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
import Image from 'next/image';
import { toast } from 'react-hot-toast';
import {
  ArrowDownUp,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Info,
  Loader2,
} from 'lucide-react';
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
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { ERC20_TOKEN_ABI } from '@/lib/swap/base-swap-abi';
import {
  BASE_CHAIN_ID,
  MAX_APPROVAL_AMOUNT,
  SWAP_TOKEN_MAP,
  USER_SWAP_TOKEN_IDS,
} from '@/lib/swap/constants';
import { getAllowedSwapTargets } from '@/lib/swap/rules';
import type {
  SwapBuildStepResponse,
  SwapQuoteResponse,
  SwapQuoteStep,
  SwapTokenId,
  UserSwapTokenId,
} from '@/lib/swap/types';
import { getBaseReadClient, waitForBaseReceipt } from '@/lib/base-rpc';
import { cn, formatTokenAmountRounded } from '@/lib/utils';

type QuoteState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ready'; quote: SwapQuoteResponse }
  | { status: 'error'; error: string };

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

type FeeEstimateState =
  | { status: 'idle' }
  | { status: 'loading' }
  | {
      status: 'ready';
      totalFeeWei: bigint;
      swapFeeWei: bigint;
      approvalFeeWei?: bigint;
      approvalRequired: boolean;
    }
  | {
      status: 'error';
      error: string;
      approvalRequired: boolean;
    };

const readClient = getBaseReadClient();
const ETH_GAS_BUFFER_WEI = BigInt(50_000_000_000_000);
const KYBER_SWAP_GAS_FALLBACK = BigInt(360_000);

