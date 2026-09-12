'use client';
import { SwapTokenSelector as TokenSelector } from '@/components/transactions/swap-token-selector';
import { getBalanceShortfallMessage } from '@/lib/balance-shortfall';

import { swapAmountFontSize } from "@/components/swap-amount-layout";
import { SwapAmountCard, SWAP_EDITABLE_AMOUNT_CLASS, SWAP_OUTPUT_AMOUNT_CLASS } from '@/components/transactions/swap-amount-card';
import { SwapQuoteReview } from '@/components/transactions/swap-quote-review';
import { SwapExecutionNotice } from '@/components/transactions/swap-execution-notice';
import { useLastSwapTransaction } from '@/hooks/useLastSwapTransaction';
import { getEconomicReadState } from '@/lib/economic-read-state';
import { requireUnchangedSwapReview } from '@/lib/swap/review';
import { useSwapQuote } from '@/hooks/useSwapQuote';
import { fetchSwapJson, parseSwapBuildStep, SwapRequestError } from '@/lib/swap/response';
import { validateSwapExecution } from '@/lib/swap/calldata';
import { SwapReviewRequiredError } from '@/lib/swap/errors';
import { approveAndRebuildSwap } from '@/lib/swap/approval-flow';
import { withMonitoringAbort as withMonitorAbort, throwIfMonitoringAborted as throwIfAborted, waitForMonitorDelay } from '@/lib/transaction-monitor';
import { parseWalletBatchStatus, getBatchTransactionHashes } from '@/lib/wallet-batch-status';
import { formatEditableAmount, parseInputAmount } from '@/lib/swap/amount';

import {
  useCallback,
  useDeferredValue,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'react-hot-toast';
import { Loader2 } from 'lucide-react';
import {
  encodeFunctionData,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { base } from 'viem/chains';
import { useAccount, useBalance, useSwitchChain, useWalletClient } from 'wagmi';
import { useQuery } from '@tanstack/react-query';
import { estimateNextSwapFee, requireSwapCallFunds } from '@/lib/swap/gas';
import { swapFeeQueryKey } from '@/lib/swap/fee-query-key';

import { Button } from '@/components/ui/button';
import { DisabledReason } from '@/components/ui/premium';
import { TransactionRecoveryOptions } from '@/components/transactions/transaction-recovery-options';
import { ERC20_TOKEN_ABI } from '@/lib/swap/base-swap-abi';
import {
  BASE_CHAIN_ID,
  SWAP_QUOTE_MAX_AGE_MS,
  SWAP_TOKEN_MAP,
  USER_SWAP_TOKEN_IDS,
} from '@/lib/swap/constants';
import { getAllowedSwapTargets, sanitizeSwapDecimalInput } from '@/lib/swap/rules';
import type {
  SwapBuildStepResponse,
  SwapQuoteResponse,
  SwapQuoteStep,
  UserSwapTokenId,
} from '@/lib/swap/types';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { useTabVisibility } from '@/lib/tab-visibility-context';
import { getBaseReadClient, getBaseReceiptClient, waitForBaseReceipt } from '@/lib/base-rpc';
import { getPendingEvmReceiptTargets, throwIfTransactionSuperseded, verifyPendingEvmReceiptBinding } from '@/lib/transaction-proof-verification';
import { isDefinitivePostSubmissionError } from '@/lib/transaction-lifecycle';
import { requestBalanceRefresh } from '@/lib/app-events';
import {
  getBuilderCapabilities,
  transformCallsWithBuilderCode,
} from '@/lib/builder-code';
import { postMissionProgress } from '@/lib/mission-tracking';
import {
  extractTransactionHash,
} from '@/lib/transaction-utils';
import {
  PendingEvmStaleError,
  acknowledgePendingEvmRecord,
  canDurablyPersistPendingEvmTransactions,
  createPendingEvmCallsDigest,
  createPendingEvmRecord,
  finalizePendingEvmRecord,
  getBrowserPendingEvmStorage,
  getPendingEvmIntentDigest,
  getPendingEvmPhase,
  isDefinitivePendingEvmPreSubmissionError,
  removePendingEvmRecord,
  replacePendingEvmProof,
  withPendingEvmHardDeadline,
  withPendingEvmMonitorLease,
  withPendingEvmSubmissionGuard,
  writePendingEvmRecord,
  type PendingEvmCall,
  type PendingEvmExecutionMethod,
  type PendingEvmProof,
  type PendingEvmRecord,
} from '@/lib/pending-evm-transaction';
import {
  claimPendingEvmCoordinatorAttempt,
  promotePendingEvmCoordinatorAttemptToMonitor,
  registerPendingEvmController,
  releasePendingEvmCoordinatorAttempt,
  requestPendingEvmCoordinatorReconcile,
  type PendingEvmCoordinatorSnapshot,
} from '@/lib/pending-evm-coordinator';
import { formatTokenDisplay, formatTokenEstimate } from '@/lib/token-display';
import { SWAP_PANEL_STRINGS as S } from './pixotchi-swap-panel.strings';

type ExecutionStatus =
  | 'pending'
  | 'approving'
  | 'swapping'
  | 'confirming'
  | 'complete'
  | 'error';

type ExecutionStepState = {
  key: 'step1' | 'step2';
  label: string;
  status: ExecutionStatus;
  txHash?: Hex;
  message?: string;
};

type SmartWalletBatchCall = {
  to: Address;
  data: Hex;
  value: bigint;
};

const SWAP_APPROVAL_INTENT_KEY = 'pixotchi-swap:approval:v1';
const SWAP_EXECUTION_INTENT_KEY = 'pixotchi-swap:execution:v1';
const EMPTY_PENDING_CALLS_DIGEST = createPendingEvmCallsDigest([]);
const waitForMonitorRetry = (signal?: AbortSignal) => waitForMonitorDelay(1_000, signal);

type SwapPendingStage = 'approval' | 'swap';

type TrackedSwapSubmission<T> = {
  coordinatorSignal?: AbortSignal;
  monitorRecord: PendingEvmRecord;
  terminalRecord: PendingEvmRecord;
  value: T;
};

class SwapSubmissionBlockedError extends Error {
  constructor(message = 'Another action is still in progress. Please wait for it to finish.') {
    super(message);
    this.name = 'SwapSubmissionBlockedError';
  }
}

class SwapSubmissionAmbiguousError extends Error {
  constructor() {
    super('Confirmation delayed. Your swap may still complete.');
    this.name = 'SwapSubmissionAmbiguousError';
  }
}

class SwapTransactionRevertedError extends Error {
  constructor(message = 'Swap transaction reverted') {
    super(message);
    this.name = 'SwapTransactionRevertedError';
  }
}

function getSwapPendingIntentKey(stage: SwapPendingStage): string {
  return stage === 'approval' ? SWAP_APPROVAL_INTENT_KEY : SWAP_EXECUTION_INTENT_KEY;
}

function isAbortError(error: unknown): boolean {
  return (error as { name?: unknown })?.name === 'AbortError';
}

const OCK_COMPAT_FONT = 'ock-compat-font';
const SWAP_MAX_BUTTON_CLASS =
  `${OCK_COMPAT_FONT} flex min-h-11 cursor-pointer items-center justify-center rounded-[var(--radius-control)] px-3 py-2 text-sm font-semibold text-primary hover:bg-primary/10 disabled:pointer-events-none disabled:opacity-[0.38]`;
const SWAP_DIRECTION_BUTTON_CLASS =
  'relative z-10 mx-auto -my-5 flex h-11 min-h-11 w-16 items-center justify-center rounded-[var(--radius-control)] border-[3px] border-solid border-card/90 bg-card/95 bg-[image:var(--gradient-surface)] shadow-[var(--shadow-control)] hover:border-primary/25 hover:bg-[hsl(var(--nav-hover-bg))] active:bg-secondary focus:bg-secondary disabled:pointer-events-none disabled:opacity-[0.38]';
const SWAP_PRIMARY_ACTION_CLASS =
  `${OCK_COMPAT_FONT} mt-4 flex w-full items-center justify-center gap-2 rounded-[var(--radius-control)] bg-primary bg-[image:var(--gradient-control-active)] px-4 py-3 font-semibold text-primary-foreground disabled:pointer-events-none disabled:opacity-[0.38]`;

// Turns wallet/viem errors into something a user can actually read.
// Viem rejection errors include a pile of metadata (chain id, RPC url, version,
// request args, contract selectors...) that we never want to toast verbatim.
function humanizeSwapError(error: unknown): string {
  if (!(error instanceof Error)) return 'Swap failed.';

  const anyErr = error as Error & {
    code?: number | string;
    shortMessage?: string;
    cause?: { code?: number | string; name?: string };
  };
  const haystack = `${anyErr.shortMessage ?? ''} ${anyErr.message ?? ''}`.toLowerCase();
  const rejectionCode = 4001;
  const isRejection =
    anyErr.code === rejectionCode ||
    anyErr.cause?.code === rejectionCode ||
    anyErr.name === 'UserRejectedRequestError' ||
    anyErr.cause?.name === 'UserRejectedRequestError' ||
    /user\s+(rejected|denied)|request\s+rejected|user\s+cancell?ed/.test(haystack);

  if (isRejection) return 'Swap rejected.';

  if (anyErr.shortMessage) return anyErr.shortMessage;

  const firstLine = (anyErr.message || '').split('\n')[0]?.trim();
  return firstLine || 'Swap failed.';
}

async function fetchSwapStep(address: Address, step: SwapQuoteStep, amountIn: string, quoteToken: string, signal?: AbortSignal) {
  const response = await fetchSwapJson('/api/swap/build-step', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ quoteToken, kind: step.kind, sellToken: step.sellToken, buyToken: step.buyToken, amountIn, sender: address, recipient: address }),
    signal,
    credentials: 'same-origin',
  });
  return parseSwapBuildStep(response, step, amountIn, address);
}

