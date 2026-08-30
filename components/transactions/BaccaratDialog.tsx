"use client";

import type { LifecycleStatus } from "@/components/transactions/transaction-kit";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import PlayingCard from "@/components/ui/PlayingCard";
import { useTokenMetadata } from "@/hooks/useTokenMetadata";
import { loadBetPreference, storeBetPreference } from "@/lib/casino-bet-preferences";
import { formatCasinoLimitForToken, getCasinoUiMaxBet, getCasinoUiMinBet, isPotentialCasinoAmountInput, parseCasinoAmountInput } from "@/lib/casino-amount-input";
import { getClientCasinoPolicy } from "@/lib/casino-client";
import { rouletteCanReveal, rouletteRevealBlocksRemaining } from "@/lib/casino-hardening-rules.mjs";
import { dispatchPostTransactionRefresh, POST_TRANSACTION_REFRESH_DELAYS_MS } from "@/lib/transaction-refresh";
import {
  baccaratGetActiveGame,
  baccaratGetConfig,
  baccaratGetTokenConfig,
  checkCasinoApproval,
  LAND_CONTRACT_ADDRESS,
  BaccaratBetType,
  type BaccaratActiveGame,
  type BaccaratTokenConfig,
} from "@/lib/contracts";
import { cn, formatTokenAmount, getCasinoTokenImage } from "@/lib/utils";
import {
  getBaccaratBetLabel,
  getBaccaratOutcomeLabel,
  getBaccaratPayoutLabel,
} from "@/public/abi/baccarat-abi";
import { Loader2, X } from "lucide-react";
import Image from "next/image";
import { type CSSProperties, type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useBalance, useBlockNumber } from "wagmi";
import ApproveTransaction from "./approve-transaction";
import BaccaratTransaction, { type BaccaratRevealResult } from "./baccarat-transaction";

interface BaccaratDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  landId: bigint;
  onGameComplete?: () => void;
  selectedToken: string | null;
}

type BaccaratUiPhase = "idle" | "betting" | "waiting" | "revealing";

const APPROVAL_REFRESH_DELAYS_MS = [0, 750, 1500, 3000] as const;
const BACCARAT_STATE_POLL_INTERVAL_MS = 4000;
const BACCARAT_FAILURE_STATUSES = new Set([
  "error",
  "failed",
  "reverted",
  "cancelled",
  "canceled",
  "rejected",
  "transactionRejected",
  "userRejected",
  "buildError",
]);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const BACCARAT_ACTIONS_CLASS =
  "surface-footer-divider dialog-footer-surface sticky bottom-0 z-10 mt-auto shrink-0 space-y-2 overflow-visible border-white/15 bg-black bg-[linear-gradient(180deg,rgb(0,0,0)_0%,rgb(0,0,0)_42%,rgb(0,0,0)_100%)] px-3 pb-[max(0.875rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom),var(--browser-safe-area-bottom))] pt-3 text-white sm:px-4";
const BACCARAT_ACTION_BUTTON_BASE =
  "inline-flex min-h-11 w-full min-w-0 items-center justify-center rounded-[var(--radius-control)] px-4 py-3 text-sm font-semibold leading-none shadow-[var(--shadow-control)] transition-[background-color,border-color,color,filter,box-shadow] duration-[var(--motion-quick)]";
const BACCARAT_APPROVE_BUTTON =
  `${BACCARAT_ACTION_BUTTON_BASE} border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning))] bg-[image:var(--gradient-warning)] text-[hsl(var(--warning-foreground))] [@media(hover:hover)_and_(pointer:fine)]:hover:brightness-[1.03]`;
const BACCARAT_REVEAL_BUTTON =
  `${BACCARAT_ACTION_BUTTON_BASE} border border-amber-300/35 bg-amber-500 bg-[image:var(--gradient-warning)] text-amber-950 [@media(hover:hover)_and_(pointer:fine)]:hover:brightness-[1.03]`;

const BET_OPTIONS = [
  {
    value: BaccaratBetType.PLAYER,
    label: "Player",
    payout: "2x return",
    ariaLabel: "Bet on Player",
    accentClassName: "bg-sky-300",
    selectedClassName:
      "border-sky-300/70 bg-sky-500/22 text-sky-50 shadow-[0_0_0_1px_rgba(125,211,252,0.35),0_12px_28px_rgba(14,116,144,0.26)]",
    actionClassName:
      "border border-sky-300/45 bg-sky-600 bg-[image:linear-gradient(180deg,rgba(56,189,248,0.95)_0%,rgba(2,132,199,0.94)_55%,rgba(3,105,161,0.98)_100%)] text-white [@media(hover:hover)_and_(pointer:fine)]:hover:brightness-[1.04]",
  },
  {
    value: BaccaratBetType.BANKER,
    label: "Banker",
    payout: "1.95x return",
    ariaLabel: "Bet on Banker",
    accentClassName: "bg-rose-300",
    selectedClassName:
      "border-rose-300/70 bg-rose-500/22 text-rose-50 shadow-[0_0_0_1px_rgba(253,164,175,0.35),0_12px_28px_rgba(190,18,60,0.24)]",
    actionClassName:
      "border border-rose-300/45 bg-rose-700 bg-[image:linear-gradient(180deg,rgba(244,63,94,0.96)_0%,rgba(190,18,60,0.94)_56%,rgba(136,19,55,0.98)_100%)] text-white [@media(hover:hover)_and_(pointer:fine)]:hover:brightness-[1.04]",
  },
  {
    value: BaccaratBetType.TIE,
    label: "Tie",
    payout: "9x return",
    ariaLabel: "Bet on Tie",
    accentClassName: "bg-amber-300",
    selectedClassName:
      "border-amber-300/75 bg-amber-400/22 text-amber-50 shadow-[0_0_0_1px_rgba(252,211,77,0.36),0_12px_28px_rgba(180,83,9,0.24)]",
    actionClassName:
      "border border-amber-300/45 bg-amber-500 bg-[image:linear-gradient(180deg,rgba(251,191,36,0.98)_0%,rgba(217,119,6,0.96)_56%,rgba(146,64,14,0.98)_100%)] text-amber-950 [@media(hover:hover)_and_(pointer:fine)]:hover:brightness-[1.04]",
  },
];