function TokenSelector({
  value,
  options,
  onSelect,
  disabled,
}: {
  value: UserSwapTokenId;
  options: readonly UserSwapTokenId[];
  onSelect: (next: UserSwapTokenId) => void;
  disabled?: boolean;
}) {
  const token = SWAP_TOKEN_MAP[value];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="outline"
          className="h-12 justify-between gap-3 rounded-full border-border/70 bg-background/90 px-4 text-sm shadow-[0_14px_24px_-22px_hsl(var(--foreground)/0.9)] backdrop-blur-sm hover:border-primary/25 hover:bg-background"
          disabled={disabled}
          aria-label={`Select ${token.displaySymbol}`}
        >
          <span className="flex items-center gap-3">
            <Image
              src={token.image}
              alt={token.displaySymbol}
              width={24}
              height={24}
              className="h-6 w-6 rounded-full"
            />
            <span className="font-medium">{token.displaySymbol}</span>
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 rounded-2xl p-2">
        {options.map((option) => {
          const optionToken = SWAP_TOKEN_MAP[option];
          return (
            <DropdownMenuItem
              key={option}
              onSelect={() => onSelect(option)}
              className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5"
            >
              <span className="flex items-center gap-3">
                <Image
                  src={optionToken.image}
                  alt={optionToken.displaySymbol}
                  width={22}
                  height={22}
                  className="h-[22px] w-[22px] rounded-full"
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

function QuoteRow({
  label,
  value,
  emphasis = false,
}: {
  label: string;
  value: string;
  emphasis?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-4 text-[13px]">
      <span className="text-muted-foreground">{label}</span>
      <span
        className={cn(
          'text-right text-foreground/90',
          emphasis && 'font-semibold text-foreground',
        )}
      >
        {value}
      </span>
    </div>
  );
}

function formatBasisPoints(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function formatRawAmount(tokenId: SwapTokenId, amount: string): string {
  const token = SWAP_TOKEN_MAP[tokenId];
  return `${formatTokenAmountRounded(BigInt(amount), token.decimals, 6)} ${token.displaySymbol}`;
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

function formatGasFee(amountWei: bigint): string {
  const eth = Number(formatUnits(amountWei, 18));
  if (!Number.isFinite(eth) || eth <= 0) {
    return '--';
  }

  if (eth < 0.0001) {
    return `<${eth.toFixed(6)} ETH`;
  }

  return `~${eth.toFixed(6)} ETH`;
}

function formatRateDisplay(
  sellToken: UserSwapTokenId,
  buyToken: UserSwapTokenId,
  amountIn: bigint,
  amountOut: bigint,
): string | null {
  const sellValue = Number(formatUnits(amountIn, SWAP_TOKEN_MAP[sellToken].decimals));
  const buyValue = Number(formatUnits(amountOut, SWAP_TOKEN_MAP[buyToken].decimals));
  if (!Number.isFinite(sellValue) || !Number.isFinite(buyValue) || sellValue <= 0) {
    return null;
  }

  const rate = buyValue / sellValue;
  if (!Number.isFinite(rate) || rate <= 0) {
    return null;
  }

  return `1 ${SWAP_TOKEN_MAP[sellToken].displaySymbol} = ${new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 6,
  }).format(rate)} ${SWAP_TOKEN_MAP[buyToken].displaySymbol}`;
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

function getExecutionStatusLabel(status: ExecutionStatus): string {
  switch (status) {
    case 'approving':
      return 'Approval';
    case 'swapping':
      return 'Wallet';
    case 'confirming':
      return 'Confirming';
    case 'complete':
      return 'Done';
    case 'error':
      return 'Error';
    default:
      return 'Pending';
  }
}

function getExecutionStatusClass(status: ExecutionStatus): string {
  switch (status) {
    case 'complete':
      return 'border-primary/25 bg-primary/10 text-primary';
    case 'error':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'approving':
    case 'swapping':
    case 'confirming':
      return 'border-primary/20 bg-primary/10 text-primary';
    default:
      return 'border-border/50 bg-muted/40 text-muted-foreground';
  }
}

function sanitizeDecimalInput(value: string): string {
  if (value === '') {
    return '';
  }

  const normalized = value.replace(/,/g, '.').replace(/[^\d.]/g, '');
  const firstDot = normalized.indexOf('.');
  if (firstDot === -1) {
    return normalized;
  }

  return `${normalized.slice(0, firstDot + 1)}${normalized
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
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(json.error || 'Request failed');
  }
  return json;
}

export default function PixotchiSwapPanel() {
  const { address, chainId } = useAccount();
  const { data: walletClient } = useWalletClient();
  const [sellToken, setSellToken] = useState<UserSwapTokenId>('ETH');
  const [buyToken, setBuyToken] = useState<UserSwapTokenId>('SEED');
  const [sellAmount, setSellAmount] = useState('');
  const deferredSellAmount = useDeferredValue(sellAmount);
  const [quoteState, setQuoteState] = useState<QuoteState>({ status: 'idle' });
  const [isExecuting, setIsExecuting] = useState(false);
  const [executionSteps, setExecutionSteps] = useState<ExecutionStepState[] | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [feeEstimateState, setFeeEstimateState] = useState<FeeEstimateState>({
    status: 'idle',
  });
  const quoteRequestRef = useRef(0);
  const feeRequestRef = useRef(0);

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

  const allowedTargets = useMemo(
    () => getAllowedSwapTargets(sellToken),
    [sellToken],
  );
  const allowedSources = useMemo(() => {
    return USER_SWAP_TOKEN_IDS.filter((tokenId) =>
      getAllowedSwapTargets(tokenId).includes(buyToken),
    );
  }, [buyToken]);
  const parsedAmount = useMemo(
    () => parseInputAmount(deferredSellAmount, sellToken),
    [deferredSellAmount, sellToken],
  );
  const sellBalanceRaw = sellBalanceData?.value ?? BigInt(0);
  const sellBalanceText = useMemo(() => {
    if (!address) {
      return 'Connect wallet';
    }

    if (sellBalanceLoading) {
      return 'Loading balance...';
    }

    return `Balance ${formatTokenAmountRounded(
      sellBalanceRaw,
      SWAP_TOKEN_MAP[sellToken].decimals,
      sellToken === 'USDC' ? 2 : 6,
    )}`;
  }, [address, sellBalanceLoading, sellBalanceRaw, sellToken]);

  const currentQuote = quoteState.status === 'ready' ? quoteState.quote : null;
  const seedLegStep =
    currentQuote?.steps.find(
      (step) => step.taxBps > 0 || Boolean(step.grossOut) || Boolean(step.effectiveIn),
    ) || null;
  const rateDisplay = useMemo(() => {
    if (!currentQuote || currentQuote.strategy === 'blocked' || !parsedAmount) {
      return null;
    }

    return formatRateDisplay(
      sellToken,
      buyToken,
      parsedAmount,
      BigInt(currentQuote.expectedOut),
    );
  }, [buyToken, currentQuote, parsedAmount, sellToken]);
  const buyAmountDisplay =
    currentQuote && currentQuote.strategy !== 'blocked'
      ? formatTokenAmountRounded(
          BigInt(currentQuote.expectedOut),
          SWAP_TOKEN_MAP[buyToken].decimals,
          6,
        )
      : '--';
  const isAmountValid = Boolean(parsedAmount && parsedAmount > BigInt(0));
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
    chainId !== BASE_CHAIN_ID ||
    !walletClient?.account ||
    hasInsufficientBalance;

  useEffect(() => {
    if (!allowedTargets.includes(buyToken)) {
      setBuyToken(allowedTargets[0]);
    }
  }, [allowedTargets, buyToken]);

  useEffect(() => {
    setExecutionSteps(null);
  }, [sellToken, buyToken, deferredSellAmount]);

  useEffect(() => {
    const amountIn = parsedAmount;
    if (!amountIn || amountIn <= BigInt(0)) {
      startTransition(() => setQuoteState({ status: 'idle' }));
      return;
    }

    const requestId = ++quoteRequestRef.current;
    const controller = new AbortController();
    startTransition(() => setQuoteState({ status: 'loading' }));

    const timer = window.setTimeout(async () => {
      try {
        const quote = await fetchJson<SwapQuoteResponse>('/api/swap/quote', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sellToken,
            buyToken,
            amountIn: amountIn.toString(),
            originAddress: address,
          }),
          signal: controller.signal,
        });

        if (quoteRequestRef.current !== requestId) {
          return;
        }

        startTransition(() => setQuoteState({ status: 'ready', quote }));
      } catch (error) {
        if (controller.signal.aborted || quoteRequestRef.current !== requestId) {
          return;
        }

        const message =
          error instanceof Error ? error.message : 'Failed to fetch swap quote';
        startTransition(() => setQuoteState({ status: 'error', error: message }));
      }
    }, 250);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [address, buyToken, parsedAmount, sellToken]);

  const trackSwapMission = useCallback(
    async (receipt: TransactionReceipt) => {
      if (!address || !receipt.transactionHash) {
        return;
      }

      const payload: Record<string, unknown> = {
        address,
        taskId: 's1_make_swap',
        proof: { txHash: receipt.transactionHash },
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
        if (!current) {
          return current;
        }

        return current.map((step, index) =>
          index === stepIndex ? { ...step, ...updates } : step,
        );
      });
    },
    [],
  );

  const buildStep = useCallback(
    async (step: SwapQuoteStep, amountIn: string, signal?: AbortSignal) => {
      if (!address) {
        throw new Error('Wallet not connected');
      }

      return fetchJson<SwapBuildStepResponse>('/api/swap/build-step', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: step.kind,
          sellToken: step.sellToken,
          buyToken: step.buyToken,
          amountIn,
          sender: address,
          recipient: address,
        }),
        signal,
      });
    },
    [address],
  );

  const ensureApproval = useCallback(
    async (
      approval: NonNullable<SwapBuildStepResponse['approval']>,
      stepIndex: number,
    ) => {
      if (!address || !walletClient?.account) {
        throw new Error('Wallet client unavailable');
      }

      const currentAllowance = (await readClient.readContract({
        address: approval.token,
        abi: ERC20_TOKEN_ABI,
        functionName: 'allowance',
        args: [address, approval.spender],
      })) as bigint;

      if (currentAllowance >= BigInt(approval.requiredAmount)) {
        return;
      }

      updateExecutionStep(stepIndex, {
        status: 'approving',
        message: 'Approve token spending',
      });

      const approvalHash = await walletClient.writeContract({
        address: approval.token,
        abi: ERC20_TOKEN_ABI,
        functionName: 'approve',
        args: [approval.spender, MAX_APPROVAL_AMOUNT],
        account: walletClient.account,
        chain: base,
      });

      await waitForBaseReceipt(approvalHash);
    },
    [address, updateExecutionStep, walletClient],
  );

  const executeSingleStep = useCallback(
    async (
      step: SwapQuoteStep,
      stepIndex: number,
      amountInOverride?: string,
    ): Promise<TransactionReceipt> => {
      if (!walletClient?.account) {
        throw new Error('Wallet not connected');
      }

      const amountIn = amountInOverride || step.amountIn;
      const builtStep = await buildStep(step, amountIn);

      if (builtStep.approval) {
        await ensureApproval(builtStep.approval, stepIndex);
      }

      updateExecutionStep(stepIndex, {
        status: 'swapping',
        message: step.routeLabel,
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
    [buildStep, ensureApproval, updateExecutionStep, walletClient],
  );

  const finalizeSwapSuccess = useCallback(
    async (receipt: TransactionReceipt) => {
      try {
        window.dispatchEvent(new Event('balances:refresh'));
      } catch {}
      void refetchSellBalance();
      await trackSwapMission(receipt);
      toast.success('Swap successful');

      window.setTimeout(() => {
        setExecutionSteps(null);
      }, 2200);
    },
    [refetchSellBalance, trackSwapMission],
  );

  const executeQuote = useCallback(
    async (quote: SwapQuoteResponse) => {
      if (!address) {
        toast.error('Connect your wallet to swap');
        return;
      }

      if (!walletClient?.account) {
        toast.error('Wallet client unavailable');
        return;
      }

      if (chainId !== BASE_CHAIN_ID) {
        toast.error('Switch to Base to swap');
        return;
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
        const receipt = await executeSingleStep(quote.steps[0], 0);
        await finalizeSwapSuccess(receipt);
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Swap execution failed';
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
    [address, chainId, executeSingleStep, finalizeSwapSuccess, walletClient],
  );

  const handleFlipTokens = useCallback(() => {
    setSellToken(buyToken);
    setBuyToken(sellToken);
  }, [buyToken, sellToken]);

  const handleSetMax = useCallback(() => {
    if (!address) {
      toast.error('Connect your wallet to use max');
      return;
    }

    let amount = sellBalanceRaw;
    if (sellToken === 'ETH') {
      const reserve =
        feeEstimateState.status === 'ready'
          ? feeEstimateState.totalFeeWei * BigInt(2)
          : ETH_GAS_BUFFER_WEI;

      if (amount <= reserve) {
        toast.error('Keep a bit of ETH for gas.');
        return;
      }

      amount -= reserve;
    }

    if (amount <= BigInt(0)) {
      toast.error('No balance available.');
      return;
    }

    setSellAmount(formatEditableAmount(amount, SWAP_TOKEN_MAP[sellToken].decimals));
  }, [address, feeEstimateState, sellBalanceRaw, sellToken]);

  useEffect(() => {
    if (
      !address ||
      !currentQuote ||
      currentQuote.strategy === 'blocked' ||
      currentQuote.steps.length === 0
    ) {
      setFeeEstimateState({ status: 'idle' });
      return;
    }

    const step = currentQuote.steps[0];
    const requestId = ++feeRequestRef.current;
    const controller = new AbortController();

    setFeeEstimateState({ status: 'loading' });

    const timer = window.setTimeout(async () => {
      try {
        const builtStep = await buildStep(step, step.amountIn, controller.signal);
        const gasPrice = await readClient.getGasPrice();

        let approvalRequired = false;
        let approvalFeeWei: bigint | undefined;

        if (builtStep.approval) {
          const currentAllowance = (await readClient.readContract({
            address: builtStep.approval.token,
            abi: ERC20_TOKEN_ABI,
            functionName: 'allowance',
            args: [address, builtStep.approval.spender],
          })) as bigint;

          approvalRequired =
            currentAllowance < BigInt(builtStep.approval.requiredAmount);

          if (approvalRequired) {
            const approvalGas = await readClient.estimateGas({
              account: address,
              to: builtStep.approval.token,
              data: encodeFunctionData({
                abi: ERC20_TOKEN_ABI,
                functionName: 'approve',
                args: [builtStep.approval.spender, MAX_APPROVAL_AMOUNT],
              }),
              value: BigInt(0),
            });
            approvalFeeWei = approvalGas * gasPrice;
          }
        }

        let swapFeeWei: bigint;
        try {
          const swapGas = await readClient.estimateGas({
            account: address,
            to: builtStep.transaction.to,
            data: builtStep.transaction.data,
            value: BigInt(builtStep.transaction.value),
          });
          swapFeeWei = swapGas * gasPrice;
        } catch {
          swapFeeWei = KYBER_SWAP_GAS_FALLBACK * gasPrice;
        }

        if (feeRequestRef.current !== requestId) {
          return;
        }

        setFeeEstimateState({
          status: 'ready',
          totalFeeWei: swapFeeWei + (approvalFeeWei ?? BigInt(0)),
          swapFeeWei,
          approvalFeeWei,
          approvalRequired,
        });
      } catch (error) {
        if (controller.signal.aborted || feeRequestRef.current !== requestId) {
          return;
        }

        setFeeEstimateState({
          status: 'error',
          error:
            error instanceof Error ? error.message : 'Failed to estimate network fee',
          approvalRequired: false,
        });
      }
    }, 180);

    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [address, buildStep, currentQuote]);

  const feeSummaryLabel =
    feeEstimateState.status === 'ready'
      ? formatGasFee(feeEstimateState.totalFeeWei)
      : feeEstimateState.status === 'loading'
        ? 'Calculating...'
        : '--';

  return (
    <div className="space-y-4">
      <div
        className="relative overflow-hidden rounded-[30px] border border-border/60 bg-card/95 p-3 shadow-[0_28px_60px_-42px_hsl(var(--foreground)/0.55)] sm:p-4"
        style={{
          backgroundImage:
            'linear-gradient(180deg, hsl(var(--card) / 0.98), hsl(var(--background) / 0.96))',
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-80"
          style={{
            background:
              'radial-gradient(circle at top left, hsl(var(--primary) / 0.12), transparent 36%), radial-gradient(circle at bottom right, hsl(var(--accent) / 0.26), transparent 34%)',
          }}
        />

        <div className="relative space-y-3">
          <div className="rounded-[24px] border border-border/55 bg-background/70 px-4 py-4 backdrop-blur-sm sm:px-5 sm:py-5">
            <div className="flex items-start justify-between gap-4">
              <TokenSelector
                value={sellToken}
                options={allowedSources}
                onSelect={setSellToken}
                disabled={isExecuting}
              />
              <div className="min-w-0 flex-1 text-right">
                <Input
                  value={sellAmount}
                  onChange={(event) => {
                    setSellAmount(sanitizeDecimalInput(event.target.value));
                  }}
                  inputMode="decimal"
                  placeholder="0.0"
                  className="h-auto border-0 bg-transparent px-0 py-0 text-right text-[40px] font-semibold leading-none tracking-[-0.04em] shadow-none focus-visible:ring-0 sm:text-[44px]"
                  disabled={isExecuting}
                  aria-label={`Sell amount in ${SWAP_TOKEN_MAP[sellToken].displaySymbol}`}
                />
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-4">
              <button
                type="button"
                onClick={handleSetMax}
                disabled={isExecuting || !address || sellBalanceRaw <= BigInt(0)}
                className="inline-flex h-8 items-center rounded-full border border-border/55 bg-background/80 px-3 text-[11px] font-medium text-muted-foreground transition hover:border-primary/25 hover:bg-primary/10 hover:text-foreground disabled:pointer-events-none disabled:opacity-50"
              >
                Max
              </button>
              <span className="text-xs text-muted-foreground">{sellBalanceText}</span>
            </div>
          </div>

          <div className="-my-3 flex justify-center">
            <Button
              type="button"
              variant="outline"
              size="icon"
              className="relative z-10 h-12 w-12 rounded-full border-primary/20 bg-background/95 text-primary shadow-[0_18px_30px_-22px_hsl(var(--primary)/0.9)] backdrop-blur hover:border-primary/30 hover:bg-background"
              onClick={handleFlipTokens}
              disabled={isExecuting}
              aria-label="Toggle swap direction"
            >
              <ArrowDownUp className="h-4 w-4" />
            </Button>
          </div>

          <div className="rounded-[24px] border border-border/55 bg-background/70 px-4 py-4 backdrop-blur-sm sm:px-5 sm:py-5">
            <div className="flex items-start justify-between gap-4">
              <TokenSelector
                value={buyToken}
                options={allowedTargets}
                onSelect={setBuyToken}
                disabled={isExecuting}
              />
              <div className="min-w-0 flex-1 text-right">
                <div className="text-[40px] font-semibold leading-none tracking-[-0.04em] sm:text-[44px]">
                  {quoteState.status === 'loading' ? (
                    <span className="inline-flex items-center gap-2 text-base font-medium text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Quoting
                    </span>
                  ) : (
                    buyAmountDisplay
                  )}
                </div>
                <div className="mt-3 text-xs text-muted-foreground">
                  {currentQuote && currentQuote.strategy !== 'blocked'
                    ? `Min ${formatRawAmount(buyToken, currentQuote.minOut)}`
                    : 'Output updates as you type'}
                </div>
              </div>
            </div>

            <div className="mt-5 flex items-center justify-between gap-4">
              <span className="text-xs text-muted-foreground">
                {rateDisplay || 'Best route selected automatically'}
              </span>
              <span className="text-xs text-muted-foreground">
                1 transaction
              </span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => setDetailsOpen((current) => !current)}
            className="flex w-full items-center justify-between gap-4 rounded-2xl px-1 py-2 text-left"
            aria-expanded={detailsOpen}
          >
            <span className="flex items-center gap-2 text-sm text-muted-foreground">
              <span>Network fees</span>
              <span className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-border/60 bg-background/75">
                <Info className="h-3.5 w-3.5" />
              </span>
            </span>

            <span className="flex items-center gap-2 text-sm font-medium text-foreground">
              <span>{feeSummaryLabel}</span>
              <span className="text-xs font-medium text-primary">
                More details
              </span>
              {detailsOpen ? (
                <ChevronUp className="h-4 w-4 text-muted-foreground" />
              ) : (
                <ChevronDown className="h-4 w-4 text-muted-foreground" />
              )}
            </span>
          </button>

          {detailsOpen && currentQuote && currentQuote.strategy !== 'blocked' ? (
            <div className="rounded-[22px] border border-border/55 bg-background/72 p-4 backdrop-blur-sm">
              <div className="space-y-3">
                <QuoteRow label="Provider" value="Kyber Aggregator" />
                <QuoteRow
                  label="Route"
                  value={currentQuote.steps[0]?.routeLabel || 'Best available route'}
                />
                <QuoteRow
                  label="Expected receive"
                  value={formatRawAmount(buyToken, currentQuote.expectedOut)}
                  emphasis
                />
                <QuoteRow
                  label="Minimum receive"
                  value={formatRawAmount(buyToken, currentQuote.minOut)}
                />
                {seedLegStep?.grossOut ? (
                  <QuoteRow
                    label="Gross receive before tax"
                    value={formatRawAmount(
                      seedLegStep.buyToken,
                      seedLegStep.grossOut,
                    )}
                  />
                ) : null}
                {seedLegStep?.effectiveIn ? (
                  <QuoteRow
                    label="SEED reaching pool"
                    value={formatRawAmount(
                      seedLegStep.sellToken,
                      seedLegStep.effectiveIn,
                    )}
                  />
                ) : null}
                {currentQuote.taxBps > 0 ? (
                  <QuoteRow
                    label="SEED tax"
                    value={formatBasisPoints(currentQuote.taxBps)}
                  />
                ) : null}
                <QuoteRow
                  label="Market slippage"
                  value={formatBasisPoints(currentQuote.marketSlippageBps)}
                />
                {currentQuote.taxBps > 0 ? (
                  <QuoteRow
                    label="Router tolerance"
                    value={formatBasisPoints(
                      currentQuote.taxBps + currentQuote.marketSlippageBps,
                    )}
                  />
                ) : null}
                <QuoteRow
                  label="Approval"
                  value={
                    feeEstimateState.status === 'ready'
                      ? feeEstimateState.approvalRequired
                        ? 'Required on first swap'
                        : 'Already approved'
                      : 'Estimated automatically'
                  }
                />
                <QuoteRow
                  label="Fee estimate"
                  value={feeSummaryLabel}
                />
              </div>

              {currentQuote.steps[0]?.routeSources.length ? (
                <div className="mt-4 flex flex-wrap gap-2">
                  {currentQuote.steps[0].routeSources.map((source) => (
                    <span
                      key={source}
                      className="inline-flex items-center rounded-full border border-primary/15 bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary"
                    >
                      {source}
                    </span>
                  ))}
                </div>
              ) : null}

              {currentQuote.steps[0]?.warnings.length ? (
                <div className="mt-4 space-y-2 border-t border-border/50 pt-4 text-xs text-muted-foreground">
                  {currentQuote.steps[0].warnings.map((warning) => (
                    <p key={warning}>{warning}</p>
                  ))}
                </div>
              ) : null}

              {feeEstimateState.status === 'error' ? (
                <p className="mt-4 border-t border-border/50 pt-4 text-xs text-muted-foreground">
                  Fee estimate is best-effort and will finalize in your wallet.
                </p>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      {quoteState.status === 'error' ? (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>Quote error</AlertTitle>
          <AlertDescription>{quoteState.error}</AlertDescription>
        </Alert>
      ) : null}

      {currentQuote?.strategy === 'blocked' ? (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>Swap unavailable</AlertTitle>
          <AlertDescription>
            {currentQuote.blockedReason || 'This swap pair is unavailable.'}
          </AlertDescription>
        </Alert>
      ) : null}

      {chainId !== BASE_CHAIN_ID ? (
        <Alert variant="destructive">
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>Wrong network</AlertTitle>
          <AlertDescription>Switch your wallet to Base to swap.</AlertDescription>
        </Alert>
      ) : null}

      {executionSteps?.[0] ? (
        <div className="rounded-[22px] border border-border/55 bg-background/75 p-4 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold">{executionSteps[0].label}</p>
              {executionSteps[0].message ? (
                <p className="mt-1 text-xs text-muted-foreground">
                  {formatExecutionMessage(executionSteps[0].message)}
                </p>
              ) : null}
            </div>
            <span
              className={cn(
                'rounded-full border px-2.5 py-1 text-[11px] uppercase tracking-wide',
                getExecutionStatusClass(executionSteps[0].status),
              )}
            >
              {getExecutionStatusLabel(executionSteps[0].status)}
            </span>
          </div>
        </div>
      ) : null}

      <Button
        type="button"
        className="h-12 w-full rounded-2xl text-sm font-semibold shadow-[0_16px_34px_-18px_hsl(var(--primary)/0.7)]"
        disabled={actionDisabled}
        onClick={() => currentQuote && executeQuote(currentQuote)}
      >
        {isExecuting ? 'Working...' : 'Swap now'}
      </Button>

      {!walletClient?.account ? (
        <p className="text-center text-xs text-muted-foreground">
          Wallet client not ready yet.
        </p>
      ) : null}
      {!isAmountValid && sellAmount.trim() ? (
        <p className="text-center text-xs text-muted-foreground">
          Enter a valid {SWAP_TOKEN_MAP[sellToken].displaySymbol} amount.
        </p>
      ) : null}
      {hasInsufficientBalance ? (
        <p className="text-center text-xs text-destructive">
          Insufficient {SWAP_TOKEN_MAP[sellToken].displaySymbol} balance.
        </p>
      ) : null}
    </div>
  );
}
