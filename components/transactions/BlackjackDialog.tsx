"use client";
import { isGameTransactionFailure } from "@/lib/game-transaction-status";
import type { BlackjackTransactionResult } from "@/lib/blackjack-events";
import { CasinoGameSurface } from './casino-game-surface';
import { BlackjackActionControls } from './blackjack-action-controls';
import { GAME_INSET_ACTION_FOOTER_CLASS, gameActionButtonClass } from './game-dialog-styles';

import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { AmountField } from '@/components/ui/amount-field';
import { TokenAmount } from '@/components/ui/token-amount';
import { CardHand, type PlayingCardValue } from '@/components/ui/PlayingCard';
import { calculateHandValue, getCardValue } from '@/lib/blackjack-cards';
import { deriveInitialPlayerActions, hasTrustedActionState, isValidCardId, reconcileTurnCards } from '@/lib/blackjack-state';
import { useTokenMetadata } from '@/hooks/useTokenMetadata';
import { useCasinoBetPreference } from '@/hooks/useCasinoBetPreference';
import { formatCasinoLimitForToken,getCasinoUiMaxBet,getCasinoUiMinBet,isPotentialCasinoAmountInput,parseCasinoAmountInput } from '@/lib/casino-amount-input';
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
    type BlackjackGameSnapshot,
} from '@/lib/contracts';
import { getCasinoTokenImage } from '@/lib/utils';
import { formatTokenDisplay, formatTokenDecimal } from '@/lib/token-display';


import Image from 'next/image';
import { useCallback,useEffect,useId,useMemo,useRef,useState } from 'react';
import { toast } from 'react-hot-toast';
import { formatUnits } from 'viem';
import { useAccount,useBalance } from 'wagmi';
import ApproveTransaction from './approve-transaction';
import BlackjackTransaction from './blackjack-transaction';
import type { LifecycleStatus } from './transaction-kit';

const getResultText = (result: BlackjackResult): string => ({
    [BlackjackResult.NONE]: '', [BlackjackResult.PLAYER_WIN]: 'You won',
    [BlackjackResult.PLAYER_BLACKJACK]: 'Natural Blackjack', [BlackjackResult.DEALER_WIN]: 'You lost',
    [BlackjackResult.DEALER_BLACKJACK]: 'Dealer Blackjack', [BlackjackResult.PUSH]: 'Bet returned',
    [BlackjackResult.PLAYER_BUST]: 'You went over 21', [BlackjackResult.SURRENDERED]: 'Hand surrendered',
}[result] ?? '');

interface BlackjackDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    landId: bigint;
    onGameComplete?: () => void;
    selectedToken: string | null;
}

