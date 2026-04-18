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
import { CheckCircle2, ChevronDown, CircleAlert, Loader2 } from 'lucide-react';
import {
  formatUnits,
  parseUnits,
  type Address,
  type Hex,
  type TransactionReceipt,
} from 'viem';
import { base } from 'viem/chains';
import { useAccount, useBalance, useWalletClient } from 'wagmi';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

const readClient = getBaseReadClient();
const ETH_GAS_BUFFER_WEI = BigInt(50_000_000_000_000);

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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-11 w-fit items-center gap-2 rounded-[12px] border border-border/60 bg-background px-3.5 py-2 shadow-sm transition-colors',
            'hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            'disabled:opacity-[0.38] disabled:pointer-events-none',
            className,
          )}
          disabled={disabled}
          aria-label={`Select ${token.displaySymbol}`}
        >
          <span className="flex items-center gap-2">
            <Image
              src={token.image}
              alt={token.displaySymbol}
              width={22}
              height={22}
              className="h-[22px] w-[22px] rounded-full"
            />
            <span className="font-semibold text-foreground">
              {token.displaySymbol}
            </span>
          </span>
          <ChevronDown className="h-4 w-4 text-foreground/70" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-56 rounded-xl p-2">
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
  const quoteRequestRef = useRef(0);

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
    if (!address || sellBalanceLoading) {
      return '';
    }

    return `Balance: ${formatTokenAmountRounded(
      sellBalanceRaw,
      SWAP_TOKEN_MAP[sellToken].decimals,
      sellToken === 'USDC' ? 2 : 6,
    )}`;
  }, [address, sellBalanceLoading, sellBalanceRaw, sellToken]);
  const buyBalanceText = useMemo(() => {
    if (!address || buyBalanceLoading) {
      return '';
    }

    return `Balance: ${formatTokenAmountRounded(
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
      if (amount <= ETH_GAS_BUFFER_WEI) {
        toast.error('Keep a bit of ETH for gas.');
        return;
      }

      amount -= ETH_GAS_BUFFER_WEI;
    }

    if (amount <= BigInt(0)) {
      toast.error('No balance available.');
      return;
    }

    setSellAmount(formatEditableAmount(amount, SWAP_TOKEN_MAP[sellToken].decimals));
  }, [address, sellBalanceRaw, sellToken]);

  return (
    <div className="space-y-4 rounded-[18px] bg-background/18 p-1.5">
      <div className="space-y-3">
        <div
          className="flex h-[140px] w-full flex-col justify-between rounded-[18px] border border-border/45 bg-background/82 px-5 py-4 shadow-sm"
          data-testid="ockSwapAmountInput_Container"
        >
          <div className="flex w-full items-center justify-between text-sm text-muted-foreground">
            Sell
          </div>
          <div className="flex w-full items-center justify-between gap-4">
            <input
              value={sellAmount}
              onChange={(event) => {
                setSellAmount(sanitizeDecimalInput(event.target.value));
              }}
              inputMode="decimal"
              placeholder="0.0"
              disabled={isExecuting}
              aria-label={`Sell amount in ${SWAP_TOKEN_MAP[sellToken].displaySymbol}`}
              className="w-full truncate border-none bg-transparent text-[2.5rem] leading-none text-foreground outline-none placeholder:text-muted-foreground"
            />
            <TokenSelector
              value={sellToken}
              options={allowedSources}
              onSelect={setSellToken}
              disabled={isExecuting}
            />
          </div>
          <div className="mt-4 flex w-full items-center justify-between">
            <div className="text-sm text-muted-foreground">
              {quoteState.status === 'loading'
                ? 'Fetching quote...'
                : '\u00A0'}
            </div>
            <div className="flex grow items-center justify-end gap-3 text-sm text-muted-foreground">
              {sellBalanceText ? <span className="truncate text-right">{sellBalanceText}</span> : null}
              {address ? (
                <button
                  type="button"
                  className="inline-flex h-8 items-center justify-center rounded-[10px] border border-border/60 bg-background px-3 text-xs font-semibold text-muted-foreground transition-colors hover:bg-accent/70 hover:text-foreground disabled:pointer-events-none disabled:opacity-[0.38]"
                  onClick={handleSetMax}
                  disabled={isExecuting || sellBalanceRaw <= BigInt(0)}
                >
                  Max
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <button
          type="button"
          className={cn(
            'relative z-10 mx-auto -my-1 flex h-10 w-10 items-center justify-center rounded-[12px] border border-border/60 bg-background text-foreground shadow-sm transition-colors',
            'hover:bg-accent/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
          )}
          data-testid="SwapTokensButton"
          onClick={handleFlipTokens}
          disabled={isExecuting}
          aria-label="Toggle swap direction"
        >
          <svg
            role="img"
            aria-label="Toggle swap direction"
            width="16"
            height="17"
            viewBox="0 0 16 17"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className="text-foreground"
          >
            <path
              d="M14.5659 4.93434L13.4345 6.06571L11.8002 4.43139L11.8002 10.75L10.2002 10.75L10.2002 4.43139L8.56592 6.06571L7.43455 4.93434L11.0002 1.36865L14.5659 4.93434ZM8.56592 12.0657L5.00023 15.6314L1.43455 12.0657L2.56592 10.9343L4.20023 12.5687L4.20023 6.25002L5.80023 6.25002L5.80023 12.5687L7.43455 10.9343L8.56592 12.0657Z"
              className="fill-current"
            />
          </svg>
        </button>

        <div
          className="flex h-[132px] w-full flex-col justify-between rounded-[18px] border border-border/45 bg-background/82 px-5 py-4 shadow-sm"
          data-testid="ockSwapAmountInput_Container"
        >
          <div className="flex w-full items-center justify-between text-sm text-muted-foreground">
            Buy
          </div>
          <div className="flex w-full items-center justify-between gap-4">
            <div className="w-full truncate bg-transparent text-[2.5rem] leading-none text-foreground">
              {quoteState.status === 'loading' ? (
                <span className="inline-flex items-center gap-2 text-base text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Quoting...
                </span>
              ) : (
                buyAmountDisplay
              )}
            </div>
            <TokenSelector
              value={buyToken}
              options={allowedTargets}
              onSelect={setBuyToken}
              disabled={isExecuting}
            />
          </div>
          <div className="flex w-full items-center justify-end text-sm text-muted-foreground">
            <div className="flex grow items-center justify-end text-sm text-muted-foreground">
              {buyBalanceText ? <span>{buyBalanceText}</span> : null}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="mt-2 w-full rounded-[12px] bg-primary px-4 py-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
          disabled={actionDisabled}
          onClick={() => currentQuote && executeQuote(currentQuote)}
        >
          {isExecuting ? 'Working...' : 'Swap'}
        </button>
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
        <div className="rounded-xl border border-border/55 bg-background/75 p-3">
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
