'use client';

import {
  startTransition,
  useCallback,
  useDeferredValue,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { toast } from 'react-hot-toast';
import { CheckCircle2, Loader2 } from 'lucide-react';
import {
  encodeFunctionData,
  formatUnits,
  parseUnits,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { base } from 'viem/chains';
import { useAccount, useBalance, useWalletClient } from 'wagmi';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ERC20_TOKEN_ABI } from '@/lib/swap/base-swap-abi';
import {
  BASE_CHAIN_ID,
  SWAP_QUOTE_MAX_AGE_MS,
  SWAP_TOKEN_MAP,
  USER_SWAP_TOKEN_IDS,
} from '@/lib/swap/constants';
import { getAllowedSwapTargets } from '@/lib/swap/rules';
import type {
  SwapBuildStepResponse,
  SwapQuoteResponse,
  SwapQuoteStep,
  UserSwapTokenId,
} from '@/lib/swap/types';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { useTabVisibility } from '@/lib/tab-visibility-context';
import { getBaseReadClient, waitForBaseReceipt } from '@/lib/base-rpc';
import {
  getBuilderCapabilities,
  transformCallsWithBuilderCode,
} from '@/lib/builder-code';
import {
  extractTransactionHash,
  normalizeTransactionReceipt,
} from '@/lib/transaction-utils';
import { cn, formatTokenAmountRounded } from '@/lib/utils';
import { SWAP_PANEL_STRINGS as S } from './pixotchi-swap-panel.strings';

type QuoteState =
  | { status: 'idle' }
  | { status: 'loading'; retryAttempt?: number }
  | { status: 'ready'; quote: SwapQuoteResponse }
  | { status: 'error'; error: string; retriable: boolean };

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

const ETH_GAS_BUFFER_WEI = BigInt(50_000_000_000_000);
// Minimum ETH balance we require *after* the swap's `value` to pay gas for
// the swap transaction itself (and a prior approval if needed).
const ETH_GAS_REQUIRED_WEI = BigInt(200_000_000_000_000);

const QUOTE_DEBOUNCE_MS = 250;
const QUOTE_MAX_RETRIES = 2;
const QUOTE_IDLE_REFRESH_MS = 5_000;

function isTransientStatus(status: number | undefined): boolean {
  if (status === undefined) return true;
  return status === 429 || status >= 500;
}

function TokenSelector({
  value,
  options,
  onSelect,
  disabled,
  className,
}: {
  value: UserSwapTokenId;
  options: readonly UserSwapTokenId[];
  onSelect: (next: UserSwapTokenId) => void;
  disabled?: boolean;
  className?: string;
}) {
  const token = SWAP_TOKEN_MAP[value];
  const [isOpen, setIsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  return (
    <DropdownMenu
      onOpenChange={(open) => {
        setIsOpen(open);
        if (!open) {
          // Radix restores focus automatically, but in some Farcaster webview
          // contexts it doesn't. Forcing focus back here is a no-op in normal
          // browsers and a safety net inside MiniApp.
          window.setTimeout(() => triggerRef.current?.focus(), 0);
        }
      }}
    >
      <DropdownMenuTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          data-testid="ockTokenSelectButton_Button"
          className={cn(
            'ock:cursor-pointer ock:bg-ock-background ock:hover:bg-ock-background-hover ock:active:bg-ock-background-active ock:focus:bg-ock-background-active',
            'ock:shadow-ock-default ock:rounded-ock-default ock:border-ock-line ock:border',
            'ock:flex ock:w-fit ock:items-center ock:gap-2 ock:px-3 ock:py-1',
            'disabled:opacity-[0.38] disabled:pointer-events-none',
            className,
          )}
          disabled={disabled}
          aria-label={S.aria.selectToken(token.displaySymbol)}
          aria-haspopup="menu"
          aria-expanded={isOpen}
        >
          <>
            <div className="ock:w-4">
              <img
                src={token.image}
                alt=""
                className="ock:overflow-hidden ock:rounded-[50%]"
                style={{
                  width: '16px',
                  height: '16px',
                  minWidth: '16px',
                  minHeight: '16px',
                }}
                aria-hidden="true"
              />
            </div>
            <span
              className="ock:font-ock ock:whitespace-nowrap ock:font-semibold ock:text-ock-foreground"
              data-testid="ockTokenSelectButton_Symbol"
            >
              {token.displaySymbol}
            </span>
          </>
          <div className="ock:relative ock:flex ock:items-center ock:justify-center">
            <div className="ock:absolute ock:top-0 ock:left-0 ock:h-4 ock:w-4" />
            {isOpen ? (
              <svg
                role="img"
                aria-label="Collapse token list"
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M3.05329 10.9866L7.99996 6.03997L12.9466 10.9866L14.1266 9.80663L7.99996 3.67997L1.87329 9.80663L3.05329 10.9866Z"
                  className="ock:fill-ock-foreground"
                />
              </svg>
            ) : (
              <svg
                role="img"
                aria-label="Expand token list"
                width="16"
                height="17"
                viewBox="0 0 16 17"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M12.95 4.85999L8.00001 9.80999L3.05001 4.85999L1.64001 6.27999L8.00001 12.64L14.36 6.27999L12.95 4.85999Z"
                  className="ock:fill-ock-foreground"
                />
              </svg>
            )}
          </div>
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        sideOffset={6}
        collisionPadding={12}
        className="w-[calc(100vw-2rem)] max-w-xs rounded-xl p-2 sm:w-56"
      >
        {options.map((option) => {
          const optionToken = SWAP_TOKEN_MAP[option];
          return (
            <DropdownMenuItem
              key={option}
              onSelect={() => onSelect(option)}
              className="flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5"
            >
              <span className="flex items-center gap-3">
                <img
                  src={optionToken.image}
                  alt=""
                  className="h-[22px] w-[22px] rounded-full object-contain"
                  aria-hidden="true"
                />
                <span>{optionToken.displaySymbol}</span>
              </span>
              {option === value ? (
                <CheckCircle2 className="h-4 w-4 text-primary" />
              ) : null}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatEditableAmount(amount: bigint, decimals: number): string {
  const formatted = formatUnits(amount, decimals);
  if (!formatted.includes('.')) {
    return formatted;
  }

  const [whole, fraction] = formatted.split('.');
  const trimmedFraction = fraction.slice(0, Math.min(decimals, 8)).replace(/0+$/, '');
  return trimmedFraction ? `${whole}.${trimmedFraction}` : whole;
}

function formatExecutionMessage(message?: string): string | null {
  if (!message) {
    return null;
  }

  if (/^0x[a-fA-F0-9]{64}$/.test(message)) {
    return `${message.slice(0, 10)}...${message.slice(-8)}`;
  }

  return message;
}

// Accepts comma-as-decimal, comma-as-thousand-separator, and scientific notation
// (e.g. "1e6", "2E-3"). Normalizes to a single dot decimal with no thousand
// separators. Returns '' for invalid input rather than silently mangling.
function sanitizeDecimalInput(raw: string): string {
  if (raw == null) return '';
  let value = String(raw).trim();
  if (value === '') return '';

  // Scientific notation -> canonical decimal string using Number + toFixed.
  if (/^[-+]?\d+(?:[.,]\d+)?[eE][-+]?\d+$/.test(value)) {
    const asNumber = Number(value.replace(',', '.'));
    if (!Number.isFinite(asNumber) || asNumber < 0) return '';
    // Use up to 18 fractional digits (max decimals in this app is 18).
    const normalized = asNumber.toFixed(18);
    return normalized.replace(/0+$/, '').replace(/\.$/, '');
  }

  // Decide whether commas are decimal separators or thousand separators.
  const commaCount = (value.match(/,/g) || []).length;
  const dotCount = (value.match(/\./g) || []).length;
  if (commaCount > 0 && dotCount === 0 && commaCount === 1) {
    // Single comma, no dot -> treat comma as decimal separator.
    value = value.replace(',', '.');
  } else {
    // Treat commas as thousand separators and drop them.
    value = value.replace(/,/g, '');
  }

  // Strip anything that isn't a digit or dot.
  value = value.replace(/[^\d.]/g, '');

  const firstDot = value.indexOf('.');
  if (firstDot === -1) {
    return value;
  }

  return `${value.slice(0, firstDot + 1)}${value
    .slice(firstDot + 1)
    .replace(/\./g, '')}`;
}

function parseInputAmount(
  amount: string,
  tokenId: UserSwapTokenId,
): bigint | null {
  if (!amount.trim()) {
    return null;
  }

  try {
    return parseUnits(amount, SWAP_TOKEN_MAP[tokenId].decimals);
  } catch {
    return null;
  }
}

async function fetchJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  let json: (T & { error?: string }) | null = null;
  try {
    json = (await response.json()) as T & { error?: string };
  } catch {
    // Leave null.
  }

  if (!response.ok) {
    const message = json?.error || `Request failed (${response.status})`;
    const err = new Error(message) as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  if (!json) {
    const err = new Error('Invalid server response') as Error & { status?: number };
    err.status = response.status;
    throw err;
  }

  return json;
}

export default function PixotchiSwapPanel() {
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const { isSmartWallet } = useSmartWallet();
  const { isTabVisible } = useTabVisibility();
  const readClient = useMemo(() => getBaseReadClient(), []);
  const [sellToken, setSellToken] = useState<UserSwapTokenId>('ETH');
  const [buyToken, setBuyToken] = useState<UserSwapTokenId>('SEED');
  const [sellAmount, setSellAmount] = useState('');
  const deferredSellAmount = useDeferredValue(sellAmount);
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: 'idle' });
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionSteps, setExecutionSteps] = useState<ExecutionStepState[] | null>(null);
  const quoteRequestRef = useRef(0);
  const backgroundRefreshInFlightRef = useRef(false);
  const quoteActivityAtRef = useRef(0);
  const messageId = 'pixotchi-swap-message';
  const isVisible = isTabVisible('swap');

  const {
    data: sellBalanceData,
    isLoading: sellBalanceLoading,
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
  const { data: buyBalanceData, isLoading: buyBalanceLoading } = useBalance({
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
  const { data: ethBalanceData } = useBalance({
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
  const sellBalanceText = useMemo(() => {
    if (!address) return '';
    if (sellBalanceLoading) return S.labels.loadingBalance;

    return `${S.labels.balancePrefix}${formatTokenAmountRounded(
      sellBalanceRaw,
      SWAP_TOKEN_MAP[sellToken].decimals,
      sellToken === 'USDC' ? 2 : 6,
    )}`;
  }, [address, sellBalanceLoading, sellBalanceRaw, sellToken]);
  const buyBalanceText = useMemo(() => {
    if (!address) return '';
    if (buyBalanceLoading) return S.labels.loadingBalance;

    return `${S.labels.balancePrefix}${formatTokenAmountRounded(
      buyBalanceData?.value ?? BigInt(0),
      SWAP_TOKEN_MAP[buyToken].decimals,
      buyToken === 'USDC' ? 2 : 6,
    )}`;
  }, [address, buyBalanceData?.value, buyBalanceLoading, buyToken]);

  const currentQuote = quoteState.status === 'ready' ? quoteState.quote : null;
  const buyAmountDisplay =
    currentQuote && currentQuote.strategy !== 'blocked'
      ? formatTokenAmountRounded(
          BigInt(currentQuote.expectedOut),
          SWAP_TOKEN_MAP[buyToken].decimals,
          6,
        )
      : '0.0';
  const isAmountValid = Boolean(parsedAmount && parsedAmount > BigInt(0));
  const isDeferredLagging = sellAmount !== deferredSellAmount;
  const hasInsufficientBalance = Boolean(
    address &&
      parsedAmount &&
      parsedAmount > BigInt(0) &&
      parsedAmount > sellBalanceRaw,
  );
  const actionDisabled =
    isExecuting ||
    !currentQuote ||
    currentQuote.strategy === 'blocked' ||
    !isAmountValid ||
    isDeferredLagging ||
    chainId !== BASE_CHAIN_ID ||
    !walletClient?.account ||
    hasInsufficientBalance;

  const markQuoteActivity = useCallback(() => {
    quoteActivityAtRef.current = Date.now();
  }, []);
  const swapMessage = useMemo(() => {
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
      return S.errors.insufficientBalance(SWAP_TOKEN_MAP[sellToken].displaySymbol);
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
      return S.execution.completed;
    }
    if (step.status === 'error') {
      return step.message || S.execution.generic;
    }
    return '\u00A0';
  }, [
    buyToken,
    chainId,
    currentQuote,
    executionSteps,
    hasInsufficientBalance,
    isAmountValid,
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

  useEffect(() => {
    markQuoteActivity();
  }, [buyToken, markQuoteActivity, sellToken]);

  useEffect(() => {
    // Clear both the cached quote AND any in-flight execution steps whenever
    // the swap parameters change, so users never see a stale quote or the
    // status line from the previous pair.
    setExecutionSteps(null);
    startTransition(() => setQuoteState({ status: 'idle' }));
  }, [sellToken, buyToken]);

  // Single source of truth for hitting /api/swap/quote. The debounced effect
  // below and the refresh-on-submit path both go through here.
  const fetchQuoteOnce = useCallback(
    async (amountIn: bigint, signal?: AbortSignal): Promise<SwapQuoteResponse> => {
      return fetchJson<SwapQuoteResponse>('/api/swap/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sellToken,
          buyToken,
          amountIn: amountIn.toString(),
          originAddress: address,
        }),
        signal,
        credentials: 'same-origin',
      });
    },
    [address, buyToken, sellToken],
  );

  useEffect(() => {
    const amountIn = parsedAmount;
    if (!amountIn || amountIn <= BigInt(0)) {
      startTransition(() => setQuoteState({ status: 'idle' }));
      return;
    }

    const requestId = ++quoteRequestRef.current;
    const controller = new AbortController();
    startTransition(() => setQuoteState({ status: 'loading' }));

    const attemptFetch = async (attempt: number): Promise<void> => {
      try {
        const quote = await fetchQuoteOnce(amountIn, controller.signal);
        if (quoteRequestRef.current !== requestId) return;
        startTransition(() => setQuoteState({ status: 'ready', quote }));
      } catch (error) {
        if (controller.signal.aborted || quoteRequestRef.current !== requestId) {
          return;
        }

        const status = (error as { status?: number })?.status;
        const transient = isTransientStatus(status);

        if (transient && attempt < QUOTE_MAX_RETRIES) {
          startTransition(() =>
            setQuoteState({ status: 'loading', retryAttempt: attempt + 1 }),
          );
          window.setTimeout(() => {
            if (controller.signal.aborted || quoteRequestRef.current !== requestId) {
              return;
            }
            void attemptFetch(attempt + 1);
          }, 400 * Math.pow(2, attempt));
          return;
        }

        const message =
          error instanceof Error ? error.message : 'Failed to fetch swap quote';
        startTransition(() =>
          setQuoteState({ status: 'error', error: message, retriable: transient }),
        );
      }
    };

    const timer = window.setTimeout(() => {
      void attemptFetch(0);
    }, QUOTE_DEBOUNCE_MS);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [fetchQuoteOnce, parsedAmount]);

  const refreshQuoteInBackground = useCallback(
    async (amountIn: bigint): Promise<void> => {
      if (backgroundRefreshInFlightRef.current) {
        return;
      }

      backgroundRefreshInFlightRef.current = true;
      const requestId = ++quoteRequestRef.current;

      try {
        const quote = await fetchQuoteOnce(amountIn);
        if (quoteRequestRef.current !== requestId) return;
        startTransition(() => setQuoteState({ status: 'ready', quote }));
      } catch (error) {
        if (quoteRequestRef.current !== requestId) return;

        const message =
          error instanceof Error ? error.message : 'Failed to fetch swap quote';
        const status = (error as { status?: number })?.status;
        startTransition(() =>
          setQuoteState((current) =>
            current.status === 'ready'
              ? current
              : { status: 'error', error: message, retriable: isTransientStatus(status) },
          ),
        );
      } finally {
        backgroundRefreshInFlightRef.current = false;
      }
    },
    [fetchQuoteOnce],
  );

  useEffect(() => {
    const amountIn = parsedAmount;
    if (!isVisible || !amountIn || amountIn <= BigInt(0)) {
      return;
    }

    if (isExecuting || isDeferredLagging || quoteState.status === 'loading') {
      return;
    }

    const interval = window.setInterval(() => {
      if (document.visibilityState !== 'visible') {
        return;
      }

      if (Date.now() - quoteActivityAtRef.current < QUOTE_IDLE_REFRESH_MS) {
        return;
      }

      void refreshQuoteInBackground(amountIn);
    }, QUOTE_IDLE_REFRESH_MS);

    return () => {
      window.clearInterval(interval);
    };
  }, [
    isDeferredLagging,
    isExecuting,
    isVisible,
    parsedAmount,
    quoteState.status,
    refreshQuoteInBackground,
  ]);

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
        await fetch('/api/gamification/missions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        });
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

      return fetchJson<SwapBuildStepResponse>('/api/swap/build-step', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          quoteToken,
          kind: step.kind,
          sellToken: step.sellToken,
          buyToken: step.buyToken,
          amountIn,
          sender: address,
          recipient: address,
        }),
        signal,
        credentials: 'same-origin',
      });
    },
    [address],
  );

  const readAllowance = useCallback(
    async (token: Address, owner: Address, spender: Address): Promise<bigint> => {
      const result = await readClient.readContract({
        address: token,
        abi: ERC20_TOKEN_ABI,
        functionName: 'allowance',
        args: [owner, spender],
      });
      if (typeof result !== 'bigint') {
        throw new Error('Unexpected allowance result type');
      }
      return result;
    },
    [readClient],
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

      // Exact-amount approval prevents unbounded risk if the spender is ever
      // compromised. Users will re-approve per swap, which is acceptable for
      // an aggregator router flow.
      const approvalHash = await walletClient.writeContract({
        address: approval.token,
        abi: ERC20_TOKEN_ABI,
        functionName: 'approve',
        args: [approval.spender, requiredAmount],
        account: walletClient.account,
        chain: base,
      });

      await waitForBaseReceipt(approvalHash);

      // Belt-and-suspenders: re-read allowance after confirmation so the next
      // writeContract sees ground truth, not the cached pre-approval state.
      const postAllowance = await readAllowance(
        approval.token,
        address,
        approval.spender,
      );
      if (postAllowance < requiredAmount) {
        throw new Error('Approval confirmed but allowance is still insufficient.');
      }
    },
    [address, readAllowance, updateExecutionStep, walletClient],
  );

  const executeApprovalAndSwapBatch = useCallback(
    async (
      approval: NonNullable<SwapBuildStepResponse['approval']>,
      builtStep: SwapBuildStepResponse,
      stepIndex: number,
    ): Promise<TransactionReceipt> => {
      if (!address || !walletClient?.account) {
        throw new Error(S.errors.walletClientUnavailable);
      }

      const requiredAmount = BigInt(approval.requiredAmount);

      const calls = transformCallsWithBuilderCode<SmartWalletBatchCall>([
        {
          to: approval.token,
          data: encodeFunctionData({
            abi: ERC20_TOKEN_ABI,
            functionName: 'approve',
            args: [approval.spender, requiredAmount],
          }),
          value: BigInt(0),
        },
        {
          to: builtStep.transaction.to,
          data: builtStep.transaction.data,
          value: BigInt(builtStep.transaction.value),
        },
      ]);

      updateExecutionStep(stepIndex, {
        status: 'swapping',
        message: S.execution.approvingAndSwapping,
      });

      const batch = await walletClient.sendCalls({
        account: walletClient.account,
        chain: base,
        calls,
        capabilities: getBuilderCapabilities(),
        forceAtomic: true,
      });

      updateExecutionStep(stepIndex, {
        status: 'confirming',
        message: S.execution.transactionPending,
      });

      const result = await walletClient.waitForCallsStatus({
        id: batch.id,
        timeout: 120_000,
        throwOnFailure: true,
      });

      if (result.status !== 'success') {
        throw new Error('Swap transaction reverted');
      }

      const receipts = result.receipts ?? [];
      const lastReceipt = receipts[receipts.length - 1] ?? receipts[0];
      const receipt = normalizeTransactionReceipt(lastReceipt);

      if (!receipt) {
        throw new Error('Swap completed without a receipt');
      }

      const txHash = extractTransactionHash(receipt) as Hex | undefined;
      updateExecutionStep(stepIndex, {
        status: 'complete',
        txHash,
        message: txHash,
      });

      return receipt as TransactionReceipt;
    },
    [address, updateExecutionStep, walletClient],
  );

  const executeSingleStep = useCallback(
    async (
      quote: SwapQuoteResponse,
      step: SwapQuoteStep,
      stepIndex: number,
      amountInOverride?: string,
    ): Promise<TransactionReceipt> => {
      if (!walletClient?.account) {
        throw new Error(S.errors.connectWallet);
      }
      if (!quote.quoteToken) {
        throw new Error('Quote token is missing. Please refresh and try again.');
      }

      const amountIn = amountInOverride || step.amountIn;
      const builtStep = await buildStep(step, amountIn, quote.quoteToken);

      // Gas safety: make sure the wallet has enough ETH to actually broadcast
      // the approval + swap beyond whatever ETH value we attach.
      if (address && ethBalanceData?.value !== undefined) {
        const requiredEth =
          BigInt(builtStep.transaction.value || '0') + ETH_GAS_REQUIRED_WEI;
        if (ethBalanceData.value < requiredEth) {
          throw new Error(S.errors.insufficientGas);
        }
      }

      if (builtStep.approval) {
        if (isSmartWallet && typeof walletClient?.sendCalls === 'function') {
          return executeApprovalAndSwapBatch(
            builtStep.approval,
            builtStep,
            stepIndex,
          );
        }

        await ensureApproval(builtStep.approval, stepIndex);
      }

      updateExecutionStep(stepIndex, {
        status: 'swapping',
        message: builtStep.step.routeLabel,
      });

      const hash = await walletClient.sendTransaction({
        to: builtStep.transaction.to,
        data: builtStep.transaction.data,
        value: BigInt(builtStep.transaction.value),
        account: walletClient.account,
        chain: base,
      });

      updateExecutionStep(stepIndex, {
        status: 'confirming',
        txHash: hash,
        message: hash,
      });

      const receipt = await waitForBaseReceipt(hash);

      if (receipt.status !== 'success') {
        throw new Error('Swap transaction reverted');
      }

      updateExecutionStep(stepIndex, {
        status: 'complete',
        txHash: hash,
        message: hash,
      });

      return receipt;
    },
    [
      address,
      buildStep,
      ensureApproval,
      ethBalanceData?.value,
      executeApprovalAndSwapBatch,
      isSmartWallet,
      updateExecutionStep,
      walletClient,
    ],
  );

  const finalizeSwapSuccess = useCallback(
    async (receipt: TransactionReceipt) => {
      try {
        window.dispatchEvent(new Event('balances:refresh'));
      } catch {}
      void refetchSellBalance();
      await trackSwapMission(receipt);
      toast.success(S.execution.completed);

      window.setTimeout(() => {
        setExecutionSteps(null);
      }, 2200);
    },
    [refetchSellBalance, trackSwapMission],
  );

  const refreshQuoteNow = useCallback(async (): Promise<SwapQuoteResponse | null> => {
    const amountIn = parsedAmount;
    if (!amountIn || amountIn <= BigInt(0)) return null;

    const requestId = ++quoteRequestRef.current;
    startTransition(() => setQuoteState({ status: 'loading' }));

    try {
      const quote = await fetchQuoteOnce(amountIn);
      if (quoteRequestRef.current !== requestId) return null;
      startTransition(() => setQuoteState({ status: 'ready', quote }));
      return quote;
    } catch (error) {
      if (quoteRequestRef.current !== requestId) return null;
      const message = error instanceof Error ? error.message : 'Failed to fetch swap quote';
      const status = (error as { status?: number })?.status;
      startTransition(() =>
        setQuoteState({ status: 'error', error: message, retriable: isTransientStatus(status) }),
      );
      return null;
    }
  }, [fetchQuoteOnce, parsedAmount]);

  const executeQuote = useCallback(
    async (initialQuote: SwapQuoteResponse) => {
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
      }

      setIsExecuting(true);
      setExecutionSteps(
        quote.steps.map((step) => ({
          key: step.key,
          label: `${SWAP_TOKEN_MAP[step.sellToken].displaySymbol} -> ${SWAP_TOKEN_MAP[step.buyToken].displaySymbol}`,
          status: 'pending',
        })),
      );

      try {
        const receipt = await executeSingleStep(quote, quote.steps[0], 0);
        await finalizeSwapSuccess(receipt);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : S.errors.swapFailed;
        setExecutionSteps((current) =>
          current?.map((step, index) =>
            index === 0 && step.status !== 'complete'
              ? { ...step, status: 'error', message }
              : step,
          ) || null,
        );
        toast.error(message);
      } finally {
        setIsExecuting(false);
      }
    },
    [
      address,
      chainId,
      executeSingleStep,
      finalizeSwapSuccess,
      refreshQuoteNow,
      walletClient,
    ],
  );

  const handleFlipTokens = useCallback(() => {
    markQuoteActivity();
    setSellToken(buyToken);
    setBuyToken(sellToken);
  }, [buyToken, markQuoteActivity, sellToken]);

  const handleSetMax = useCallback(() => {
    if (!address) {
      toast.error(S.errors.connectWallet);
      return;
    }

    if (sellBalanceLoading) {
      toast(S.labels.loadingBalance);
      return;
    }

    let amount = sellBalanceRaw;
    if (sellToken === 'ETH') {
      if (amount <= ETH_GAS_BUFFER_WEI) {
        toast.error(S.errors.keepEthForGas);
        return;
      }
      amount -= ETH_GAS_BUFFER_WEI;
    }

    if (amount <= BigInt(0)) {
      toast.error(S.errors.noBalance);
      return;
    }

    markQuoteActivity();
    setSellAmount(formatEditableAmount(amount, SWAP_TOKEN_MAP[sellToken].decimals));
  }, [address, markQuoteActivity, sellBalanceLoading, sellBalanceRaw, sellToken]);

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
      if (actionDisabled || !currentQuote) return;
      void executeQuote(currentQuote);
    },
    [actionDisabled, currentQuote, executeQuote],
  );

  const isQuoteLoading = quoteState.status === 'loading';
  const showQuoteLoadingText = isQuoteLoading || isDeferredLagging;

  return (
    <div data-ock-theme="pixotchi">
      <form
        onSubmit={handleSubmit}
        aria-busy={isExecuting}
        aria-describedby={messageId}
      >
        <div className="space-y-0.5">
          <div
            className="ock:bg-ock-secondary ock:rounded-ock-default ock:my-0.5 ock:box-border ock:flex ock:h-[148px] ock:w-full ock:flex-col ock:items-start ock:p-4"
            data-testid="ockSwapAmountInput_Container"
          >
            <label
              className="ock:font-ock ock:text-sm ock:text-ock-foreground-muted ock:flex ock:w-full ock:items-center ock:justify-between"
              htmlFor="pixotchi-swap-sell-amount"
            >
              {S.labels.sell}
            </label>
            <div className="ock:flex ock:w-full ock:items-center ock:justify-between">
              <input
                id="pixotchi-swap-sell-amount"
                value={sellAmount}
                onChange={(event) => {
                  markQuoteActivity();
                  setSellAmount(sanitizeDecimalInput(event.target.value));
                }}
                inputMode="decimal"
                placeholder="0.0"
                disabled={isExecuting}
                aria-label={S.aria.sellAmount(SWAP_TOKEN_MAP[sellToken].displaySymbol)}
                className="ock:mr-2 ock:w-full ock:border-[none] ock:bg-transparent ock:font-display ock:text-[2.5rem] ock:leading-none ock:outline-none ock:truncate text-foreground placeholder:text-muted-foreground"
              />
              <TokenSelector
                value={sellToken}
                options={allowedSources}
                onSelect={handleSellTokenSelect}
                disabled={isExecuting}
              />
            </div>
            <div className="ock:mt-4 ock:flex ock:w-full ock:items-center ock:justify-between">
              <div
                className="ock:font-ock ock:text-sm ock:text-ock-foreground-muted ock:flex ock:items-center ock:gap-1"
                role="status"
                aria-live="polite"
              >
                {showQuoteLoadingText ? (
                  <>
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    <span>
                      {quoteState.status === 'loading' && (quoteState.retryAttempt ?? 0) > 0
                        ? S.quote.retrying
                        : S.quote.loading}
                    </span>
                  </>
                ) : (
                  '\u00A0'
                )}
              </div>
              <div className="ock:font-ock ock:text-sm ock:text-ock-foreground-muted ock:flex ock:grow ock:items-center ock:justify-end">
                {sellBalanceText ? <span>{sellBalanceText}</span> : null}
                {address ? (
                  <button
                    type="button"
                    className="ock:font-ock ock:font-semibold ock:text-sm ock:text-ock-primary ock:flex ock:cursor-pointer ock:items-center ock:justify-center ock:px-2 ock:py-1 disabled:opacity-[0.38] disabled:pointer-events-none"
                    onClick={handleSetMax}
                    disabled={isExecuting || sellBalanceLoading || sellBalanceRaw <= BigInt(0)}
                    aria-label={`${S.labels.max} ${SWAP_TOKEN_MAP[sellToken].displaySymbol}`}
                  >
                    {S.labels.max}
                  </button>
                ) : null}
              </div>
            </div>
          </div>

          <button
            type="button"
            className={cn(
              'ock:cursor-pointer ock:bg-ock-background-alternate ock:hover:bg-ock-background-alternate-hover ock:active:bg-ock-background-alternate-active ock:focus:bg-ock-background-alternate-active',
              'ock:border-ock-background -my-6 relative mx-auto flex h-12 w-12 items-center justify-center rounded-lg border-4 border-solid',
            )}
            data-testid="SwapTokensButton"
            onClick={handleFlipTokens}
            disabled={isExecuting}
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
                className="ock:fill-ock-foreground"
              />
            </svg>
          </button>

          <div
            className="ock:bg-ock-secondary ock:rounded-ock-default ock:my-0.5 ock:box-border ock:flex ock:h-[148px] ock:w-full ock:flex-col ock:items-start ock:p-4"
            data-testid="ockSwapAmountInput_Container"
          >
            <div className="ock:font-ock ock:text-sm ock:text-ock-foreground-muted ock:flex ock:w-full ock:items-center ock:justify-between">
              {S.labels.buy}
            </div>
            <div className="ock:flex ock:w-full ock:items-center ock:justify-between">
              <div
                className="ock:mr-2 ock:w-full ock:truncate ock:bg-transparent ock:font-display ock:text-[2.5rem] ock:leading-none ock:text-ock-foreground"
                role="status"
                aria-live="polite"
                aria-atomic="true"
                aria-label={S.aria.buyAmount(SWAP_TOKEN_MAP[buyToken].displaySymbol)}
              >
                {buyAmountDisplay}
              </div>
              <TokenSelector
                value={buyToken}
                options={allowedTargets}
                onSelect={handleBuyTokenSelect}
                disabled={isExecuting}
              />
            </div>
            <div className="ock:mt-4 ock:flex ock:w-full ock:items-center ock:justify-between">
              <div className="ock:font-ock ock:text-sm ock:text-ock-foreground-muted">
                {'\u00A0'}
              </div>
              <div className="ock:font-ock ock:text-sm ock:text-ock-foreground-muted ock:flex ock:grow ock:items-center ock:justify-end">
                {buyBalanceText ? <span>{buyBalanceText}</span> : null}
              </div>
            </div>
          </div>

          <button
            type="submit"
            className={cn(
              'ock:bg-ock-primary ock:rounded-ock-default mt-4 w-full rounded-xl px-4 py-3',
              'ock:font-ock ock:font-semibold',
              'flex items-center justify-center gap-2',
              actionDisabled && 'opacity-[0.38] pointer-events-none',
            )}
            disabled={actionDisabled}
          >
            {isExecuting ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                <span>{S.buttons.swapping}</span>
              </>
            ) : (
              S.buttons.swap
            )}
          </button>
          <div
            id={messageId}
            className="ock:flex ock:h-7 ock:pt-2 ock:font-ock ock:text-sm ock:text-ock-foreground-muted"
            data-testid="ockSwapMessage_Message"
            role="status"
            aria-live="polite"
          >
            {formatExecutionMessage(swapMessage) || '\u00A0'}
          </div>
        </div>
      </form>
    </div>
  );
}
