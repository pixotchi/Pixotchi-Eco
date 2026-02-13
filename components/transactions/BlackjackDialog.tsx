"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, AlertTriangle } from 'lucide-react';
import { parseUnits, formatUnits } from 'viem';
import { useAccount, useBalance } from 'wagmi';
import { CardHand, getCardValue } from '@/components/ui/PlayingCard';
import { useTokenSymbol } from '@/hooks/useTokenSymbol';
import { formatTokenAmount } from '@/lib/utils';
import { usePaymaster } from '@/lib/paymaster-context';
import { SponsoredBadge } from '@/components/paymaster-toggle';
import { toast } from 'react-hot-toast';
import ApproveTransaction from './approve-transaction';
import BlackjackTransaction from './blackjack-transaction';
import {
    LAND_CONTRACT_ADDRESS,
    PIXOTCHI_TOKEN_ADDRESS,
    blackjackGetConfig,
    blackjackGetGameSnapshot,
    checkCasinoApproval,
    BlackjackPhase,
    BlackjackAction,
    BlackjackResult,
} from '@/lib/contracts';
import { getResultText } from '@/public/abi/blackjack-abi';

interface BlackjackDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    landId: bigint;
    onGameComplete?: () => void;
}

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
    onGameComplete
}: BlackjackDialogProps) {
    const { address } = useAccount();
    const { isSponsored } = usePaymaster();

    // Core game state - derived from contract
    const [gameState, setGameState] = useState<GameState>(initialGameState);

    // Transaction in progress tracking - tracks specific action for hiding other buttons
    const [txInProgress, setTxInProgress] = useState<'deal' | BlackjackAction | null>(null);

    // Config state
    const [config, setConfig] = useState<{
        minBet: bigint;
        maxBet: bigint;
        bettingToken: string;
        enabled: boolean;
    } | null>(null);

    const [allowanceWei, setAllowanceWei] = useState(BigInt(0));
    const [error, setError] = useState<string | null>(null);

    // Token info
    const { data: balanceData, refetch: refetchBalance } = useBalance({
        address: address,
        token: config?.bettingToken as `0x${string}` || PIXOTCHI_TOKEN_ADDRESS,
        query: { enabled: !!address && open }
    });

    const tokenSymbol = useTokenSymbol(config?.bettingToken) || 'SEED';
    const balanceVal = balanceData
        ? parseFloat(formatUnits(balanceData.value, balanceData.decimals))
        : 0;
    const currentBalanceWei = balanceData?.value || BigInt(0);
    const requiredApprovalWei = useMemo(() => {
        if (!config) return BigInt(0);
        try {
            const amount = parseUnits(gameState.betAmountInput || '0', 18);
            return amount > BigInt(0) ? amount : config.minBet;
        } catch {
            return config.minBet;
        }
    }, [config, gameState.betAmountInput]);
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

    // Fetch complete game state from contract
    const refreshGameState = useCallback(async (): Promise<void> => {
        if (!open || !address) return;

        try {
            const snapshot = await blackjackGetGameSnapshot(landId);

            if (!snapshot) {
                setGameState(prev => ({ ...initialGameState, betAmountInput: prev.betAmountInput }));
                return;
            }

            const normalizedPlayer = (snapshot.player || '').toLowerCase();
            const isOurGame =
                normalizedPlayer !== '' &&
                normalizedPlayer !== '0x0000000000000000000000000000000000000000' &&
                normalizedPlayer === address.toLowerCase();

            setGameState(prev => {
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
                        isActive: false,
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
                const nextPlayerCards = playerCardsDecision.cards;
                const nextSplitCards = splitCardsDecision.cards;
                const nextPlayerValue = playerCardsDecision.usedFetched ? snapshot.hand1Value : prev.playerValue;
                const nextSplitValue = splitCardsDecision.usedFetched ? snapshot.hand2Value : prev.splitValue;
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
        } catch (err) {
            console.error('Failed to refresh blackjack state:', err);
        }
    }, [open, landId, address]);

    // Load config on open
    useEffect(() => {
        const loadConfig = async () => {
            if (!open) return;

            try {
                const cfg = await blackjackGetConfig();
                if (cfg) {
                    setConfig({
                        minBet: cfg.minBet,
                        maxBet: cfg.maxBet,
                        bettingToken: cfg.bettingToken,
                        enabled: cfg.enabled,
                    });

                    // Default bet input to on-chain minimum whenever config is loaded.
                    setGameState(prev => ({
                        ...prev,
                        betAmountInput: formatUnits(cfg.minBet, 18),
                    }));

                    if (address) {
                        const allowance = await checkCasinoApproval(address, cfg.bettingToken);
                        setAllowanceWei(allowance);
                    }
                }
            } catch (err) {
                console.error('Failed to load blackjack config:', err);
            }
        };

        loadConfig();
    }, [open, address]);

    // Refresh game state on open
    useEffect(() => {
        if (open) {
            refreshGameState();
        }
    }, [open, refreshGameState]);

    // Clear state on close
    useEffect(() => {
        if (!open) {
            setGameState({
                ...initialGameState,
                betAmountInput: config ? formatUnits(config.minBet, 18) : initialGameState.betAmountInput,
            });
            setTxInProgress(null);
            setError(null);
        }
    }, [open, config]);

    // Handle deal complete (combined bet + deal)
    // Handle deal complete (combined bet + deal)
    const handleDealComplete = useCallback(async (result?: any) => {
        setTxInProgress(null);

        if (!result) {
            setError('Transaction failed. Please try again.');
            return;
        }

        // Check if game ended immediately (blackjack)
        // Check if game ended immediately (blackjack)
        if (result.gameResult !== undefined) {
            setGameState(prev => ({
                ...prev,
                result: result.gameResult,
                payout: result.payout || '0',
                splitResults: result.splitResults || null,
                // Explicitly set player cards from the event, otherwise they stay empty (fresh game)
                playerCards: result.cards && result.cards.length > 0 ? result.cards : prev.playerCards,
                playerValue: result.handValue || prev.playerValue,
                dealerCards: result.dealerCards || prev.dealerCards,
                dealerValue: result.dealerValue || prev.dealerValue,
                activeHandCount: 1, // Default cleanup
                hasSplit: false
            }));

            // If game ended, state might be cleared (NONE), which is fine. Refresh immediately.
            await refreshGameState();
            refetchBalance();
        } else if (result.cards && result.cards.length > 0) {
            // Game Started Successfully (Optimistic Update)
            // This ensures the UI shows cards immediately even if RPC is slow
            const dealtCards = Array.isArray(result.cards) ? result.cards.map(Number) : [];
            const optimisticActions = deriveInitialPlayerActions(dealtCards);
            let optimisticBetAmountWei = BigInt(0);
            try {
                optimisticBetAmountWei = parseUnits(gameState.betAmountInput || '0', 18);
            } catch {
                optimisticBetAmountWei = BigInt(0);
            }
            setGameState(prev => ({
                ...prev,
                isActive: true,
                contractPhase: BlackjackPhase.PLAYER_TURN, // Force phase
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

            // Avoid immediate refresh polling here: mixed-lag RPC endpoints can briefly
            // overwrite fresh receipt-derived cards/actions with stale state.
            // We still sync on the next explicit refresh/action.
            refetchBalance();
        } else {
            // Fallback for unknown state or error
            await refreshGameState();
            refetchBalance();
        }
    }, [refreshGameState, refetchBalance, landId, gameState.betAmountInput]);

    // Handle action complete (immediate result with server randomness)
    const handleActionComplete = useCallback(async (result?: any) => {
        setTxInProgress(null);

        if (!result) {
            // Transaction failed, refresh state anyway
            await refreshGameState();
            return;
        }

        // Check if game ended - we have all data from event, don't need to refresh
        if (result.gameResult !== undefined) {
            setGameState(prev => {
                // Preserve existing player cards if event doesn't provide them
                // (e.g., surrender clears game before emitting event)
                let finalPlayerCards = prev.playerCards;
                let finalPlayerValue = result.handValue || prev.playerValue;

                // Only use event cards if they are provided AND not empty
                if (result.cards && result.cards.length > 0) {
                    finalPlayerCards = result.cards;
                }

                // Preserve existing dealer cards if event doesn't provide them
                let finalDealerCards = prev.dealerCards;
                let finalDealerValue = result.dealerValue || prev.dealerValue;

                if (result.dealerCards && result.dealerCards.length > 0) {
                    finalDealerCards = result.dealerCards;
                }

                // Preserve/update split hand cards for resolved split games
                let finalSplitCards = prev.splitCards;
                let finalSplitValue = result.splitValue || prev.splitValue;
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

            // Don't call refreshGameState() - it will overwrite our preserved cards
            // with empty data from the cleared contract
            refetchBalance();
            return;
        }

        // Game didn't end (e.g., hit without bust)
        // Fix Bug 3: Optimistic Update using event data
        // If we trust the event log, we can update state immediately without waiting for RPC
        if (result.cards && result.cards.length > 0) {
            setGameState(prev => {
                // If it's a hit, we expect 1 new card.
                // The event 'BlackjackHit' usually returns just the NEW card in some contracts,
                // but our decoder in handleStatus seems to return `cards: [newCard]`.
                // Let's check how `result.cards` is populated in `BlackjackTransaction`.
                // Looking at `blackjack-transaction.tsx`, for 'action' mode/BlackjackHit:
                // `cards: [Number(args.newCard)]`

                // So we should APPEND this card to the correct hand
                const targetHandIndex = result.handIndex ?? prev.currentHandIndex;
                const newCard = result.cards[0];

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
                    playerValue: targetHandIndex === 0 ? (result.handValue || prev.playerValue) : prev.playerValue,
                    splitValue: targetHandIndex === 1 ? (result.handValue || prev.splitValue) : prev.splitValue,
                    // A post-hit hand can no longer double/surrender/split on this turn.
                    // Fresh on-chain snapshot will follow and finalize exact action flags.
                    canDouble: false,
                    canSplit: false,
                    canSurrender: false,
                    contractPhase: BlackjackPhase.PLAYER_TURN
                };
            });
        }

        // Still trigger a refresh in background to eventually sync fully
        await refreshGameState();
        refetchBalance();
    }, [refreshGameState, refetchBalance]);

    // Handle approval success
    const handleApproveSuccess = useCallback(async () => {
        toast.success('Token approved!');
        if (address && config) {
            const allowance = await checkCasinoApproval(address, config.bettingToken);
            setAllowanceWei(allowance);
        }
    }, [address, config]);

    // Play again
    const handlePlayAgain = useCallback(() => {
        setGameState(prev => ({ ...initialGameState, betAmountInput: prev.betAmountInput }));
        setError(null);
        refetchBalance();
        if (onGameComplete) onGameComplete();
    }, [refetchBalance, onGameComplete]);

    // Close handler - allow closing even mid-game (user may want to abandon)
    const handleClose = useCallback(() => {
        if (txInProgress) {
            toast.error('Transaction in progress, please wait');
            return;
        }

        // Warn if closing mid-game but allow it
        if (gameState.isActive && uiPhase !== 'result') {
            toast('Game still active - your bet remains on-chain', { icon: '⚠️' });
        }

        onOpenChange(false);
        if (uiPhase === 'result' && onGameComplete) {
            onGameComplete();
        }
    }, [txInProgress, gameState.isActive, uiPhase, onOpenChange, onGameComplete]);

    // Bet amount in wei
    const betAmountWei = useMemo(() => {
        try {
            return parseUnits(gameState.betAmountInput || '0', 18);
        } catch {
            return BigInt(0);
        }
    }, [gameState.betAmountInput]);
    const additionalActionBetWei = gameState.betAmount > BigInt(0) ? gameState.betAmount : BigInt(0);
    const hasBalanceForAdditionalAction = currentBalanceWei >= additionalActionBetWei;
    const hasAllowanceForAdditionalAction = allowanceWei >= additionalActionBetWei;
    const needsAdditionalApproval =
        additionalActionBetWei > BigInt(0) && !hasAllowanceForAdditionalAction;
    const disableDoubleForFunding =
        gameState.canDouble &&
        (additionalActionBetWei <= BigInt(0) || !hasBalanceForAdditionalAction);
    const disableSplitForFunding =
        gameState.canSplit &&
        (additionalActionBetWei <= BigInt(0) || !hasBalanceForAdditionalAction);

    const handleActionClick = useCallback(async (action: BlackjackAction): Promise<boolean> => {
        const latestSnapshot = await blackjackGetGameSnapshot(landId);
        if (!latestSnapshot || latestSnapshot.phase !== BlackjackPhase.PLAYER_TURN) {
            toast.error('Game state changed. Refreshing...');
            await refreshGameState();
            return false;
        }

        const actionAllowed =
            (action === BlackjackAction.HIT && latestSnapshot.canHit) ||
            (action === BlackjackAction.STAND && latestSnapshot.canStand) ||
            (action === BlackjackAction.DOUBLE && latestSnapshot.canDouble) ||
            (action === BlackjackAction.SPLIT && latestSnapshot.canSplit) ||
            (action === BlackjackAction.SURRENDER && latestSnapshot.canSurrender);

        if (!actionAllowed) {
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

        const requiresAdditionalBet = action === BlackjackAction.DOUBLE || action === BlackjackAction.SPLIT;
        if (!requiresAdditionalBet) {
            setError(null);
            setTxInProgress(action);
            return true;
        }

        const requiredWei = latestSnapshot.betAmount > BigInt(0) ? latestSnapshot.betAmount : gameState.betAmount;
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
        const requiredAmount = formatUnits(requiredWei, 18);

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
        return true;
    }, [
        landId,
        refreshGameState,
        address,
        allowanceWei,
        config,
        currentBalanceWei,
        gameState.betAmount,
        refetchBalance,
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
            const amountWei = parseUnits(gameState.betAmountInput, 18);
            if (amountWei < config.minBet) {
                setError(`Minimum bet is ${formatUnits(config.minBet, 18)} ${tokenSymbol}`);
                return false;
            }
            if (amountWei > config.maxBet) {
                setError(`Maximum bet is ${formatUnits(config.maxBet, 18)} ${tokenSymbol}`);
                return false;
            }
        }
        setError(null);
        setTxInProgress('deal');
        return true;
    }, [gameState.betAmountInput, balanceVal, config, tokenSymbol]);

    // Handle transaction errors (specifically for Action Locking security feature)
    const handleTransactionError = useCallback((error: string) => {
        // If action is locked, specific message
        if (error.includes('Action Locked')) {
            toast.error("Action Locked! You must stick to your original decision for this hand.", { duration: 4000 });
        } else {
            toast.error(error);
        }

        // Reset progress state so user can choose the correct button
        setTxInProgress(null);
    }, []);

    // Get the current hand index for actions
    const getCurrentHandIndex = useCallback((): number => {
        if (!gameState.hasSplit) return 0;
        return gameState.currentHandIndex;
    }, [gameState.hasSplit, gameState.currentHandIndex]);

    if (!open) return null;

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="max-w-lg bg-cover bg-center bg-no-repeat bg-[url('/icons/casinobj.png')] border-none text-white rounded-xl">
                <DialogHeader>
                    <DialogTitle className="font-pixel text-xl flex items-center justify-between text-white">
                        ♦️ Blackjack
                        <SponsoredBadge show={isSponsored} />
                    </DialogTitle>
                </DialogHeader>

                <div className="space-y-6 py-4">
                    {/* Dealer Hand */}
                    {gameState.dealerCards.length > 0 && (
                        <CardHand
                            cards={gameState.dealerCards}
                            label="DEALER"
                            value={uiPhase === 'result' ? gameState.dealerValue : undefined}
                            hideHoleCard={uiPhase !== 'result' && gameState.dealerCards.length > 1}
                        />
                    )}

                    {/* Player Hand(s) */}
                    {gameState.playerCards.length > 0 && (
                        <div className="flex justify-center gap-8">
                            <CardHand
                                cards={gameState.playerCards}
                                label={gameState.hasSplit ? "HAND 1" : "YOUR HAND"}
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
                                    label="HAND 2"
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
                                <div className="text-lg text-white mt-2">
                                    {gameState.splitResults && gameState.splitResults.length > 1 ? 'Total Payout' : 'Payout'}: {gameState.payout} {tokenSymbol}
                                </div>
                            )}
                        </div>
                    )}

                    {/* Betting Phase - Combined Bet + Deal */}
                    {uiPhase === 'betting' && (
                        <div className="space-y-4">
                            <div>
                                <label className="text-sm text-white/80 mb-2 block">Bet Amount</label>
                                <div className="flex gap-2">
                                    <Input
                                        type="number"
                                        value={gameState.betAmountInput}
                                        onChange={(e) => setGameState(prev => ({ ...prev, betAmountInput: e.target.value }))}
                                        className="bg-white/10 border-white/20 text-white"
                                        min="1"
                                        step="1"
                                        disabled={txInProgress !== null}
                                    />
                                    <span className="flex items-center text-white/80">{tokenSymbol}</span>
                                </div>
                                {error && <p className="text-red-400 text-sm mt-1">{error}</p>}
                                <p className="text-white/60 text-sm mt-1">
                                    Balance: {formatTokenAmount(balanceData?.value || BigInt(0), balanceData?.decimals || 18)} {tokenSymbol}
                                </p>
                                {config && (
                                    <p className="text-white/40 text-xs mt-1">
                                        Min: {formatUnits(config.minBet, 18)} | Max: {formatUnits(config.maxBet, 18)} {tokenSymbol}
                                    </p>
                                )}
                            </div>

                            {config && !config.enabled ? (
                                <Button className="w-full" disabled variant="secondary">
                                    Blackjack disabled
                                </Button>
                            ) : !hasApproval && config ? (
                                <ApproveTransaction
                                    spenderAddress={LAND_CONTRACT_ADDRESS}
                                    tokenAddress={config.bettingToken as `0x${string}`}
                                    onSuccess={handleApproveSuccess}
                                    buttonText={`Approve ${tokenSymbol}`}
                                    buttonClassName="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold"
                                />
                            ) : (
                                <BlackjackTransaction
                                    mode="deal"
                                    landId={landId}
                                    betAmount={betAmountWei}
                                    disabled={!config || betAmountWei <= BigInt(0) || txInProgress !== null}
                                    buttonText={txInProgress === 'deal' ? "Dealing..." : "DEAL"}
                                    buttonClassName="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold"
                                    onButtonClick={handleDealClick}
                                    onComplete={handleDealComplete}
                                    onError={handleTransactionError}
                                    tokenSymbol={tokenSymbol}
                                />
                            )}
                        </div>
                    )}

                    {/* Playing Phase - Action Buttons */}
                    {uiPhase === 'playing' && (
                        <div className="space-y-4">
                            {/* Status text - changes based on action state */}
                            <p className="text-center text-white/60 text-sm min-h-[20px]">
                                {txInProgress !== null
                                    ? 'Confirm transaction in wallet...'
                                    : (gameState.hasSplit ? `Playing Hand ${getCurrentHandIndex() + 1}` : 'Your Turn')
                                }
                            </p>
                            {txInProgress === null && (gameState.canDouble || gameState.canSplit) && additionalActionBetWei > BigInt(0) && (!hasBalanceForAdditionalAction || needsAdditionalApproval) && (
                                <p className="text-center text-red-300 text-xs">
                                    {!hasBalanceForAdditionalAction
                                        ? `Insufficient balance for Double/Split (needs ${formatUnits(additionalActionBetWei, 18)} ${tokenSymbol})`
                                        : `Approval may be too low for Double/Split (needs ${formatUnits(additionalActionBetWei, 18)} ${tokenSymbol}). We will re-check on click.`}
                                </p>
                            )}

                            {/* Primary action buttons - flex layout for proper centering */}
                            <div className="flex flex-wrap justify-center gap-3">
                                {/* HIT */}
                                {(txInProgress === null || txInProgress === BlackjackAction.HIT) && gameState.canHit && (
                                    <BlackjackTransaction
                                        mode="action"
                                        landId={landId}
                                        handIndex={getCurrentHandIndex()}
                                        action={BlackjackAction.HIT}
                                        disabled={false}
                                        buttonText="HIT"
                                        buttonClassName="bg-blue-600 hover:bg-blue-700 text-white font-bold py-3 px-6 rounded-lg min-w-[90px] transition-all shadow-lg"
                                        onButtonClick={() => handleActionClick(BlackjackAction.HIT)}
                                        onComplete={handleActionComplete}
                                        onError={handleTransactionError}
                                        tokenSymbol={tokenSymbol}
                                    />
                                )}
                                {/* STAND */}
                                {(txInProgress === null || txInProgress === BlackjackAction.STAND) && gameState.canStand && (
                                    <BlackjackTransaction
                                        mode="action"
                                        landId={landId}
                                        handIndex={getCurrentHandIndex()}
                                        action={BlackjackAction.STAND}
                                        disabled={false}
                                        buttonText="STAND"
                                        buttonClassName="bg-red-600 hover:bg-red-700 text-white font-bold py-3 px-6 rounded-lg min-w-[90px] transition-all shadow-lg"
                                        onButtonClick={() => handleActionClick(BlackjackAction.STAND)}
                                        onComplete={handleActionComplete}
                                        onError={handleTransactionError}
                                        tokenSymbol={tokenSymbol}
                                    />
                                )}
                                {/* DOUBLE */}
                                {(txInProgress === null || txInProgress === BlackjackAction.DOUBLE) && gameState.canDouble && (
                                    <BlackjackTransaction
                                        mode="action"
                                        landId={landId}
                                        handIndex={getCurrentHandIndex()}
                                        action={BlackjackAction.DOUBLE}
                                        disabled={disableDoubleForFunding}
                                        buttonText="DOUBLE"
                                        buttonClassName="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-6 rounded-lg min-w-[90px] transition-all shadow-lg"
                                        onButtonClick={() => handleActionClick(BlackjackAction.DOUBLE)}
                                        onComplete={handleActionComplete}
                                        onError={handleTransactionError}
                                        tokenSymbol={tokenSymbol}
                                    />
                                )}
                            </div>

                            {/* Secondary actions - SPLIT and SURRENDER (smaller, separate row) */}
                            {txInProgress === null && (gameState.canSplit || gameState.canSurrender) && (
                                <div className="flex justify-center gap-3">
                                    {gameState.canSplit && (
                                        <BlackjackTransaction
                                            mode="action"
                                            landId={landId}
                                            handIndex={getCurrentHandIndex()}
                                            action={BlackjackAction.SPLIT}
                                            disabled={disableSplitForFunding}
                                            buttonText="SPLIT"
                                            buttonClassName="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-all"
                                            onButtonClick={() => handleActionClick(BlackjackAction.SPLIT)}
                                            onComplete={handleActionComplete}
                                            onError={handleTransactionError}
                                            tokenSymbol={tokenSymbol}
                                        />
                                    )}
                                    {gameState.canSurrender && (
                                        <BlackjackTransaction
                                            mode="action"
                                            landId={landId}
                                            handIndex={getCurrentHandIndex()}
                                            action={BlackjackAction.SURRENDER}
                                            disabled={false}
                                            buttonText="SURRENDER"
                                            buttonClassName="bg-gray-600 hover:bg-gray-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-all"
                                            onButtonClick={() => handleActionClick(BlackjackAction.SURRENDER)}
                                            onComplete={handleActionComplete}
                                            onError={handleTransactionError}
                                            tokenSymbol={tokenSymbol}
                                        />
                                    )}
                                </div>
                            )}

                            {/* Show active SPLIT/SURRENDER button when in progress */}
                            {(txInProgress === BlackjackAction.SPLIT || txInProgress === BlackjackAction.SURRENDER) && (
                                <div className="flex justify-center">
                                    {txInProgress === BlackjackAction.SPLIT && (
                                        <BlackjackTransaction
                                            mode="action"
                                            landId={landId}
                                            handIndex={getCurrentHandIndex()}
                                            action={BlackjackAction.SPLIT}
                                            disabled={disableSplitForFunding}
                                            buttonText="SPLIT"
                                            buttonClassName="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-lg min-w-[90px] transition-all shadow-lg"
                                            onButtonClick={() => handleActionClick(BlackjackAction.SPLIT)}
                                            onComplete={handleActionComplete}
                                            onError={handleTransactionError}
                                            tokenSymbol={tokenSymbol}
                                        />
                                    )}
                                    {txInProgress === BlackjackAction.SURRENDER && (
                                        <BlackjackTransaction
                                            mode="action"
                                            landId={landId}
                                            handIndex={getCurrentHandIndex()}
                                            action={BlackjackAction.SURRENDER}
                                            disabled={false}
                                            buttonText="SURRENDER"
                                            buttonClassName="bg-gray-600 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-lg min-w-[90px] transition-all shadow-lg"
                                            onButtonClick={() => handleActionClick(BlackjackAction.SURRENDER)}
                                            onComplete={handleActionComplete}
                                            onError={handleTransactionError}
                                            tokenSymbol={tokenSymbol}
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
                            className="w-full bg-yellow-500 hover:bg-yellow-600 text-black font-bold"
                        >
                            PLAY AGAIN
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