export default function PixotchiSwapPanel({ isPanelVisible = true }: { isPanelVisible?: boolean }) {
  const { address, chainId, connector } = useAccount();
  const walletScopeRef = useRef({ address, chainId });
  walletScopeRef.current = { address, chainId };
  const acknowledgeLockRef = useRef(false);
  const { lastTransaction, remember: rememberTransaction } = useLastSwapTransaction(address);
  const { data: walletClient } = useWalletClient();
  const { isPending: isSwitchingChain, switchChainAsync } = useSwitchChain();
  const { isSmartWallet } = useSmartWallet();
  const { isTabVisible } = useTabVisibility();
  const readClient = useMemo(() => getBaseReadClient(), []);
  const [sellToken, setSellToken] = useState<UserSwapTokenId>('ETH');
  const [buyToken, setBuyToken] = useState<UserSwapTokenId>('SEED');
  const [sellAmount, setSellAmount] = useState('');
  const deferredSellAmount = useDeferredValue(sellAmount);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isSettingMax, setIsSettingMax] = useState(false);
  const maxRequestRef = useRef<AbortController | null>(null);
  const [isRecoveryChecking, setIsRecoveryChecking] = useState(true);
  const [isPeerBlocked, setIsPeerBlocked] = useState(false);
  const [pendingFeedbackRecord, setPendingFeedbackRecord] = useState<PendingEvmRecord | null>(null);
  const pendingFeedbackRecordRef = useRef(pendingFeedbackRecord);
  pendingFeedbackRecordRef.current = pendingFeedbackRecord;
  const [executionSteps, setExecutionSteps] = useState<ExecutionStepState[] | null>(null);
  const balanceRefreshTimerRef = useRef<number | null>(null);
  const completionResetTimerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const executingRef = useRef(false);
  const activePendingRecordRef = useRef<PendingEvmRecord | null>(null);
  const coordinatorSnapshotsRef = useRef<Record<SwapPendingStage, PendingEvmCoordinatorSnapshot | null>>({
    approval: null,
    swap: null,
  });
  // Keep labels/status ids instance-safe if this panel is ever mounted in both
  // a responsive surface and a dialog during a layout transition.
  const panelId = useId();
  const approvalControllerId = `${panelId}:swap-approval`;
  const swapControllerId = `${panelId}:swap-execution`;
  const messageId = `pixotchi-swap-message-${panelId}`;
  const sellAmountId = `pixotchi-swap-sell-amount-${panelId}`;
  const isVisible = isTabVisible('swap') && isPanelVisible;
  const recoveryRegistryIdentity = useMemo(
    () => walletClient?.account
      ? {
          accountAddress: walletClient.account.address,
          chainId: BASE_CHAIN_ID,
        }
      : null,
    [walletClient],
  );

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (balanceRefreshTimerRef.current !== null) {
        window.clearTimeout(balanceRefreshTimerRef.current);
      }
      if (completionResetTimerRef.current !== null) {
        window.clearTimeout(completionResetTimerRef.current);
      }
    };
  }, []);

  const {
    data: sellBalanceData,
    isFetching: sellBalanceFetching,
    error: sellBalanceError,
    refetch: refetchSellBalance,
  } = useBalance({
    address,
    chainId: BASE_CHAIN_ID,
    token:
      sellToken === 'ETH'
        ? undefined
        : (SWAP_TOKEN_MAP[sellToken].address as Address | undefined),
    query: {
      enabled: Boolean(address),
    },
  });
  const {
    data: buyBalanceData,
    isFetching: buyBalanceFetching,
    error: buyBalanceError,
    refetch: refetchBuyBalance,
  } = useBalance({
    address,
    chainId: BASE_CHAIN_ID,
    token:
      buyToken === 'ETH'
        ? undefined
        : (SWAP_TOKEN_MAP[buyToken].address as Address | undefined),
    query: {
      enabled: Boolean(address),
    },
  });
  const { data: ethBalanceData, isFetching: ethBalanceFetching, error: ethBalanceError, refetch: refetchEthBalance } = useBalance({
    address,
    chainId: BASE_CHAIN_ID,
    query: {
      enabled: Boolean(address),
    },
  });

  const allowedTargets = useMemo(
    () => getAllowedSwapTargets(sellToken),
    [sellToken],
  );
  const allowedSources = useMemo(
    () =>
      USER_SWAP_TOKEN_IDS.filter((tokenId) =>
        getAllowedSwapTargets(tokenId).includes(buyToken),
      ),
    [buyToken],
  );
  const parsedAmount = useMemo(
    () => parseInputAmount(deferredSellAmount, sellToken),
    [deferredSellAmount, sellToken],
  );
  const sellBalanceRaw = sellBalanceData?.value ?? BigInt(0);
  const sellReadState = getEconomicReadState({ hasSnapshot: sellBalanceData !== undefined, identityMatches: Boolean(address), loading: sellBalanceFetching, error: sellBalanceError });
  const buyReadState = getEconomicReadState({ hasSnapshot: buyBalanceData !== undefined, identityMatches: Boolean(address), loading: buyBalanceFetching, error: buyBalanceError });
  const ethReadState = getEconomicReadState({ hasSnapshot: ethBalanceData !== undefined, identityMatches: Boolean(address), loading: ethBalanceFetching, error: ethBalanceError });
  const sellBalanceText = useMemo(() => {
    if (!address) return '';
    if (sellReadState === 'loading' && !sellBalanceData) return S.labels.loadingBalance;
    if (sellReadState === 'error' && !sellBalanceData) return 'Balance unavailable';

    return `${S.labels.balancePrefix}${formatTokenDisplay(
      sellBalanceRaw,
      SWAP_TOKEN_MAP[sellToken].decimals,
      sellToken === 'USDC' ? 2 : 6,
    )}${sellReadState === 'error' ? ' (last known)' : ''}`;
  }, [address, sellReadState, sellBalanceData, sellBalanceRaw, sellToken]);
  const buyBalanceText = useMemo(() => {
    if (!address) return '';
    if (buyReadState === 'loading' && !buyBalanceData) return S.labels.loadingBalance;
    if (buyReadState === 'error' && !buyBalanceData) return 'Balance unavailable';

    return `${S.labels.balancePrefix}${formatTokenDisplay(
      buyBalanceData?.value ?? BigInt(0),
      SWAP_TOKEN_MAP[buyToken].decimals,
      buyToken === 'USDC' ? 2 : 6,
    )}${buyReadState === 'error' ? ' (last known)' : ''}`;
  }, [address, buyBalanceData, buyReadState, buyToken]);

  const { quoteState, fetchQuoteOnce, refreshQuoteNow, markQuoteActivity } = useSwapQuote({
    address, sellToken, buyToken, amountIn: parsedAmount, visible: isVisible, executing: isExecuting,
    deferred: deferredSellAmount !== sellAmount,
  });
  const currentQuote = quoteState.status === 'ready' ? quoteState.quote : null;
  const buyAmountDisplay =
    currentQuote && currentQuote.strategy !== 'blocked'
      ? formatTokenEstimate(
          BigInt(currentQuote.expectedOut),
          SWAP_TOKEN_MAP[buyToken].decimals,
          6,
        )
      : '—';
  const isAmountValid = Boolean(parsedAmount && parsedAmount > BigInt(0));
  const isDeferredLagging = sellAmount !== deferredSellAmount;
  const hasInsufficientBalance = Boolean(
    address && sellBalanceData !== undefined && !sellBalanceError &&
      parsedAmount &&
      parsedAmount > BigInt(0) &&
      parsedAmount > sellBalanceRaw,
  );
  const insufficientBalanceMessage = hasInsufficientBalance && parsedAmount
    ? getBalanceShortfallMessage(sellBalanceRaw, parsedAmount, SWAP_TOKEN_MAP[sellToken].displaySymbol, SWAP_TOKEN_MAP[sellToken].decimals)
    : null;
  const usesSmartWalletBatch =
    isSmartWallet &&
    typeof walletClient?.sendCalls === 'function' &&
    typeof walletClient?.waitForCallsStatus === 'function';
  const spendingReadsReady = sellReadState === 'ready' && ethReadState === 'ready';
  // Retain labels during a same-wallet refresh, but keep the spending gate below.
  const hasSpendingSnapshot = sellBalanceData !== undefined && (
    ethBalanceData !== undefined
  );
  const balanceReadError = Boolean(sellBalanceError || buyBalanceError || ethBalanceError);
  const retrySwapBalances = useCallback(() => Promise.allSettled([refetchSellBalance(), refetchBuyBalance(), refetchEthBalance()]), [refetchBuyBalance, refetchEthBalance, refetchSellBalance]);
  const feeQuery = useQuery({
    queryKey: swapFeeQueryKey(address, chainId, currentQuote),
    queryFn: async ({ signal }) => {
      if (!address || !currentQuote?.quoteToken || !currentQuote.steps[0]) throw new Error('A fresh quote is required.');
      const step = currentQuote.steps[0];
      const built = await fetchSwapStep(address, step, step.amountIn, currentQuote.quoteToken, signal);
      return estimateNextSwapFee(readClient, address, built);
    },
    enabled: Boolean(address && chainId === BASE_CHAIN_ID && currentQuote?.quoteToken && currentQuote.strategy !== 'blocked' && isAmountValid && !hasInsufficientBalance && !usesSmartWalletBatch && isVisible && !isExecuting),
    staleTime: 10_000,
    refetchInterval: isVisible && !isExecuting ? 15_000 : false,
    retry: 1,
  });
  const feeUnavailable = !usesSmartWalletBatch && Boolean(currentQuote?.quoteToken) && (feeQuery.isError || !feeQuery.data);
  const requiredEthForSwap = (sellToken === 'ETH' && parsedAmount ? parsedAmount : BigInt(0)) + (usesSmartWalletBatch ? BigInt(0) : feeQuery.data?.fee ?? BigInt(0));
  const hasInsufficientGas = Boolean(
    address &&
      currentQuote &&
      currentQuote.strategy !== 'blocked' &&
      isAmountValid &&
      ethBalanceData?.value !== undefined &&
      ethBalanceData.value < requiredEthForSwap,
  );
  const actionDisabled =
    isExecuting ||
    isSettingMax ||
    isRecoveryChecking ||
    isPeerBlocked ||
    !spendingReadsReady ||
    !currentQuote ||
    currentQuote.strategy === 'blocked' ||
    !isAmountValid ||
    isDeferredLagging ||
    chainId !== BASE_CHAIN_ID ||
    !walletClient?.account ||
    hasInsufficientBalance ||
    feeUnavailable ||
    hasInsufficientGas;

  const swapMessage = useMemo(() => {
    if (pendingFeedbackRecord) {
      return getPendingEvmPhase(pendingFeedbackRecord) === 'stale'
        ? 'Confirmation delayed.'
        : pendingFeedbackRecord.proof.kind === 'reservation'
          ? 'Confirmation delayed.'
          : 'A previous action is still being confirmed.';
    }

    if (isPeerBlocked) {
      return 'Another action is still in progress. Please wait for it to finish.';
    }

    if (currentQuote?.strategy === 'blocked') {
      return currentQuote.blockedReason || S.errors.blockedPairFallback;
    }

    if (quoteState.status === 'error') {
      return quoteState.error;
    }

    if (chainId !== BASE_CHAIN_ID) {
      return S.errors.switchToBase;
    }

    if (!walletClient?.account) {
      return S.errors.walletClientUnavailable;
    }

    if (!isAmountValid && sellAmount.trim()) {
      return S.errors.enterValidAmount(SWAP_TOKEN_MAP[sellToken].displaySymbol);
    }

    if (hasInsufficientBalance) {
      return insufficientBalanceMessage;
    }

    if (hasInsufficientGas) {
      return '\u00A0';
    }

    if (!executionSteps?.[0]) {
      return '\u00A0';
    }

    const step = executionSteps[0];
    if (step.status === 'approving') {
      return step.message || S.execution.approveToken;
    }
    if (step.status === 'swapping') {
      return (
        step.message ||
        `Swapping ${SWAP_TOKEN_MAP[sellToken].displaySymbol} for ${SWAP_TOKEN_MAP[buyToken].displaySymbol}`
      );
    }
    if (step.status === 'confirming') {
      return step.message || S.execution.transactionPending;
    }
    if (step.status === 'complete') {
      const completionMessage = step.message?.trim();
      return completionMessage && !/^0x[0-9a-fA-F]{64}$/.test(completionMessage)
        ? completionMessage
        : S.execution.completed;
    }
    if (step.status === 'error') {
      return step.message || S.execution.generic;
    }
    return '\u00A0';
  }, [
    insufficientBalanceMessage,
    buyToken,
    chainId,
    currentQuote,
    executionSteps,
    hasInsufficientBalance,
    hasInsufficientGas,
    isAmountValid,
    isPeerBlocked,
    pendingFeedbackRecord,
    quoteState,
    sellAmount,
    sellToken,
    walletClient?.account,
  ]);

  useEffect(() => {
    if (!allowedTargets.includes(buyToken)) {
      setBuyToken(allowedTargets[0]);
    }
  }, [allowedTargets, buyToken]);

  useEffect(() => { setExecutionSteps(null); }, [sellToken, buyToken]);

  const trackSwapMission = useCallback(
    async (receipt: TransactionReceipt) => {
      if (!address) return;
      const txHash = extractTransactionHash(receipt);
      if (!txHash) return;

      const payload: Record<string, unknown> = {
        address,
        taskId: 's1_make_swap',
        proof: { txHash },
      };

      try {
        await postMissionProgress(payload);
      } catch (error) {
        console.warn('[PixotchiSwapPanel] Failed to track mission', error);
      }
    },
    [address],
  );

  const updateExecutionStep = useCallback(
    (stepIndex: number, updates: Partial<ExecutionStepState>) => {
      setExecutionSteps((current) => {
        if (!current) return current;
        return current.map((step, index) =>
          index === stepIndex ? { ...step, ...updates } : step,
        );
      });
    },
    [],
  );

  const buildStep = useCallback(
    async (
      step: SwapQuoteStep,
      amountIn: string,
      quoteToken: string,
      signal?: AbortSignal,
    ) => {
      if (!address) {
        throw new Error(S.errors.connectWallet);
      }

      return fetchSwapStep(address, step, amountIn, quoteToken, signal);
    },
    [address],
  );

  const readAllowance = useCallback(
    async (
      token: Address,
      owner: Address,
      spender: Address,
      blockNumber?: bigint,
    ): Promise<bigint> => {
      const result = await readClient.readContract({
        address: token,
        abi: ERC20_TOKEN_ABI,
        functionName: 'allowance',
        args: [owner, spender],
        ...(blockNumber !== undefined ? { blockNumber } : {}),
      });
      if (typeof result !== 'bigint') {
        throw new Error('Unexpected allowance result type');
      }
      return result;
    },
    [readClient],
  );

  const submitTrackedAttempt = useCallback(
    async <T,>({
      calls,
      method,
      stage,
      submit,
    }: {
      calls: PendingEvmCall[];
      method: PendingEvmExecutionMethod;
      stage: SwapPendingStage;
      submit: () => Promise<{
        proof: Exclude<PendingEvmProof, { kind: 'reservation' }>;
        value: T;
      }>;
    }): Promise<TrackedSwapSubmission<T>> => {
      if (!walletClient?.account) {
        throw new Error(S.errors.walletClientUnavailable);
      }

      const registry = {
        accountAddress: walletClient.account.address,
        chainId: BASE_CHAIN_ID,
      };
      const controllerId = stage === 'approval' ? approvalControllerId : swapControllerId;
      const storage = getBrowserPendingEvmStorage();
      if (!canDurablyPersistPendingEvmTransactions(storage)) {
        throw new Error(
          'We need browser storage to keep your transaction safe. Enable site storage and try again.',
        );
      }

      const callsDigest = createPendingEvmCallsDigest(calls);
      const guarded = await withPendingEvmSubmissionGuard(storage, registry, async () => {
        const reservation = createPendingEvmRecord({
          callsDigest,
          ...(method === 'batch' ? { connectorId: connector?.id ?? 'unavailable' } : {}),
          identity: {
            ...registry,
            intentKey: getSwapPendingIntentKey(stage),
          },
          method,
          proof: { kind: 'reservation' },
        });

        if (!claimPendingEvmCoordinatorAttempt(registry, reservation, controllerId)) {
          throw new SwapSubmissionBlockedError();
        }
        activePendingRecordRef.current = reservation;
        if (!writePendingEvmRecord(storage, reservation)) {
          removePendingEvmRecord(storage, reservation);
          releasePendingEvmCoordinatorAttempt(registry, reservation, controllerId);
          activePendingRecordRef.current = null;
          throw new Error(
            'We need browser storage to keep your transaction safe. Enable site storage and try again.',
          );
        }

        try {
          const submitted = await withPendingEvmHardDeadline(submit(), reservation);
          const finalized = finalizePendingEvmRecord(storage, reservation, submitted.proof);
          const monitorRecord = finalized?.record ?? createPendingEvmRecord({
            attemptId: reservation.attemptId,
            callsDigest,
            ...(method === 'batch' ? { connectorId: connector?.id ?? 'unavailable' } : {}),
            identity: {
              ...registry,
              intentKey: getSwapPendingIntentKey(stage),
            },
            method,
            proof: submitted.proof,
          });
          const terminalRecord = finalized?.blocker ?? reservation;
          activePendingRecordRef.current = terminalRecord;

          const coordinatorSignal = finalized?.persisted
            ? promotePendingEvmCoordinatorAttemptToMonitor(
                registry,
                monitorRecord,
                controllerId,
              ) ?? undefined
            : undefined;
          if (!finalized?.persisted) {
            console.warn(
              '[PixotchiSwapPanel] Transaction proof could not replace its durable reservation; the reservation remains locked while this page monitors the returned proof.',
            );
          }

          return {
            coordinatorSignal,
            monitorRecord,
            terminalRecord,
            value: submitted.value,
          };
        } catch (error) {
          const canRelease = isDefinitivePendingEvmPreSubmissionError(error);
          if (canRelease && removePendingEvmRecord(storage, reservation)) {
            activePendingRecordRef.current = null;
            releasePendingEvmCoordinatorAttempt(registry, reservation, controllerId);
            throw error;
          }

          releasePendingEvmCoordinatorAttempt(registry, reservation, controllerId);
          requestPendingEvmCoordinatorReconcile(registry);
          throw new SwapSubmissionAmbiguousError();
        }
      });

      if (!guarded.acquired || !guarded.value.submitted) {
        requestPendingEvmCoordinatorReconcile(registry);
        throw new SwapSubmissionBlockedError();
      }
      return guarded.value.value;
    },
    [approvalControllerId, connector?.id, swapControllerId, walletClient],
  );

  const monitorCanonicalHash = useCallback(
    async (
      record: PendingEvmRecord,
      hash: Hex,
      stepIndex: number,
      signal?: AbortSignal,
      onRecord?: (record: PendingEvmRecord) => void,
      walletTransactionHashes?: readonly Hex[],
    ): Promise<TransactionReceipt> => {
      let retryAttempt = 0;
      let currentHash = hash;
      let currentRecord = record;
      while (true) {
        try {
          const receipt = await withMonitorAbort(
            withPendingEvmHardDeadline(waitForBaseReceipt(currentHash, {
              onReplaced: ({ reason, transaction }) => {
                const previousHash = currentHash;
                currentHash = transaction.hash;
                if (!signal?.aborted && walletScopeRef.current.address?.toLowerCase() === record.accountAddress.toLowerCase()) {
                  updateExecutionStep(stepIndex, { status: 'confirming', txHash: currentHash });
                }
                const replacement = {
                  disposition: reason === 'replaced' ? 'superseded' as const : reason,
                  previousHash, transactionHash: currentHash,
                  ...((currentRecord.initialTransactionHash
                    || (currentRecord.proof.kind === 'calls' && !currentRecord.proof.hash)
                    || currentRecord.replacement?.verified) ? { verified: true as const } : {}),
                };
                const next = replacePendingEvmProof(getBrowserPendingEvmStorage(), currentRecord,
                  currentRecord.proof.kind === 'calls'
                    ? { kind: 'calls', id: currentRecord.proof.id, hash: currentHash }
                    : { kind: 'hash', hash: currentHash }, replacement);
                if (next) {
                  currentRecord = next;
                  onRecord?.(next);
                } else {
                  // Keep the observed disposition even if another record owner
                  // won persistence; never credit a known changed-call receipt.
                  currentRecord = { ...currentRecord, replacement:
                    currentRecord.replacement?.disposition === 'superseded' || currentRecord.replacement?.disposition === 'cancelled'
                      ? currentRecord.replacement : replacement };
                }
              },
            }), currentRecord),
            signal,
          );
          throwIfTransactionSuperseded(currentRecord);
          if (receipt.status !== 'success') throw new SwapTransactionRevertedError();
          if (receipt.status === 'success') {
            await withMonitorAbort(withPendingEvmHardDeadline(verifyPendingEvmReceiptBinding({
              record: currentRecord, transactionHash: receipt.transactionHash, walletTransactionHashes,
              getTransaction: transactionHash => getBaseReceiptClient().getTransaction({ hash: transactionHash }),
            }), currentRecord), signal);
          }
          return receipt;
        } catch (error) {
          if (isAbortError(error) || error instanceof PendingEvmStaleError || isDefinitivePostSubmissionError(error)) throw error;
          updateExecutionStep(stepIndex, {
            status: 'confirming',
            txHash: currentHash,
            message: retryAttempt === 0
              ? S.execution.transactionPending
              : 'Confirmation is taking a little longer. Still checking your transaction…',
          });
          retryAttempt += 1;
          await waitForMonitorRetry(signal);
        }
      }
    },
    [updateExecutionStep],
  );

  const monitorBatchSubmission = useCallback(
    async (
      record: PendingEvmRecord,
      stepIndex: number,
      signal?: AbortSignal,
      onRecord?: (record: PendingEvmRecord) => void,
    ): Promise<TransactionReceipt> => {
      if (record.proof.kind !== 'calls' || typeof walletClient?.waitForCallsStatus !== 'function') {
        throw new Error('Wallet batch confirmation is unavailable.');
      }

      while (true) {
        try {
          const result = await withMonitorAbort(
            withPendingEvmHardDeadline(
              walletClient.waitForCallsStatus({
                id: record.proof.id,
                timeout: 120_000,
                throwOnFailure: false,
              }),
              record,
            ),
            signal,
          );
          const batch = parseWalletBatchStatus(result, BASE_CHAIN_ID);
          const status = batch.status;
          if (status === 'failure') {
            throw new SwapTransactionRevertedError();
          }
          if (status !== 'success') {
            await waitForMonitorRetry(signal);
            continue;
          }

          const hashes = getBatchTransactionHashes(batch);
          const transactionHash = hashes[hashes.length - 1];
          if (!transactionHash) {
            updateExecutionStep(stepIndex, {
              status: 'confirming',
              message: S.execution.transactionPending,
            });
            await waitForMonitorRetry(signal);
            continue;
          }

          // A batch may include several receipts. Verify each before crediting the swap.
          let receipt: TransactionReceipt | undefined;
          let currentRecord = record;
          const receiptHashes = getPendingEvmReceiptTargets(record, hashes);
          for (const hash of receiptHashes) receipt = await monitorCanonicalHash(currentRecord, hash, stepIndex, signal, next => {
            currentRecord = next;
            onRecord?.(next);
          }, hashes);
          if (!receipt) throw new Error('Missing canonical swap receipt');
          return receipt;
        } catch (error) {
          if (
            isAbortError(error) ||
            error instanceof PendingEvmStaleError ||
            error instanceof SwapTransactionRevertedError || isDefinitivePostSubmissionError(error)
          ) {
            throw error;
          }
          updateExecutionStep(stepIndex, {
            status: 'confirming',
            message: 'Confirmation is taking a little longer. Still checking your transaction…',
          });
          await waitForMonitorRetry(signal);
        }
      }
    },
    [monitorCanonicalHash, updateExecutionStep, walletClient],
  );

  const monitorTrackedSubmission = useCallback(
    async (
      stage: SwapPendingStage,
      monitorRecord: PendingEvmRecord,
      terminalRecord: PendingEvmRecord,
      stepIndex: number,
      signal?: AbortSignal,
    ): Promise<{ ownsTerminal: boolean; receipt: TransactionReceipt }> => {
      const storage = getBrowserPendingEvmStorage();
      const registry = {
        accountAddress: monitorRecord.accountAddress,
        chainId: monitorRecord.chainId,
      };
      const controllerId = stage === 'approval' ? approvalControllerId : swapControllerId;
      const lease = await withPendingEvmMonitorLease(
        storage,
        monitorRecord,
        async (isLeaseCurrent) => {
          let receipt: TransactionReceipt;
          let currentTerminalRecord = terminalRecord;
          const onReplacement = (next: PendingEvmRecord) => {
            currentTerminalRecord = next;
            if (activePendingRecordRef.current?.attemptId === next.attemptId) activePendingRecordRef.current = next;
          };
          try {
            if (monitorRecord.method === 'direct') {
              if (monitorRecord.proof.kind !== 'hash') {
                throw new Error('Direct transaction hash is missing.');
              }
              receipt = await monitorCanonicalHash(
                monitorRecord,
                monitorRecord.proof.hash,
                stepIndex,
                signal,
                onReplacement,
              );
            } else {
              receipt = await monitorBatchSubmission(monitorRecord, stepIndex, signal, onReplacement);
            }
          } catch (error) {
            if (!(error instanceof SwapTransactionRevertedError) && !isDefinitivePostSubmissionError(error)) throw error;
            throwIfAborted(signal);
            if (!isLeaseCurrent()) {
              throw new DOMException('Transaction confirmation ownership changed.', 'AbortError');
            }
            const ownsTerminal = removePendingEvmRecord(storage, currentTerminalRecord);
            releasePendingEvmCoordinatorAttempt(
              registry,
              terminalRecord,
              controllerId,
            );
            requestPendingEvmCoordinatorReconcile(registry);
            if (!ownsTerminal) {
              throw new DOMException('Transaction confirmation ownership changed.', 'AbortError');
            }
            if (activePendingRecordRef.current?.attemptId === terminalRecord.attemptId) {
              activePendingRecordRef.current = null;
            }
            throw error;
          }

          throwIfAborted(signal);
          if (!isLeaseCurrent()) {
            throw new DOMException('Transaction confirmation ownership changed.', 'AbortError');
          }
          const ownsTerminal = removePendingEvmRecord(storage, currentTerminalRecord);
          if (ownsTerminal && activePendingRecordRef.current?.attemptId === terminalRecord.attemptId) {
            activePendingRecordRef.current = null;
          }
          releasePendingEvmCoordinatorAttempt(
            registry,
            terminalRecord,
            controllerId,
          );
          requestPendingEvmCoordinatorReconcile(registry);
          return { ownsTerminal, receipt };
        },
        { allowQueuedProofFlush: true },
      );

      if (!lease.acquired) {
        throw new DOMException(
          'Transaction confirmation is being checked in another tab.',
          'AbortError',
        );
      }
      return lease.value;
    },
    [
      approvalControllerId,
      monitorBatchSubmission,
      monitorCanonicalHash,
      swapControllerId,
    ],
  );

  const ensureApproval = useCallback(
    async (
      approval: NonNullable<SwapBuildStepResponse['approval']>,
      stepIndex: number,
    ) => {
      if (!address || !walletClient?.account) {
        throw new Error(S.errors.walletClientUnavailable);
      }

      const requiredAmount = BigInt(approval.requiredAmount);
      const currentAllowance = await readAllowance(
        approval.token,
        address,
        approval.spender,
      );

      if (currentAllowance >= requiredAmount) {
        return;
      }

      updateExecutionStep(stepIndex, {
        status: 'approving',
        message: S.execution.approveToken,
      });

      const approvalCall = {
        to: approval.token,
        data: encodeFunctionData({
          abi: ERC20_TOKEN_ABI,
          functionName: 'approve',
          args: [approval.spender, requiredAmount],
        }),
        value: BigInt(0),
      };
      await requireSwapCallFunds(readClient, address, approvalCall);
      const submitted = await submitTrackedAttempt({
        calls: [approvalCall],
        method: 'direct',
        stage: 'approval',
        submit: async () => {
          if (walletScopeRef.current.address?.toLowerCase() !== address.toLowerCase() || walletScopeRef.current.chainId !== BASE_CHAIN_ID) {
            throw new DOMException('The swap wallet changed.', 'AbortError');
          }
          // Exact-amount approval prevents unbounded risk if the spender is ever
          // compromised. The durable reservation is written before this wallet
          // call, and its hash replaces that reservation before monitoring.
          const hash = await walletClient.writeContract({
            address: approval.token,
            abi: ERC20_TOKEN_ABI,
            functionName: 'approve',
            args: [approval.spender, requiredAmount],
            account: walletClient.account,
            chain: base,
          });
          return {
            proof: { hash, kind: 'hash' as const },
            value: hash,
          };
        },
      });

      updateExecutionStep(stepIndex, {
        status: 'confirming',
        txHash: submitted.value,
        message: submitted.value,
      });
      const monitored = await monitorTrackedSubmission(
        'approval',
        submitted.monitorRecord,
        submitted.terminalRecord,
        stepIndex,
        submitted.coordinatorSignal,
      );
      if (!monitored.ownsTerminal) {
        throw new DOMException('Approval confirmation ownership changed.', 'AbortError');
      }
      if (monitored.receipt.status !== 'success') {
        throw new Error('Approval transaction reverted.');
      }
      rememberTransaction(extractTransactionHash(monitored.receipt), 'approval');

      // Belt-and-suspenders: re-read allowance after confirmation so the next
      // transaction sees state at the canonical receipt block, never a lagging
      // provider's provisional `latest` view.
      const postAllowance = await readAllowance(
        approval.token,
        address,
        approval.spender,
        monitored.receipt.blockNumber,
      );
      if (postAllowance < requiredAmount) {
        throw new Error('Approval confirmed but allowance is still insufficient.');
      }
    },
    [
      address,
      monitorTrackedSubmission,
      readAllowance,
      readClient,
      rememberTransaction,
      submitTrackedAttempt,
      updateExecutionStep,
      walletClient,
    ],
  );

  const executeSmartWalletSwapBatch = useCallback(
    async (
      builtStep: SwapBuildStepResponse,
      stepIndex: number,
      approval?: NonNullable<SwapBuildStepResponse['approval']>,
    ): Promise<TransactionReceipt> => {
      if (
        !address ||
        !walletClient?.account ||
        typeof walletClient.sendCalls !== 'function' ||
        typeof walletClient.waitForCallsStatus !== 'function'
      ) {
        throw new Error(S.errors.walletClientUnavailable);
      }

      const calls: SmartWalletBatchCall[] = [];
      validateSwapExecution(builtStep, { sender: address, recipient: address, sellToken: builtStep.step.sellToken,
        buyToken: builtStep.step.buyToken, amountIn: builtStep.step.amountIn, minOut: builtStep.step.minOut });
      if (approval) {
        const requiredAmount = BigInt(approval.requiredAmount);
        calls.push({
          to: approval.token,
          data: encodeFunctionData({
            abi: ERC20_TOKEN_ABI,
            functionName: 'approve',
            args: [approval.spender, requiredAmount],
          }),
          value: BigInt(0),
        });
      }
      calls.push({
        to: builtStep.transaction.to,
        data: builtStep.transaction.data,
        value: BigInt(builtStep.transaction.value),
      });

      const transformedCalls = transformCallsWithBuilderCode<SmartWalletBatchCall>(
        calls,
      );

      updateExecutionStep(stepIndex, {
        status: 'swapping',
        message: approval
          ? S.execution.approvingAndSwapping
          : builtStep.step.routeLabel,
      });

      const submitted = await submitTrackedAttempt({
        calls: transformedCalls,
        method: 'batch',
        stage: 'swap',
        submit: async () => {
          if (walletScopeRef.current.address?.toLowerCase() !== address.toLowerCase() || walletScopeRef.current.chainId !== BASE_CHAIN_ID) {
            throw new DOMException('The swap wallet changed.', 'AbortError');
          }
          validateSwapExecution(builtStep, { sender: address, recipient: address, sellToken: builtStep.step.sellToken,
            buyToken: builtStep.step.buyToken, amountIn: builtStep.step.amountIn, minOut: builtStep.step.minOut });
          const batch = await walletClient.sendCalls({
            account: walletClient.account,
            chain: base,
            calls: transformedCalls,
            capabilities: getBuilderCapabilities(),
            forceAtomic: true,
          });
          if (typeof batch.id !== 'string' || batch.id.trim() === '') {
            throw new Error('Wallet returned no transaction id.');
          }
          return {
            proof: { id: batch.id, kind: 'calls' as const },
            value: batch.id,
          };
        },
      });

      updateExecutionStep(stepIndex, {
        status: 'confirming',
        message: S.execution.transactionPending,
      });
      const monitored = await monitorTrackedSubmission(
        'swap',
        submitted.monitorRecord,
        submitted.terminalRecord,
        stepIndex,
        submitted.coordinatorSignal,
      );
      if (!monitored.ownsTerminal) {
        throw new DOMException('Swap confirmation ownership changed.', 'AbortError');
      }
      if (monitored.receipt.status !== 'success') {
        throw new Error('Swap transaction reverted');
      }

      const txHash = extractTransactionHash(monitored.receipt) as Hex | undefined;
      updateExecutionStep(stepIndex, {
        status: 'complete',
        txHash,
        message: txHash,
      });

      return monitored.receipt;
    },
    [
      address,
      monitorTrackedSubmission,
      submitTrackedAttempt,
      updateExecutionStep,
      walletClient,
    ],
  );

  const executeSingleStep = useCallback(
    async (
      quote: SwapQuoteResponse,
      step: SwapQuoteStep,
      stepIndex: number,
    ): Promise<TransactionReceipt> => {
      if (!walletClient?.account) {
        throw new Error(S.errors.connectWallet);
      }
      if (!quote.quoteToken) {
        throw new Error('Quote token is missing. Please refresh and try again.');
      }

      if (quote.strategy !== 'single_kyber' || quote.steps.length !== 1 || step.key !== 'step1' || step.kind !== 'kyber') {
        throw new Error('Only a single Kyber swap can be executed.');
      }
      const amountIn = step.amountIn;
      let builtStep = await buildStep(step, amountIn, quote.quoteToken);
      const canUseSmartWalletBatch =
        isSmartWallet &&
        typeof walletClient?.sendCalls === 'function' &&
        typeof walletClient?.waitForCallsStatus === 'function';
      if (canUseSmartWalletBatch) {
        // The bundler estimates account-execution fees and sponsorship. Native
        // swap value still has to be funded by the connected account.
        if (address && await readClient.getBalance({ address }) < BigInt(builtStep.transaction.value)) {
          throw new Error(S.errors.insufficientSwapValue);
        }
        return executeSmartWalletSwapBatch(
          builtStep,
          stepIndex,
          builtStep.approval ?? undefined,
        );
      }

      if (builtStep.approval) {
        builtStep = await approveAndRebuildSwap({ reviewed: quote, built: builtStep,
          approve: approval => ensureApproval(approval, stepIndex), refresh: refreshQuoteNow,
          build: fresh => buildStep(fresh.steps[0], amountIn, fresh.quoteToken!),
        });
      }

      updateExecutionStep(stepIndex, {
        status: 'swapping',
        message: builtStep.step.routeLabel,
      });

      const swapCall = {
        to: builtStep.transaction.to,
        data: builtStep.transaction.data,
        value: BigInt(builtStep.transaction.value),
      };
      await requireSwapCallFunds(readClient, walletClient.account.address, swapCall);
      const submitted = await submitTrackedAttempt({
        calls: [swapCall],
        method: 'direct',
        stage: 'swap',
        submit: async () => {
          const sender = walletClient.account.address;
          if (walletScopeRef.current.address?.toLowerCase() !== sender.toLowerCase() || walletScopeRef.current.chainId !== BASE_CHAIN_ID) {
            throw new DOMException('The swap wallet changed.', 'AbortError');
          }
          validateSwapExecution(builtStep, { sender, recipient: sender, sellToken: step.sellToken,
            buyToken: step.buyToken, amountIn, minOut: step.minOut });
          const hash = await walletClient.sendTransaction({
            to: builtStep.transaction.to,
            data: builtStep.transaction.data,
            value: BigInt(builtStep.transaction.value),
            account: walletClient.account,
            chain: base,
          });
          return {
            proof: { hash, kind: 'hash' as const },
            value: hash,
          };
        },
      });

      updateExecutionStep(stepIndex, {
        status: 'confirming',
        txHash: submitted.value,
        message: submitted.value,
      });
      const monitored = await monitorTrackedSubmission(
        'swap',
        submitted.monitorRecord,
        submitted.terminalRecord,
        stepIndex,
        submitted.coordinatorSignal,
      );
      if (!monitored.ownsTerminal) {
        throw new DOMException('Swap confirmation ownership changed.', 'AbortError');
      }
      if (monitored.receipt.status !== 'success') {
        throw new Error('Swap transaction reverted');
      }

      updateExecutionStep(stepIndex, {
        status: 'complete',
        txHash: monitored.receipt.transactionHash,
        message: monitored.receipt.transactionHash,
      });

      return monitored.receipt;
    },
    [
      address,
      buildStep,
      refreshQuoteNow,
      ensureApproval,
      executeSmartWalletSwapBatch,
      isSmartWallet,
      readClient,
      monitorTrackedSubmission,
      submitTrackedAttempt,
      updateExecutionStep,
      walletClient,
    ],
  );

  const finalizeSwapSuccess = useCallback(
    async (receipt: TransactionReceipt) => {
      const transactionHash = extractTransactionHash(receipt);
      rememberTransaction(transactionHash, 'swap');
      // One receipt-keyed global reconciliation and one pair-specific pass.
      // Both are delayed just enough for lagging RPC replicas, and both are
      // cancellable/coalesced instead of accumulating after repeated swaps.
      requestBalanceRefresh({
        address,
        delayMs: 750,
        source: 'swap',
        transactionHash,
      });
      if (balanceRefreshTimerRef.current !== null) {
        window.clearTimeout(balanceRefreshTimerRef.current);
      }
      balanceRefreshTimerRef.current = window.setTimeout(() => {
        balanceRefreshTimerRef.current = null;
        void Promise.allSettled([
          refetchSellBalance(),
          refetchBuyBalance(),
          refetchEthBalance(),
        ]);
      }, 750);

      await trackSwapMission(receipt);
      toast.success(S.execution.completed);

      if (completionResetTimerRef.current !== null) {
        window.clearTimeout(completionResetTimerRef.current);
      }
      completionResetTimerRef.current = window.setTimeout(() => {
        completionResetTimerRef.current = null;
        setExecutionSteps(null);
      }, 2200);
    },
    [
      address,
      refetchBuyBalance,
      refetchEthBalance,
      refetchSellBalance,
      rememberTransaction,
      trackSwapMission,
    ],
  );

  const recoverPendingSwapStage = useCallback(
    async (
      stage: SwapPendingStage,
      record: PendingEvmRecord,
      signal: AbortSignal,
    ) => {
      if (executingRef.current) return;
      executingRef.current = true;
      activePendingRecordRef.current = record;
      if (completionResetTimerRef.current !== null) {
        window.clearTimeout(completionResetTimerRef.current);
        completionResetTimerRef.current = null;
      }
      if (mountedRef.current) {
        setIsExecuting(true);
        setExecutionSteps([{
          key: 'step1',
          label: stage === 'approval' ? 'Token approval' : 'Swap',
          status: 'confirming',
          txHash: record.proof.kind === 'hash' ? record.proof.hash : undefined,
          message: 'Resuming confirmation for your previous action…',
        }]);
      }

      try {
        const monitored = await monitorTrackedSubmission(
          stage,
          record,
          record,
          0,
          signal,
        );
        if (!monitored.ownsTerminal) return;
        if (monitored.receipt.status !== 'success') {
          throw new Error(
            stage === 'approval' ? 'Approval transaction reverted.' : 'Swap transaction reverted',
          );
        }

        const transactionHash = extractTransactionHash(monitored.receipt) as Hex | undefined;
        updateExecutionStep(0, {
          status: 'complete',
          txHash: transactionHash,
          message: stage === 'approval' ? S.execution.approvalCompleted : transactionHash,
        });
        if (stage === 'swap') {
          await finalizeSwapSuccess(monitored.receipt);
        } else {
          rememberTransaction(transactionHash, 'approval');
          toast.success(S.execution.approvalCompleted);
          completionResetTimerRef.current = window.setTimeout(() => {
            completionResetTimerRef.current = null;
            setExecutionSteps(null);
          }, 2200);
        }
      } catch (error) {
        if (isAbortError(error)) return;
        const message = error instanceof PendingEvmStaleError
          ? 'Confirmation delayed.'
          : humanizeSwapError(error);
        updateExecutionStep(0, { status: 'error', message });
        if (!(error instanceof PendingEvmStaleError)) toast.error(message);
      } finally {
        const registry = {
          accountAddress: record.accountAddress,
          chainId: record.chainId,
        };
        releasePendingEvmCoordinatorAttempt(
          registry,
          record,
          stage === 'approval' ? approvalControllerId : swapControllerId,
        );
        requestPendingEvmCoordinatorReconcile(registry);
        executingRef.current = false;
        if (mountedRef.current) setIsExecuting(false);
      }
    },
    [
      approvalControllerId,
      finalizeSwapSuccess,
      monitorTrackedSubmission,
      rememberTransaction,
      swapControllerId,
      updateExecutionStep,
    ],
  );

  const applyCoordinatorSnapshot = useCallback(
    (stage: SwapPendingStage, snapshot: PendingEvmCoordinatorSnapshot) => {
      coordinatorSnapshotsRef.current[stage] = snapshot;
      const approvalSnapshot = coordinatorSnapshotsRef.current.approval;
      const swapSnapshot = coordinatorSnapshotsRef.current.swap;
      if (!approvalSnapshot || !swapSnapshot) return;

      const feedbackRecord = approvalSnapshot.feedbackRecord ?? swapSnapshot.feedbackRecord;
      setPendingFeedbackRecord(feedbackRecord);
      setIsPeerBlocked(
        approvalSnapshot.locked || swapSnapshot.locked || feedbackRecord !== null,
      );
      setIsRecoveryChecking(false);
    },
    [],
  );

  useEffect(() => {
    if (!recoveryRegistryIdentity) {
      coordinatorSnapshotsRef.current = { approval: null, swap: null };
      setPendingFeedbackRecord(null);
      setIsPeerBlocked(false);
      setIsRecoveryChecking(false);
      return;
    }

    coordinatorSnapshotsRef.current = { approval: null, swap: null };
    setIsRecoveryChecking(true);
    const unregisterApproval = registerPendingEvmController(
      recoveryRegistryIdentity,
      {
        callsDigest: EMPTY_PENDING_CALLS_DIGEST,
        controllerId: approvalControllerId,
        intentDigest: getPendingEvmIntentDigest(SWAP_APPROVAL_INTENT_KEY),
        onSnapshot: (snapshot) => applyCoordinatorSnapshot('approval', snapshot),
        recover: (record, signal) => recoverPendingSwapStage('approval', record, signal),
      },
    );
    const unregisterSwap = registerPendingEvmController(
      recoveryRegistryIdentity,
      {
        callsDigest: EMPTY_PENDING_CALLS_DIGEST,
        connectorId:
          typeof walletClient?.waitForCallsStatus === 'function'
            ? connector?.id
            : undefined,
        controllerId: swapControllerId,
        intentDigest: getPendingEvmIntentDigest(SWAP_EXECUTION_INTENT_KEY),
        onSnapshot: (snapshot) => applyCoordinatorSnapshot('swap', snapshot),
        recover: (record, signal) => recoverPendingSwapStage('swap', record, signal),
      },
    );

    return () => {
      unregisterApproval();
      unregisterSwap();
    };
  }, [
    applyCoordinatorSnapshot,
    approvalControllerId,
    connector?.id,
    recoverPendingSwapStage,
    recoveryRegistryIdentity,
    swapControllerId,
    walletClient,
  ]);

  const executeQuote = useCallback(
    async (initialQuote: SwapQuoteResponse) => {
      if (executingRef.current || isRecoveryChecking || isPeerBlocked) return;
      if (!address) {
        toast.error(S.errors.connectWallet);
        return;
      }
      if (!walletClient?.account) {
        toast.error(S.errors.walletClientUnavailable);
        return;
      }
      if (chainId !== BASE_CHAIN_ID) {
        toast.error(S.errors.switchToBase);
        return;
      }

      executingRef.current = true;
      setIsExecuting(true);
      if (completionResetTimerRef.current !== null) {
        window.clearTimeout(completionResetTimerRef.current);
        completionResetTimerRef.current = null;
      }

      try {
        // Guard against executing a quote that is older than the max-age or past
        // its server-provided expiry. If so, refetch before touching the wallet.
        let quote: SwapQuoteResponse | null = initialQuote;
        const now = Date.now();
        const stale =
          !quote.quoteToken ||
          !quote.issuedAt ||
          !quote.expiresAt ||
          now - quote.issuedAt > SWAP_QUOTE_MAX_AGE_MS ||
          now >= quote.expiresAt;

        if (stale) {
          toast.loading(S.errors.quoteStale, { id: 'swap-refresh-quote' });
          quote = await refreshQuoteNow();
          toast.dismiss('swap-refresh-quote');
          if (!quote || quote.strategy === 'blocked') {
            toast.error(quote?.blockedReason || S.errors.quoteStale);
            return;
          }
          requireUnchangedSwapReview(initialQuote, quote);
        }

        setExecutionSteps(
          quote.steps.map((step) => ({
            key: step.key,
            label: `${SWAP_TOKEN_MAP[step.sellToken].displaySymbol} -> ${SWAP_TOKEN_MAP[step.buyToken].displaySymbol}`,
            status: 'pending',
          })),
        );
        const receipt = await executeSingleStep(quote, quote.steps[0], 0);
        await finalizeSwapSuccess(receipt);
      } catch (error) {
        if (isAbortError(error)) return;
        if (error instanceof SwapReviewRequiredError
          || (error instanceof SwapRequestError && (error.status === 409 || error.status === 410))) {
          await refreshQuoteNow();
          toast.error('The quote changed or expired. Review the updated minimum received, then confirm again.');
          setExecutionSteps(null);
          return;
        }
        const message = humanizeSwapError(error);
        const isUnresolved =
          error instanceof SwapSubmissionAmbiguousError ||
          error instanceof SwapSubmissionBlockedError ||
          error instanceof PendingEvmStaleError;
        setExecutionSteps((current) =>
          current?.map((step, index) =>
            index === 0 && step.status !== 'complete'
              ? {
                  ...step,
                  status: isUnresolved ? 'confirming' : 'error',
                  message: error instanceof PendingEvmStaleError
          ? 'Confirmation delayed.'
                    : message,
                }
              : step,
          ) || null,
        );
        if (!(error instanceof PendingEvmStaleError)) toast.error(message);
      } finally {
        toast.dismiss('swap-refresh-quote');
        executingRef.current = false;
        if (mountedRef.current) setIsExecuting(false);
      }
    },
    [
      address,
      chainId,
      executeSingleStep,
      finalizeSwapSuccess,
      isPeerBlocked,
      isRecoveryChecking,
      refreshQuoteNow,
      walletClient,
    ],
  );

  const handleFlipTokens = useCallback(() => {
    markQuoteActivity();
    setSellToken(buyToken);
    setBuyToken(sellToken);
  }, [buyToken, markQuoteActivity, sellToken]);

  useEffect(() => () => {
    maxRequestRef.current?.abort();
  }, [address, buyToken, sellToken, isVisible]);

  const handleSetMax = useCallback(async () => {
    if (!address) {
      toast.error(S.errors.connectWallet);
      return;
    }

    if (sellReadState !== 'ready') {
      toast(sellReadState === 'error' ? 'Balance unavailable. Retry balances before using Max.' : S.labels.loadingBalance);
      return;
    }

    maxRequestRef.current?.abort();
    const controller = new AbortController();
    maxRequestRef.current = controller;
    setIsSettingMax(true);
    try {
      let amount = sellBalanceRaw;
      if (sellToken === 'ETH') {
        const balance = await readClient.getBalance({ address });
        amount = balance;
        {
          // Optional sponsorship can be declined. Max must still leave gas.
          // Probe below the balance so estimation itself can afford gas, then
          // re-estimate the exact Max calldata and only adjust downward.
          let probe = balance / BigInt(2);
          for (let i = 0; i < 3; i++) {
            controller.signal.throwIfAborted();
            if (probe <= BigInt(0)) throw new Error(S.errors.keepEthForGas);
            const quote = await fetchQuoteOnce(probe, controller.signal);
            if (!quote.quoteToken || !quote.steps[0] || quote.strategy === 'blocked') throw new Error('Could not estimate Max for this pair.');
            const built = await buildStep(quote.steps[0], quote.steps[0].amountIn, quote.quoteToken, controller.signal);
            const { fee } = await estimateNextSwapFee(readClient, address, built);
            const affordable = balance - fee;
            if (i > 0 && amount <= affordable) break;
            amount = affordable;
            probe = amount;
          }
        }
      }
      controller.signal.throwIfAborted();
      if (amount <= BigInt(0)) throw new Error(S.errors.keepEthForGas);
      markQuoteActivity();
      setSellAmount(formatEditableAmount(amount, SWAP_TOKEN_MAP[sellToken].decimals));
    } catch (error) {
      if (!controller.signal.aborted) toast.error(humanizeSwapError(error));
    } finally {
      if (maxRequestRef.current === controller) {
        maxRequestRef.current = null;
        setIsSettingMax(false);
      }
    }
  }, [address, buildStep, fetchQuoteOnce, markQuoteActivity, readClient, sellReadState, sellBalanceRaw, sellToken]);

  const handleSellTokenSelect = useCallback(
    (next: UserSwapTokenId) => {
      markQuoteActivity();
      setSellToken(next);
    },
    [markQuoteActivity],
  );

  const handleBuyTokenSelect = useCallback(
    (next: UserSwapTokenId) => {
      markQuoteActivity();
      setBuyToken(next);
    },
    [markQuoteActivity],
  );

  const handleSubmit = useCallback(
    (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      if (executingRef.current || actionDisabled || !currentQuote) return;
      void executeQuote(currentQuote);
    },
    [actionDisabled, currentQuote, executeQuote],
  );

  const handleAcknowledgeStaleTransaction = useCallback(async () => {
    const record = pendingFeedbackRecord;
    if (acknowledgeLockRef.current || !record || getPendingEvmPhase(record) !== 'stale') return;
    const scope = walletScopeRef.current;
    if (scope.address?.toLowerCase() !== record.accountAddress.toLowerCase() || scope.chainId !== record.chainId) return;
    acknowledgeLockRef.current = true;
    try {
      const acknowledged = await acknowledgePendingEvmRecord(getBrowserPendingEvmStorage(), record);
      requestPendingEvmCoordinatorReconcile({ accountAddress: record.accountAddress, chainId: record.chainId });
      if (!acknowledged || !mountedRef.current || walletScopeRef.current.address !== scope.address || walletScopeRef.current.chainId !== scope.chainId
        || pendingFeedbackRecordRef.current?.attemptId !== record.attemptId) return;
      if (activePendingRecordRef.current?.attemptId === record.attemptId) activePendingRecordRef.current = null;
      setPendingFeedbackRecord(null);
      setExecutionSteps(null);
    } finally {
      acknowledgeLockRef.current = false;
    }
  }, [pendingFeedbackRecord]);

  const isQuoteLoading = quoteState.status === 'loading';
  const showQuoteLoadingText = isQuoteLoading || isDeferredLagging;
  const disabledReason = useMemo(() => {
    if (isExecuting) return null;
    if (isRecoveryChecking) return 'Confirmation delayed.';
    if (isPeerBlocked) {
      return pendingFeedbackRecord && getPendingEvmPhase(pendingFeedbackRecord) === 'stale'
        ? 'Confirmation delayed.'
        : 'Another action is still in progress. Please wait for it to finish.';
    }
    if (chainId !== BASE_CHAIN_ID) return S.errors.switchToBase;
    if (!walletClient?.account) return S.errors.walletClientUnavailable;
    if (!spendingReadsReady && (balanceReadError || !hasSpendingSnapshot)) return balanceReadError ? 'Balance unavailable. Retry the balance check.' : 'Checking spendable balances…';
    if (!sellAmount.trim()) return null;
    if (!isAmountValid) return S.errors.enterValidAmount(SWAP_TOKEN_MAP[sellToken].displaySymbol);
    if (hasInsufficientBalance) return insufficientBalanceMessage;
    if (hasInsufficientGas) return null;
    if (isDeferredLagging || isQuoteLoading) return S.quote.loading;
    if (currentQuote?.strategy === 'blocked') return currentQuote.blockedReason || S.errors.blockedPairFallback;
    if (!currentQuote) return 'Waiting for a swap quote.';
    if (feeUnavailable) return feeQuery.isError ? 'Network fee unavailable. Retry the estimate.' : 'Checking the network fee...';
    return null;
  }, [
    insufficientBalanceMessage,
    chainId,
    currentQuote,
    feeUnavailable,
    feeQuery.isError,
    hasInsufficientBalance,
    hasInsufficientGas,
    isAmountValid,
    isDeferredLagging,
    isExecuting,
    isPeerBlocked,
    isQuoteLoading,
    isRecoveryChecking,
    pendingFeedbackRecord,
    sellAmount,
    sellToken,
    walletClient?.account,
    balanceReadError,
    spendingReadsReady,
    hasSpendingSnapshot,
  ]);
  const actionButtonLabel = useMemo(() => {
    if (!actionDisabled || isExecuting) return S.buttons.swap;
    if (isRecoveryChecking) return 'Checking Wallet...';
    if (isPeerBlocked) return 'Wallet Transaction Pending';
    if (chainId !== BASE_CHAIN_ID) return 'Switch to Base';
    if (!walletClient?.account) return 'Connect Wallet';
    if (!spendingReadsReady && (balanceReadError || !hasSpendingSnapshot)) return balanceReadError ? 'Balance Unavailable' : 'Checking Balances…';
    if (!sellAmount.trim()) return S.buttons.swap;
    if (!isAmountValid) return 'Enter Valid Amount';
    if (hasInsufficientBalance) return `Insufficient ${SWAP_TOKEN_MAP[sellToken].displaySymbol}`;
    if (hasInsufficientGas) return 'Need ETH for Gas';
    if (isDeferredLagging || isQuoteLoading) return 'Fetching Quote...';
    if (currentQuote?.strategy === 'blocked') return 'Pair Unavailable';
    if (!currentQuote) return 'Waiting for Quote';
    if (feeUnavailable) return feeQuery.isError ? 'Fee Unavailable' : 'Checking Fee...';
    return S.buttons.swap;
  }, [
    actionDisabled,
    feeUnavailable,
    feeQuery.isError,
    chainId,
    currentQuote,
    hasInsufficientBalance,
    hasInsufficientGas,
    isAmountValid,
    isDeferredLagging,
    isExecuting,
    isPeerBlocked,
    isQuoteLoading,
    isRecoveryChecking,
    sellAmount,
    sellToken,
    walletClient?.account,
    balanceReadError,
    spendingReadsReady,
    hasSpendingSnapshot,
  ]);
  const handleSwitchToBase = useCallback(() => {
    if (chainId === BASE_CHAIN_ID || isSwitchingChain) return;
    void switchChainAsync({ chainId: BASE_CHAIN_ID }).catch(() => {
      toast.error('Could not switch your wallet to Base.');
    });
  }, [chainId, isSwitchingChain, switchChainAsync]);

  return (
    <div>
      <form
        onSubmit={handleSubmit}
        aria-busy={isExecuting}
        aria-describedby={messageId}
      >
        <div className="space-y-0.5">
          <SwapAmountCard
            label={<label htmlFor={sellAmountId}>{S.labels.sell}</label>}
            selector={<TokenSelector value={sellToken} options={allowedSources} onSelect={handleSellTokenSelect} disabled={isExecuting || isSettingMax} />}
            amount={<input
              id={sellAmountId} value={sellAmount}
              onChange={(event) => {
                markQuoteActivity();
                const nextAmount = sanitizeSwapDecimalInput(event.target.value);
                if (nextAmount !== null) setSellAmount(nextAmount);
              }}
              inputMode="decimal" placeholder="0.0" disabled={isExecuting || isSettingMax}
              aria-label={S.aria.sellAmount(SWAP_TOKEN_MAP[sellToken].displaySymbol)}
              className={SWAP_EDITABLE_AMOUNT_CLASS}
              style={{ fontSize: `min(${swapAmountFontSize(sellAmount)}, var(--swap-amount-max))` }}
            />}
            balance={sellBalanceText}
            max={address ? <button type="button" className={SWAP_MAX_BUTTON_CLASS} onClick={handleSetMax}
              disabled={isExecuting || isSettingMax || sellReadState !== 'ready' || sellBalanceRaw <= BigInt(0)}
              aria-label={`${S.labels.max} ${SWAP_TOKEN_MAP[sellToken].displaySymbol}`}>{isSettingMax ? 'Checking…' : S.labels.max}</button> : null}
            status={showQuoteLoadingText ? <span role="status" className="inline-flex items-center gap-1">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              {quoteState.status === 'loading' && (quoteState.retryAttempt ?? 0) > 0 ? S.quote.retrying : S.quote.loading}
            </span> : null}
          />

          <button
            type="button"
            className={SWAP_DIRECTION_BUTTON_CLASS}
            data-testid="SwapTokensButton"
            onClick={handleFlipTokens}
            disabled={isExecuting || isSettingMax}
            aria-label={S.aria.toggleDirection}
          >
            <svg
              role="img"
              aria-label={S.aria.toggleDirection}
              width="16"
              height="17"
              viewBox="0 0 16 17"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M14.5659 4.93434L13.4345 6.06571L11.8002 4.43139L11.8002 10.75L10.2002 10.75L10.2002 4.43139L8.56592 6.06571L7.43455 4.93434L11.0002 1.36865L14.5659 4.93434ZM8.56592 12.0657L5.00023 15.6314L1.43455 12.0657L2.56592 10.9343L4.20023 12.5687L4.20023 6.25002L5.80023 6.25002L5.80023 12.5687L7.43455 10.9343L8.56592 12.0657Z"
                className="fill-foreground"
              />
            </svg>
          </button>

          <SwapAmountCard
            output
            label={<span>{S.labels.buy} <span className="text-xs">· estimated</span></span>}
            selector={<TokenSelector value={buyToken} options={allowedTargets} onSelect={handleBuyTokenSelect} disabled={isExecuting || isSettingMax} />}
            amount={<div className={SWAP_OUTPUT_AMOUNT_CLASS}
              style={{ fontSize: `min(${swapAmountFontSize(buyAmountDisplay)}, var(--swap-amount-max))` }}
              role="status" aria-live="polite" aria-atomic="true" aria-label={S.aria.buyAmount(SWAP_TOKEN_MAP[buyToken].displaySymbol)}>{buyAmountDisplay}</div>}
            balance={buyBalanceText}
          />

          {balanceReadError && <div role="alert" className="mt-2 space-y-1 text-xs text-muted-foreground">
            <p>Some balances could not be verified. Last-known amounts are shown when available.</p>
            <Button type="button" variant="outline" size="sm" disabled={sellBalanceFetching || buyBalanceFetching || ethBalanceFetching}
              onClick={() => void retrySwapBalances()}>Retry balances</Button>
          </div>}
          {quoteState.status === 'error' && <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void refreshQuoteNow()}>Retry quote</Button>}
          {currentQuote && <SwapQuoteReview quote={currentQuote} fee={!usesSmartWalletBatch && !hasInsufficientBalance ? <div>
            {feeQuery.isError ? <Button type="button" variant="outline" size="sm" disabled={feeQuery.isFetching} onClick={() => void feeQuery.refetch()}>Retry fee estimate</Button>
              : feeQuery.data ? <p>{feeQuery.data.stage === 'approval' ? 'Approval' : 'Swap'} network fee budget: {formatTokenEstimate(feeQuery.data.fee, 18, 8)} ETH, including a buffer.
                {feeQuery.data.stage === 'approval' ? ' The swap fee is checked after approval.' : ''}</p>
                : <p>Checking network fee…</p>}
          </div> : undefined} />}

          {chainId !== BASE_CHAIN_ID ? (
            <Button
              type="button"
              variant="default"
              fullWidth
              className={SWAP_PRIMARY_ACTION_CLASS}
              disabled={isSwitchingChain}
              loading={isSwitchingChain}
              loadingText="Switching to Base..."
              onClick={handleSwitchToBase}
            >
              Switch to Base
            </Button>
          ) : (
            <Button
              type="submit"
              variant="default"
              fullWidth
              className={SWAP_PRIMARY_ACTION_CLASS}
              disabled={actionDisabled}
              loading={isExecuting}
              loadingText={S.buttons.swapping}
            >
              {actionButtonLabel}
            </Button>
          )}
          {actionDisabled && disabledReason ? (
            <DisabledReason className="mt-2">
              {disabledReason}
            </DisabledReason>
          ) : null}
          {pendingFeedbackRecord && getPendingEvmPhase(pendingFeedbackRecord) === 'stale' ? (
            <TransactionRecoveryOptions
              className="mt-2"
              onContinue={handleAcknowledgeStaleTransaction}
            />
          ) : null}
          <SwapExecutionNotice id={messageId} message={swapMessage}
            currentHash={executionSteps?.find(step => step.txHash)?.txHash} lastTransaction={lastTransaction} />
        </div>
      </form>
    </div>
  );
}