const APPROVAL_REFRESH_DELAYS_MS = [0, 750, 1500, 3000] as const;
const waitForAbortableDelay = (ms: number, signal: AbortSignal): Promise<boolean> => (
    new Promise((resolve) => {
        if (signal.aborted) {
            resolve(false);
            return;
        }

        let settled = false;
        const finish = (completed: boolean) => {
            if (settled) return;
            settled = true;
            window.clearTimeout(timeoutId);
            signal.removeEventListener('abort', handleAbort);
            resolve(completed);
        };
        const handleAbort = () => finish(false);
        const timeoutId = window.setTimeout(() => finish(true), ms);
        signal.addEventListener('abort', handleAbort, { once: true });
        if (signal.aborted) handleAbort();
    })
);
const BLACKJACK_WARNING_BUTTON = gameActionButtonClass('warning');

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
    dealerCards: PlayingCardValue[];

    // Hand values from contract
    playerValue: number;
    splitValue: number;
    dealerValue: number;

    // Game state from contract
    hasSplit: boolean;
    activeHandCount: number;
    currentHandIndex: number;
    betAmount: bigint;
    /** Exact for observed rounds; a resumed split may omit prior double stakes. */
    committedWei: bigint | null;

    // Available actions from contract
    canHit: boolean;
    canStand: boolean;
    canDouble: boolean;
    canSplit: boolean;
    canSurrender: boolean;

    // Result state
    result: BlackjackResult | null;
    payout: string;
    payoutWei?: bigint;
    splitResults: Array<{
        result: BlackjackResult;
        playerFinalValue: number;
        dealerFinalValue: number;
        payout?: string;
        payoutWei: bigint;
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
    committedWei: null,
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
    const refreshScopeRef = useRef('');
    const gameOwnerScopeRef = useRef('');
    const snapshotGenerationRef = useRef(0);
    const configGenerationRef = useRef(0);
    const allowanceGenerationRef = useRef(0);
    const actionSyncGenerationRef = useRef(0);
    const scopeAbortControllerRef = useRef<AbortController | null>(null);
    const snapshotRequestsRef = useRef(new Map<string, {
        generation: number;
        promise: Promise<BlackjackGameSnapshot | null>;
        scopeKey: string;
    }>());
    const gameRefreshInFlightRef = useRef<{
        generation: number;
        promise: Promise<boolean>;
        scopeKey: string;
    } | null>(null);
    const actionSyncInFlightRef = useRef<{
        controller: AbortController;
        generation: number;
        promise: Promise<boolean>;
        scopeKey: string;
    } | null>(null);

    // Transaction in progress tracking - tracks specific action for hiding other buttons
    const [txInProgress, setTxInProgress] = useState<'deal' | BlackjackAction | null>(null);
    const [walletTxPending, setWalletTxPending] = useState(false);
    const [roundId, setRoundId] = useState(0);
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
    const [configReadStatus, setConfigReadStatus] = useState<'loading' | 'ready' | 'unsupported' | 'error'>('loading');
    const [readRetry, setReadRetry] = useState(0);
    const [approvalRefreshing, setApprovalRefreshing] = useState(false);

    useEffect(() => {
        if (!open || blackjackPlayable) return;
        onOpenChange(false);
        toast.error(
            casinoPolicy.blackjackEnabled
                ? (casinoPolicy.message || 'Casino is currently unavailable.')
                : 'Blackjack is currently unavailable.'
        );
    }, [blackjackPlayable, casinoPolicy.blackjackEnabled, casinoPolicy.message, onOpenChange, open]);

    const { symbol: tokenSymbolRaw, decimals: tokenDecimals, isReady: metadataReady, isError: metadataError, refetch: refetchMetadata } = useTokenMetadata(config?.bettingToken);
    const refreshScopeKey = [
        open ? 'open' : 'closed',
        blackjackPlayable ? 'playable' : 'disabled',
        address?.toLowerCase() ?? '',
        landId.toString(),
        selectedToken?.toLowerCase() ?? '',
    ].join(':');
    const gameOwnerScopeKey = [address?.toLowerCase() ?? '', landId.toString()].join(':');

    useEffect(() => {
        const gameOwnerChanged = gameOwnerScopeRef.current !== gameOwnerScopeKey;
        gameOwnerScopeRef.current = gameOwnerScopeKey;
        refreshScopeRef.current = refreshScopeKey;
        refreshGenerationRef.current += 1;
        snapshotGenerationRef.current += 1;
        configGenerationRef.current += 1;
        allowanceGenerationRef.current += 1;
        actionSyncGenerationRef.current += 1;
        scopeAbortControllerRef.current?.abort();
        actionSyncInFlightRef.current?.controller.abort();
        const scopeController = new AbortController();
        scopeAbortControllerRef.current = scopeController;

        setActionButtonsReady(false);
        setActionButtonsSyncing(false);
        setActionButtonsSyncFailed(false);
        setConfig(null);
        setConfigReadStatus('loading');
        setApprovalRefreshing(false);
        setAllowanceWei(BigInt(0));
        if (gameOwnerChanged) {
            setGameState(prev => ({
                ...initialGameState,
                betAmountInput: prev.betAmountInput,
            }));
            setTxInProgress(null);
            setWalletTxPending(false);
            setError(null);
        }

        return () => {
            if (refreshScopeRef.current === refreshScopeKey) {
                refreshScopeRef.current = '';
            }
            refreshGenerationRef.current += 1;
            snapshotGenerationRef.current += 1;
            configGenerationRef.current += 1;
            allowanceGenerationRef.current += 1;
            actionSyncGenerationRef.current += 1;
            scopeController.abort();
            actionSyncInFlightRef.current?.controller.abort();
            if (scopeAbortControllerRef.current === scopeController) {
                scopeAbortControllerRef.current = null;
            }
        };
    }, [gameOwnerScopeKey, refreshScopeKey]);

    const readGameSnapshot = useCallback((): Promise<BlackjackGameSnapshot | null> => {
        if (!open || !blackjackPlayable || refreshScopeRef.current !== refreshScopeKey) {
            return Promise.resolve(null);
        }

        const snapshotRequests = snapshotRequestsRef.current;
        const activeRequest = snapshotRequests.get(refreshScopeKey);
        const snapshotGeneration = snapshotGenerationRef.current;
        if (
            activeRequest?.scopeKey === refreshScopeKey &&
            activeRequest.generation === snapshotGeneration
        ) {
            return activeRequest.promise;
        }

        const requestRecord: {
            generation: number;
            promise: Promise<BlackjackGameSnapshot | null>;
            scopeKey: string;
        } = {
            generation: snapshotGeneration,
            promise: Promise.resolve(null),
            scopeKey: refreshScopeKey,
        };
        const readSnapshot = () => {
            if (
                refreshScopeRef.current !== refreshScopeKey ||
                snapshotGenerationRef.current !== snapshotGeneration
            ) return Promise.resolve(null);
            return blackjackGetGameSnapshot(landId);
        };
        const snapshotPromise = activeRequest?.scopeKey === refreshScopeKey
            ? activeRequest.promise.catch(() => null).then(readSnapshot)
            : readSnapshot();
        requestRecord.promise = snapshotPromise.finally(() => {
            if (snapshotRequests.get(refreshScopeKey) === requestRecord) {
                snapshotRequests.delete(refreshScopeKey);
            }
        });
        snapshotRequests.set(refreshScopeKey, requestRecord);
        return requestRecord.promise;
    }, [blackjackPlayable, landId, open, refreshScopeKey]);

    const { data: balanceData, error: balanceError, refetch: refetchBalance } = useBalance({
        address: address,
        token: config?.bettingToken as `0x${string}` | undefined,
        query: { enabled: !!address && open && !!config?.bettingToken }
    });

    const tokenSymbol = tokenSymbolRaw || 'TOKEN';
    const uiMinBet = useMemo(() => (
        config && tokenDecimals !== undefined ? getCasinoUiMinBet(config.bettingToken, tokenDecimals, config.minBet) : BigInt(0)
    ), [config, tokenDecimals]);
    const uiMaxBet = useMemo(() => (
        config && tokenDecimals !== undefined ? getCasinoUiMaxBet(config.bettingToken, tokenDecimals, config.maxBet) : BigInt(0)
    ), [config, tokenDecimals]);
    const formattedMinBet = useMemo(() => (
        config && tokenDecimals !== undefined ? formatCasinoLimitForToken(uiMinBet, tokenDecimals, config.bettingToken, 'min') : '—'
    ), [config, tokenDecimals, uiMinBet]);
    const formattedMaxBet = useMemo(() => (
        config && tokenDecimals !== undefined ? formatCasinoLimitForToken(uiMaxBet, tokenDecimals, config.bettingToken, 'max') : '—'
    ), [config, tokenDecimals, uiMaxBet]);
    const tokenLogo = useMemo(() => getCasinoTokenImage(config?.bettingToken), [config?.bettingToken]);
    const currentBalanceWei = balanceData?.value || BigInt(0);
    const requiredApprovalWei = useMemo(() => {
        if (!config || tokenDecimals === undefined) return BigInt(0);
        try {
            const amount = parseCasinoAmountInput(gameState.betAmountInput || '0', tokenDecimals);
            return amount > BigInt(0) ? amount : uiMinBet;
        } catch {
            return uiMinBet;
        }
    }, [config, gameState.betAmountInput, tokenDecimals, uiMinBet]);
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
        snapshotGenerationRef.current += 1;
        actionSyncGenerationRef.current += 1;
        actionSyncInFlightRef.current?.controller.abort();
    }, []);

    // Fetch complete game state from contract
    const refreshGameState = useCallback((): Promise<boolean> => {
        if (!open || !blackjackPlayable || refreshScopeRef.current !== refreshScopeKey) {
            return Promise.resolve(false);
        }

        const activeRefresh = gameRefreshInFlightRef.current;
        if (
            activeRefresh?.scopeKey === refreshScopeKey &&
            activeRefresh.generation === refreshGenerationRef.current
        ) {
            return activeRefresh.promise;
        }

        const refreshGeneration = refreshGenerationRef.current + 1;
        refreshGenerationRef.current = refreshGeneration;
        const isCurrentRefresh = () => (
            refreshScopeRef.current === refreshScopeKey &&
            refreshGenerationRef.current === refreshGeneration
        );
        const requestRecord: {
            generation: number;
            promise: Promise<boolean>;
            scopeKey: string;
        } = {
            generation: refreshGeneration,
            promise: Promise.resolve(false),
            scopeKey: refreshScopeKey,
        };

        requestRecord.promise = (async () => {
            try {
                const snapshot = await readGameSnapshot();

                if (!isCurrentRefresh()) {
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
                    if (!isCurrentRefresh()) {
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
                let nextDealerCards: PlayingCardValue[] = snapshot.dealerCards;

                if (isPlayerTurn && nextDealerCards.length === 1) {
                    nextDealerCards = [nextDealerCards[0], null];
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
                    committedWei: !snapshot.hasSplit ? snapshot.betAmount
                        : prev.hasSplit ? prev.committedWei
                        : snapshot.actionHandIndex === 0 ? snapshot.betAmount * BigInt(2) : null,
                    canHit: isPlayerTurn ? snapshot.canHit : false,
                    canStand: isPlayerTurn ? snapshot.canStand : false,
                    canDouble: isPlayerTurn ? snapshot.canDouble : false,
                    canSplit: isPlayerTurn ? snapshot.canSplit : false,
                    canSurrender: isPlayerTurn ? snapshot.canSurrender : false,
                };
                });
                return trustedActionState;
            } catch (err) {
                if (isCurrentRefresh()) {
                    console.error('Failed to refresh blackjack state:', err);
                    setActionButtonsReady(false);
                }
                return false;
            }
        })().finally(() => {
            if (gameRefreshInFlightRef.current === requestRecord) {
                gameRefreshInFlightRef.current = null;
            }
        });
        gameRefreshInFlightRef.current = requestRecord;
        return requestRecord.promise;
    }, [address, blackjackPlayable, open, readGameSnapshot, refreshScopeKey]);

    const syncActionButtonsWithRetries = useCallback((): Promise<boolean> => {
        if (!open || !blackjackPlayable || refreshScopeRef.current !== refreshScopeKey) {
            return Promise.resolve(false);
        }

        const activeSync = actionSyncInFlightRef.current;
        if (
            activeSync?.scopeKey === refreshScopeKey &&
            activeSync.generation === actionSyncGenerationRef.current &&
            !activeSync.controller.signal.aborted
        ) {
            return activeSync.promise;
        }

        const syncGeneration = actionSyncGenerationRef.current + 1;
        actionSyncGenerationRef.current = syncGeneration;
        const controller = new AbortController();
        const isCurrentSync = () => (
            !controller.signal.aborted &&
            refreshScopeRef.current === refreshScopeKey &&
            actionSyncGenerationRef.current === syncGeneration
        );
        const syncRecord: {
            controller: AbortController;
            generation: number;
            promise: Promise<boolean>;
            scopeKey: string;
        } = {
            controller,
            generation: syncGeneration,
            promise: Promise.resolve(false),
            scopeKey: refreshScopeKey,
        };

        syncRecord.promise = (async () => {
            if (!isCurrentSync()) return false;
            setActionButtonsReady(false);
            setActionButtonsSyncing(true);
            setActionButtonsSyncFailed(false);

            const maxAttempts = 3;
            for (let attempt = 0; attempt < maxAttempts; attempt++) {
                const trusted = await refreshGameState();
                if (!isCurrentSync()) return false;
                if (trusted) {
                    setActionButtonsReady(true);
                    setActionButtonsSyncing(false);
                    setActionButtonsSyncFailed(false);
                    return true;
                }
                if (
                    attempt < maxAttempts - 1 &&
                    !await waitForAbortableDelay(1500, controller.signal)
                ) {
                    return false;
                }
            }

            if (!isCurrentSync()) return false;
            setActionButtonsSyncing(false);
            setActionButtonsSyncFailed(true);
            return false;
        })().finally(() => {
            if (actionSyncInFlightRef.current === syncRecord) {
                actionSyncInFlightRef.current = null;
            }
        });
        actionSyncInFlightRef.current = syncRecord;
        return syncRecord.promise;
    }, [blackjackPlayable, open, refreshGameState, refreshScopeKey]);

    // Load config on open
    useEffect(() => {
        if (!open || !blackjackPlayable || refreshScopeRef.current !== refreshScopeKey) return;

        let disposed = false;
        const configGeneration = configGenerationRef.current + 1;
        configGenerationRef.current = configGeneration;
        const snapshotGeneration = snapshotGenerationRef.current;
        const allowanceGeneration = allowanceGenerationRef.current + 1;
        allowanceGenerationRef.current = allowanceGeneration;
        const scopeSignal = scopeAbortControllerRef.current?.signal;
        const isCurrentConfig = () => (
            !disposed &&
            !scopeSignal?.aborted &&
            refreshScopeRef.current === refreshScopeKey &&
            configGenerationRef.current === configGeneration &&
            snapshotGenerationRef.current === snapshotGeneration
        );

        const loadConfig = async () => {
            setConfigReadStatus('loading');
            try {
                const snapshot = await readGameSnapshot();
                if (!isCurrentConfig()) return;
                if (!snapshot) throw new Error('Blackjack game snapshot read failed');

                let effectiveToken = selectedToken;
                if (snapshot.isActive) {
                    effectiveToken = await blackjackGetGameToken(landId);
                    if (!isCurrentConfig()) return;
                    if (!effectiveToken) throw new Error('Blackjack active game token read failed');
                }

                if (!effectiveToken) {
                    setConfig(null);
                    setConfigReadStatus('unsupported');
                    if (allowanceGenerationRef.current === allowanceGeneration) {
                        setAllowanceWei(BigInt(0));
                    }
                    return;
                }

                const cfg = await blackjackGetTokenConfig(effectiveToken);
                if (!isCurrentConfig()) return;
                if (!cfg) throw new Error('Blackjack token config read failed');

                const nextConfig = cfg.supported || snapshot.isActive
                    ? {
                        minBet: cfg?.minBet ?? BigInt(0),
                        maxBet: cfg?.maxBet ?? BigInt(0),
                        bettingToken: effectiveToken,
                        enabled: cfg?.enabled ?? false,
                    }
                    : null;
                let allowance = BigInt(0);
                if (address && nextConfig) {
                    allowance = await checkCasinoApproval(address, effectiveToken);
                    if (!isCurrentConfig()) return;
                }

                setConfig(nextConfig);
                setConfigReadStatus(nextConfig ? 'ready' : 'unsupported');
                if (allowanceGenerationRef.current === allowanceGeneration) {
                    setAllowanceWei(allowance);
                }
            } catch (err) {
                if (isCurrentConfig()) {
                    console.error('Failed to load blackjack config:', err);
                    setConfigReadStatus('error');
                }
            }
        };

        void loadConfig();
        return () => {
            disposed = true;
        };
    }, [address, blackjackPlayable, landId, open, readGameSnapshot, refreshScopeKey, selectedToken, readRetry]);

    const configBettingToken = config?.bettingToken ?? null;
    const initializeBetAmount = useCallback((value: string) => {
        setGameState(previous => ({ ...previous, betAmountInput: value }));
    }, []);
    const rememberBetAmount = useCasinoBetPreference({
        game: 'blackjack', scope: open ? refreshScopeKey : null,
        enabled: configReadStatus === 'ready' && gameState.contractPhase === BlackjackPhase.NONE,
        token: configBettingToken, decimals: tokenDecimals, minBet: uiMinBet, maxBet: uiMaxBet,
        onInitialize: initializeBetAmount,
    });
    const handleBetAmountInputChange = useCallback((value: string) => {
        if (!isPotentialCasinoAmountInput(value)) return;
        setGameState(prev => ({ ...prev, betAmountInput: value }));
        rememberBetAmount(value);
    }, [rememberBetAmount]);

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

        if (status.statusName === 'success' || isGameTransactionFailure(status.statusName ?? '')) {
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
                ? 'Confirmation expired. Choose the same action again to continue.'
                : 'Confirmation cancelled. Choose the same action and amount to continue.'
        );
    }, []);

    // Handle the initial deal, including an immediately settled natural.
    const handleDealComplete = useCallback(async (result?: BlackjackTransactionResult) => {
        try {
            setWalletTxPending(false);
            if (!result) {
                setError('Deal did not confirm. Refresh and check the game before trying again.');
                return;
            }
            invalidatePendingRefreshes();
            setGameState(prev => {
                const committed = tokenDecimals === undefined ? null : parseCasinoAmountInput(prev.betAmountInput || '0', tokenDecimals);
                return { ...prev, committedWei: committed, betAmount: committed ?? prev.betAmount };
            });

            // A natural may settle in the same receipt as the deal.
            if (result.gameResult !== undefined) {
                setGameState(prev => ({
                    ...prev,
                    result: result.gameResult ?? prev.result,
                    payout: result.payout ?? '',
                    payoutWei: result.payoutWei,
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
                    optimisticBetAmountWei = tokenDecimals === undefined ? BigInt(0) : parseCasinoAmountInput(gameState.betAmountInput || '0', tokenDecimals);
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
                    dealerCards: result.dealerUpCard !== undefined ? [result.dealerUpCard, null] : prev.dealerCards,
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
                // Refresh when the receipt has no usable card event.
                await refreshGameState();
                refetchBalance();
                onGameComplete?.();
            }
        } finally {
            setTxInProgress(null);
        }
    }, [invalidatePendingRefreshes, onGameComplete, refetchBalance, refreshGameState, syncActionButtonsWithRetries, gameState.betAmountInput, address, tokenDecimals]);

    // Handle action complete (immediate result with server randomness)
    const handleActionComplete = useCallback(async (result?: BlackjackTransactionResult) => {
        setTxInProgress(null);
        setWalletTxPending(false);
        if (!result) {
            // Transaction failed, refresh state anyway
            setError('Action did not confirm. Refresh and check the game before trying again.');
            await refreshGameState();
            return;
        }
        invalidatePendingRefreshes();
        if (result.actionTaken === BlackjackAction.DOUBLE || result.actionTaken === BlackjackAction.SPLIT) {
            setGameState(prev => ({ ...prev, committedWei: prev.committedWei === null ? null : prev.committedWei + prev.betAmount }));
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
                    result: result.gameResult ?? prev.result,
                    payout: result.payout ?? '',
                    payoutWei: result.payoutWei,
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
            const splitHand1Card = result.splitHand1Card;
            const splitHand2Card = result.splitHand2Card;
            setGameState(prev => {
                const originalHand1Card = prev.playerCards[0];
                const originalHand2Card = prev.playerCards[1];

                const nextHand1 =
                    typeof originalHand1Card === 'number'
                        ? [originalHand1Card, splitHand1Card]
                        : prev.playerCards;
                const nextHand2 =
                    typeof originalHand2Card === 'number'
                        ? [originalHand2Card, splitHand2Card]
                        : (prev.splitCards.length > 0 ? prev.splitCards : [splitHand2Card]);

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
            const newCard = result.cards[0];
            setGameState(prev => {
                // If it's a hit, we expect 1 new card.
                // The event 'BlackjackHit' usually returns just the NEW card in some contracts,
                // but our decoder in handleStatus seems to return `cards: [newCard]`.
                // Let's check how `result.cards` is populated in `BlackjackTransaction`.
                // Looking at `blackjack-transaction.tsx`, for 'action' mode/BlackjackHit:
                // `cards: [Number(args.newCard)]`

                // So we should APPEND this card to the correct hand
                const targetHandIndex = result.handIndex ?? prev.currentHandIndex;
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

                // A double always ends the hand; so does a hit that busts. When that
                // happens on hand 1 of a split, the turn moves to hand 2.
                //
                // This used to be left entirely to the follow-up onchain sync. That
                // sync gives up after 3 attempts, and every action button is gated on
                // `actionButtonsReady`, so losing the race left the player looking at
                // "Playing Hand 1" with no Double button and the "Please reopen
                // Blackjack" notice. Advancing locally makes the common path work
                // without waiting on the RPC; the sync still finalizes the exact flags,
                // and handleActionClick re-validates every action against a fresh
                // snapshot before sending, so an optimistic flag cannot submit an
                // action the contract would reject.
                const handFinished =
                    result.actionTaken === BlackjackAction.DOUBLE ||
                    (result.actionTaken === BlackjackAction.HIT && result.busted === true);
                const movesToSecondHand =
                    prev.hasSplit && targetHandIndex === 0 && handFinished;

                return {
                    ...prev,
                    isActive: true,
                    // Update the specific hand's cards
                    playerCards: newPlayerCards,
                    splitCards: newSplitCards,
                    // Update value
                    playerValue: targetHandIndex === 0 ? (result.handValue ?? prev.playerValue) : prev.playerValue,
                    splitValue: targetHandIndex === 1 ? (result.handValue ?? prev.splitValue) : prev.splitValue,
                    currentHandIndex: movesToSecondHand ? 1 : prev.currentHandIndex,
                    // A post-hit hand can no longer double/surrender/split on this turn.
                    // Fresh onchain snapshot will follow and finalize exact action flags.
                    canHit: movesToSecondHand ? true : prev.canHit,
                    canStand: movesToSecondHand ? true : prev.canStand,
                    canDouble: movesToSecondHand ? newSplitCards.length === 2 : false,
                    canSplit: false,
                    canSurrender: false,
                    contractPhase: BlackjackPhase.PLAYER_TURN
                };
            });
        }

        // STAND emits no card, so it never reached the optimistic update above and
        // relied entirely on the sync to move the turn to hand 2 — same failure mode
        // as double.
        if (result.actionTaken === BlackjackAction.STAND) {
            setGameState(prev => {
                const actedHandIndex = result.handIndex ?? prev.currentHandIndex;
                if (!prev.hasSplit || actedHandIndex !== 0) {
                    return prev;
                }
                return {
                    ...prev,
                    currentHandIndex: 1,
                    canHit: true,
                    canStand: true,
                    canDouble: prev.splitCards.length === 2,
                    canSplit: false,
                    canSurrender: false,
                    contractPhase: BlackjackPhase.PLAYER_TURN,
                };
            });
        }

        // Still trigger a refresh in background to eventually sync fully
        await syncActionButtonsWithRetries();
        refetchBalance();
        onGameComplete?.();
    }, [invalidatePendingRefreshes, refreshGameState, refetchBalance, syncActionButtonsWithRetries, onGameComplete]);

    // Handle approval success
    const handleApproveSuccess = useCallback(async () => {
        const scopeSignal = scopeAbortControllerRef.current?.signal;
        if (
            !address ||
            !config ||
            !scopeSignal ||
            scopeSignal.aborted ||
            refreshScopeRef.current !== refreshScopeKey
        ) return;

        const allowanceGeneration = allowanceGenerationRef.current + 1;
        allowanceGenerationRef.current = allowanceGeneration;
        const isCurrentAllowance = () => (
            !scopeSignal.aborted &&
            refreshScopeRef.current === refreshScopeKey &&
            allowanceGenerationRef.current === allowanceGeneration
        );
        setApprovalRefreshing(true);
        const requiredAllowance = gameState.isActive ? gameState.betAmount : requiredApprovalWei;
        try {
            for (const delayMs of APPROVAL_REFRESH_DELAYS_MS) {
                if (
                    delayMs > 0 &&
                    !await waitForAbortableDelay(delayMs, scopeSignal)
                ) return;
                if (!isCurrentAllowance()) return;

                let allowance: bigint;
                try {
                    allowance = await checkCasinoApproval(address, config.bettingToken);
                } catch {
                    continue;
                }
                if (!isCurrentAllowance()) return;
                setAllowanceWei(allowance);
                if (allowance >= requiredAllowance) {
                    setError(null);
                    return;
                }
            }

            if (isCurrentAllowance()) setError('Approval confirmed, but the updated allowance is not available yet. Retry allowance verification.');
        } finally {
            if (isCurrentAllowance()) setApprovalRefreshing(false);
        }
    }, [address, config, gameState.betAmount, gameState.isActive, refreshScopeKey, requiredApprovalWei]);

    const retryGameReads = useCallback(() => {
        setReadRetry(value => value + 1);
        void Promise.allSettled([refetchBalance(), refetchMetadata(), syncActionButtonsWithRetries()]);
    }, [refetchBalance, refetchMetadata, syncActionButtonsWithRetries]);

    // Play again
    const handlePlayAgain = useCallback(() => {
        invalidatePendingRefreshes();
        // New round id so CardHand keys change and the deal animation replays
        // even when the same ranks land in the same positions.
        setRoundId((previous) => previous + 1);
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
            toast('Confirmation cancelled. Choose the same action when you return.');
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
        if (tokenDecimals === undefined) return BigInt(0);
        try {
            return parseCasinoAmountInput(gameState.betAmountInput || '0', tokenDecimals);
        } catch {
            return BigInt(0);
        }
    }, [gameState.betAmountInput, tokenDecimals]);
    const dealAmountIssue = useMemo(() => {
        if (!address) return 'Connect wallet to play';
        if (configReadStatus === 'error') return 'Blackjack data unavailable';
        if (configReadStatus === 'unsupported') return 'Select a supported token';
        if (!config) return 'Loading limits...';
        if (!metadataReady) return metadataError ? 'Token details unavailable' : 'Loading token details...';
        if (!config.enabled) return 'Blackjack disabled';
        if (betAmountWei <= BigInt(0)) return 'Enter bet amount';
        if (betAmountWei < uiMinBet) return `Min ${formattedMinBet} ${tokenSymbol}`;
        if (betAmountWei > uiMaxBet) return `Max ${formattedMaxBet} ${tokenSymbol}`;
        if (balanceError) return 'Balance unavailable';
        if (!balanceData) return 'Loading balance...';
        if (betAmountWei > currentBalanceWei) return 'Insufficient Balance';
        return null;
    }, [address, balanceData, balanceError, betAmountWei, config, configReadStatus, currentBalanceWei, formattedMaxBet, formattedMinBet, metadataError, metadataReady, tokenSymbol, uiMaxBet, uiMinBet]);

    const betInputIssue = !metadataReady || !config ? undefined
        : betAmountWei <= BigInt(0) ? 'Enter a valid bet amount.'
        : betAmountWei < uiMinBet ? `Minimum ${formattedMinBet} ${tokenSymbol}.`
        : betAmountWei > uiMaxBet ? `Maximum ${formattedMaxBet} ${tokenSymbol}.`
        : balanceData && betAmountWei > currentBalanceWei ? `Your available ${tokenSymbol} balance is too low.` : undefined;

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
        ? 'Waiting for transaction confirmation…'
        : txInProgress !== null
            ? 'Continue with the highlighted action below.'
            : (gameState.hasSplit ? `Playing Hand ${currentActionHandIndex + 1}` : 'Your Turn');

    const additionalActionBetWei = gameState.betAmount > BigInt(0) ? gameState.betAmount : BigInt(0);
    const hasBalanceForAdditionalAction = currentBalanceWei >= additionalActionBetWei;
    const hasAllowanceForAdditionalAction = allowanceWei >= additionalActionBetWei;
    const needsAdditionalApproval =
        additionalActionBetWei > BigInt(0) && !hasAllowanceForAdditionalAction;
    const disableDoubleForFunding =
        canDoubleUi &&
        (additionalActionBetWei <= BigInt(0) || !hasBalanceForAdditionalAction || needsAdditionalApproval || approvalRefreshing || !metadataReady || !!balanceError || configReadStatus !== 'ready');
    const disableSplitForFunding =
        canSplitUi &&
        (additionalActionBetWei <= BigInt(0) || !hasBalanceForAdditionalAction || needsAdditionalApproval || approvalRefreshing || !metadataReady || !!balanceError || configReadStatus !== 'ready');

    const handleActionClick = useCallback(async (action: BlackjackAction): Promise<boolean | { handIndex: number }> => {
        const scopeSignal = scopeAbortControllerRef.current?.signal;
        const isCurrentActionScope = () => (
            !!scopeSignal &&
            !scopeSignal.aborted &&
            refreshScopeRef.current === refreshScopeKey
        );
        if (!isCurrentActionScope()) return false;

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

        let latestSnapshot = await readGameSnapshot();
        if (!isCurrentActionScope()) return false;

        // Retry once for transient stale reads before deciding state changed.
        if (!latestSnapshot || latestSnapshot.phase !== BlackjackPhase.PLAYER_TURN) {
            if (!scopeSignal || !await waitForAbortableDelay(250, scopeSignal)) return false;
            latestSnapshot = await readGameSnapshot();
            if (!isCurrentActionScope()) return false;
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

        if (!metadataReady || tokenDecimals === undefined || configReadStatus !== 'ready') {
            setError('Verify token details before adding a wager. You can still finish your current hand.');
            return false;
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
            if (!isCurrentActionScope()) return false;
            if (refreshed.error || refreshed.data?.value === undefined) throw new Error('Balance read failed');
            latestBalanceWei = refreshed.data.value;
        } catch (err) {
            if (!isCurrentActionScope()) return false;
            console.warn('Failed to refresh balance before action:', err);
            setError('Unable to verify your balance. Retry game data before adding a wager.');
            return false;
        }

        let latestAllowanceWei = allowanceWei;
        if (address && config) {
            const allowanceGeneration = allowanceGenerationRef.current + 1;
            allowanceGenerationRef.current = allowanceGeneration;
            try {
                latestAllowanceWei = await checkCasinoApproval(address, config.bettingToken);
                if (!isCurrentActionScope()) return false;
                if (allowanceGenerationRef.current === allowanceGeneration) {
                    setAllowanceWei(latestAllowanceWei);
                }
            } catch (err) {
                if (!isCurrentActionScope()) return false;
                console.warn('Failed to refresh allowance before action:', err);
                setError('Unable to verify your allowance. Retry allowance verification before adding a wager.');
                return false;
            }
        }

        const actionLabel = action === BlackjackAction.DOUBLE ? 'double' : 'split';
        const requiredAmount = formatTokenDisplay(requiredWei, tokenDecimals, tokenDecimals);

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
        readGameSnapshot,
        refreshGameState,
        refreshScopeKey,
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
        metadataReady,
        configReadStatus,
        tokenSymbol
    ]);

    // Validate bet and start deal
    const handleDealClick = useCallback((): boolean => {
        if (dealAmountIssue || !hasApproval) {
            setError(dealAmountIssue ?? 'Approve the wager before dealing.');
            return false;
        }
        if (betAmountWei <= BigInt(0)) {
            setError('Please enter a valid bet amount');
            return false;
        }
        if (betAmountWei > currentBalanceWei) {
            setError('Insufficient balance');
            return false;
        }
        if (config) {
            if (!config.enabled) {
                setError('Blackjack is currently disabled');
                return false;
            }
            if (betAmountWei < uiMinBet) {
                setError(`Minimum bet is ${formattedMinBet} ${tokenSymbol}`);
                return false;
            }
            if (betAmountWei > uiMaxBet) {
                setError(`Maximum bet is ${formattedMaxBet} ${tokenSymbol}`);
                return false;
            }
        }
        setError(null);
        setTxInProgress('deal');
        return true;
    }, [betAmountWei, config, currentBalanceWei, dealAmountIssue, formattedMaxBet, formattedMinBet, hasApproval, tokenSymbol, uiMaxBet, uiMinBet]);

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

    const showDealerHand =
        gameState.dealerCards.length > 0 ||
        (uiPhase === 'result' && gameState.result !== null);
    const resolvedPayout = gameState.payoutWei !== undefined && tokenDecimals !== undefined ? formatUnits(gameState.payoutWei, tokenDecimals) : gameState.payout;
    const netResultWei = gameState.payoutWei !== undefined && gameState.committedWei !== null ? gameState.payoutWei - gameState.committedWei : undefined;
    const roundResultLabel = netResultWei === undefined && gameState.hasSplit ? 'Round complete' : netResultWei === undefined ? (gameState.result === BlackjackResult.PUSH ? 'Bet returned' : gameState.result !== null ? getResultText(gameState.result) : '')
        : netResultWei === BigInt(0) ? 'Bet returned' : `${netResultWei > BigInt(0) ? 'You won' : 'You lost'}${tokenDecimals === undefined ? '' : ` ${formatUnits(netResultWei < BigInt(0) ? -netResultWei : netResultWei, tokenDecimals)} ${tokenSymbol}`}`;
    const payoutAnnouncement = resolvedPayout && tokenDecimals !== undefined ? `${resolvedPayout} ${tokenSymbol}` : 'amount unavailable until token details are verified';
    const blackjackResultAnnouncement = uiPhase === 'result' && gameState.result !== null
        ? gameState.splitResults && gameState.splitResults.length > 1
            ? `Blackjack result. ${gameState.splitResults.map((hand, index) => `Hand ${index + 1}: ${getResultText(hand.result) || 'result'}, value ${hand.playerFinalValue}`).join('. ')}. Dealer value ${gameState.dealerValue}. Total payout ${payoutAnnouncement}.`
            : `Blackjack result: ${getResultText(gameState.result) || 'result'}. Your hand value ${gameState.playerValue}. Dealer value ${gameState.dealerValue}. Payout ${payoutAnnouncement}.`
        : '';
    const blackjackAnnouncement = blackjackResultAnnouncement || (uiPhase === 'playing'
        ? `${blackjackTurnStatusText}.${txInProgress === null && !actionButtonsReady
            ? actionButtonsSyncing
                ? ' Syncing valid actions.'
                : actionButtonsSyncFailed
                    ? ' Unable to verify valid actions.'
                    : ' Waiting for trusted onchain action state.'
            : ''}`
        : '');

    return (
        <Dialog open={open} onOpenChange={handleClose}>
            <CasinoGameSurface
                title="Blackjack"
                description="Blackjack game dialog with active hand state, onchain action controls, and transaction status."
                onClose={handleClose}
                preventEscape={walletTxPending || gameState.isActive}
            >
                <p className="sr-only" role="status" aria-live="polite" aria-atomic="true">
                    {blackjackAnnouncement}
                </p>

                <div className="flex min-h-0 flex-1 flex-col gap-4 p-3 pb-0 pt-4 sm:gap-5 sm:p-4 sm:pb-0">
                    {uiPhase === 'playing' && <section aria-label="Blackjack round stake" className="rounded-lg border border-white/20 bg-black/50 p-3 text-sm text-white/85">
                        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
                            <dt>Base wager</dt><dd className="text-right [overflow-wrap:anywhere]">{tokenDecimals === undefined ? 'Amount unavailable' : `${formatUnits(gameState.betAmount, tokenDecimals)} ${tokenSymbol}`}</dd>
                            <dt>Total committed</dt><dd className="text-right [overflow-wrap:anywhere]">{tokenDecimals === undefined ? 'Amount unavailable' : gameState.committedWei === null ? `At least ${formatUnits(gameState.betAmount * BigInt(gameState.hasSplit ? 2 : 1), tokenDecimals)} ${tokenSymbol}` : `${formatUnits(gameState.committedWei, tokenDecimals)} ${tokenSymbol}`}</dd>
                            <dt>{balanceError ? "Last known balance" : "Available balance"}</dt><dd className="text-right [overflow-wrap:anywhere]">{tokenDecimals === undefined || !balanceData ? 'Checking…' : <TokenAmount amount={currentBalanceWei} decimals={tokenDecimals} unit={tokenSymbol} mode="compact" withIcon={false} />}</dd>
                        </dl>
                        {gameState.committedWei === null && gameState.hasSplit && <p className="mt-2 text-xs">This resumed split may include an earlier Double. Its extra stake is unavailable from the current game read.</p>}
                    </section>}
                    {/* Dealer Hand */}
                    {showDealerHand && (
                        <CardHand
                            dealId={roundId}
                            cards={gameState.dealerCards}
                            label="Dealer"
                            value={uiPhase === 'result' && gameState.result !== null ? gameState.dealerValue : undefined}
                            hideHoleCard={uiPhase !== 'result' && gameState.dealerCards.length > 1}
                        />
                    )}

                    {/* Player Hand(s) */}
                    {gameState.playerCards.length > 0 && (
                        <div className={`grid min-w-0 grid-cols-1 gap-3 ${gameState.hasSplit ? "min-[480px]:grid-cols-2" : ""}`}>
                            <CardHand
                                dealId={roundId}
                                cards={gameState.playerCards}
                                label={gameState.hasSplit ? "Hand 1" : "Your Hand"}
                                value={gameState.playerValue}
                                small={gameState.hasSplit}
                                active={uiPhase === 'playing' && currentActionHandIndex === 0}
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
                                    dealId={roundId}
                                    cards={gameState.splitCards}
                                    label="Hand 2"
                                    value={gameState.splitValue}
                                    small
                                    active={uiPhase === 'playing' && currentActionHandIndex === 1}
                                    className={uiPhase === 'playing' && currentActionHandIndex === 1 ? "max-[479px]:order-first" : undefined}
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
                            {(
                                <div className={`text-2xl font-bold ${gameState.result === BlackjackResult.PLAYER_WIN ||
                                    gameState.result === BlackjackResult.PLAYER_BLACKJACK
                                    ? 'text-green-400'
                                    : gameState.result === BlackjackResult.PUSH
                                        ? 'text-yellow-400'
                                        : 'text-red-400'
                                    }`}>
                                    {roundResultLabel}
                                    {gameState.result === BlackjackResult.PLAYER_BLACKJACK && (
                                        <div className="text-sm font-normal text-green-300 mt-1">
                                            Natural Blackjack · 3:2 winnings plus your stake
                                        </div>
                                    )}
                                </div>
                            )}
                            {gameState.result === BlackjackResult.SURRENDERED && <p className="mt-1 text-sm text-white/80">Hand surrendered.</p>}
                            {gameState.committedWei === null && gameState.hasSplit && <p className="mt-1 text-sm text-white/80">Net winnings are unavailable because this resumed round’s earlier Double stakes were not included in the game read.</p>}
                            {tokenDecimals === undefined && <p role="status">Round settled. Verify token details to display the payout amount.</p>}
                            {tokenDecimals !== undefined && resolvedPayout !== '' && (
                                <div className="mt-2 flex min-w-0 flex-wrap items-center justify-center gap-1 text-lg text-white">
                                    <span>Total returned:</span>
                                    <Image src={tokenLogo} alt={tokenSymbol} width={16} height={16} className="h-4 w-4 rounded-full" />
                                    <span className="min-w-0 [overflow-wrap:anywhere]">{formatTokenDecimal(resolvedPayout, tokenDecimals, 'exact')} {tokenSymbol}</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Betting Phase */}
                    {uiPhase === 'betting' && (
                        <div className="space-y-4">
                            <div>
                                <AmountField id={betAmountInputId} name="blackjack-bet-amount" label="Bet amount" unit={tokenSymbol} surface="game" placeholder={formattedMinBet} aria-label={`Blackjack bet amount in ${tokenSymbol}`} value={gameState.betAmountInput} onChange={e => handleBetAmountInputChange(e.target.value)} disabled={txInProgress !== null}
                                    error={betInputIssue ?? error ?? undefined}
                                    hint={<p>Minimum {formattedMinBet} · Maximum {formattedMaxBet} {tokenSymbol}.</p>}
                                    balance={balanceData ? formatUnits(balanceData.value, balanceData.decimals) : 'Checking…'} />
                                <p className="mt-3 text-sm text-white/80">Choose Deal, then Confirm Deal to open your wallet. Each action follows the same two steps.</p>
                            </div>
                        </div>
                    )}

                    <details className="rounded-lg border border-white/20 bg-black/45 p-3 text-sm text-white/85">
                        <summary className="min-h-11 cursor-pointer content-center font-semibold">How to play Blackjack</summary>
                        <div className="space-y-2 pt-2 leading-relaxed">
                            <p>Get closer to 21 than the dealer without going over. Number cards count at face value; J/Q/K count as 10; an Ace counts as 1 or 11.</p>
                            <p>Hit takes another card. Stand finishes your hand. Double adds one base wager, deals one card, and finishes that hand. Split adds one base wager to create two hands from an eligible pair. Surrender ends an eligible hand and returns half its wager.</p>
                            <p>A win returns your wager plus equal winnings. A natural Blackjack pays 3:2 winnings plus the original stake. A tie returns the wager. The highlighted hand is the one your next action affects.</p>
                        </div>
                    </details>
                    {(configReadStatus === 'error' || metadataError || balanceError) && (
                        <div role="alert" className="space-y-2 text-center text-sm">
                            <p>Blackjack data could not be verified. Your current hand is preserved.</p>
                            <Button onClick={retryGameReads} disabled={walletTxPending || txInProgress !== null}>Retry game data</Button>
                        </div>
                    )}
                    {uiPhase === 'betting' && (
                        <div data-blackjack-action-footer className={GAME_INSET_ACTION_FOOTER_CLASS}>
                            {config && !config.enabled ? (
                                <Button className="w-full" disabled variant="secondary">
                                    Blackjack disabled
                                </Button>
                            ) : dealAmountIssue ? (
                                <div className="space-y-2">
                                    <Button className="w-full" disabled variant="secondary" aria-describedby={`${betAmountInputId}-availability`}>Deal</Button>
                                    <p id={`${betAmountInputId}-availability`} role="status" className="text-center text-xs text-white/80">{dealAmountIssue}</p>
                                </div>
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
                                    disabled={!!dealAmountIssue || (txInProgress !== null && txInProgress !== 'deal')}
                                    buttonText="Deal"
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

                    {/* Error display */}
                    {error && uiPhase !== 'betting' && (
                        <p role="alert" className="text-red-200 text-sm text-center">{error}</p>
                    )}

                    {/* Playing Phase - Action Buttons */}
                    {uiPhase === 'playing' && !blackjackGameActiveInAnotherWallet && (
                        <div data-blackjack-action-footer className={GAME_INSET_ACTION_FOOTER_CLASS}>
                            {/* Status text - changes based on action state */}
                            <p role="status" className="text-center text-white/80 text-sm min-h-[20px]">
                                {blackjackTurnStatusText}
                            </p>
                            {txInProgress === null && !actionButtonsReady && (
                                <p className="text-center text-yellow-300 text-xs">
                                    {actionButtonsSyncing
                                        ? 'Syncing valid actions...'
                                        : actionButtonsSyncFailed
                                            ? 'Unable to verify valid actions right now. Your hand is preserved.'
                                            : 'Waiting for trusted onchain action state...'}
                                </p>
                            )}
                            {txInProgress === null && actionButtonsSyncFailed && (
                                <Button onClick={retryGameReads}>Retry game data</Button>
                            )}
                            {txInProgress === null && actionButtonsReady && tokenDecimals !== undefined && (canDoubleUi || canSplitUi) && additionalActionBetWei > BigInt(0) && (!hasBalanceForAdditionalAction || needsAdditionalApproval) && (
                                <p className="text-center text-red-300 text-xs">
                                    {!hasBalanceForAdditionalAction
                                        ? `Insufficient balance for Double/Split (needs ${formatTokenDisplay(additionalActionBetWei, tokenDecimals, tokenDecimals)} ${tokenSymbol})`
                                        : `Double/Split needs approval for an additional ${formatTokenDisplay(additionalActionBetWei, tokenDecimals, tokenDecimals)} ${tokenSymbol}.`}
                                </p>
                            )}

                            {txInProgress === null && actionButtonsReady && metadataReady && !balanceError && config && (canDoubleUi || canSplitUi) && needsAdditionalApproval && hasBalanceForAdditionalAction && (
                                <div className="space-y-2">
                                    <ApproveTransaction spenderAddress={LAND_CONTRACT_ADDRESS} tokenAddress={config.bettingToken as `0x${string}`} onSuccess={handleApproveSuccess} buttonText="Approve additional wager" buttonClassName={BLACKJACK_WARNING_BUTTON} disabled={approvalRefreshing || walletTxPending} />
                                    <Button variant="secondary" className="w-full" onClick={() => void handleApproveSuccess()} disabled={approvalRefreshing || walletTxPending}>
                                        {approvalRefreshing ? 'Verifying allowance...' : 'Retry allowance verification'}
                                    </Button>
                                </div>
                            )}
                            {tokenDecimals !== undefined && (canDoubleUi || canSplitUi || canSurrenderUi) && <p className="text-center text-xs leading-relaxed text-white/80">
                                {(canDoubleUi || canSplitUi) && `Double${canSplitUi ? '/Split' : ''} adds ${formatUnits(additionalActionBetWei, tokenDecimals)} ${tokenSymbol}. `}
                                {canSurrenderUi && `Surrender returns ${formatUnits(gameState.betAmount / BigInt(2), tokenDecimals)} ${tokenSymbol} and ends the hand.`}
                            </p>}
                            <BlackjackActionControls
                                landId={landId}
                                handIndex={getCurrentHandIndex()}
                                ready={actionButtonsReady}
                                pendingAction={txInProgress}
                                available={{
                                    [BlackjackAction.HIT]: canHitUi,
                                    [BlackjackAction.STAND]: canStandUi,
                                    [BlackjackAction.DOUBLE]: canDoubleUi,
                                    [BlackjackAction.SPLIT]: canSplitUi,
                                    [BlackjackAction.SURRENDER]: canSurrenderUi,
                                }}
                                fundingDisabled={{ double: disableDoubleForFunding, split: disableSplitForFunding }}
                                onPrepare={handleActionClick}
                                onStatusUpdate={handleBlackjackStatusUpdate}
                                onComplete={handleActionComplete}
                                onPreparedCancel={handlePreparedCancel}
                                onError={handleTransactionError}
                                tokenSymbol={tokenSymbol}
                                tokenDecimals={tokenDecimals}
                                bettingToken={config?.bettingToken ?? null}
                            />

                        </div>
                    )}

                    {/* Play Again (Result phase) */}
                    {uiPhase === 'result' && (
                        <div data-blackjack-action-footer className={GAME_INSET_ACTION_FOOTER_CLASS}>
                            <Button
                                onClick={handlePlayAgain}
                                variant="warning"
                                className="w-full font-bold"
                            >
                                Play Again
                            </Button>
                        </div>
                    )}

                </div>
            </CasinoGameSurface>
        </Dialog>
    );
}