const TABLE_BET_OPTIONS = [
  { ...BET_OPTIONS[2], widthClassName: "w-[86%]" },
  { ...BET_OPTIONS[1], widthClassName: "w-[94%]" },
  { ...BET_OPTIONS[0], widthClassName: "w-full" },
] as const;

function BaccaratHandArea({
  cards,
  label,
  tone,
  value,
}: {
  cards: number[];
  label: string;
  tone: "player" | "banker";
  value?: number;
}) {
  const hasCards = cards.length > 0;
  const placeholders = tone === "player" ? [0, 1] : [2, 3];

  return (
    <div
      className={cn(
        "flex min-w-0 flex-col items-center gap-2 rounded-[var(--radius-control)] border px-3 py-3 shadow-[var(--shadow-hairline)]",
        tone === "player"
          ? "border-sky-300/20 bg-sky-950/22"
          : "border-rose-300/20 bg-rose-950/24"
      )}
      role="group"
      aria-label={`${label} hand`}
    >
      <div className="flex w-full items-center justify-center gap-2">
        <span className={cn("h-1.5 w-1.5 rounded-full", tone === "player" ? "bg-sky-300" : "bg-rose-300")} />
        <span className="text-xs font-semibold tracking-normal text-white/78">{label}</span>
      </div>
      <div className="flex min-h-[6.25rem] items-center justify-center -space-x-5 pl-2" role="list" aria-label={`${label} cards`}>
        {hasCards
          ? cards.map((card, index) => (
            <div
              key={`${label}-${card}-${index}`}
              role="listitem"
              className="animate-deal-card relative z-[var(--card-z)] transition-transform duration-[var(--motion-quick)] ease-[var(--ease-standard)] [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-2 [@media(hover:hover)_and_(pointer:fine)]:hover:z-10"
              style={{ animationDelay: `${index * 50}ms`, '--card-z': index } as CSSProperties}
            >
              <PlayingCard value={card} className="shadow-2xl" />
            </div>
          ))
          : placeholders.map((card, index) => (
            <div
              key={`${label}-placeholder-${card}`}
              aria-hidden="true"
              className="relative opacity-85"
              style={{ transform: `rotate(${index === 0 ? -4 : 4}deg)`, zIndex: index }}
            >
              <PlayingCard value={card} hidden className="shadow-2xl" />
            </div>
          ))}
      </div>
      <div>
        {hasCards && value !== undefined && (
          <div className="flex min-h-8 flex-col items-center justify-center gap-0.5">
            <span className="text-lg font-semibold text-white">{value}</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function BaccaratDialog({
  open,
  onOpenChange,
  landId,
  onGameComplete,
  selectedToken,
}: BaccaratDialogProps) {
  const { address } = useAccount();
  const casinoPolicy = getClientCasinoPolicy();
  const betAmountInputId = useId();
  const betOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const betMotionFrameRef = useRef<number | null>(null);
  const refreshGenerationRef = useRef(0);
  const refreshScopeRef = useRef("");
  const loadingGenerationRef = useRef<number | null>(null);
  const loadedScopeRef = useRef("");
  const optimisticBalanceTimerRef = useRef<number | null>(null);
  const allowanceGenerationRef = useRef(0);

  const [phase, setPhase] = useState<BaccaratUiPhase>("idle");
  const [betType, setBetType] = useState<BaccaratBetType>(BaccaratBetType.BANKER);
  const [suppressBetOptionMotion, setSuppressBetOptionMotion] = useState(false);
  const [betAmount, setBetAmount] = useState("10");
  const [tokenConfig, setTokenConfig] = useState<BaccaratTokenConfig | null>(null);
  const [activeGame, setActiveGame] = useState<BaccaratActiveGame | null>(null);
  const [allowanceWei, setAllowanceWei] = useState(BigInt(0));
  const [result, setResult] = useState<BaccaratRevealResult | null>(null);
  const [expiredResult, setExpiredResult] = useState<{ forfeitedAmount: string } | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [walletTxPending, setWalletTxPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimisticBalanceWei, setOptimisticBalanceWei] = useState<bigint | null>(null);

  const hasResolvedRound = !!result || !!expiredResult;
  const effectiveToken = activeGame?.isActive && !hasResolvedRound ? activeGame.bettingToken : selectedToken;
  const { symbol: tokenSymbolRaw, decimals: tokenDecimals } = useTokenMetadata(effectiveToken);
  const tokenSymbol = tokenSymbolRaw || "TOKEN";
  const tokenLogo = useMemo(() => getCasinoTokenImage(effectiveToken), [effectiveToken]);
  const uiMinBet = useMemo(
    () => tokenConfig ? getCasinoUiMinBet(effectiveToken, tokenDecimals, tokenConfig.minBet) : BigInt(0),
    [effectiveToken, tokenConfig, tokenDecimals]
  );
  const uiMaxBet = useMemo(
    () => tokenConfig ? getCasinoUiMaxBet(effectiveToken, tokenDecimals, tokenConfig.maxBet) : BigInt(0),
    [effectiveToken, tokenConfig, tokenDecimals]
  );
  const formattedMinBet = useMemo(
    () => tokenConfig ? formatCasinoLimitForToken(uiMinBet, tokenDecimals, effectiveToken, "min") : "0",
    [effectiveToken, tokenConfig, tokenDecimals, uiMinBet]
  );
  const formattedMaxBet = useMemo(
    () => tokenConfig ? formatCasinoLimitForToken(uiMaxBet, tokenDecimals, effectiveToken, "max") : "0",
    [effectiveToken, tokenConfig, tokenDecimals, uiMaxBet]
  );
  const betInputWidth = useMemo(() => {
    const visibleChars = Math.max(betAmount.length, formattedMinBet.length, 4);
    return `calc(${Math.min(visibleChars + 1, 18)}ch + 1.25rem)`;
  }, [betAmount, formattedMinBet]);

  const { data: balanceData, refetch: refetchBalance } = useBalance({
    address,
    token: effectiveToken as `0x${string}` | undefined,
    query: { enabled: !!address && !!effectiveToken },
  });

  const { data: liveBlock } = useBlockNumber({
    watch: open && !!activeGame?.isActive,
    query: {
      enabled: open && !!activeGame?.isActive,
      refetchInterval: open && activeGame?.isActive ? 3000 : false,
    },
  });

  const betWei = useMemo(() => {
    try {
      return parseCasinoAmountInput(betAmount || "0", tokenDecimals);
    } catch {
      return BigInt(0);
    }
  }, [betAmount, tokenDecimals]);

  const potentialPayoutWei = useMemo(() => {
    if (betWei <= BigInt(0)) return BigInt(0);
    if (betType === BaccaratBetType.BANKER) return betWei + (betWei * BigInt(9500) / BigInt(10000));
    if (betType === BaccaratBetType.TIE) return betWei * BigInt(9);
    return betWei * BigInt(2);
  }, [betType, betWei]);

  const canRevealActiveGame = rouletteCanReveal(activeGame, liveBlock);
  const revealBlocksRemaining = useMemo(() => (
    rouletteRevealBlocksRemaining(activeGame, liveBlock)
  ), [activeGame, liveBlock]);
  const activeGameBelongsToWallet = !activeGame?.isActive || (!!address && activeGame.player.toLowerCase() === address.toLowerCase());
  const balanceWei = optimisticBalanceWei ?? balanceData?.value ?? BigInt(0);
  const displayedBalanceWei = optimisticBalanceWei ?? balanceData?.value;
  const displayedBalanceDecimals = balanceData?.decimals ?? tokenDecimals;
  const hasBalance = !address || !tokenConfig || balanceWei >= betWei;
  const hasApproval = allowanceWei >= betWei;
  const amountBelowMin = !!tokenConfig && betWei > BigInt(0) && betWei < uiMinBet;
  const amountAboveMax = !!tokenConfig && betWei > uiMaxBet;
  const tokenDisabled = !tokenConfig?.supported || !tokenConfig.enabled;
  const hasPendingGame = !!activeGame?.isActive && !hasResolvedRound;
  const bettingLocked = walletTxPending || hasPendingGame || phase === "waiting" || phase === "revealing";
  const balanceScopeKey = `${address?.toLowerCase() ?? ""}:${effectiveToken?.toLowerCase() ?? ""}`;
  const canPlaceBet =
    casinoPolicy.playable &&
    !!address &&
    !!effectiveToken &&
    !!tokenConfig &&
    tokenConfig.supported &&
    tokenConfig.enabled &&
    betWei >= uiMinBet &&
    betWei <= uiMaxBet &&
    hasBalance &&
    hasApproval &&
    !bettingLocked;
  const refreshScopeKey = [
    open ? "open" : "closed",
    casinoPolicy.playable ? "playable" : "disabled",
    address?.toLowerCase() ?? "",
    landId.toString(),
    selectedToken?.toLowerCase() ?? "",
    effectiveToken?.toLowerCase() ?? "",
    tokenDecimals.toString(),
  ].join(":");
  const loadingScopeKey = [
    address?.toLowerCase() ?? "",
    landId.toString(),
    selectedToken?.toLowerCase() ?? "",
  ].join(":");

  useEffect(() => {
    refreshScopeRef.current = refreshScopeKey;
    refreshGenerationRef.current += 1;
    allowanceGenerationRef.current += 1;

    return () => {
      if (refreshScopeRef.current === refreshScopeKey) {
        refreshScopeRef.current = "";
      }
      refreshGenerationRef.current += 1;
      allowanceGenerationRef.current += 1;
    };
  }, [refreshScopeKey]);

  const refetchBalanceAfterTx = useCallback(() => {
    dispatchPostTransactionRefresh();
    for (const delay of POST_TRANSACTION_REFRESH_DELAYS_MS) {
      if (delay <= 0) {
        void refetchBalance();
      } else {
        window.setTimeout(() => void refetchBalance(), delay);
      }
    }
  }, [refetchBalance]);

  const applyOptimisticBalanceDelta = useCallback((deltaWei: bigint) => {
    setOptimisticBalanceWei((current) => {
      const base = current ?? balanceData?.value;
      if (base === undefined) return current;
      const next = base + deltaWei;
      return next > BigInt(0) ? next : BigInt(0);
    });

    const clearDelay = POST_TRANSACTION_REFRESH_DELAYS_MS[POST_TRANSACTION_REFRESH_DELAYS_MS.length - 1] + 1500;
    if (optimisticBalanceTimerRef.current !== null) {
      window.clearTimeout(optimisticBalanceTimerRef.current);
    }
    optimisticBalanceTimerRef.current = window.setTimeout(() => {
      optimisticBalanceTimerRef.current = null;
      setOptimisticBalanceWei(null);
    }, clearDelay);
  }, [balanceData?.value]);

  const refreshBaccaratState = useCallback(async (options?: { keepPendingWhenMissing?: boolean; showLoading?: boolean }) => {
    if (!open || !casinoPolicy.playable || refreshScopeRef.current !== refreshScopeKey) return null;

    const requestGeneration = refreshGenerationRef.current + 1;
    refreshGenerationRef.current = requestGeneration;
    const allowanceGeneration = allowanceGenerationRef.current + 1;
    allowanceGenerationRef.current = allowanceGeneration;
    const controlsLoading = options?.showLoading || loadingGenerationRef.current !== null;
    if (controlsLoading) {
      loadingGenerationRef.current = requestGeneration;
      if (options?.showLoading) setIsLoading(true);
    }
    const isCurrentRequest = () => (
      refreshScopeRef.current === refreshScopeKey &&
      refreshGenerationRef.current === requestGeneration
    );

    try {
      setError(null);
      const [active, globalConfig] = await Promise.all([
        baccaratGetActiveGame(landId),
        baccaratGetConfig(),
      ]);
      if (!isCurrentRequest()) return null;
      if (!active || !globalConfig) {
        throw new Error("Baccarat game state read failed");
      }

      const token = active?.isActive ? active.bettingToken : selectedToken;

      if (!token || (!globalConfig.enabled && !active.isActive)) {
        if (!isCurrentRequest()) return null;
        setTokenConfig(null);
        setActiveGame(null);
        setAllowanceWei(BigInt(0));
        setPhase("idle");
        return active;
      }

      const cfg = await baccaratGetTokenConfig(token);
      if (!isCurrentRequest()) return null;
      if (!cfg) {
        throw new Error("Baccarat token config read failed");
      }

      let approval = BigInt(0);
      if (address && cfg?.supported) {
        approval = await checkCasinoApproval(address, token);
      }
      if (!isCurrentRequest()) return null;

      setTokenConfig(cfg);
      if (active?.isActive) {
        setActiveGame(active);
        setBetType(active.betType);
        setBetAmount(formatUnits(active.betAmount, tokenDecimals));
        setPhase(active.canReveal || active.isExpired ? "revealing" : "waiting");
      } else if (!options?.keepPendingWhenMissing) {
        setActiveGame(null);
        setPhase((current) => current === "betting" ? current : "idle");
      }
      if (allowanceGenerationRef.current === allowanceGeneration) {
        setAllowanceWei(approval);
      }

      return active;
    } catch (err) {
      if (isCurrentRequest()) {
        console.error("Failed to load baccarat state:", err);
        setError("Failed to load Baccarat data");
      }
      return null;
    } finally {
      if (isCurrentRequest() && loadingGenerationRef.current === requestGeneration) {
        loadingGenerationRef.current = null;
        setIsLoading(false);
      }
    }
  }, [address, casinoPolicy.playable, landId, open, refreshScopeKey, selectedToken, tokenDecimals]);

  useEffect(() => {
    if (!open || casinoPolicy.playable) return;
    onOpenChange(false);
    toast.error(casinoPolicy.message || "Casino is currently unavailable.");
  }, [casinoPolicy.message, casinoPolicy.playable, onOpenChange, open]);

  useEffect(() => {
    if (!open || !casinoPolicy.playable) {
      loadingGenerationRef.current = null;
      loadedScopeRef.current = "";
      setIsLoading(false);
      return;
    }
    const showLoading = loadedScopeRef.current !== loadingScopeKey;
    loadedScopeRef.current = loadingScopeKey;
    void refreshBaccaratState({ showLoading });
  }, [casinoPolicy.playable, loadingScopeKey, open, refreshBaccaratState]);

  useEffect(() => {
    if (optimisticBalanceTimerRef.current !== null) {
      window.clearTimeout(optimisticBalanceTimerRef.current);
      optimisticBalanceTimerRef.current = null;
    }
    setOptimisticBalanceWei(null);
    return () => {
      if (optimisticBalanceTimerRef.current !== null) {
        window.clearTimeout(optimisticBalanceTimerRef.current);
        optimisticBalanceTimerRef.current = null;
      }
    };
  }, [balanceScopeKey]);

  useEffect(() => {
    if (!open || !tokenConfig || activeGame?.isActive) return;
    setBetAmount(loadBetPreference({
      game: "baccarat",
      token: effectiveToken,
      minBet: uiMinBet,
      maxBet: uiMaxBet,
      decimals: tokenDecimals,
      fallback: formattedMinBet,
    }));
  }, [activeGame?.isActive, effectiveToken, formattedMinBet, open, tokenConfig, tokenDecimals, uiMaxBet, uiMinBet]);

  useEffect(() => {
    const waitingForActiveGame = !activeGame?.isActive && phase === "waiting" && !hasResolvedRound;
    if (!open || (!hasPendingGame && !waitingForActiveGame) || walletTxPending) return;

    let disposed = false;
    let timeoutId: number | null = null;
    const keepPendingWhenMissing = waitingForActiveGame;
    const poll = async () => {
      await refreshBaccaratState({ keepPendingWhenMissing });
      if (!disposed) {
        timeoutId = window.setTimeout(() => void poll(), BACCARAT_STATE_POLL_INTERVAL_MS);
      }
    };

    timeoutId = window.setTimeout(() => void poll(), BACCARAT_STATE_POLL_INTERVAL_MS);
    return () => {
      disposed = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [activeGame?.isActive, hasPendingGame, hasResolvedRound, open, phase, refreshBaccaratState, walletTxPending]);

  const handleStatusUpdate = useCallback((status: LifecycleStatus) => {
    const statusName = status.statusName ?? "";
    if (statusName === "transactionPending") {
      setWalletTxPending(true);
    }
    if (statusName === "success" || BACCARAT_FAILURE_STATUSES.has(statusName)) {
      setWalletTxPending(false);
    }
  }, []);

  const handlePlaceComplete = useCallback(async (txResult?: BaccaratRevealResult) => {
    setWalletTxPending(false);
    if (!txResult) return;

    setResult(null);
    setExpiredResult(null);
    setPhase("waiting");
    applyOptimisticBalanceDelta(-betWei);
    refetchBalanceAfterTx();

    for (const delayMs of [0, 1500, 4000]) {
      if (delayMs > 0) await wait(delayMs);
      const active = await refreshBaccaratState({ keepPendingWhenMissing: true });
      if (active?.isActive) break;
    }
  }, [applyOptimisticBalanceDelta, betWei, refetchBalanceAfterTx, refreshBaccaratState]);

  const handleRevealComplete = useCallback((revealResult?: BaccaratRevealResult) => {
    setWalletTxPending(false);
    if (!revealResult) return;

    refetchBalanceAfterTx();
    if (revealResult.expired) {
      setExpiredResult({ forfeitedAmount: revealResult.forfeitedAmount ?? "0" });
      setResult(null);
    } else {
      const payoutWei = parseUnits(revealResult.payout ?? "0", tokenDecimals);
      if (payoutWei > BigInt(0)) {
        applyOptimisticBalanceDelta(payoutWei);
      }
      setResult(revealResult);
      setExpiredResult(null);
    }

    setActiveGame(null);
    setPhase("idle");
    onGameComplete?.();
  }, [applyOptimisticBalanceDelta, onGameComplete, refetchBalanceAfterTx, tokenDecimals]);

  const handleApproveSuccess = useCallback(async () => {
    if (!address || !effectiveToken || refreshScopeRef.current !== refreshScopeKey) return;
    toast.success(`${tokenSymbol} approved for Baccarat`);

    const allowanceGeneration = allowanceGenerationRef.current + 1;
    allowanceGenerationRef.current = allowanceGeneration;
    const isCurrentAllowanceRequest = () => (
      refreshScopeRef.current === refreshScopeKey &&
      allowanceGenerationRef.current === allowanceGeneration
    );

    for (const delay of APPROVAL_REFRESH_DELAYS_MS) {
      if (delay > 0) await wait(delay);
      if (!isCurrentAllowanceRequest()) return;

      const approval = await checkCasinoApproval(address, effectiveToken);
      if (!isCurrentAllowanceRequest()) return;
      setAllowanceWei(approval);
      if (approval >= betWei) break;
    }
  }, [address, betWei, effectiveToken, refreshScopeKey, tokenSymbol]);

  const handleBetAmountChange = useCallback((value: string) => {
    if (!isPotentialCasinoAmountInput(value)) return;
    setBetAmount(value);
    storeBetPreference("baccarat", effectiveToken, value, tokenDecimals);
  }, [effectiveToken, tokenDecimals]);

  const handleClose = useCallback(() => {
    if (walletTxPending) {
      toast.error("Wait for the wallet transaction to finish.");
      return;
    }
    if (activeGame?.isActive && !hasResolvedRound) {
      toast("Baccarat round remains active until revealed or expired.", { id: "baccarat-active-close" });
    }
    onOpenChange(false);
  }, [activeGame?.isActive, hasResolvedRound, onOpenChange, walletTxPending]);

  const handlePlayAgain = useCallback(() => {
    setResult(null);
    setExpiredResult(null);
    setError(null);
    setPhase("idle");
    void refetchBalance();
  }, [refetchBalance]);

  const resultOutcome = result?.outcome !== undefined ? getBaccaratOutcomeLabel(result.outcome) : null;
  const resultBet = result?.betType !== undefined ? getBaccaratBetLabel(result.betType) : getBaccaratBetLabel(betType);
  const isPushResult = !!result && !result.won && !!result.payout && result.payout !== "0";
  const showTable = hasPendingGame || hasResolvedRound;
  const showWagerPanel = !hasPendingGame && !hasResolvedRound;
  const selectedBetOption = useMemo(
    () => BET_OPTIONS.find((option) => option.value === betType) ?? BET_OPTIONS[1],
    [betType]
  );
  const dealButtonClassName = useMemo(
    () => `${BACCARAT_ACTION_BUTTON_BASE} ${selectedBetOption.actionClassName}`,
    [selectedBetOption.actionClassName]
  );
  const baccaratAnnouncement = expiredResult
    ? `Baccarat round expired. ${expiredResult.forfeitedAmount} ${tokenSymbol} forfeited.`
    : result && resultOutcome
      ? `Baccarat result: ${resultOutcome} wins. ${resultBet} bet ${result.won ? "won" : isPushResult ? "pushed" : "lost"}. Payout ${result.payout ?? "0"} ${tokenSymbol}.`
      : "";
  const suppressBetMotionForKeyboard = useCallback(() => {
    if (betMotionFrameRef.current !== null) {
      cancelAnimationFrame(betMotionFrameRef.current);
    }
    setSuppressBetOptionMotion(true);
    betMotionFrameRef.current = requestAnimationFrame(() => {
      betMotionFrameRef.current = requestAnimationFrame(() => {
        betMotionFrameRef.current = null;
        setSuppressBetOptionMotion(false);
      });
    });
  }, []);

  useEffect(() => () => {
    if (betMotionFrameRef.current !== null) {
      cancelAnimationFrame(betMotionFrameRef.current);
      betMotionFrameRef.current = null;
    }
  }, []);

  const handleBetOptionKeyDown = useCallback((event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let nextIndex: number | null = null;

    if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
      nextIndex = (index - 1 + TABLE_BET_OPTIONS.length) % TABLE_BET_OPTIONS.length;
    } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
      nextIndex = (index + 1) % TABLE_BET_OPTIONS.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TABLE_BET_OPTIONS.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    suppressBetMotionForKeyboard();
    setBetType(TABLE_BET_OPTIONS[nextIndex].value);
    betOptionRefs.current[nextIndex]?.focus();
  }, [suppressBetMotionForKeyboard]);

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => (nextOpen ? onOpenChange(true) : handleClose())}>
      <DialogContent
        className="blackjack-dialog-surface max-h-full w-[min(96vw,34rem)] overflow-hidden border-white/15 bg-[url('/icons/casinobj-bg.webp')] bg-cover bg-center bg-no-repeat !p-0 text-white"
        mobileMode="center"
        surface="game"
        size="full"
        hideCloseButton
        /* Money game with no visible close button: a stray backdrop tap must not
           abandon a round — nor may a stray Escape press. */
        onPointerDownOutside={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (walletTxPending || hasPendingGame) event.preventDefault();
        }}
      >
        <DialogTitle className="sr-only">Baccarat</DialogTitle>
        <DialogDescription className="sr-only">
          Punto Banco Baccarat with Player, Banker, and Tie bets.
        </DialogDescription>
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {baccaratAnnouncement}
        </p>
        <Button
          type="button"
          variant="headerIcon"
          size="icon"
          onClick={handleClose}
          aria-label="Close Baccarat dialog"
          className="absolute right-3 top-3 z-50"
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>

        <div className="flex min-h-0 flex-1 flex-col bg-black/50 text-white">
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-3 pb-4 pt-4 sm:px-4 sm:pt-5">
            {isLoading ? (
              <div className="flex min-h-[22rem] items-center justify-center" role="status" aria-live="polite">
                <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-white/70" />
                <span className="sr-only">Loading Baccarat game</span>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-[38rem] flex-col gap-3 sm:gap-4">
                {showTable && (
                  <div className="rounded-[var(--radius-control)] border border-white/10 bg-black/35 p-3 shadow-[var(--shadow-hairline)]">
                    <div className="grid grid-cols-2 gap-2 sm:gap-3">
                      <BaccaratHandArea
                        cards={result?.playerCards ?? []}
                        label="Player"
                        tone="player"
                        value={result?.playerTotal}
                      />
                      <BaccaratHandArea
                        cards={result?.bankerCards ?? []}
                        label="Banker"
                        tone="banker"
                        value={result?.bankerTotal}
                      />
                    </div>

                    {(result || expiredResult) && (
                      <div className={cn(
                        "mt-3 border-t px-1 pt-3 text-center",
                        result?.won
                          ? "border-emerald-400/35"
                          : isPushResult
                            ? "border-sky-300/35"
                            : "border-white/15"
                      )}>
                        {expiredResult ? (
                          <>
                            <div className="text-lg font-semibold text-red-200">Round Expired</div>
                            <div className="mt-1 text-sm text-white/75">
                              {expiredResult.forfeitedAmount} {tokenSymbol} forfeited.
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-lg font-semibold">
                              {resultOutcome} {result?.won ? "Wins" : isPushResult ? "Push" : "Wins"}
                            </div>
                            <div className="mt-1 text-sm text-white/75">
                              Bet: {resultBet} • Payout: {result?.payout ?? "0"} {tokenSymbol}
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {hasPendingGame && (
                      <div className="mt-3 border-t border-amber-300/25 px-1 pt-3 text-sm text-amber-50">
                        <div className="font-semibold">Active round</div>
                        <div className="mt-1 text-amber-50/80">
                          {canRevealActiveGame
                            ? "Reveal is ready."
                            : `Reveal unlocks in ${revealBlocksRemaining} block${revealBlocksRemaining === 1 ? "" : "s"}.`}
                        </div>
                        {!activeGameBelongsToWallet && (
                          <div className="mt-1 text-xs text-amber-100/75">
                            This round belongs to another wallet.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {showWagerPanel && (
                  <div className="rounded-[var(--radius-control)] border border-white/10 bg-black/45 p-3 shadow-[var(--shadow-hairline)]">
                    <div className="mb-2 text-xs font-semibold uppercase text-white/60">Bet On</div>
                    <div
                      className="flex flex-col items-center gap-1.5 rounded-[var(--radius-control)] border border-yellow-500/15 bg-red-950/20 px-2 py-2"
                      role="radiogroup"
                      aria-label="Baccarat bet type"
                      aria-orientation="vertical"
                    >
                      {TABLE_BET_OPTIONS.map((option, optionIndex) => {
                        const selected = option.value === betType;
                        return (
                          <button
                            key={option.value}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            aria-label={option.ariaLabel}
                            tabIndex={selected ? 0 : -1}
                            disabled={bettingLocked}
                            onClick={(event) => {
                              if (event.detail === 0) suppressBetMotionForKeyboard();
                              setBetType(option.value);
                            }}
                            onKeyDown={(event) => handleBetOptionKeyDown(event, optionIndex)}
                            ref={(node) => {
                              betOptionRefs.current[optionIndex] = node;
                            }}
                            className={cn(
                              "group relative flex min-h-11 min-w-0 items-center justify-center overflow-visible rounded-full border px-8 py-2 text-center text-sm font-extrabold uppercase leading-none text-yellow-200 shadow-[var(--shadow-hairline)] transition-[background-color,border-color,color,filter,box-shadow,transform] duration-[var(--motion-quick)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:translate-y-px disabled:pointer-events-none disabled:opacity-60",
                              suppressBetOptionMotion && "transition-none",
                              option.widthClassName,
                              selected
                                ? "border-yellow-300/85 bg-red-800/95 bg-[linear-gradient(180deg,rgba(127,29,29,0.98)_0%,rgba(91,12,12,0.98)_54%,rgba(61,6,6,0.98)_100%)] shadow-[0_0_0_1px_rgba(252,211,77,0.34),0_12px_28px_rgba(127,29,29,0.34)]"
                                : "border-yellow-600/50 bg-red-950/75 bg-[linear-gradient(180deg,rgba(94,14,14,0.72)_0%,rgba(69,10,10,0.78)_58%,rgba(37,5,5,0.86)_100%)] text-yellow-200/80 [@media(hover:hover)_and_(pointer:fine)]:hover:border-yellow-400/70 [@media(hover:hover)_and_(pointer:fine)]:hover:text-yellow-100"
                            )}
                          >
                            <span
                              aria-hidden="true"
                              className={cn(
                                "absolute -left-3 top-1/2 h-5 w-4 -translate-y-1/2",
                                selected ? "bg-yellow-300" : "bg-yellow-600/55"
                              )}
                              style={{ clipPath: "polygon(0 50%, 100% 0, 100% 100%)" }}
                            />
                            <span
                              aria-hidden="true"
                              className={cn(
                                "absolute left-8 right-8 top-1.5 h-0.5 rounded-full",
                                selected ? "bg-yellow-200" : "bg-yellow-600/35"
                              )}
                            />
                            <span className="truncate text-base">{option.label}</span>
                          </button>
                        );
                      })}
                    </div>

                    <div className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
                      <div className="min-w-0">
                        <label htmlFor={betAmountInputId} className="text-xs font-semibold uppercase text-white/60">
                          Bet Amount
                        </label>
                        <div className="mt-2 flex flex-wrap items-center gap-2">
                          <Input
                            id={betAmountInputId}
                            inputMode="text"
                            placeholder={formattedMinBet}
                            value={betAmount}
                            disabled={bettingLocked}
                            onChange={(event) => handleBetAmountChange(event.target.value)}
                            className="h-11 min-w-[4.5rem] border-white/20 bg-black/55 text-center text-white placeholder:text-white/45 caret-white selection:bg-white/20 selection:text-white focus:!border-white/45 focus:!bg-black/70 focus:!text-white focus:!outline-none focus-visible:!border-white/45 focus-visible:!bg-black/70 focus-visible:!text-white focus-visible:!ring-1 focus-visible:!ring-white/35 focus-visible:!ring-offset-0"
                            style={{ width: betInputWidth }}
                            aria-label="Baccarat bet amount"
                          />
                          <span className="inline-flex items-center gap-1 text-sm font-medium text-white/85">
                            <Image src={tokenLogo} alt={tokenSymbol} width={16} height={16} className="h-4 w-4 rounded-full" />
                            {tokenSymbol}
                          </span>
                        </div>
                        <div className="mt-2 text-xs text-white/60">
                          Min {formattedMinBet} • Max {formattedMaxBet}
                        </div>
                      </div>

                      <div className="min-w-0 space-y-1 text-sm text-white/80 sm:min-w-[12rem] sm:text-right">
                        <div className="flex justify-between gap-3 sm:justify-end">
                          <span className="text-white/55">Payout</span>
                          <span className="font-semibold text-white">{getBaccaratPayoutLabel(betType)}</span>
                        </div>
                        <div className="flex justify-between gap-3 sm:justify-end">
                          <span className="text-white/55">Potential</span>
                          <span className="inline-flex items-center gap-1 font-semibold text-white">
                            <Image src={tokenLogo} alt={tokenSymbol} width={14} height={14} className="h-3.5 w-3.5 rounded-full" />
                            {formatTokenAmount(potentialPayoutWei, tokenDecimals)} {tokenSymbol}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {error && <div className="text-center text-sm text-red-300">{error}</div>}
                {tokenDisabled && selectedToken && (
                  <div className="text-center text-sm text-white/60">
                    Baccarat is not enabled for the selected token.
                  </div>
                )}
              </div>
            )}
          </div>

          <div data-baccarat-action-footer className={BACCARAT_ACTIONS_CLASS}>
            {hasPendingGame ? (
              <BaccaratTransaction
                mode="reveal"
                landId={landId}
                disabled={!activeGameBelongsToWallet || !canRevealActiveGame || walletTxPending}
                buttonText={activeGame?.isExpired ? "Forfeit Expired Round" : canRevealActiveGame ? "Reveal Baccarat" : `Wait ${revealBlocksRemaining} Block${revealBlocksRemaining === 1 ? "" : "s"}`}
                buttonClassName={BACCARAT_REVEAL_BUTTON}
                onStatusUpdate={handleStatusUpdate}
                onComplete={handleRevealComplete}
                tokenSymbol={tokenSymbol}
                tokenDecimals={tokenDecimals}
              />
            ) : hasResolvedRound ? (
              <Button
                type="button"
                variant="warning"
                className="w-full font-bold"
                onClick={handlePlayAgain}
              >
                Play Again
              </Button>
            ) : !address ? (
              <Button className="w-full" variant="secondary" disabled>
                Connect wallet to play
              </Button>
            ) : !effectiveToken || !tokenConfig ? (
              <Button className="w-full" variant="secondary" disabled>
                Select a supported token
              </Button>
            ) : tokenDisabled ? (
              <Button className="w-full" variant="secondary" disabled>
                Baccarat unavailable for {tokenSymbol}
              </Button>
            ) : betWei <= BigInt(0) ? (
              <Button className="w-full" variant="secondary" disabled>
                Enter bet amount
              </Button>
            ) : amountBelowMin ? (
              <Button className="w-full" variant="secondary" disabled>
                Minimum {formattedMinBet} {tokenSymbol}
              </Button>
            ) : amountAboveMax ? (
              <Button className="w-full" variant="secondary" disabled>
                Maximum {formattedMaxBet} {tokenSymbol}
              </Button>
            ) : !hasBalance ? (
              <Button className="w-full" variant="secondary" disabled>
                Insufficient {tokenSymbol}
              </Button>
            ) : !hasApproval ? (
              <ApproveTransaction
                spenderAddress={LAND_CONTRACT_ADDRESS}
                tokenAddress={effectiveToken as `0x${string}`}
                onSuccess={handleApproveSuccess}
                buttonText={`Approve ${tokenSymbol}`}
                buttonClassName={BACCARAT_APPROVE_BUTTON}
              />
            ) : (
              <BaccaratTransaction
                mode="placeBet"
                landId={landId}
                betType={betType}
                betAmount={betWei}
                bettingToken={effectiveToken}
                disabled={!canPlaceBet}
                buttonText={`Deal ${getBaccaratBetLabel(betType)}`}
                buttonClassName={dealButtonClassName}
                onStatusUpdate={handleStatusUpdate}
                onComplete={handlePlaceComplete}
                tokenSymbol={tokenSymbol}
                tokenDecimals={tokenDecimals}
              />
            )}
            {displayedBalanceWei !== undefined && (
              <div className="flex items-center justify-center gap-1.5 text-center text-xs text-white/55">
                <span>Balance:</span>
                <Image src={tokenLogo} alt={tokenSymbol} width={14} height={14} className="h-3.5 w-3.5 rounded-full" />
                <span>{formatTokenAmount(displayedBalanceWei, displayedBalanceDecimals)} {tokenSymbol}</span>
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
