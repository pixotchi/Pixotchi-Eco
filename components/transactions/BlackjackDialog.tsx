"use client";

import { Button } from '@/components/ui/button';
import { Dialog,DialogContent,DialogDescription,DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { CardHand,calculateHandValue,getCardValue } from '@/components/ui/PlayingCard';
import { useTokenMetadata } from '@/hooks/useTokenMetadata';
import { loadBetPreference,storeBetPreference } from '@/lib/casino-bet-preferences';
import { getClientCasinoPolicy } from '@/lib/casino-client';
import {
BlackjackAction,
BlackjackPhase,
BlackjackResult,
LAND_CONTRACT_ADDRESS,
blackjackGetGameSnapshot,
blackjackGetGameToken,
blackjackGetTokenConfig,
checkCasinoApproval,
} from '@/lib/contracts';
import { formatTokenAmount,formatTokenAmountRounded,getCasinoTokenImage } from '@/lib/utils';
import { getResultText } from '@/public/abi/blackjack-abi';
import { X } from 'lucide-react';
import Image from 'next/image';
import { useCallback,useEffect,useId,useMemo,useRef,useState } from 'react';
import { toast } from 'react-hot-toast';
import { formatUnits,parseUnits } from 'viem';
import { useAccount,useBalance } from 'wagmi';
import ApproveTransaction from './approve-transaction';
import BlackjackTransaction from './blackjack-transaction';
import type { LifecycleStatus } from './transaction-kit';

interface BlackjackDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    landId: bigint;
    onGameComplete?: () => void;
    selectedToken: string | null;
}

const MAX_TOKEN_APPROVAL = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');
const APPROVAL_REFRESH_DELAYS_MS = [0, 750, 1500, 3000] as const;
const BLACKJACK_FAILURE_STATUSES = new Set([
    'error',
    'failed',
    'reverted',
    'cancelled',
    'canceled',
    'rejected',
    'transactionRejected',
    'userRejected',
    'buildError',
]);
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const BLACKJACK_ACTION_BUTTON_BASE = "inline-flex min-h-11 w-full min-w-0 items-center justify-center rounded-[var(--radius-control)] px-3 py-2.5 text-sm font-semibold leading-none shadow-[var(--shadow-control)] transition-[background-color,border-color,color,filter,box-shadow] duration-[var(--motion-quick)]";
const BLACKJACK_SMALL_ACTION_BUTTON_BASE = "inline-flex min-h-11 w-full min-w-0 items-center justify-center rounded-[var(--radius-control)] px-3 py-2.5 text-xs font-semibold leading-none shadow-[var(--shadow-hairline)] transition-[background-color,border-color,color,filter,box-shadow] duration-[var(--motion-quick)]";
const BLACKJACK_WARNING_BUTTON = `${BLACKJACK_ACTION_BUTTON_BASE} border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning))] bg-[image:var(--gradient-warning)] text-[hsl(var(--warning-foreground))] hover:brightness-[1.03]`;
const BLACKJACK_PRIMARY_BUTTON = `${BLACKJACK_ACTION_BUTTON_BASE} border border-primary/30 bg-primary bg-[image:var(--gradient-control-active)] text-primary-foreground hover:brightness-[1.03]`;
const BLACKJACK_STAND_BUTTON = `${BLACKJACK_ACTION_BUTTON_BASE} border border-white/20 bg-white/10 text-white hover:bg-white/15`;
const BLACKJACK_DANGER_BUTTON = `${BLACKJACK_ACTION_BUTTON_BASE} border border-destructive/45 bg-destructive bg-[image:var(--gradient-danger)] text-destructive-foreground hover:brightness-[1.03]`;
const BLACKJACK_WARNING_ACTION_BUTTON = `${BLACKJACK_ACTION_BUTTON_BASE} border border-[hsl(var(--warning)/0.35)] bg-[hsl(var(--warning))] bg-[image:var(--gradient-warning)] text-[hsl(var(--warning-foreground))] hover:brightness-[1.03]`;
const BLACKJACK_SPECIAL_BUTTON = `${BLACKJACK_ACTION_BUTTON_BASE} border border-white/20 bg-[image:var(--gradient-special)] text-white hover:brightness-105`;
const BLACKJACK_SPECIAL_BUTTON_SM = `${BLACKJACK_SMALL_ACTION_BUTTON_BASE} border border-white/20 bg-[image:var(--gradient-special)] text-white hover:brightness-105`;
const BLACKJACK_NEUTRAL_BUTTON_SM = `${BLACKJACK_SMALL_ACTION_BUTTON_BASE} border border-white/15 bg-white/10 text-white/90 hover:bg-white/15`;
const BLACKJACK_STICKY_ACTIONS_CLASS = "surface-footer-divider dialog-footer-surface sticky z-10 -bottom-3 -mx-3 -mb-3 mt-3 space-y-3 border-white/15 bg-black bg-[linear-gradient(180deg,rgba(0,0,0,0.82)_0%,rgba(0,0,0,0.96)_42%,rgba(0,0,0,1)_100%)] px-3 pb-[max(0.75rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom),var(--browser-safe-area-bottom))] pt-3 text-white backdrop-blur-md sm:-bottom-4 sm:-mb-4 sm:-ml-4 sm:-mr-7 sm:mt-4 sm:px-4";

/**
 * Simplified UI phase model for server-signed randomness flow
 * No more commit-reveal phases!
 */
type DialogPhase =
    | 'loading'    // Initial load
    | 'betting'    // Ready to place bet (will deal immediately)
    | 'playing'    // Taking actions (immediate results)
    | 'result';    // Game complete

interface GameState {
    // Contract-derived state
    contractPhase: BlackjackPhase;
    isActive: boolean;
    player: string;

    // Cards from contract
    playerCards: number[];
    splitCards: number[];
    dealerCards: number[];

    // Hand values from contract
    playerValue: number;
    splitValue: number;
    dealerValue: number;

    // Game state from contract
    hasSplit: boolean;
    activeHandCount: number;
    currentHandIndex: number;
    betAmount: bigint;

    // Available actions from contract
    canHit: boolean;
    canStand: boolean;
    canDouble: boolean;
    canSplit: boolean;
    canSurrender: boolean;

    // Result state
    result: BlackjackResult | null;
    payout: string;
    splitResults: Array<{
        result: BlackjackResult;
        playerFinalValue: number;
        dealerFinalValue: number;
        payout: string;
    }> | null;

    // UI-only state
    betAmountInput: string;
}

const initialGameState: GameState = {
    contractPhase: BlackjackPhase.NONE,
    isActive: false,
    player: '',
    playerCards: [],
    splitCards: [],
    dealerCards: [],
    playerValue: 0,
    splitValue: 0,
    dealerValue: 0,
    hasSplit: false,
    activeHandCount: 1,
    currentHandIndex: 0,
    betAmount: BigInt(0),
    canHit: false,
    canStand: false,
    canDouble: false,
    canSplit: false,
    canSurrender: false,
    result: null,
    payout: '0',
    splitResults: null,
    betAmountInput: '0',
};

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const WIN_RESULTS = new Set<BlackjackResult>([
    BlackjackResult.PLAYER_WIN,
    BlackjackResult.PLAYER_BLACKJACK,
]);

const LOSS_RESULTS = new Set<BlackjackResult>([
    BlackjackResult.DEALER_WIN,
    BlackjackResult.DEALER_BLACKJACK,
    BlackjackResult.PLAYER_BUST,
    BlackjackResult.SURRENDERED,
]);

const getResultColorClass = (result: BlackjackResult): string => {
    if (WIN_RESULTS.has(result)) return 'text-green-300';
    if (LOSS_RESULTS.has(result)) return 'text-red-300';
    return 'text-yellow-300';
};

const deriveInitialPlayerActions = (cards: number[]) => {
    const hasTwoCards = cards.length === 2;
    const canSplit =
        hasTwoCards &&
        getCardValue(cards[0]) === getCardValue(cards[1]);

    return {
        canHit: true,
        canStand: true,
        canDouble: hasTwoCards,
        canSplit,
        canSurrender: hasTwoCards,
    };
};

const areCardsPrefix = (prefix: number[], full: number[]): boolean =>
    prefix.length <= full.length && prefix.every((card, idx) => full[idx] === card);

const isValidCardId = (value: UntypedValue): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 52;

