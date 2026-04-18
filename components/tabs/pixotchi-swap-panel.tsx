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
  CircleAlert,
  Loader2,
} from 'lucide-react';
import { parseUnits, type Address, type Hex, type TransactionReceipt } from 'viem';
import { base } from 'viem/chains';
import { useAccount, useWalletClient } from 'wagmi';
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
  getTokenAddress,
  isNativeSwapToken,
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
  | 'requoting'
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

type ResumeStepState = {
  step: SwapQuoteStep;
  amountIn: string;
  originalSellToken: UserSwapTokenId;
  originalBuyToken: UserSwapTokenId;
};

const readClient = getBaseReadClient();

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
          className="h-11 justify-between gap-3 rounded-xl px-3"
          disabled={disabled}
          aria-label={`Select ${token.displaySymbol}`}
        >
          <span className="flex items-center gap-2">
            <Image
              src={token.image}
              alt={token.displaySymbol}
              width={20}
              height={20}
              className="h-5 w-5 rounded-full"
            />
            <span>{token.displaySymbol}</span>
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52">
        {options.map((option) => {
          const optionToken = SWAP_TOKEN_MAP[option];
          return (
            <DropdownMenuItem
              key={option}
              onSelect={() => onSelect(option)}
              className="flex items-center justify-between gap-3"
            >
              <span className="flex items-center gap-2">
                <Image
                  src={optionToken.image}
                  alt={optionToken.displaySymbol}
                  width={20}
                  height={20}
                  className="h-5 w-5 rounded-full"
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
    <div className="flex items-center justify-between gap-4 text-xs">
      <span className="text-muted-foreground">{label}</span>
      <span className={cn('text-right', emphasis && 'font-semibold text-foreground')}>
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

function getStepTitle(step: SwapQuoteStep): string {
  return `${SWAP_TOKEN_MAP[step.sellToken].displaySymbol} -> ${SWAP_TOKEN_MAP[step.buyToken].displaySymbol}`;
}

function getExecutionStatusLabel(status: ExecutionStatus): string {
  switch (status) {
    case 'requoting':
      return 'Requoting';
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
      return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';
    case 'error':
      return 'border-destructive/30 bg-destructive/10 text-destructive';
    case 'approving':
    case 'swapping':
    case 'confirming':
    case 'requoting':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300';
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

async function fetchJson<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(url, init);
  const json = (await response.json()) as T & { error?: string };
  if (!response.ok) {
    throw new Error(json.error || 'Request failed');
  }
  return json;
}

async function getTokenBalance(tokenId: SwapTokenId, owner: Address): Promise<bigint> {
  if (isNativeSwapToken(tokenId)) {
    return readClient.getBalance({ address: owner });
  }

  return (await readClient.readContract({
    address: getTokenAddress(tokenId as Exclude<SwapTokenId, 'ETH'>),
    abi: ERC20_TOKEN_ABI,
    functionName: 'balanceOf',
    args: [owner],
  })) as bigint;
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
  const [resumeStep, setResumeStep] = useState<ResumeStepState | null>(null);
  const quoteRequestRef = useRef(0);

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

  useEffect(() => {
    if (!allowedTargets.includes(buyToken)) {
      setBuyToken(allowedTargets[0]);
    }
  }, [allowedTargets, buyToken]);

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

  const ensureApproval = useCallback(
    async (approval: NonNullable<SwapBuildStepResponse['approval']>, stepIndex: number) => {
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

  const buildStep = useCallback(
    async (step: SwapQuoteStep, amountIn: string) => {
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
      });
    },
    [address],
  );

  const executeSingleStep = useCallback(
    async (
      step: SwapQuoteStep,
      stepIndex: number,
      amountInOverride?: string,
    ): Promise<{ actualOut: bigint; receipt: TransactionReceipt }> => {
      if (!walletClient?.account) {
        throw new Error('Wallet not connected');
      }

      const amountIn = amountInOverride || step.amountIn;
      const builtStep = await buildStep(step, amountIn);
      const buyTokenBalanceBefore =
        builtStep.step.buyToken === 'WETH'
          ? await getTokenBalance('WETH', address as Address)
          : null;

      if (builtStep.approval) {
        await ensureApproval(builtStep.approval, stepIndex);
      }

      updateExecutionStep(stepIndex, {
        status: 'swapping',
        message: getStepTitle(builtStep.step),
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
      const buyTokenBalanceAfter =
        builtStep.step.buyToken === 'WETH'
          ? await getTokenBalance('WETH', address as Address)
          : null;

      if (receipt.status !== 'success') {
        throw new Error('Swap transaction reverted');
      }

      updateExecutionStep(stepIndex, {
        status: 'complete',
        txHash: hash,
        message: getStepTitle(builtStep.step),
      });

      const actualOut =
        buyTokenBalanceBefore !== null && buyTokenBalanceAfter !== null
          ? buyTokenBalanceAfter - buyTokenBalanceBefore
          : BigInt(builtStep.step.expectedOut);

      return { actualOut, receipt };
    },
    [address, buildStep, ensureApproval, updateExecutionStep, walletClient],
  );

  const finalizeSwapSuccess = useCallback(
    async (receipt: TransactionReceipt) => {
      setResumeStep(null);
      try {
        window.dispatchEvent(new Event('balances:refresh'));
      } catch {}
      await trackSwapMission(receipt);
      toast.success('Swap successful');
    },
    [trackSwapMission],
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
      setResumeStep(null);
      setExecutionSteps(
        quote.steps.map((step) => ({
          key: step.key,
          label: getStepTitle(step),
          status: 'pending',
        })),
      );

      try {
        const firstResult = await executeSingleStep(quote.steps[0], 0);

        if (quote.strategy === 'two_step_via_weth' && quote.steps[1]) {
          updateExecutionStep(1, {
            status: 'requoting',
            message: `Using actual WETH received: ${formatRawAmount(
              'WETH',
              firstResult.actualOut.toString(),
            )}`,
          });

          try {
            const secondResult = await executeSingleStep(
              quote.steps[1],
              1,
              firstResult.actualOut.toString(),
            );
            await finalizeSwapSuccess(secondResult.receipt);
          } catch (error) {
            setResumeStep({
              step: quote.steps[1],
              amountIn: firstResult.actualOut.toString(),
              originalSellToken: quote.sellToken,
              originalBuyToken: quote.buyToken,
            });
            updateExecutionStep(1, {
              status: 'error',
              message:
                error instanceof Error
                  ? error.message
                  : 'Step 2 failed after WETH was received.',
            });
            toast.error(
              'Step 1 succeeded. You now hold WETH and can resume step 2.',
            );
            return;
          }
        } else {
          await finalizeSwapSuccess(firstResult.receipt);
        }
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
    [
      address,
      chainId,
      executeSingleStep,
      finalizeSwapSuccess,
      updateExecutionStep,
      walletClient,
    ],
  );

  const handleResumeStep = useCallback(async () => {
    if (!resumeStep || !address || !walletClient?.account) {
      return;
    }

    if (chainId !== BASE_CHAIN_ID) {
      toast.error('Switch to Base to resume step 2');
      return;
    }

    setIsExecuting(true);
    setExecutionSteps([
      {
        key: 'step1',
        label: `Resume ${getStepTitle(resumeStep.step)}`,
        status: 'pending',
      },
    ]);

    try {
      const result = await executeSingleStep(
        resumeStep.step,
        0,
        resumeStep.amountIn,
      );
      await finalizeSwapSuccess(result.receipt);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to resume step 2';
      setExecutionSteps([
        {
          key: 'step1',
          label: `Resume ${getStepTitle(resumeStep.step)}`,
          status: 'error',
          message,
        },
      ]);
      toast.error(message);
    } finally {
      setIsExecuting(false);
    }
  }, [
    address,
    chainId,
    executeSingleStep,
    finalizeSwapSuccess,
    resumeStep,
    walletClient,
  ]);

  const handleFlipTokens = useCallback(() => {
    setSellToken(buyToken);
    setBuyToken(sellToken);
    setResumeStep(null);
  }, [buyToken, sellToken]);

  const currentQuote =
    quoteState.status === 'ready' ? quoteState.quote : null;
  const buyAmountDisplay =
    currentQuote && currentQuote.strategy !== 'blocked'
      ? formatRawAmount(buyToken, currentQuote.expectedOut)
      : '--';
  const isAmountValid = Boolean(parsedAmount && parsedAmount > BigInt(0));
  const seedLegStep =
    currentQuote?.steps.find((step) => step.kind === 'baseswap_seed') || null;
  const actionLabel = resumeStep
    ? `Resume ${getStepTitle(resumeStep.step)}`
    : currentQuote?.strategy === 'two_step_via_weth'
      ? 'Swap in 2 steps'
      : 'Swap now';
  const actionDisabled =
    isExecuting ||
    !currentQuote ||
    currentQuote.strategy === 'blocked' ||
    !isAmountValid ||
    chainId !== BASE_CHAIN_ID ||
    !walletClient?.account;

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-2xl border border-border/60 bg-background/80 p-3">
        <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Sell
            </span>
            <TokenSelector
              value={sellToken}
              options={allowedSources}
              onSelect={(next) => {
                setSellToken(next);
                setResumeStep(null);
              }}
              disabled={isExecuting}
            />
          </div>
          <Input
            value={sellAmount}
            onChange={(event) => {
              setSellAmount(sanitizeDecimalInput(event.target.value));
              setResumeStep(null);
            }}
            inputMode="decimal"
            placeholder="0.0"
            className="h-14 border-0 bg-transparent px-0 text-2xl font-semibold shadow-none focus-visible:ring-0"
            disabled={isExecuting}
            aria-label={`Sell amount in ${SWAP_TOKEN_MAP[sellToken].displaySymbol}`}
          />
        </div>

        <div className="flex justify-center">
          <Button
            type="button"
            size="icon"
            variant="outline"
            className="h-10 w-10 rounded-full"
            onClick={handleFlipTokens}
            disabled={isExecuting}
            aria-label="Toggle swap direction"
          >
            <ArrowDownUp className="h-4 w-4" />
          </Button>
        </div>

        <div className="rounded-xl border border-border/60 bg-muted/20 p-3">
          <div className="mb-3 flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Buy
            </span>
            <TokenSelector
              value={buyToken}
              options={allowedTargets}
              onSelect={(next) => {
                setBuyToken(next);
                setResumeStep(null);
              }}
              disabled={isExecuting}
            />
          </div>
          <div className="flex h-14 items-center text-2xl font-semibold">
            {quoteState.status === 'loading' ? (
              <span className="flex items-center gap-2 text-base text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Fetching quote
              </span>
            ) : (
              buyAmountDisplay
            )}
          </div>
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

      {resumeStep ? (
        <Alert>
          <CircleAlert className="h-4 w-4" />
          <AlertTitle>Resume step 2</AlertTitle>
          <AlertDescription className="space-y-3">
            <p>
              Step 1 already completed. You can continue with{' '}
              {formatRawAmount('WETH', resumeStep.amountIn)} into{' '}
              {SWAP_TOKEN_MAP[resumeStep.originalBuyToken].displaySymbol}.
            </p>
            <Button
              type="button"
              className="w-full"
              onClick={handleResumeStep}
              disabled={isExecuting}
            >
              {isExecuting ? 'Working...' : `Resume ${getStepTitle(resumeStep.step)}`}
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {currentQuote && currentQuote.strategy !== 'blocked' ? (
        <div className="space-y-3 rounded-2xl border border-border/60 bg-muted/15 p-4">
          <div className="flex items-center justify-between gap-4">
            <span className="text-sm font-semibold">Swap details</span>
            <span className="rounded-full border border-border/60 px-2 py-1 text-[11px] uppercase tracking-wide text-muted-foreground">
              {currentQuote.strategy === 'two_step_via_weth'
                ? '2 transactions'
                : currentQuote.strategy === 'single_baseswap_seed'
                  ? 'BaseSwap direct'
                  : 'Kyber direct'}
            </span>
          </div>

          {seedLegStep?.grossOut ? (
            <div className="space-y-2">
              <QuoteRow
                label="BaseSwap gross receive"
                value={formatRawAmount(seedLegStep.buyToken, seedLegStep.grossOut)}
              />
              <QuoteRow
                label="SEED tax"
                value={formatBasisPoints(seedLegStep.taxBps)}
              />
            </div>
          ) : null}

          {seedLegStep?.effectiveIn ? (
            <QuoteRow
              label="SEED reaching pool"
              value={formatRawAmount(seedLegStep.sellToken, seedLegStep.effectiveIn)}
            />
          ) : null}

          <QuoteRow
            label="Expected receive"
            value={formatRawAmount(buyToken, currentQuote.expectedOut)}
            emphasis
          />
          <QuoteRow
            label="Minimum receive"
            value={formatRawAmount(buyToken, currentQuote.minOut)}
          />
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

          <div className="space-y-2 border-t border-border/50 pt-3">
            {currentQuote.steps.map((step) => (
              <div
                key={step.key}
                className="rounded-xl border border-border/50 bg-background/70 p-3"
              >
                <div className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{getStepTitle(step)}</span>
                  <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                    {step.kind === 'kyber' ? 'Kyber' : 'BaseSwap'}
                  </span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">{step.routeLabel}</p>
                {step.warnings.length > 0 ? (
                  <p className="mt-2 text-xs text-muted-foreground">
                    {step.warnings.join(' ')}
                  </p>
                ) : null}
              </div>
            ))}
          </div>

          {currentQuote.warnings.length > 0 ? (
            <Alert>
              <CircleAlert className="h-4 w-4" />
              <AlertDescription>{currentQuote.warnings.join(' ')}</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : null}

      {executionSteps ? (
        <div className="space-y-2 rounded-2xl border border-border/60 bg-background/70 p-4">
          <div className="text-sm font-semibold">Execution status</div>
          {executionSteps.map((step) => (
            <div
              key={`${step.key}-${step.label}`}
              className="rounded-xl border border-border/50 bg-muted/10 p-3"
            >
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-medium">{step.label}</span>
                <span
                  className={cn(
                    'rounded-full border px-2 py-1 text-[11px] uppercase tracking-wide',
                    getExecutionStatusClass(step.status),
                  )}
                >
                  {getExecutionStatusLabel(step.status)}
                </span>
              </div>
              {step.message ? (
                <p className="mt-2 break-all text-xs text-muted-foreground">
                  {step.message}
                </p>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}

      <Button
        type="button"
        className="h-11 w-full"
        disabled={actionDisabled}
        onClick={() => currentQuote && executeQuote(currentQuote)}
      >
        {isExecuting ? 'Working...' : actionLabel}
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
      {currentQuote?.strategy === 'two_step_via_weth' ? (
        <p className="text-center text-xs text-muted-foreground">
          Composite swaps use WETH internally so step 2 can re-quote from the
          exact output of step 1.
        </p>
      ) : null}
    </div>
  );
}
