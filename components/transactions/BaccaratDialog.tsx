"use client";
import { isGameTransactionFailure } from "@/lib/game-transaction-status";
import { CasinoGameSurface } from './casino-game-surface';
import { GAME_ACTION_BUTTON_BASE, GAME_ACTION_FOOTER_CLASS, gameActionButtonClass } from './game-dialog-styles';

import type { LifecycleStatus } from "@/components/transactions/transaction-kit";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { AmountField } from '@/components/ui/amount-field';
import { TokenAmount } from '@/components/ui/token-amount';
import { CardHand } from "@/components/ui/PlayingCard";
import { useTokenMetadata } from "@/hooks/useTokenMetadata";
import { useCasinoBetPreference } from "@/hooks/useCasinoBetPreference";
import { formatCasinoLimitForToken, getCasinoUiMaxBet, getCasinoUiMinBet, isPotentialCasinoAmountInput, parseCasinoAmountInput } from "@/lib/casino-amount-input";
import { getClientCasinoPolicy } from "@/lib/casino-client";
import { getEconomicReadState } from "@/lib/economic-read-state";
import { getPoolBoundedMaxBet } from "@/lib/casino-pool-solvency";
import { BACCARAT_REVEAL_WINDOW_BLOCKS, getCasinoRevealWindow } from "@/lib/casino-reveal-window";
import { baccaratPotentialReturn, baccaratReturnLabel, baccaratWorstCaseReturn, validBaccaratPayoutRules, type BaccaratPayoutRules } from "@/lib/baccarat-presentation";
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
import { cn, getCasinoTokenImage } from "@/lib/utils";
import {
  getBaccaratBetLabel,
  getBaccaratOutcomeLabel,
} from "@/public/abi/baccarat-abi";
import { Loader2 } from "lucide-react";
import Image from "next/image";
import { type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "react-hot-toast";
import { formatUnits, parseUnits } from "viem";
import { useAccount, useBalance, useBlockNumber } from "wagmi";
import ApproveTransaction from "./approve-transaction";
import BaccaratTransaction, { type BaccaratRevealResult } from "./baccarat-transaction";
import { getBaseTransactionReceipt } from '@/lib/base-rpc';
import { baccaratOwnerScope, baccaratRoundBelongsTo, hasCompleteBaccaratResult, parseBaccaratResultFromReceipts, type BaccaratRoundIdentity, type BaccaratSettlement } from '@/lib/baccarat-result';

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
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

const BACCARAT_APPROVE_BUTTON = gameActionButtonClass('warning');
const BACCARAT_REVEAL_BUTTON = gameActionButtonClass('warning');

const BET_OPTIONS = [
  {
    value: BaccaratBetType.PLAYER,
    label: "Player",
    ariaLabel: "Bet on Player",
    actionClassName:
      "border border-sky-300/45 bg-sky-600 bg-[image:linear-gradient(180deg,rgba(56,189,248,0.95)_0%,rgba(2,132,199,0.94)_55%,rgba(3,105,161,0.98)_100%)] text-white [@media(hover:hover)_and_(pointer:fine)]:hover:brightness-[1.04]",
  },
  {
    value: BaccaratBetType.BANKER,
    label: "Banker",
    ariaLabel: "Bet on Banker",
    actionClassName:
      "border border-rose-300/45 bg-rose-700 bg-[image:linear-gradient(180deg,rgba(244,63,94,0.96)_0%,rgba(190,18,60,0.94)_56%,rgba(136,19,55,0.98)_100%)] text-white [@media(hover:hover)_and_(pointer:fine)]:hover:brightness-[1.04]",
  },
  {
    value: BaccaratBetType.TIE,
    label: "Tie",
    ariaLabel: "Bet on Tie",
    actionClassName:
      "border border-amber-300/45 bg-amber-500 bg-[image:linear-gradient(180deg,rgba(251,191,36,0.98)_0%,rgba(217,119,6,0.96)_56%,rgba(146,64,14,0.98)_100%)] text-amber-950 [@media(hover:hover)_and_(pointer:fine)]:hover:brightness-[1.04]",
  },
];

const TABLE_BET_OPTIONS = [
  { ...BET_OPTIONS[2], widthClassName: "w-[86%]" },
  { ...BET_OPTIONS[1], widthClassName: "w-[94%]" },
  { ...BET_OPTIONS[0], widthClassName: "w-full" },
] as const;

function BaccaratHandArea({ cards, label, value }: { cards: number[]; label: string; value?: number }) {
  return <CardHand cards={cards.length ? cards : [null, null]} label={`${label} hand`} value={value} hideHoleCard={cards.length === 0} />;
}

export default function BaccaratDialog(props: BaccaratDialogProps) {
  const { address } = useAccount();
  // A wallet/land change must never inherit another owner's local round or requests.
  return <BaccaratDialogContent key={baccaratOwnerScope(address, props.landId)} {...props} />;
}

function BaccaratDialogContent({
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
  const [readStatus, setReadStatus] = useState<"loading" | "ready" | "error" | "unsupported" | "disabled">("loading");
  const [verifiedConfigToken, setVerifiedConfigToken] = useState<string | null>(null);
  const [payoutRules, setPayoutRules] = useState<BaccaratPayoutRules | null>(null);
  const [tokenConfig, setTokenConfig] = useState<BaccaratTokenConfig | null>(null);
  const [activeGame, setActiveGame] = useState<BaccaratActiveGame | null>(null);
  const [allowanceWei, setAllowanceWei] = useState(BigInt(0));
  const [settlement, setSettlement] = useState<BaccaratSettlement | null>(null);
  const [receiptRetrying, setReceiptRetrying] = useState(false);
  const [receiptRetry, setReceiptRetry] = useState(0);
  const receiptScopeRef = useRef(0);
  const submittedRoundRef = useRef<BaccaratRoundIdentity | null>(null);
  const settledHashesRef = useRef(new Set<string>());
  const [isLoading, setIsLoading] = useState(false);
  const [walletTxPending, setWalletTxPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [optimisticBalanceWei, setOptimisticBalanceWei] = useState<bigint | null>(null);

  const hasResolvedRound = !!settlement && hasCompleteBaccaratResult(settlement.result);
  const awaitingReceipt = !!settlement && !hasResolvedRound;
  const result = hasResolvedRound && !settlement.result.expired ? settlement.result : null;
  const expiredResult = hasResolvedRound && settlement.result.expired ? settlement.result : null;
  const effectiveToken = settlement?.round.token ?? (activeGame?.isActive ? activeGame.bettingToken : selectedToken);
  const { symbol: tokenSymbolRaw, decimals: metadataDecimals, isReady: metadataReady, isError: metadataError, refetch: refetchMetadata } = useTokenMetadata(effectiveToken);
  const tokenDecimals = settlement?.round.decimals ?? metadataDecimals;
  const tokenSymbol = settlement?.round.symbol ?? tokenSymbolRaw ?? "TOKEN";
  const tokenLogo = useMemo(() => getCasinoTokenImage(effectiveToken), [effectiveToken]);
  const uiMinBet = useMemo(
    () => tokenConfig && tokenDecimals !== undefined ? getCasinoUiMinBet(effectiveToken, tokenDecimals, tokenConfig.minBet) : BigInt(0),
    [effectiveToken, tokenConfig, tokenDecimals]
  );
  const uiMaxBet = useMemo(
    () => tokenConfig && tokenDecimals !== undefined ? getCasinoUiMaxBet(effectiveToken, tokenDecimals, tokenConfig.maxBet) : BigInt(0),
    [effectiveToken, tokenConfig, tokenDecimals]
  );
  const { data: payoutPoolData, isLoading: isPayoutPoolLoading, error: payoutPoolError, refetch: refetchPayoutPool } = useBalance({
    address: tokenConfig?.rewardPool as `0x${string}` | undefined,
    token: effectiveToken as `0x${string}` | undefined,
    query: {
      enabled: open && !!tokenConfig?.rewardPool && !!effectiveToken,
      refetchInterval: open ? 10_000 : false,
    },
  });
  const payoutPoolReadStatus = getEconomicReadState({
    hasSnapshot: payoutPoolData?.value !== undefined,
    identityMatches: !!tokenConfig?.rewardPool && !!effectiveToken,
    loading: isPayoutPoolLoading,
    error: payoutPoolError,
  });
  const payoutPoolBalance = payoutPoolData?.value ?? null;
  const offeredMaxBet = payoutRules ? (getPoolBoundedMaxBet(uiMaxBet, payoutPoolBalance, baccaratWorstCaseReturn(payoutRules)) ?? uiMaxBet) : BigInt(0);
  const formattedMinBet = useMemo(
    () => tokenConfig && tokenDecimals !== undefined ? formatCasinoLimitForToken(uiMinBet, tokenDecimals, effectiveToken, "min") : "—",
    [effectiveToken, tokenConfig, tokenDecimals, uiMinBet]
  );
  const formattedMaxBet = useMemo(
    () => tokenConfig && tokenDecimals !== undefined ? formatCasinoLimitForToken(offeredMaxBet, tokenDecimals, effectiveToken, "max") : "—",
    [effectiveToken, offeredMaxBet, tokenConfig, tokenDecimals]
  );

  const { data: balanceData, error: balanceError, isLoading: balanceLoading, refetch: refetchBalance } = useBalance({
    address,
    token: effectiveToken as `0x${string}` | undefined,
    query: { enabled: !!address && !!effectiveToken },
  });

  const balanceReadState = getEconomicReadState({ hasSnapshot: balanceData?.value !== undefined, identityMatches: !!address && !!effectiveToken, loading: balanceLoading, error: balanceError });
  const { data: liveBlock } = useBlockNumber({
    watch: open && !!activeGame?.isActive,
    query: {
      enabled: open && !!activeGame?.isActive,
      refetchInterval: open && activeGame?.isActive ? 3000 : false,
    },
  });

  const betWei = useMemo(() => {
    if (tokenDecimals === undefined) return BigInt(0);
    try {
      return parseCasinoAmountInput(betAmount || "0", tokenDecimals);
    } catch {
      return BigInt(0);
    }
  }, [betAmount, tokenDecimals]);

  const potentialPayoutWei = useMemo(() => payoutRules && betWei > BigInt(0)
    ? baccaratPotentialReturn(betType, betWei, payoutRules) : null, [betType, betWei, payoutRules]);
  const revealWindow = activeGame?.isActive
    ? getCasinoRevealWindow(activeGame.revealBlock, liveBlock, BACCARAT_REVEAL_WINDOW_BLOCKS) : null;
  const activeRoundExpired = activeGame?.isExpired === true || revealWindow?.expired === true;
  const canRevealActiveGame = !!activeGame?.isActive && (activeRoundExpired || (revealWindow?.blocksUntilOpen === BigInt(0)) || (liveBlock === undefined && activeGame.canReveal));
  const activeGameBelongsToWallet = !activeGame?.isActive || (!!address && activeGame.player.toLowerCase() === address.toLowerCase());
  const balanceWei = optimisticBalanceWei ?? balanceData?.value ?? BigInt(0);
  const displayedBalanceWei = optimisticBalanceWei ?? balanceData?.value;
  const displayedBalanceDecimals = balanceData?.decimals ?? tokenDecimals;
  const hasBalance = !address || !tokenConfig || balanceWei >= betWei;
  const hasApproval = allowanceWei >= betWei;
  const amountBelowMin = !!tokenConfig && betWei > BigInt(0) && betWei < uiMinBet;
  const amountAboveMax = !!tokenConfig && betWei > offeredMaxBet;
  const payoutPoolUnknown = payoutPoolReadStatus !== "ready";
  const poolLiquidityBinds = payoutPoolReadStatus === "ready" && offeredMaxBet < uiMaxBet;
  const gameDataReady = readStatus === "ready" && verifiedConfigToken === effectiveToken?.toLowerCase();
  const tokenDisabled = readStatus === "unsupported" || readStatus === "disabled";
  const amountIssue = !metadataReady || !tokenConfig ? undefined
    : betWei <= BigInt(0) ? "Enter a valid bet amount."
    : amountBelowMin ? `Minimum ${formattedMinBet} ${tokenSymbol}.`
    : amountAboveMax ? `Maximum ${formattedMaxBet} ${tokenSymbol}.`
    : !hasBalance ? `Your available ${tokenSymbol} balance is too low.` : undefined;
  const hasPendingGame = !!activeGame?.isActive && !settlement;
  const bettingLocked = walletTxPending || hasPendingGame || awaitingReceipt || !metadataReady || phase === "waiting" || phase === "revealing";
  const balanceScopeKey = `${address?.toLowerCase() ?? ""}:${effectiveToken?.toLowerCase() ?? ""}`;
  const canPlaceBet =
    casinoPolicy.playable &&
    metadataReady &&
    gameDataReady &&
    !!payoutRules &&
    !!address &&
    !!effectiveToken &&
    !!tokenConfig &&
    tokenConfig.supported &&
    tokenConfig.enabled &&
    betWei >= uiMinBet &&
    betWei <= offeredMaxBet &&
    hasBalance &&
    balanceReadState === "ready" &&
    hasApproval &&
    !payoutPoolUnknown &&
    !bettingLocked;
  const refreshScopeKey = [
    open ? "open" : "closed",
    casinoPolicy.playable ? "playable" : "disabled",
    address?.toLowerCase() ?? "",
    landId.toString(),
    selectedToken?.toLowerCase() ?? "",
    effectiveToken?.toLowerCase() ?? "",
    tokenDecimals?.toString() ?? "unknown",
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

  useEffect(() => {
    // A selected-token change dismisses an old result, but cannot discard a
    // confirmed reveal whose receipt still needs recovery.
    setSettlement(current => current && hasCompleteBaccaratResult(current.result) ? null : current);
  }, [selectedToken]);

  useEffect(() => () => { receiptScopeRef.current += 1; }, []);

  const refetchBalanceAfterTx = useCallback(() => {
    dispatchPostTransactionRefresh();
    for (const delay of POST_TRANSACTION_REFRESH_DELAYS_MS) {
      if (delay <= 0) {
        void refetchBalance();
        void refetchPayoutPool();
      } else {
        window.setTimeout(() => void refetchBalance(), delay);
        window.setTimeout(() => void refetchPayoutPool(), delay);
      }
    }
  }, [refetchBalance, refetchPayoutPool]);
  const retryPayoutPool = useCallback(() => {
    void refetchPayoutPool().catch((error) => {
      console.warn("Failed to refresh Baccarat reward pool:", error);
    });
  }, [refetchPayoutPool]);

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
      if (options?.showLoading) { setIsLoading(true); setReadStatus("loading"); }
    }
    const isCurrentRequest = () => (
      refreshScopeRef.current === refreshScopeKey &&
      refreshGenerationRef.current === requestGeneration
    );

    try {
      setError(null);
      const active = await baccaratGetActiveGame(landId);
      if (!isCurrentRequest()) return null;
      if (!active) throw new Error("Baccarat game state read failed");
      // Recovery belongs to the paid round. Optional new-bet/config reads must
      // never hide it or prevent a no-new-spend reveal.
      if (active.isActive) {
        setActiveGame(active);
        setBetType(active.betType);
        setPhase(active.canReveal || active.isExpired ? "revealing" : "waiting");
      } else if (!options?.keepPendingWhenMissing) {
        setActiveGame(null);
        setPhase(current => current === "betting" ? current : "idle");
      }
      const globalConfig = await baccaratGetConfig();
      if (!isCurrentRequest()) return null;
      if (!globalConfig || !validBaccaratPayoutRules(globalConfig)) throw new Error("Baccarat payout rules read failed");
      setPayoutRules({ bankerCommissionBps: globalConfig.bankerCommissionBps, tiePayoutMultiplier: globalConfig.tiePayoutMultiplier });
      const token = active.isActive ? active.bettingToken : selectedToken;
      if (!token || !globalConfig.enabled) {
        setTokenConfig(null);
        setAllowanceWei(BigInt(0));
        setReadStatus(globalConfig.enabled ? "unsupported" : "disabled");
        return active;
      }
      const cfg = await baccaratGetTokenConfig(token);
      if (!isCurrentRequest()) return null;
      if (!cfg) throw new Error("Baccarat token config read failed");
      setTokenConfig(cfg);
      setVerifiedConfigToken(token.toLowerCase());
      let approval = BigInt(0);
      if (address && cfg.supported) approval = await checkCasinoApproval(address, token);
      if (!isCurrentRequest()) return null;
      setReadStatus(!cfg.supported ? "unsupported" : !cfg.enabled ? "disabled" : "ready");
      if (allowanceGenerationRef.current === allowanceGeneration) setAllowanceWei(approval);
      return active;
    } catch (err) {
      if (isCurrentRequest()) {
        console.error("Failed to load baccarat state:", err);
        setReadStatus("error");
        setError("Baccarat data unavailable. Retry to verify the game and betting limits.");
      }
      return null;
    } finally {
      if (isCurrentRequest() && loadingGenerationRef.current === requestGeneration) {
        loadingGenerationRef.current = null;
        setIsLoading(false);
      }
    }
  }, [address, casinoPolicy.playable, landId, open, refreshScopeKey, selectedToken]);

  useEffect(() => {
    if (activeGame?.isActive && metadataReady && tokenDecimals !== undefined && effectiveToken?.toLowerCase() === activeGame.bettingToken.toLowerCase()) {
      setBetAmount(formatUnits(activeGame.betAmount, tokenDecimals));
    }
  }, [activeGame, effectiveToken, metadataReady, tokenDecimals]);

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

  const rememberBetAmount = useCasinoBetPreference({
    game: 'baccarat', scope: open ? loadingScopeKey : null,
    enabled: !!tokenConfig && !activeGame?.isActive && readStatus === 'ready',
    token: effectiveToken, decimals: tokenDecimals, minBet: uiMinBet, maxBet: offeredMaxBet,
    onInitialize: setBetAmount,
  });

  useEffect(() => {
    const waitingForActiveGame = !activeGame?.isActive && phase === "waiting" && !settlement;
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
  }, [activeGame?.isActive, hasPendingGame, settlement, open, phase, refreshBaccaratState, walletTxPending]);

  const handleStatusUpdate = useCallback((status: LifecycleStatus) => {
    const statusName = status.statusName ?? "";
    if (statusName === "transactionPending") {
      setWalletTxPending(true);
    }
    if (statusName === "success" || isGameTransactionFailure(statusName)) {
      setWalletTxPending(false);
    }
  }, []);

  const handlePlaceComplete = useCallback(async (txResult?: BaccaratRevealResult) => {
    setWalletTxPending(false);
    if (!txResult) return;

    setSettlement(null);
    setPhase("waiting");
    applyOptimisticBalanceDelta(-betWei);
    refetchBalanceAfterTx();

    for (const delayMs of [0, 1500, 4000]) {
      if (delayMs > 0) await wait(delayMs);
      const active = await refreshBaccaratState({ keepPendingWhenMissing: true });
      if (active?.isActive) break;
    }
  }, [applyOptimisticBalanceDelta, betWei, refetchBalanceAfterTx, refreshBaccaratState]);

  const roundIdentity = useMemo((): BaccaratRoundIdentity | undefined => (
    activeGame?.isActive
      ? { owner: activeGame.player, landId, token: activeGame.bettingToken, decimals: tokenDecimals,
          symbol: tokenSymbolRaw, wager: activeGame.betAmount, betType: activeGame.betType, revealBlock: activeGame.revealBlock }
      : undefined
  ), [activeGame, landId, tokenDecimals, tokenSymbolRaw]);

  const acceptSettlement = useCallback((round: BaccaratRoundIdentity, revealResult: BaccaratRevealResult) => {
    if (!baccaratRoundBelongsTo(round, address, landId)) return;
    setSettlement({ round, result: revealResult });
    if (!hasCompleteBaccaratResult(revealResult)) return;
    const settlementKey = revealResult.transactionHash ?? `${round.owner}:${round.landId}:${round.revealBlock}`;
    if (settledHashesRef.current.has(settlementKey)) return;
    settledHashesRef.current.add(settlementKey);
    if (!revealResult.expired) {
      const payoutWei = revealResult.payoutWei ?? (revealResult.payout !== undefined && round.decimals !== undefined ? parseUnits(revealResult.payout, round.decimals) : BigInt(0));
      if (payoutWei > BigInt(0)) applyOptimisticBalanceDelta(payoutWei);
    }
    setActiveGame(null);
    setPhase("idle");
    onGameComplete?.();
  }, [address, applyOptimisticBalanceDelta, landId, onGameComplete]);

  const handleRevealComplete = useCallback((revealResult?: BaccaratRevealResult) => {
    setWalletTxPending(false);
    if (!revealResult) return;
    const round = submittedRoundRef.current ?? roundIdentity;
    if (!round) return;
    refetchBalanceAfterTx();
    acceptSettlement(round, revealResult);
  }, [acceptSettlement, refetchBalanceAfterTx, roundIdentity]);

  useEffect(() => {
    if (!open || !awaitingReceipt || !settlement?.result.transactionHash) return;
    const scope = receiptScopeRef.current;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;
    const recover = async () => {
      setReceiptRetrying(true);
      try {
        const receipt = await getBaseTransactionReceipt(settlement.result.transactionHash as `0x${string}`);
        if (disposed || receiptScopeRef.current !== scope) return;
        const recovered = parseBaccaratResultFromReceipts([receipt], settlement.round, LAND_CONTRACT_ADDRESS);
        if (recovered && hasCompleteBaccaratResult(recovered)) {
          acceptSettlement(settlement.round, recovered);
          refetchBalanceAfterTx();
          return;
        }
      } catch { /* Confirmed transaction; unavailable receipt is not a loss or a failed reveal. */ }
      finally { if (!disposed && receiptScopeRef.current === scope) setReceiptRetrying(false); }
      const delay = [1500, 4000, 8000][attempt++];
      if (!disposed && receiptScopeRef.current === scope && delay !== undefined) timer = setTimeout(() => void recover(), delay);
    };
    void recover();
    return () => { disposed = true; if (timer) clearTimeout(timer); };
  }, [acceptSettlement, awaitingReceipt, open, receiptRetry, refetchBalanceAfterTx, settlement]);

  const handleApproveSuccess = useCallback(async () => {
    if (!address || !effectiveToken || refreshScopeRef.current !== refreshScopeKey) return;

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
  }, [address, betWei, effectiveToken, refreshScopeKey]);

  const handleBetAmountChange = useCallback((value: string) => {
    if (!isPotentialCasinoAmountInput(value)) return;
    setBetAmount(value);
    rememberBetAmount(value);
  }, [rememberBetAmount]);

  const handleClose = useCallback(() => {
    if (walletTxPending) {
      toast.error("Wait for the wallet transaction to finish.");
      return;
    }
    if (activeGame?.isActive && !hasResolvedRound) {
      toast("Return to reveal your Baccarat result before its block deadline or your stake is forfeited.", { id: "baccarat-active-close" });
    }
    onOpenChange(false);
  }, [activeGame?.isActive, hasResolvedRound, onOpenChange, walletTxPending]);

  const handlePlayAgain = useCallback(() => {
    setSettlement(null);
    submittedRoundRef.current = null;
    setError(null);
    setPhase("idle");
    void refetchBalance();
  }, [refetchBalance]);

  const resultOutcome = result?.outcome !== undefined ? getBaccaratOutcomeLabel(result.outcome) : null;
  const resultBet = result?.betType !== undefined ? getBaccaratBetLabel(result.betType) : getBaccaratBetLabel(betType);
  const resolvedPayout = result?.payoutWei !== undefined && tokenDecimals !== undefined ? formatUnits(result.payoutWei, tokenDecimals) : result?.payout;
  const resolvedForfeiture = expiredResult?.forfeitedWei !== undefined && tokenDecimals !== undefined ? formatUnits(expiredResult.forfeitedWei, tokenDecimals) : expiredResult?.forfeitedAmount;
  const isPushResult = !!result && !result.won && (result.payoutWei !== undefined ? result.payoutWei > BigInt(0) : !!result.payout && result.payout !== "0");
  const netResultWei = result?.payoutWei !== undefined && settlement ? result.payoutWei - settlement.round.wager : undefined;
  const resultHeading = isPushResult ? "Bet returned" : result?.won ? "You won" : "You lost";
  const resultNetAmount = netResultWei !== undefined && tokenDecimals !== undefined ? `${formatUnits(netResultWei < BigInt(0) ? -netResultWei : netResultWei, tokenDecimals)} ${tokenSymbol}` : undefined;
  const showTable = hasPendingGame || !!settlement;
  const showWagerPanel = !hasPendingGame && !settlement;
  const selectedBetOption = useMemo(
    () => BET_OPTIONS.find((option) => option.value === betType) ?? BET_OPTIONS[1],
    [betType]
  );
  const dealButtonClassName = useMemo(
    () => `${GAME_ACTION_BUTTON_BASE} ${selectedBetOption.actionClassName}`,
    [selectedBetOption.actionClassName]
  );
  const baccaratAnnouncement = expiredResult
    ? `Baccarat round expired. ${resolvedForfeiture === undefined ? 'Verify token details to display the forfeited amount.' : `${resolvedForfeiture} ${tokenSymbol} forfeited.`}`
    : result && resultOutcome
      ? `Baccarat result: ${resultHeading}${!isPushResult && resultNetAmount ? ` ${resultNetAmount}` : ""}. ${resultOutcome === "Tie" ? "The hands tied" : `${resultOutcome} had the winning hand`}. ${resolvedPayout === undefined ? 'Verify token details to display the returned amount.' : `Total returned ${resolvedPayout} ${tokenSymbol}.`}`
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
      <CasinoGameSurface
        title="Baccarat"
        description="Punto Banco Baccarat with Player, Banker, and Tie bets."
        onClose={handleClose}
        preventEscape={walletTxPending || hasPendingGame}
      >
        <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
          {baccaratAnnouncement}
        </p>

        <div className="flex min-h-0 flex-1 flex-col bg-black/50 text-white">
          <div className="px-3 pb-4 pt-4 sm:px-4 sm:pt-5">
            {isLoading ? (
              <div className="flex min-h-[22rem] items-center justify-center" role="status" aria-live="polite">
                <Loader2 aria-hidden="true" className="h-8 w-8 animate-spin text-white/70" />
                <span className="sr-only">Loading Baccarat game</span>
              </div>
            ) : (
              <div className="mx-auto flex w-full max-w-[38rem] flex-col gap-3 sm:gap-4">
                {showTable && (
                  <div className="rounded-[var(--radius-control)] border border-white/10 bg-black/35 p-3 shadow-[var(--shadow-hairline)]">
                    {result && <div className="grid min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2">
                      <BaccaratHandArea
                        cards={result?.playerCards ?? []}
                        label="Player"
                        value={result?.playerTotal}
                      />
                      <BaccaratHandArea
                        cards={result?.bankerCards ?? []}
                        label="Banker"
                        value={result?.bankerTotal}
                      />
                    </div>}

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
                              {resolvedForfeiture === undefined ? 'Verify token details to display the forfeited amount.' : `${resolvedForfeiture} ${tokenSymbol} forfeited.`}
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="text-lg font-semibold">
                              {resultHeading}{!isPushResult && resultNetAmount ? ` ${resultNetAmount}` : ""}
                            </div>
                            <div className="mt-1 text-sm text-white/75">
                              Bet: {resultBet} • Total returned: {resolvedPayout === undefined ? 'Amount unavailable until token details are verified' : `${resolvedPayout} ${tokenSymbol}`}
                            </div>
                            <p className="mt-1 text-sm text-white/75">{resultOutcome === "Tie" ? "The hands tied." : `${resultOutcome} had the winning hand.`}</p>
                          </>
                        )}
                      </div>
                    )}

                    {awaitingReceipt && (
                      <div className="space-y-2 text-sm" role="status" aria-live="polite">
                        <p className="font-semibold">Reveal confirmed. Result is still loading.</p>
                        <p>Your {tokenDecimals === undefined ? '' : `${formatUnits(settlement.round.wager, tokenDecimals)} ${tokenSymbol} `}{getBaccaratBetLabel(settlement.round.betType)} bet is preserved while we retrieve its outcome.</p>
                        {settlement.result.transactionHash && (
                          <a className="underline" href={`https://basescan.org/tx/${settlement.result.transactionHash}`} target="_blank" rel="noopener noreferrer">View confirmed transaction</a>
                        )}
                      </div>
                    )}

                    {hasPendingGame && activeGame && (
                      <section aria-label="Committed Baccarat round" className="space-y-2 px-1 text-sm text-amber-50">
                        <p className="font-semibold">{tokenDecimals === undefined ? "Committed stake: amount unavailable" : `${formatUnits(activeGame.betAmount, tokenDecimals)} ${tokenSymbol} committed`} · {getBaccaratBetLabel(activeGame.betType)}</p>
                        <ol className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-white/80" aria-label="Round progress">
                          <li>1. Bet placed</li><li aria-current="step">2. {activeRoundExpired ? "Reveal deadline passed" : canRevealActiveGame ? "Reveal available" : "Waiting for reveal"}</li><li>3. Result</li>
                        </ol>
                        <p role="status">{activeRoundExpired
                          ? "The reveal deadline passed and your stake is forfeited. Close the expired round to continue."
                          : revealWindow?.remainingRevealBlocks === null
                            ? "Checking the current block. Reveal promptly when available."
                            : canRevealActiveGame
                              ? revealWindow?.remainingRevealBlocks === BigInt(0) ? "Reveal now: this is the last valid block." : `Reveal now. ${revealWindow?.remainingRevealBlocks} blocks remain before your stake is forfeited.`
                              : `Reveal unlocks in ${revealWindow?.blocksUntilOpen} blocks.`}</p>
                        <p className="break-words text-xs text-white/75">Reveal window: blocks {revealWindow?.firstRevealBlock.toString()}–{revealWindow?.lastRevealBlock.toString()} (inclusive).</p>
                        {!activeGameBelongsToWallet && <p>This round belongs to another wallet.</p>}
                      </section>
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
                              "group relative flex min-h-11 min-w-0 items-center justify-center overflow-visible rounded-full border px-8 py-2 text-center text-sm font-extrabold uppercase leading-none text-yellow-200 shadow-[var(--shadow-hairline)] transition-[background-color,border-color,color,filter,box-shadow,transform,translate] duration-[var(--motion-quick)] ease-[var(--ease-standard)] focus-visible:transition-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-yellow-300/80 focus-visible:ring-offset-2 focus-visible:ring-offset-black active:translate-y-px disabled:pointer-events-none disabled:opacity-60",
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
                      <div className="min-w-0 flex-1">
                        <AmountField id={betAmountInputId} label="Bet amount" unit={tokenSymbol} surface="game" placeholder={formattedMinBet} aria-label="Baccarat bet amount" value={betAmount} onChange={e => handleBetAmountChange(e.target.value)} disabled={bettingLocked}
                          error={amountIssue} hint={<p>Minimum {formattedMinBet} · Maximum {formattedMaxBet} {tokenSymbol}.</p>}
                          balance={displayedBalanceWei !== undefined && displayedBalanceDecimals !== undefined ? formatUnits(displayedBalanceWei, displayedBalanceDecimals) : "Checking…"} />
                        {payoutPoolUnknown ? (
                          <div className="mt-2 text-xs text-amber-200" role="status">
                            <p>{payoutPoolReadStatus === "error"
                              ? "Reward pool liquidity could not be verified. Retry before dealing."
                              : "Checking reward pool liquidity before enabling bets..."}</p>
                            {payoutPoolReadStatus === "error" && (
                              <Button type="button" variant="outline" className="mt-2" onClick={retryPayoutPool}>
                                Retry reward pool read
                              </Button>
                            )}
                          </div>
                        ) : poolLiquidityBinds ? (
                          <div className="mt-2 text-xs text-amber-200" role="alert">
                            Reward pool liquidity limits the max bet to {formattedMaxBet} {tokenSymbol}.
                          </div>
                        ) : null}
                      </div>

                      <div className="min-w-0 space-y-1 text-sm text-white/80 [overflow-wrap:anywhere] sm:max-w-[45%] sm:text-right">
                        <div className="flex justify-between gap-3 sm:justify-end">
                          <span className="text-white/75">Winning return</span>
                          <span className="font-semibold text-white">{payoutRules ? baccaratReturnLabel(betType, payoutRules) : "Verifying rules…"}</span>
                        </div>
                        <div className="flex justify-between gap-3 sm:justify-end">
                          <span className="text-white/75">Total returned</span>
                          <span className="inline-flex items-center gap-1 font-semibold text-white">
                            <Image src={tokenLogo} alt={tokenSymbol} width={14} height={14} className="h-3.5 w-3.5 rounded-full" />
                            {tokenDecimals === undefined || potentialPayoutWei === null ? '—' : formatUnits(potentialPayoutWei, tokenDecimals)} {tokenSymbol}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {showWagerPanel && <p className="text-sm leading-relaxed text-white/80">Placing a bet is step 1. You must submit a second transaction to reveal the result within {BACCARAT_REVEAL_WINDOW_BLOCKS.toString()} blocks after its reveal block, or your entire stake is forfeited. The exact deadline appears after your bet is confirmed.</p>}
                <details className="rounded-lg border border-white/20 bg-black/45 p-3 text-sm text-white/85">
                  <summary className="min-h-11 cursor-pointer content-center font-semibold">How to play Baccarat</summary>
                  <div className="space-y-2 pt-2 leading-relaxed">
                    <p>Choose Player, Banker, or Tie. The hand closest to 9 wins. Aces count as 1, cards 2–9 at face value, and 10/J/Q/K as 0. Only the last digit of the total counts.</p>
                    <p>A natural 8 or 9 ends the deal. Otherwise Player draws on 0–5. If Player stands, Banker draws on 0–5. If Player draws, Banker draws on 0–2; on 3 unless Player drew 8; on 4 with Player’s third card 2–7; on 5 with 4–7; and on 6 with 6–7.</p>
                    <p>{payoutRules ? `Player returns 2× the stake. Banker deducts ${payoutRules.bankerCommissionBps / 100}% commission from winnings (${baccaratReturnLabel(BaccaratBetType.BANKER, payoutRules)}). Tie returns ${1 + payoutRules.tiePayoutMultiplier}× the stake. All total returns include the original stake.` : "Payout rules are unavailable until game data is verified."} Player and Banker bets are returned when the hands tie.</p>
                  </div>
                </details>
                {error && <div role="alert" className="space-y-2 text-center text-sm text-red-200"><p>{error}</p>{readStatus === "error" && <Button onClick={() => void refreshBaccaratState({ showLoading: false })}>Retry game data</Button>}</div>}
                {balanceError && <div role="alert" className="space-y-2 text-center text-sm text-amber-100"><p>Your latest balance could not be verified. Displayed amounts are last known; new bets are paused.</p><Button onClick={() => { void Promise.allSettled([refetchBalance(), refreshBaccaratState({ showLoading: false })]); }}>Retry balance read</Button></div>}
                {metadataError && <Button onClick={() => void refetchMetadata()}>Retry token details</Button>}
                {tokenDisabled && selectedToken && (
                  <div className="text-center text-sm text-white/60">
                    {readStatus === "unsupported" ? "The selected token is not supported for Baccarat." : "Baccarat betting is currently disabled."}
                  </div>
                )}
              </div>
            )}
          </div>

          <div data-baccarat-action-footer className={GAME_ACTION_FOOTER_CLASS}>
            {awaitingReceipt ? (
              <Button className="w-full" disabled={receiptRetrying || !settlement.result.transactionHash} onClick={() => setReceiptRetry(value => value + 1)}>
                {receiptRetrying ? 'Retrieving result...' : 'Retry result retrieval'}
              </Button>
            ) : hasPendingGame ? (
              <BaccaratTransaction
                mode="reveal"
                roundIdentity={roundIdentity}
                landId={landId}
                disabled={!activeGameBelongsToWallet || !canRevealActiveGame || walletTxPending || !roundIdentity}
                buttonText={activeRoundExpired ? "Close expired round" : "Reveal result"}
                buttonClassName={BACCARAT_REVEAL_BUTTON}
                onStatusUpdate={handleStatusUpdate}
                onComplete={handleRevealComplete}
                onButtonClick={() => { submittedRoundRef.current = roundIdentity ?? null; }}
                tokenSymbol={tokenSymbol}
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
            ) : !address || !metadataReady || !effectiveToken || !tokenConfig || !gameDataReady || payoutPoolUnknown || balanceReadState !== "ready" || !!amountIssue ? (
              <div className="space-y-2">
                <Button className="w-full" variant="secondary" disabled aria-describedby={`${betAmountInputId}-availability`}>Deal {getBaccaratBetLabel(betType)}</Button>
                <p id={`${betAmountInputId}-availability`} role="status" className="text-center text-xs text-white/80">
                  {!address ? "Connect wallet to play." : !metadataReady ? "Verify token details to enable new bets." : readStatus === "error" ? "Retry game data to continue." : !gameDataReady && !tokenDisabled ? "Loading Baccarat limits…" : tokenDisabled ? "Baccarat betting is unavailable." : payoutPoolUnknown ? "Verify reward pool liquidity to continue." : balanceReadState !== "ready" ? "Verify your balance to enable new bets." : amountIssue}
                </p>
              </div>
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
              />
            )}
            {displayedBalanceWei !== undefined && displayedBalanceDecimals !== undefined && (
              <div className="flex items-center justify-center gap-1.5 text-center text-xs text-white/55">
                <span>{balanceError ? "Last known balance:" : "Balance:"}</span>
                <TokenAmount amount={displayedBalanceWei} decimals={displayedBalanceDecimals} unit={tokenSymbol} mode="compact" withIcon={false} />
              </div>
            )}
          </div>
        </div>
      </CasinoGameSurface>
    </Dialog>
  );
}