const hasTrustedActionState = (snapshot: UntypedValue): boolean => {
    if (!snapshot || snapshot.phase !== BlackjackPhase.PLAYER_TURN) return false;

    const actionHandIndex = Number(snapshot.actionHandIndex ?? 0);
    const handCards =
        actionHandIndex === 1
            ? (Array.isArray(snapshot.hand2Cards) ? snapshot.hand2Cards : [])
            : (Array.isArray(snapshot.hand1Cards) ? snapshot.hand1Cards : []);

    if (handCards.length === 0) return false;

    const hasTwoCards = handCards.length === 2;
    const canSplitByCards =
        hasTwoCards &&
        getCardValue(handCards[0]) === getCardValue(handCards[1]);

    if (snapshot.canDouble && !hasTwoCards) return false;
    if (snapshot.canSplit && (snapshot.hasSplit || actionHandIndex !== 0 || !hasTwoCards || !canSplitByCards)) return false;
    if (snapshot.canSurrender && (snapshot.hasSplit || actionHandIndex !== 0 || !hasTwoCards)) return false;

    return true;
};

const reconcileTurnCards = (
    prevCards: number[],
    fetchedCards: number[],
    phase: BlackjackPhase
): { cards: number[]; usedFetched: boolean } => {
    // Outside live turn, trust fetched chain state.
    if (phase !== BlackjackPhase.PLAYER_TURN) {
        return { cards: fetchedCards, usedFetched: true };
    }

    // No local state yet: accept fetched as baseline.
    if (prevCards.length === 0) {
        return { cards: fetchedCards, usedFetched: true };
    }

    // Missing or lagging fetched state: keep local receipt-derived cards.
    if (fetchedCards.length === 0) {
        return { cards: prevCards, usedFetched: false };
    }

    // Fetched advanced from local state -> accept.
    if (areCardsPrefix(prevCards, fetchedCards)) {
        return { cards: fetchedCards, usedFetched: true };
    }

    // Fetched is older/conflicting -> keep local state to avoid card rewrites/flicker.
    return { cards: prevCards, usedFetched: false };
};

export default function BlackjackDialog({
    open,
    onOpenChange,
    landId,
    onGameComplete,
    selectedToken
}: BlackjackDialogProps) {
    const betAmountInputId = useId();
    const { address } = useAccount();
    const casinoPolicy = getClientCasinoPolicy();
    const blackjackPlayable = casinoPolicy.playable && casinoPolicy.blackjackEnabled;

    // Core game state - derived from contract
    const [gameState, setGameState] = useState<GameState>(initialGameState);
    const refreshGenerationRef = useRef(0);

    // Transaction in progress tracking - tracks specific action for hiding other buttons
    const [txInProgress, setTxInProgress] = useState<'deal' | BlackjackAction | null>(null);
    const [walletTxPending, setWalletTxPending] = useState(false);
    // Action buttons are only shown when onchain action state is trusted.
    const [actionButtonsReady, setActionButtonsReady] = useState(false);
    const [actionButtonsSyncing, setActionButtonsSyncing] = useState(false);
    const [actionButtonsSyncFailed, setActionButtonsSyncFailed] = useState(false);

    // Config state
    const [config, setConfig] = useState<{
        minBet: bigint;
        maxBet: bigint;
        bettingToken: string;
        enabled: boolean;
    } | null>(null);

    const [allowanceWei, setAllowanceWei] = useState(BigInt(0));
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (!open || blackjackPlayable) return;
        onOpenChange(false);
        toast.error(
            casinoPolicy.blackjackEnabled
                ? (casinoPolicy.message || 'Casino is currently unavailable.')
                : 'Blackjack is currently unavailable.'
        );
    }, [blackjackPlayable, casinoPolicy.blackjackEnabled, casinoPolicy.message, onOpenChange, open]);

    const { symbol: tokenSymbolRaw, decimals: tokenDecimals } = useTokenMetadata(config?.bettingToken);

    const { data: balanceData, refetch: refetchBalance } = useBalance({
        address: address,
        token: config?.bettingToken as `0x${string}` | undefined,
        query: { enabled: !!address && open && !!config?.bettingToken }
    });

    const tokenSymbol = tokenSymbolRaw || 'TOKEN';
    const formattedMinBet = useMemo(() => (
        config ? formatTokenAmountRounded(config.minBet, tokenDecimals) : '0'
    ), [config, tokenDecimals]);
    const formattedMaxBet = useMemo(() => (
        config ? formatTokenAmountRounded(config.maxBet, tokenDecimals) : '0'
    ), [config, tokenDecimals]);
    const tokenLogo = useMemo(() => getCasinoTokenImage(config?.bettingToken), [config?.bettingToken]);
    const betInputWidth = useMemo(() => {
        const visibleChars = Math.max(gameState.betAmountInput.length, formattedMinBet.length, 4);
        return `calc(${Math.min(visibleChars + 1, 20)}ch + 1.25rem)`;
    }, [gameState.betAmountInput, formattedMinBet]);
    const balanceVal = balanceData
        ? parseFloat(formatUnits(balanceData.value, balanceData.decimals))
        : 0;
    const currentBalanceWei = balanceData?.value || BigInt(0);
    const requiredApprovalWei = useMemo(() => {
        if (!config) return BigInt(0);
        try {
            const amount = parseUnits(gameState.betAmountInput || '0', tokenDecimals);
            return amount > BigInt(0) ? amount : config.minBet;
        } catch {
            return config.minBet;
        }
    }, [config, gameState.betAmountInput, tokenDecimals]);
    const hasApproval = allowanceWei >= requiredApprovalWei;

    // Derive UI phase from contract state (simplified for server randomness)
    const uiPhase = useMemo((): DialogPhase => {
        // If we have a final result from the transaction, show it regardless of contract phase
        // (Contract might clear state immediately upon resolution)
        if (gameState.result !== null) {
            return 'result';
        }

        switch (gameState.contractPhase) {
            case BlackjackPhase.NONE:
                return 'betting';
            case BlackjackPhase.BETTING:
                // With server randomness, should not stay in BETTING
                // This would only happen briefly during transition
                return 'betting';
            case BlackjackPhase.PLAYER_TURN:
                return 'playing';
            case BlackjackPhase.RESOLVED:
                return 'result';
            default:
                return 'loading';
        }
    }, [gameState.contractPhase, gameState.result]);

    const invalidatePendingRefreshes = useCallback(() => {
        refreshGenerationRef.current += 1;
    }, []);

    // Fetch complete game state from contract
    const refreshGameState = useCallback(async (): Promise<boolean> => {
        if (!open || !blackjackPlayable) {
            setActionButtonsReady(false);
            return false;
        }

        const refreshGeneration = refreshGenerationRef.current;

        try {
            const snapshot = await blackjackGetGameSnapshot(landId);

            if (refreshGeneration !== refreshGenerationRef.current) {
                return false;
            }

            if (!snapshot) {
                // Do not hard-reset UI on transient RPC/read failures.
                // We keep the current state and try again on next refresh/action.
                setActionButtonsReady(false);
                return false;
            }

            const normalizedPlayer = (snapshot.player || '').toLowerCase();
            const normalizedAddress = address?.toLowerCase() ?? '';
            const isOurGame =
                normalizedPlayer !== '' &&
                normalizedPlayer !== ZERO_ADDRESS &&
                normalizedAddress !== '' &&
                normalizedPlayer === normalizedAddress;
            const trustedActionState = isOurGame && hasTrustedActionState(snapshot);
            setActionButtonsReady(trustedActionState);
            if (trustedActionState) {
                setActionButtonsSyncing(false);
                setActionButtonsSyncFailed(false);
            }

            setGameState(prev => {
                if (refreshGeneration !== refreshGenerationRef.current) {
                    return prev;
                }

                const snapshotLooksEmpty =
                    snapshot.phase === BlackjackPhase.NONE &&
                    (normalizedPlayer === '' || normalizedPlayer === ZERO_ADDRESS) &&
                    snapshot.hand1Cards.length === 0 &&
                    snapshot.hand2Cards.length === 0 &&
                    snapshot.dealerCards.length === 0;
                const prevPlayer = (prev.player || '').toLowerCase();
                const prevLikelyOurGame =
                    prevPlayer === '' ||
                    prevPlayer === ZERO_ADDRESS ||
                    (normalizedAddress !== '' && prevPlayer === normalizedAddress);

                // Guard against stale RPC regressions: keep active local game if chain snapshot
                // momentarily reports empty state.
                if (
                    prev.isActive &&
                    prev.contractPhase === BlackjackPhase.PLAYER_TURN &&
                    snapshotLooksEmpty &&
                    prevLikelyOurGame
                ) {
                    return prev;
                }

                const splitStateRegressed =
                    prev.isActive &&
                    prev.contractPhase === BlackjackPhase.PLAYER_TURN &&
                    prev.hasSplit &&
                    snapshot.phase === BlackjackPhase.PLAYER_TURN &&
                    (
                        !snapshot.hasSplit ||
                        snapshot.activeHandCount < 2 ||
                        snapshot.hand2Cards.length === 0
                    );

                // Guard against mixed-RPC lag right after split:
                // once local state has split hands, do not regress back to single-hand
                // UI until onchain snapshot confirms the split state.
                if (splitStateRegressed) {
                    return prev;
                }

                if (!isOurGame) {
                    if (prev.result !== null) {
                        return {
                            ...prev,
                            contractPhase: snapshot.phase,
                            isActive: false,
                            player: snapshot.player,
                        };
                    }

                        return {
                            ...prev,
                            contractPhase: snapshot.phase,
                            isActive: snapshot.isActive,
                            player: snapshot.player,
                            playerCards: [],
                        splitCards: [],
                        dealerCards: [],
                        playerValue: 0,
                        splitValue: 0,
                        dealerValue: 0,
                        hasSplit: false,
                        activeHandCount: 1,
                        currentHandIndex: 0,
                        betAmount: BigInt(0),
                        canHit: false,
                        canStand: false,
                        canDouble: false,
                        canSplit: false,
                        canSurrender: false,
                    };
                }

                const splitTransition =
                    snapshot.phase === BlackjackPhase.PLAYER_TURN &&
                    snapshot.hasSplit &&
                    !prev.hasSplit &&
                    snapshot.hand1Cards.length > 0 &&
                    snapshot.hand2Cards.length > 0;

                let nextPlayerCards: number[];
                let nextSplitCards: number[];
                let nextPlayerValue: number;
                let nextSplitValue: number;

                if (splitTransition) {
                    // Split is a valid non-prefix transition for hand1 (card2 is replaced),
                    // so force-accept fetched cards here.
                    nextPlayerCards = snapshot.hand1Cards;
                    nextSplitCards = snapshot.hand2Cards;
                    nextPlayerValue = snapshot.hand1Value;
                    nextSplitValue = snapshot.hand2Value;
                } else {
                    const playerCardsDecision = reconcileTurnCards(
                        prev.playerCards,
                        snapshot.hand1Cards,
                        snapshot.phase
                    );
                    const splitCardsDecision = reconcileTurnCards(
                        prev.splitCards,
                        snapshot.hand2Cards,
                        snapshot.phase
                    );
                    nextPlayerCards = playerCardsDecision.cards;
                    nextSplitCards = splitCardsDecision.cards;
                    nextPlayerValue = playerCardsDecision.usedFetched ? snapshot.hand1Value : prev.playerValue;
                    nextSplitValue = splitCardsDecision.usedFetched ? snapshot.hand2Value : prev.splitValue;
                }
                const isPlayerTurn = snapshot.phase === BlackjackPhase.PLAYER_TURN;
                let nextDealerCards = snapshot.dealerCards;

                if (isPlayerTurn && nextDealerCards.length === 1) {
                    nextDealerCards = [nextDealerCards[0], 0];
                }
                if (
                    isPlayerTurn &&
                    prev.dealerCards.length > 0 &&
                    nextDealerCards.length > 0 &&
                    prev.dealerCards[0] !== nextDealerCards[0]
                ) {
                    nextDealerCards = prev.dealerCards;
                }

                // If we have a local result but contract says game is gone/empty, keep old cards
                if (prev.result !== null && nextPlayerCards.length === 0) {
                    return {
                        ...prev,
                        contractPhase: snapshot.phase,
                        isActive: snapshot.isActive,
                        player: snapshot.player,
                        // Keep existing cards
                        activeHandCount: snapshot.activeHandCount,
                        betAmount: snapshot.betAmount,
                    };
                }

                return {
                    ...prev,
                    contractPhase: snapshot.phase,
                    isActive: snapshot.isActive,
                    player: snapshot.player,
                    playerCards: nextPlayerCards,
                    splitCards: nextSplitCards,
                    dealerCards: nextDealerCards.length > 0 ? nextDealerCards : prev.dealerCards, // Keep dealer cards if we have them
                    playerValue: nextPlayerValue,
                    splitValue: nextSplitValue,
                    dealerValue: snapshot.dealerValue,
                    hasSplit: snapshot.hasSplit,
                    activeHandCount: snapshot.activeHandCount,
                    currentHandIndex: snapshot.actionHandIndex,
                    betAmount: snapshot.betAmount,
                    canHit: isPlayerTurn ? snapshot.canHit : false,
                    canStand: isPlayerTurn ? snapshot.canStand : false,
                    canDouble: isPlayerTurn ? snapshot.canDouble : false,
                    canSplit: isPlayerTurn ? snapshot.canSplit : false,
                    canSurrender: isPlayerTurn ? snapshot.canSurrender : false,
                };
            });
            return trustedActionState;
        } catch (err) {
            console.error('Failed to refresh blackjack state:', err);
            setActionButtonsReady(false);
            return false;
        }
    }, [open, landId, address, blackjackPlayable]);

    const syncActionButtonsWithRetries = useCallback(async (): Promise<boolean> => {
        setActionButtonsReady(false);
        setActionButtonsSyncing(true);
        setActionButtonsSyncFailed(false);

        const maxAttempts = 3;
        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            const trusted = await refreshGameState();
            if (trusted) {
                setActionButtonsReady(true);
                setActionButtonsSyncing(false);
                setActionButtonsSyncFailed(false);
                return true;
            }
            if (attempt < maxAttempts - 1) {
                await new Promise(resolve => setTimeout(resolve, 1500));
            }
        }

        setActionButtonsSyncing(false);
        setActionButtonsSyncFailed(true);
        return false;
    }, [refreshGameState]);

    // Load config on open
    useEffect(() => {
        const loadConfig = async () => {
            if (!open || !blackjackPlayable) return;

            try {
                const snapshot = await blackjackGetGameSnapshot(landId);
                const effectiveToken = snapshot?.isActive
                    ? await blackjackGetGameToken(landId)
                    : selectedToken;

                if (!effectiveToken) {
                    setConfig(null);
                    setAllowanceWei(BigInt(0));
                    return;
                }

                const cfg = await blackjackGetTokenConfig(effectiveToken);
                if (cfg?.supported || snapshot?.isActive) {
                    setConfig({
                        minBet: cfg?.minBet ?? BigInt(0),
                        maxBet: cfg?.maxBet ?? BigInt(0),
                        bettingToken: effectiveToken,
                        enabled: cfg?.enabled ?? false,
                    });

                    if (address) {
                        const allowance = await checkCasinoApproval(address, effectiveToken);
                        setAllowanceWei(allowance);
                    } else {
                        setAllowanceWei(BigInt(0));
                    }
                } else {
                    setConfig(null);
                    setAllowanceWei(BigInt(0));
                }
            } catch (err) {
                console.error('Failed to load blackjack config:', err);
            }
        };

        loadConfig();
    }, [open, address, landId, selectedToken, blackjackPlayable]);

    const configBettingToken = config?.bettingToken ?? null;
    const configMinBet = config?.minBet ?? null;
    const configMaxBet = config?.maxBet ?? null;

    useEffect(() => {
        if (!open || !configBettingToken || configMinBet === null || configMaxBet === null || gameState.contractPhase !== BlackjackPhase.NONE) return;
        setGameState(prev => ({
            ...prev,
            betAmountInput: loadBetPreference({
                game: 'blackjack',
                token: configBettingToken,
                minBet: configMinBet,
                maxBet: configMaxBet,
                decimals: tokenDecimals,
                fallback: formattedMinBet,
            }),
        }));
    }, [configBettingToken, configMinBet, configMaxBet, gameState.contractPhase, open, formattedMinBet, tokenDecimals]);

    useEffect(() => {
        if (!configBettingToken) return;
        storeBetPreference('blackjack', configBettingToken, gameState.betAmountInput, tokenDecimals);
    }, [configBettingToken, gameState.betAmountInput, tokenDecimals]);

    // Refresh game state on open
    useEffect(() => {
        if (open && blackjackPlayable) {
            refreshGameState();
        }
    }, [open, refreshGameState, blackjackPlayable]);

    // Keep action state synced while playing. If it becomes stale, hide buttons and
    // retry up to 3 times over ~3-4s before giving up.
    useEffect(() => {
        if (!open || !address) return;
        if (uiPhase !== 'playing') return;
        if (txInProgress !== null) return;
        if (actionButtonsReady) return;
        if (actionButtonsSyncing) return;
        if (actionButtonsSyncFailed) return;

        syncActionButtonsWithRetries();
    }, [
        open,
        address,
        uiPhase,
        txInProgress,
        actionButtonsReady,
        actionButtonsSyncing,
        actionButtonsSyncFailed,
        syncActionButtonsWithRetries,
    ]);

    // Clear state on close
    useEffect(() => {
        if (!open) {
            invalidatePendingRefreshes();
            setGameState(prev => ({
                ...initialGameState,
                betAmountInput: prev.betAmountInput,
            }));
            setTxInProgress(null);
            setError(null);
            setActionButtonsReady(false);
            setActionButtonsSyncing(false);
            setActionButtonsSyncFailed(false);
            setWalletTxPending(false);
        }
    }, [open, invalidatePendingRefreshes]);

    const handleBlackjackStatusUpdate = useCallback((status: LifecycleStatus) => {
        if (status.statusName === 'transactionPending') {
            setWalletTxPending(true);
            return;
        }

        if (status.statusName === 'success' || BLACKJACK_FAILURE_STATUSES.has(status.statusName ?? '')) {
            setWalletTxPending(false);
        }
    }, []);

    const handlePreparedCancel = useCallback((reason: "cancelled" | "expired") => {
        setTxInProgress(prev => {
            if (prev !== null && prev !== 'deal') return prev;
            return null;
        });
        setWalletTxPending(false);
        setError(
            reason === "expired"
                ? 'Prepared Blackjack action expired. Retry the same action to continue.'
                : 'Prepared Blackjack action cancelled. Retry the same action and bet amount if the app asks you to.'
        );
    }, []);

    // Handle deal complete (combined bet + deal)
    // Handle deal complete (combined bet + deal)
    const handleDealComplete = useCallback(async (result?: UntypedValue) => {
        try {
            setWalletTxPending(false);
            if (!result) {
                setError('Deal did not confirm. Refresh and check the game before trying again.');
                return;
            }

            // Check if game ended immediately (blackjack)
            // Check if game ended immediately (blackjack)
            if (result.gameResult !== undefined) {
                invalidatePendingRefreshes();
                setGameState(prev => ({
                    ...prev,
                    result: result.gameResult,
                    payout: result.payout || '0',
                    splitResults: result.splitResults || null,
                    // Explicitly set player cards from the event, otherwise they stay empty (fresh game)
                    playerCards: result.cards && result.cards.length > 0 ? result.cards : prev.playerCards,
                    playerValue: result.handValue ?? prev.playerValue,
                    dealerCards: result.dealerCards || prev.dealerCards,
                    dealerValue: result.dealerValue ?? prev.dealerValue,
                    activeHandCount: 1, // Default cleanup
                    hasSplit: false
                }));
                setActionButtonsReady(false);
                setActionButtonsSyncing(false);
                setActionButtonsSyncFailed(false);

                refetchBalance();
                onGameComplete?.();
            } else if (result.cards && result.cards.length > 0) {
                // Game Started Successfully (Optimistic Update)
                // This ensures the UI shows cards immediately even if RPC is slow
                const dealtCards = Array.isArray(result.cards) ? result.cards.map(Number) : [];
                const optimisticActions = deriveInitialPlayerActions(dealtCards);
                let optimisticBetAmountWei = BigInt(0);
                try {
                    optimisticBetAmountWei = parseUnits(gameState.betAmountInput || '0', tokenDecimals);
                } catch {
                    optimisticBetAmountWei = BigInt(0);
                }
                setGameState(prev => ({
                    ...prev,
                    isActive: true,
                    contractPhase: BlackjackPhase.PLAYER_TURN, // Force phase
                    player: address || prev.player,
                    playerCards: dealtCards,
                    playerValue: result.handValue ?? 0,
                    // Keep current wager in local state so mid-game DOUBLE/SPLIT funding checks
                    // are available immediately, before the next RPC refresh.
                    betAmount: optimisticBetAmountWei > BigInt(0) ? optimisticBetAmountWei : prev.betAmount,
                    // Show dealer up card + hidden
                    dealerCards: result.dealerUpCard !== undefined ? [result.dealerUpCard, 0] : prev.dealerCards,
                    dealerValue: 0,
                    canHit: optimisticActions.canHit,
                    canStand: optimisticActions.canStand,
                    canDouble: optimisticActions.canDouble,
                    canSplit: optimisticActions.canSplit,
                    canSurrender: optimisticActions.canSurrender,

                    // Reset fresh game state defaults
                    activeHandCount: 1,
                    hasSplit: false,
                    currentHandIndex: 0,
                    result: null,
                    payout: '0',
                    splitResults: null,
                }));

                // Don't show actions until we have trusted onchain flags.
                await syncActionButtonsWithRetries();
                refetchBalance();
                onGameComplete?.();
            } else {
                // Fallback for UntypedValue state or error
                await refreshGameState();
                refetchBalance();
                onGameComplete?.();
            }
        } finally {
            setTxInProgress(null);
        }
    }, [invalidatePendingRefreshes, onGameComplete, refetchBalance, refreshGameState, syncActionButtonsWithRetries, gameState.betAmountInput, address, tokenDecimals]);

    // Handle action complete (immediate result with server randomness)
    const handleActionComplete = useCallback(async (result?: UntypedValue) => {
        setTxInProgress(null);
        setWalletTxPending(false);
        if (!result) {
            // Transaction failed, refresh state anyway
            setError('Action did not confirm. Refresh and check the game before trying again.');
            await refreshGameState();
            return;
        }

        // Check if game ended - we have all data from event, don't need to refresh
        if (result.gameResult !== undefined) {
            setGameState(prev => {
                // Preserve existing player cards if event doesn't provide them
                // (e.g., surrender clears game before emitting event)
                let finalPlayerCards = prev.playerCards;
                let finalPlayerValue = result.handValue ?? prev.playerValue;

                // Only use event cards if they are provided AND not empty
                if (result.cards && result.cards.length > 0) {
                    finalPlayerCards = result.cards;
                }

                // Preserve existing dealer cards if event doesn't provide them
                let finalDealerCards = prev.dealerCards;
                let finalDealerValue = result.dealerValue ?? prev.dealerValue;

                if (result.dealerCards && result.dealerCards.length > 0) {
                    finalDealerCards = result.dealerCards;
                }

                // Preserve/update split hand cards for resolved split games
                let finalSplitCards = prev.splitCards;
                let finalSplitValue = result.splitValue ?? prev.splitValue;
                if (result.splitCards && result.splitCards.length > 0) {
                    finalSplitCards = result.splitCards;
                } else if (
                    prev.hasSplit &&
                    result.lastActionHandIndex === 1 &&
                    typeof result.lastActionCard === 'number'
                ) {
                    // Backward-compatible fallback for older contracts where GameComplete
                    // does not include split hand cards.
                    finalSplitCards = [...prev.splitCards, result.lastActionCard];
                }

                return {
                    ...prev,
                    result: result.gameResult,
                    payout: result.payout || '0',
                    splitResults: result.splitResults || null,
                    dealerCards: finalDealerCards,
                    dealerValue: finalDealerValue,
                    playerCards: finalPlayerCards,
                    playerValue: finalPlayerValue,
                    splitCards: finalSplitCards,
                    splitValue: finalSplitValue,
                    isActive: false, // Game ended
                    contractPhase: BlackjackPhase.RESOLVED,
                };
            });
            setActionButtonsReady(false);
            setActionButtonsSyncing(false);
            setActionButtonsSyncFailed(false);

            // Don't call refreshGameState() - it will overwrite our preserved cards
            // with empty data from the cleared contract
            refetchBalance();
            onGameComplete?.();
            return;
        }

        if (
            result.actionTaken === BlackjackAction.SPLIT &&
            isValidCardId(result.splitHand1Card) &&
            isValidCardId(result.splitHand2Card)
        ) {
            setGameState(prev => {
                const originalHand1Card = prev.playerCards[0];
                const originalHand2Card = prev.playerCards[1];

                const nextHand1 =
                    typeof originalHand1Card === 'number'
                        ? [originalHand1Card, result.splitHand1Card]
                        : prev.playerCards;
                const nextHand2 =
                    typeof originalHand2Card === 'number'
                        ? [originalHand2Card, result.splitHand2Card]
                        : (prev.splitCards.length > 0 ? prev.splitCards : [result.splitHand2Card]);

                return {
                    ...prev,
                    hasSplit: true,
                    activeHandCount: 2,
                    currentHandIndex: 0,
                    playerCards: nextHand1,
                    splitCards: nextHand2,
                    playerValue: calculateHandValue(nextHand1),
                    splitValue: calculateHandValue(nextHand2),
                    canSplit: false,
                    canSurrender: false,
                    contractPhase: BlackjackPhase.PLAYER_TURN,
                };
            });
        }

        // Game didn't end (e.g., hit/double without settlement)
        // Optimistic update from BlackjackHit event (single new card).
        if (
            (result.actionTaken === BlackjackAction.HIT || result.actionTaken === BlackjackAction.DOUBLE) &&
            result.cards &&
            result.cards.length > 0
        ) {
            setGameState(prev => {
                // If it's a hit, we expect 1 new card.
                // The event 'BlackjackHit' usually returns just the NEW card in some contracts,
                // but our decoder in handleStatus seems to return `cards: [newCard]`.
                // Let's check how `result.cards` is populated in `BlackjackTransaction`.
                // Looking at `blackjack-transaction.tsx`, for 'action' mode/BlackjackHit:
                // `cards: [Number(args.newCard)]`

                // So we should APPEND this card to the correct hand
                const targetHandIndex = result.handIndex ?? prev.currentHandIndex;
                const newCard = Number(result.cards[0]);
                if (!isValidCardId(newCard)) {
                    return prev;
                }

                const newPlayerCards = [...prev.playerCards];
                const newSplitCards = [...prev.splitCards];

                if (targetHandIndex === 1 && prev.hasSplit) {
                    // Start of split hand or append
                    newSplitCards.push(newCard);
                } else {
                    // Main hand
                    newPlayerCards.push(newCard);
                }

                return {
                    ...prev,
                    isActive: true,
                    // Update the specific hand's cards
                    playerCards: newPlayerCards,
                    splitCards: newSplitCards,
                    // Update value
                    playerValue: targetHandIndex === 0 ? (result.handValue ?? prev.playerValue) : prev.playerValue,
                    splitValue: targetHandIndex === 1 ? (result.handValue ?? prev.splitValue) : prev.splitValue,
                    // A post-hit hand can no longer double/surrender/split on this turn.
                    // Fresh onchain snapshot will follow and finalize exact action flags.
                    canDouble: false,
                    canSplit: false,
                    canSurrender: false,
                    contractPhase: BlackjackPhase.PLAYER_TURN
                };
            });
        }

        // Still trigger a refresh in background to eventually sync fully
        await syncActionButtonsWithRetries();
        refetchBalance();
        onGameComplete?.();
    }, [refreshGameState, refetchBalance, syncActionButtonsWithRetries, onGameComplete]);

    // Handle approval success
    const handleApproveSuccess = useCallback(async () => {
        toast.success('Token approved!');
        if (!address || !config) return;

        setAllowanceWei(MAX_TOKEN_APPROVAL);

        for (const delayMs of APPROVAL_REFRESH_DELAYS_MS) {
            if (delayMs > 0) await wait(delayMs);

            const allowance = await checkCasinoApproval(address, config.bettingToken);
            if (allowance >= requiredApprovalWei) {
                setAllowanceWei(allowance);
                return;
            }
        }

        console.warn('Approval transaction succeeded, but allowance read has not caught up yet.');
    }, [address, config, requiredApprovalWei]);

    // Play again
    const handlePlayAgain = useCallback(() => {
        invalidatePendingRefreshes();
        setGameState(prev => ({ ...initialGameState, betAmountInput: prev.betAmountInput }));
        setError(null);
        refetchBalance();
        if (onGameComplete) onGameComplete();
    }, [invalidatePendingRefreshes, refetchBalance, onGameComplete]);

    // Close handler - allow closing even mid-game (user may want to abandon)
    const handleClose = useCallback(() => {
        if (walletTxPending) {
            toast.error('Transaction submitted. Please wait for confirmation.');
            return;
        }

        if (txInProgress) {
            toast('Prepared Blackjack action cancelled. Retry the same action if needed.');
        }

        // Warn if closing mid-game but allow it
        if (gameState.isActive && uiPhase !== 'result') {
            toast('Game still active - your bet remains onchain', { icon: '⚠️' });
        }

        onOpenChange(false);
        if (uiPhase === 'result' && onGameComplete) {
            onGameComplete();
        }
    }, [txInProgress, walletTxPending, gameState.isActive, uiPhase, onOpenChange, onGameComplete]);

    // Bet amount in wei
    const betAmountWei = useMemo(() => {
        try {
            return parseUnits(gameState.betAmountInput || '0', tokenDecimals);
        } catch {
            return BigInt(0);
        }
    }, [gameState.betAmountInput, tokenDecimals]);
    const dealAmountIssue = useMemo(() => {
        if (!config) return 'Loading limits...';
        if (!config.enabled) return 'Blackjack disabled';
        if (betAmountWei <= BigInt(0)) return 'Enter bet amount';
        if (betAmountWei < config.minBet) return `Min ${formattedMinBet} ${tokenSymbol}`;
        if (betAmountWei > config.maxBet) return `Max ${formattedMaxBet} ${tokenSymbol}`;
        if (!balanceData) return 'Loading balance...';
        if (betAmountWei > currentBalanceWei) return 'Insufficient Balance';
        return null;
    }, [balanceData, betAmountWei, config, currentBalanceWei, formattedMaxBet, formattedMinBet, tokenSymbol]);

    const currentActionHandIndex = gameState.hasSplit ? gameState.currentHandIndex : 0;
    const currentActionCards =
        gameState.hasSplit && currentActionHandIndex === 1
            ? gameState.splitCards
            : gameState.playerCards;
    const currentHandHasTwoCards = currentActionCards.length === 2;
    const currentHandIsMain = currentActionHandIndex === 0;
    const canSplitByCards =
        currentHandHasTwoCards &&
        getCardValue(currentActionCards[0]) === getCardValue(currentActionCards[1]);

    // UI safety clamp: don't expose impossible actions even if a stale RPC snapshot
    // briefly reports permissive flags.
    const canHitUi = gameState.canHit && currentActionCards.length > 0;
    const canStandUi = gameState.canStand && currentActionCards.length > 0;
    const canDoubleUi = gameState.canDouble && currentHandHasTwoCards;
    const canSplitUi =
        gameState.canSplit &&
        !gameState.hasSplit &&
        currentHandIsMain &&
        canSplitByCards;
    const canSurrenderUi =
        gameState.canSurrender &&
        !gameState.hasSplit &&
        currentHandIsMain &&
        currentHandHasTwoCards;
    const blackjackPlayerAddress = (gameState.player || '').toLowerCase();
    const blackjackGameBelongsToWallet =
        !gameState.isActive ||
        (!!address && blackjackPlayerAddress !== '' && blackjackPlayerAddress !== ZERO_ADDRESS && blackjackPlayerAddress === address.toLowerCase());
    const blackjackGameActiveInAnotherWallet = gameState.isActive && !blackjackGameBelongsToWallet;
    const blackjackTurnStatusText = walletTxPending
        ? 'Confirm transaction in wallet...'
        : txInProgress !== null
            ? 'Retry the prepared action, or reopen after the lock clears.'
            : (gameState.hasSplit ? `Playing Hand ${currentActionHandIndex + 1}` : 'Your Turn');

    const additionalActionBetWei = gameState.betAmount > BigInt(0) ? gameState.betAmount : BigInt(0);
    const hasBalanceForAdditionalAction = currentBalanceWei >= additionalActionBetWei;
    const hasAllowanceForAdditionalAction = allowanceWei >= additionalActionBetWei;
    const needsAdditionalApproval =
        additionalActionBetWei > BigInt(0) && !hasAllowanceForAdditionalAction;
    const disableDoubleForFunding =
        canDoubleUi &&
        (additionalActionBetWei <= BigInt(0) || !hasBalanceForAdditionalAction);
    const disableSplitForFunding =
        canSplitUi &&
        (additionalActionBetWei <= BigInt(0) || !hasBalanceForAdditionalAction);

    const handleActionClick = useCallback(async (action: BlackjackAction): Promise<boolean | { handIndex: number }> => {
        if (!actionButtonsReady) {
            toast.error('Syncing game state. Please wait...');
            return false;
        }

        const actionAllowedLocally =
            (action === BlackjackAction.HIT && canHitUi) ||
            (action === BlackjackAction.STAND && canStandUi) ||
            (action === BlackjackAction.DOUBLE && canDoubleUi) ||
            (action === BlackjackAction.SPLIT && canSplitUi) ||
            (action === BlackjackAction.SURRENDER && canSurrenderUi);

        if (!actionAllowedLocally) {
            toast.error('That action is not valid for your current hand.');
            await refreshGameState();
            return false;
        }

        let latestSnapshot = await blackjackGetGameSnapshot(landId);

        // Retry once for transient stale reads before deciding state changed.
        if (!latestSnapshot || latestSnapshot.phase !== BlackjackPhase.PLAYER_TURN) {
            await new Promise(resolve => setTimeout(resolve, 250));
            latestSnapshot = await blackjackGetGameSnapshot(landId);
        }

        if (!latestSnapshot) {
            toast.error('Game state is syncing. Please try again.');
            await refreshGameState();
            return false;
        }

        if (latestSnapshot.phase !== BlackjackPhase.PLAYER_TURN) {
            toast.error('Game is no longer in player turn. Refreshing state.');
            await refreshGameState();
            return false;
        }

        const actionAllowedOnchain =
            (action === BlackjackAction.HIT && latestSnapshot.canHit) ||
            (action === BlackjackAction.STAND && latestSnapshot.canStand) ||
            (action === BlackjackAction.DOUBLE && latestSnapshot.canDouble) ||
            (action === BlackjackAction.SPLIT && latestSnapshot.canSplit) ||
            (action === BlackjackAction.SURRENDER && latestSnapshot.canSurrender);

        if (!actionAllowedOnchain) {
            toast.error('That action is no longer available for this hand.');
            await refreshGameState();
            return false;
        }

        setGameState(prev => ({
            ...prev,
            contractPhase: latestSnapshot.phase,
            hasSplit: latestSnapshot.hasSplit,
            activeHandCount: latestSnapshot.activeHandCount,
            currentHandIndex: latestSnapshot.actionHandIndex,
            betAmount: latestSnapshot.betAmount,
            canHit: latestSnapshot.canHit,
            canStand: latestSnapshot.canStand,
            canDouble: latestSnapshot.canDouble,
            canSplit: latestSnapshot.canSplit,
            canSurrender: latestSnapshot.canSurrender,
        }));

        const resolvedHandIndex = latestSnapshot.actionHandIndex;

        const requiresAdditionalBet = action === BlackjackAction.DOUBLE || action === BlackjackAction.SPLIT;
        if (!requiresAdditionalBet) {
            setError(null);
            setTxInProgress(action);
            return { handIndex: resolvedHandIndex };
        }

        const requiredWei = latestSnapshot.betAmount > BigInt(0)
            ? latestSnapshot.betAmount
            : gameState.betAmount;
        if (requiredWei <= BigInt(0)) {
            toast.error('Unable to verify additional wager amount. Please refresh.');
            return false;
        }

        let latestBalanceWei = currentBalanceWei;
        try {
            const refreshed = await refetchBalance();
            latestBalanceWei = refreshed.data?.value ?? latestBalanceWei;
        } catch (err) {
            console.warn('Failed to refresh balance before action:', err);
        }

        let latestAllowanceWei = allowanceWei;
        if (address && config) {
            try {
                latestAllowanceWei = await checkCasinoApproval(address, config.bettingToken);
                setAllowanceWei(latestAllowanceWei);
            } catch (err) {
                console.warn('Failed to refresh allowance before action:', err);
            }
        }

        const actionLabel = action === BlackjackAction.DOUBLE ? 'double' : 'split';
        const requiredAmount = formatTokenAmountRounded(requiredWei, tokenDecimals);

        if (latestBalanceWei < requiredWei) {
            toast.error(`Insufficient balance to ${actionLabel}. Need ${requiredAmount} ${tokenSymbol}.`);
            return false;
        }

        if (latestAllowanceWei < requiredWei) {
            toast.error(`Insufficient approval to ${actionLabel}. Approve at least ${requiredAmount} ${tokenSymbol}.`);
            return false;
        }

        setError(null);
        setTxInProgress(action);
        return { handIndex: resolvedHandIndex };
    }, [
        landId,
        refreshGameState,
        address,
        allowanceWei,
        config,
        currentBalanceWei,
        gameState.betAmount,
        canHitUi,
        canStandUi,
        canDoubleUi,
        canSplitUi,
        canSurrenderUi,
        actionButtonsReady,
        refetchBalance,
        tokenDecimals,
        tokenSymbol
    ]);

    // Validate bet and start deal
    const handleDealClick = useCallback((): boolean => {
        const amount = parseFloat(gameState.betAmountInput);
        if (isNaN(amount) || amount <= 0) {
            setError('Please enter a valid bet amount');
            return false;
        }
        if (amount > balanceVal) {
            setError('Insufficient balance');
            return false;
        }
        if (config) {
            if (!config.enabled) {
                setError('Blackjack is currently disabled');
                return false;
            }
            const amountWei = parseUnits(gameState.betAmountInput, tokenDecimals);
            if (amountWei < config.minBet) {
                setError(`Minimum bet is ${formattedMinBet} ${tokenSymbol}`);
                return false;
            }
            if (amountWei > config.maxBet) {
                setError(`Maximum bet is ${formattedMaxBet} ${tokenSymbol}`);
                return false;
            }
        }
        setError(null);
        setTxInProgress('deal');
        return true;
    }, [gameState.betAmountInput, balanceVal, config, tokenSymbol, tokenDecimals, formattedMinBet, formattedMaxBet]);

    // Handle transaction errors (specifically for Action Locking security feature)
    const handleTransactionError = useCallback((error: string) => {
        // If action is locked, specific message
        if (error.toLowerCase().includes('action locked')) {
            toast.error("Action locked. Retry the same Blackjack action for a short window.", { duration: 4000 });
        } else {
            toast.error(error);
        }

        // Reset progress state so user can choose the correct button
        setTxInProgress(null);
        setWalletTxPending(false);
    }, []);

    // Get the current hand index for actions
    const getCurrentHandIndex = useCallback((): number => {
        if (!gameState.hasSplit) return 0;
        return gameState.currentHandIndex;
    }, [gameState.hasSplit, gameState.currentHandIndex]);

    if (!open) return null;

    const showDealerHand =
        gameState.dealerCards.length > 0 ||
        (uiPhase === 'result' && gameState.result !== null);

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent
                hideCloseButton
                mobileMode="center"
                surface="game"
                className="blackjack-dialog-surface max-h-[calc(100dvh-1rem)] w-[min(96vw,34rem)] overflow-y-auto overscroll-contain border-white/15 bg-[url('/icons/casinobj.png')] bg-cover bg-center bg-no-repeat p-3 text-white sm:p-4"
            >
                <DialogTitle className="sr-only">Blackjack</DialogTitle>
                <DialogDescription className="sr-only">
                    Blackjack game dialog with active hand state, onchain action controls, and transaction status.
                </DialogDescription>
                <Button
                    type="button"
                    variant="ghost"
                    size="iconCompact"
                    onClick={handleClose}
                    aria-label="Close Blackjack dialog"
                    className="absolute right-2 top-2 z-50 h-10 min-h-10 w-10 min-w-10 border border-white/45 bg-black/70 text-white shadow-[0_8px_20px_rgba(0,0,0,0.45)] hover:bg-black/85 hover:text-white focus-visible:ring-white sm:right-3 sm:top-3"
                >
                    <X className="h-4 w-4" aria-hidden="true" />
                </Button>

                <div className="space-y-4 pb-3 pt-1 sm:space-y-5">
                    {/* Dealer Hand */}
                    {showDealerHand && (
                        <CardHand
                            cards={gameState.dealerCards}
                            label="Dealer"
                            value={uiPhase === 'result' && gameState.result !== null ? gameState.dealerValue : undefined}
                            hideHoleCard={uiPhase !== 'result' && gameState.dealerCards.length > 1}
                        />
                    )}

                    {/* Player Hand(s) */}
                    {gameState.playerCards.length > 0 && (
                        <div className="flex justify-center gap-8">
                            <CardHand
                                cards={gameState.playerCards}
                                label={gameState.hasSplit ? "Hand 1" : "Your Hand"}
                                value={gameState.playerValue}
                                small={gameState.hasSplit} // Fix Bug 2: Use small cards for split to save space
                                statusText={
                                    uiPhase === 'result' &&
                                        gameState.hasSplit &&
                                        gameState.splitResults &&
                                        gameState.splitResults[0]
                                        ? (getResultText(gameState.splitResults[0].result) || 'Result')
                                        : undefined
                                }
                                statusClassName={
                                    uiPhase === 'result' &&
                                        gameState.hasSplit &&
                                        gameState.splitResults &&
                                        gameState.splitResults[0]
                                        ? getResultColorClass(gameState.splitResults[0].result)
                                        : undefined
                                }
                            />
                            {gameState.hasSplit && gameState.splitCards.length > 0 && (
                                <CardHand
                                    cards={gameState.splitCards}
                                    label="Hand 2"
                                    value={gameState.splitValue}
                                    small={true} // Fix Bug 2: Use small cards for split
                                    statusText={
                                        uiPhase === 'result' &&
                                            gameState.splitResults &&
                                            gameState.splitResults[1]
                                            ? (getResultText(gameState.splitResults[1].result) || 'Result')
                                            : undefined
                                    }
                                    statusClassName={
                                        uiPhase === 'result' &&
                                            gameState.splitResults &&
                                            gameState.splitResults[1]
                                            ? getResultColorClass(gameState.splitResults[1].result)
                                            : undefined
                                    }
                                />
                            )}
                        </div>
                    )}

                    {/* Result Display */}
                    {uiPhase === 'result' && gameState.result !== null && (
                        <div className="text-center py-4">
                            {!(gameState.splitResults && gameState.splitResults.length > 1) && (
                                <div className={`text-2xl font-bold ${gameState.result === BlackjackResult.PLAYER_WIN ||
                                    gameState.result === BlackjackResult.PLAYER_BLACKJACK
                                    ? 'text-green-400'
                                    : gameState.result === BlackjackResult.PUSH
                                        ? 'text-yellow-400'
                                        : 'text-red-400'
                                    }`}>
                                    {getResultText(gameState.result)}
                                    {gameState.result === BlackjackResult.PLAYER_BLACKJACK && (
                                        <div className="text-sm font-normal text-green-300 mt-1">
                                            (Natural Blackjack - 3:2 Payout!)
                                        </div>
                                    )}
                                </div>
                            )}
                            {parseFloat(gameState.payout) > 0 && (
                                <div className="mt-2 inline-flex items-center gap-1 text-lg text-white">
                                    <span>{gameState.splitResults && gameState.splitResults.length > 1 ? 'Total Payout:' : 'Payout:'}</span>
                                    <Image src={tokenLogo} alt={tokenSymbol} width={16} height={16} className="h-4 w-4 rounded-full" />
                                    <span>{gameState.payout} {tokenSymbol}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Betting Phase - Combined Bet + Deal */}
                    {uiPhase === 'betting' && (
                        <div className="space-y-4">
                            <div>
                                <label htmlFor={betAmountInputId} className="text-sm text-white/80 mb-2 block">Bet Amount</label>
                                <div className="flex gap-2">
                                    <Input
                                        id={betAmountInputId}
                                        name="blackjack-bet-amount"
                                        type="text"
                                        inputMode="decimal"
                                        aria-label={`Blackjack bet amount in ${tokenSymbol}`}
                                        value={gameState.betAmountInput}
                                        onChange={(e) => setGameState(prev => ({ ...prev, betAmountInput: e.target.value }))}
                                        className="min-w-[6.5rem] w-auto flex-none px-2 tabular-nums bg-white/10 border-white/20 text-white"
                                        min={formattedMinBet}
                                        step="any"
                                        disabled={txInProgress !== null}
                                        style={{ width: betInputWidth }}
                                    />
                                    <span className="inline-flex items-center gap-1 text-white/80">
                                        <Image src={tokenLogo} alt={tokenSymbol} width={16} height={16} className="h-4 w-4 rounded-full" />
                                        {tokenSymbol}
                                    </span>
                                </div>
                                {error && <p className="text-red-400 text-sm mt-1">{error}</p>}
                                <div className="mt-1 space-y-1">
                                <p className="flex items-center gap-1 text-white/60 text-sm">
                                    <span>Balance:</span>
                                    <Image src={tokenLogo} alt={tokenSymbol} width={14} height={14} className="h-3.5 w-3.5 rounded-full" />
                                    <span>{formatTokenAmount(balanceData?.value || BigInt(0), balanceData?.decimals || tokenDecimals)} {tokenSymbol}</span>
                                </p>
                                {config && (
                                    <p className="text-white/40 text-xs">
                                        Min: {formattedMinBet} | Max: {formattedMaxBet} {tokenSymbol}
                                    </p>
                                )}
                                </div>
                            </div>

                            {config && !config.enabled ? (
                                <Button className="w-full" disabled variant="secondary">
                                    Blackjack disabled
                                </Button>
                            ) : dealAmountIssue ? (
                                <Button
                                    className="w-full"
                                    disabled
                                    variant={dealAmountIssue === 'Insufficient Balance' ? 'destructive' : 'secondary'}
                                >
                                    {dealAmountIssue}
                                </Button>
                            ) : !hasApproval && config ? (
                                <ApproveTransaction
                                    spenderAddress={LAND_CONTRACT_ADDRESS}
                                    tokenAddress={config.bettingToken as `0x${string}`}
                                    onSuccess={handleApproveSuccess}
                                    buttonText={`Approve ${tokenSymbol}`}
                                    buttonClassName={BLACKJACK_WARNING_BUTTON}
                                />
                            ) : (
                                <BlackjackTransaction
                                    mode="deal"
                                    landId={landId}
                                    betAmount={betAmountWei}
                                    disabled={!!dealAmountIssue || txInProgress !== null}
                                    buttonText={txInProgress === 'deal' ? "Dealing..." : "Deal"}
                                    buttonAriaLabel="Deal Blackjack hand"
                                    buttonClassName={BLACKJACK_WARNING_BUTTON}
                                    onButtonClick={handleDealClick}
                                    onStatusUpdate={handleBlackjackStatusUpdate}
                                    onComplete={handleDealComplete}
                                    onPreparedCancel={handlePreparedCancel}
                                    onError={handleTransactionError}
                                    tokenSymbol={tokenSymbol}
                                    tokenDecimals={tokenDecimals}
                                    bettingToken={config?.bettingToken ?? null}
                                />
                            )}
                        </div>
                    )}

                    {uiPhase === 'playing' && blackjackGameActiveInAnotherWallet && (
                        <div className="rounded-lg border border-red-400/30 bg-black/40 p-3 text-center text-sm text-red-200">
                            {address
                                ? 'This Blackjack game was started by another wallet.'
                                : 'Connect the wallet that started this Blackjack game.'}
                        </div>
                    )}

                    {/* Playing Phase - Action Buttons */}
                    {uiPhase === 'playing' && !blackjackGameActiveInAnotherWallet && (
                        <div data-blackjack-action-footer className={BLACKJACK_STICKY_ACTIONS_CLASS}>
                            {/* Status text - changes based on action state */}
                            <p className="text-center text-white/60 text-sm min-h-[20px]">
                                {blackjackTurnStatusText}
                            </p>
                            {txInProgress === null && !actionButtonsReady && (
                                <p className="text-center text-yellow-300 text-xs">
                                    {actionButtonsSyncing
                                        ? 'Syncing valid actions...'
                                        : actionButtonsSyncFailed
                                            ? 'Unable to verify valid actions right now. Please reopen Blackjack.'
                                            : 'Waiting for trusted onchain action state...'}
                                </p>
                            )}
                            {txInProgress === null && actionButtonsReady && (canDoubleUi || canSplitUi) && additionalActionBetWei > BigInt(0) && (!hasBalanceForAdditionalAction || needsAdditionalApproval) && (
                                <p className="text-center text-red-300 text-xs">
                                    {!hasBalanceForAdditionalAction
                                        ? `Insufficient balance for Double/Split (needs ${formatTokenAmountRounded(additionalActionBetWei, tokenDecimals)} ${tokenSymbol})`
                                        : `Approval may be too low for Double/Split (needs ${formatTokenAmountRounded(additionalActionBetWei, tokenDecimals)} ${tokenSymbol}). We will re-check on click.`}
                                </p>
                            )}

                            {/* Primary action buttons - flex layout for proper centering */}
                            <div className="grid grid-cols-[repeat(auto-fit,minmax(6rem,1fr))] gap-2">
                                {/* HIT */}
                                {actionButtonsReady && (txInProgress === null || txInProgress === BlackjackAction.HIT) && canHitUi && (
                                    <BlackjackTransaction
                                        mode="action"
                                        landId={landId}
                                        handIndex={getCurrentHandIndex()}
                                        action={BlackjackAction.HIT}
                                        disabled={false}
                                        buttonText="Hit"
                                        buttonAriaLabel="Hit current Blackjack hand"
                                        buttonClassName={BLACKJACK_PRIMARY_BUTTON}
                                        onButtonClick={() => handleActionClick(BlackjackAction.HIT)}
                                        onStatusUpdate={handleBlackjackStatusUpdate}
                                        onComplete={handleActionComplete}
                                        onPreparedCancel={handlePreparedCancel}
                                        onError={handleTransactionError}
                                        tokenSymbol={tokenSymbol}
                                        tokenDecimals={tokenDecimals}
                                        bettingToken={config?.bettingToken ?? null}
                                    />
                                )}
                                {/* STAND */}
                                {actionButtonsReady && (txInProgress === null || txInProgress === BlackjackAction.STAND) && canStandUi && (
                                    <BlackjackTransaction
                                        mode="action"
                                        landId={landId}
                                        handIndex={getCurrentHandIndex()}
                                        action={BlackjackAction.STAND}
                                        disabled={false}
                                        buttonText="Stand"
                                        buttonAriaLabel="Stand on current Blackjack hand"
                                        buttonClassName={BLACKJACK_STAND_BUTTON}
                                        onButtonClick={() => handleActionClick(BlackjackAction.STAND)}
                                        onStatusUpdate={handleBlackjackStatusUpdate}
                                        onComplete={handleActionComplete}
                                        onPreparedCancel={handlePreparedCancel}
                                        onError={handleTransactionError}
                                        tokenSymbol={tokenSymbol}
                                        tokenDecimals={tokenDecimals}
                                        bettingToken={config?.bettingToken ?? null}
                                    />
                                )}
                                {/* DOUBLE */}
                                {actionButtonsReady && (txInProgress === null || txInProgress === BlackjackAction.DOUBLE) && canDoubleUi && (
                                    <BlackjackTransaction
                                        mode="action"
                                        landId={landId}
                                        handIndex={getCurrentHandIndex()}
                                        action={BlackjackAction.DOUBLE}
                                        disabled={disableDoubleForFunding}
                                        buttonText="Double"
                                        buttonAriaLabel="Double current Blackjack hand"
                                        buttonClassName={BLACKJACK_WARNING_ACTION_BUTTON}
                                        onButtonClick={() => handleActionClick(BlackjackAction.DOUBLE)}
                                        onStatusUpdate={handleBlackjackStatusUpdate}
                                        onComplete={handleActionComplete}
                                        onPreparedCancel={handlePreparedCancel}
                                        onError={handleTransactionError}
                                        tokenSymbol={tokenSymbol}
                                        tokenDecimals={tokenDecimals}
                                        bettingToken={config?.bettingToken ?? null}
                                    />
                                )}
                            </div>

                            {/* Secondary actions - SPLIT and SURRENDER (smaller, separate row) */}
                            {actionButtonsReady && txInProgress === null && (canSplitUi || canSurrenderUi) && (
                                <div className="grid grid-cols-[repeat(auto-fit,minmax(7rem,1fr))] gap-2">
                                    {canSplitUi && (
                                        <BlackjackTransaction
                                            mode="action"
                                            landId={landId}
                                            handIndex={getCurrentHandIndex()}
                                            action={BlackjackAction.SPLIT}
                                            disabled={disableSplitForFunding}
                                            buttonText="Split"
                                            buttonAriaLabel="Split current Blackjack hand"
                                            buttonClassName={BLACKJACK_SPECIAL_BUTTON_SM}
                                            onButtonClick={() => handleActionClick(BlackjackAction.SPLIT)}
                                            onStatusUpdate={handleBlackjackStatusUpdate}
                                            onComplete={handleActionComplete}
                                            onPreparedCancel={handlePreparedCancel}
                                            onError={handleTransactionError}
                                            tokenSymbol={tokenSymbol}
                                            tokenDecimals={tokenDecimals}
                                            bettingToken={config?.bettingToken ?? null}
                                        />
                                    )}
                                    {canSurrenderUi && (
                                        <BlackjackTransaction
                                            mode="action"
                                            landId={landId}
                                            handIndex={getCurrentHandIndex()}
                                            action={BlackjackAction.SURRENDER}
                                            disabled={false}
                                            buttonText="Surrender"
                                            buttonAriaLabel="Surrender current Blackjack hand"
                                            buttonClassName={BLACKJACK_NEUTRAL_BUTTON_SM}
                                            onButtonClick={() => handleActionClick(BlackjackAction.SURRENDER)}
                                            onStatusUpdate={handleBlackjackStatusUpdate}
                                            onComplete={handleActionComplete}
                                            onPreparedCancel={handlePreparedCancel}
                                            onError={handleTransactionError}
                                            tokenSymbol={tokenSymbol}
                                            tokenDecimals={tokenDecimals}
                                            bettingToken={config?.bettingToken ?? null}
                                        />
                                    )}
                                </div>
                            )}

                            {/* Show active SPLIT/SURRENDER button when in progress */}
                            {actionButtonsReady && (txInProgress === BlackjackAction.SPLIT || txInProgress === BlackjackAction.SURRENDER) && (
                                <div className="flex justify-center">
                                    {txInProgress === BlackjackAction.SPLIT && (
                                        <BlackjackTransaction
                                            mode="action"
                                            landId={landId}
                                            handIndex={getCurrentHandIndex()}
                                            action={BlackjackAction.SPLIT}
                                            disabled={disableSplitForFunding}
                                            buttonText="Split"
                                            buttonAriaLabel="Split current Blackjack hand"
                                            buttonClassName={BLACKJACK_SPECIAL_BUTTON}
                                            onButtonClick={() => handleActionClick(BlackjackAction.SPLIT)}
                                            onStatusUpdate={handleBlackjackStatusUpdate}
                                            onComplete={handleActionComplete}
                                            onPreparedCancel={handlePreparedCancel}
                                            onError={handleTransactionError}
                                            tokenSymbol={tokenSymbol}
                                            tokenDecimals={tokenDecimals}
                                            bettingToken={config?.bettingToken ?? null}
                                        />
                                    )}
                                    {txInProgress === BlackjackAction.SURRENDER && (
                                        <BlackjackTransaction
                                            mode="action"
                                            landId={landId}
                                            handIndex={getCurrentHandIndex()}
                                            action={BlackjackAction.SURRENDER}
                                            disabled={false}
                                            buttonText="Surrender"
                                            buttonAriaLabel="Surrender current Blackjack hand"
                                            buttonClassName={BLACKJACK_DANGER_BUTTON}
                                            onButtonClick={() => handleActionClick(BlackjackAction.SURRENDER)}
                                            onStatusUpdate={handleBlackjackStatusUpdate}
                                            onComplete={handleActionComplete}
                                            onPreparedCancel={handlePreparedCancel}
                                            onError={handleTransactionError}
                                            tokenSymbol={tokenSymbol}
                                            tokenDecimals={tokenDecimals}
                                            bettingToken={config?.bettingToken ?? null}
                                        />
                                    )}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Play Again (Result phase) */}
                    {uiPhase === 'result' && (
                        <Button
                            onClick={handlePlayAgain}
                            variant="warning"
                            className="w-full font-bold"
                        >
                            Play Again
                        </Button>
                    )}

                    {/* Error display */}
                    {error && uiPhase !== 'betting' && (
                        <p className="text-red-400 text-sm text-center">{error}</p>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );
}
