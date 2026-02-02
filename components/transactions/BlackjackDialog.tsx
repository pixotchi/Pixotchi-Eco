"use client";

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Loader2, AlertTriangle } from 'lucide-react';
import { parseUnits, formatUnits } from 'viem';
import { useAccount, useBalance } from 'wagmi';
import PlayingCard, { CardHand, calculateHandValue } from '@/components/ui/PlayingCard';
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
    blackjackGetGameBasic,
    blackjackGetGameHands,
    blackjackGetActions,
    blackjackGetDealerHand,
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
    betAmountInput: '10',
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

    const [hasApproval, setHasApproval] = useState(false);
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
            // 1. Fetch Basic Info first to get current hand index
            const gameBasic = await blackjackGetGameBasic(landId);

            if (!gameBasic) {
                setGameState(prev => ({ ...initialGameState, betAmountInput: prev.betAmountInput }));
                return;
            }

            // 2. Determine the correct hand index (Workaround for contract bug)
            // Contract doesn't update currentHandIndex when Hand 1 finishes.
            // We check if the reported hand has actions. If not, and it's a split game, check the next hand.
            let currentHandIdx = gameBasic.currentHandIndex ?? 0;

            // Get actions for the reported hand
            let actions = await blackjackGetActions(landId, currentHandIdx);

            const hasAvailableActions = (acts: any) =>
                acts && (acts.canHit || acts.canStand || acts.canDouble || acts.canSplit || acts.canSurrender);

            // If reported hand (0) has no actions, but we split, check Hand 1
            if (gameBasic.hasSplit && currentHandIdx === 0 && !hasAvailableActions(actions)) {
                // Try fetching actions for Hand 1
                const nextHandActions = await blackjackGetActions(landId, 1);
                if (hasAvailableActions(nextHandActions)) {
                    currentHandIdx = 1;
                    actions = nextHandActions;
                }
            }

            // 3. Fetch game hands now that we have the final index/actions
            const gameHands = await blackjackGetGameHands(landId);

            const isOurGame = gameBasic.player.toLowerCase() === address.toLowerCase();

            // Fetch dealer hand
            let dealerCards: number[] = [];
            let dealerValue = 0;

            if (gameBasic.phase === BlackjackPhase.RESOLVED) {
                const dealerHand = await blackjackGetDealerHand(landId);
                if (dealerHand) {
                    dealerCards = dealerHand.dealerCards;
                    dealerValue = dealerHand.dealerValue;
                }
            } else if (gameBasic.dealerUpCard > 0) {
                // Show up card + hole card (placeholder)
                dealerCards = [gameBasic.dealerUpCard, 0];
                dealerValue = 0;
            }

            // If game is resolved, keep old cards if new ones are empty (to show final state)
            setGameState(prev => {
                const newPlayerCards = gameHands?.hand1Cards || [];
                const newDealerCards = dealerCards;

                // If we have a local result but contract says game is gone/empty, keep old cards
                if (prev.result !== null && newPlayerCards.length === 0) {
                    return {
                        ...prev,
                        contractPhase: gameBasic.phase,
                        isActive: gameBasic.isActive && isOurGame,
                        player: gameBasic.player,
                        // Keep existing cards
                        activeHandCount: gameBasic.activeHandCount,
                        betAmount: gameBasic.betAmount,
                    };
                }

                return {
                    ...prev,
                    contractPhase: gameBasic.phase,
                    isActive: gameBasic.isActive && isOurGame,
                    player: gameBasic.player,
                    playerCards: newPlayerCards,
                    splitCards: gameHands?.hand2Cards || [],
                    dealerCards: newDealerCards.length > 0 ? newDealerCards : prev.dealerCards, // Keep dealer cards if we have them
                    playerValue: gameHands?.hand1Value || 0,
                    splitValue: gameHands?.hand2Value || 0,
                    dealerValue,
                    hasSplit: gameBasic.hasSplit,
                    activeHandCount: gameBasic.activeHandCount,
                    currentHandIndex: currentHandIdx,
                    betAmount: gameBasic.betAmount,
                    canHit: actions?.canHit || false,
                    canStand: actions?.canStand || false,
                    canDouble: actions?.canDouble || false,
                    canSplit: actions?.canSplit || false,
                    canSurrender: actions?.canSurrender || false,
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

                    if (address) {
                        const allowance = await checkCasinoApproval(address, cfg.bettingToken);
                        setHasApproval(allowance >= cfg.maxBet);
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
            setGameState(prev => ({ ...initialGameState, betAmountInput: prev.betAmountInput }));
            setTxInProgress(null);
            setError(null);
        }
    }, [open]);

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
            setGameState(prev => ({
                ...prev,
                isActive: true,
                contractPhase: BlackjackPhase.PLAYER_TURN, // Force phase
                playerCards: result.cards,
                playerValue: result.handValue ?? 0,
                // Show dealer up card + hidden
                dealerCards: result.dealerUpCard ? [result.dealerUpCard, 0] : prev.dealerCards,
                dealerValue: 0,

                // Reset fresh game state defaults
                activeHandCount: 1,
                hasSplit: false,
                currentHandIndex: 0,
                result: null,
                payout: '0'
            }));

            // Game is active, but RPC might still verify it as NONE (stale).
            // Poll until we see a valid active phase
            let attempts = 0;
            const checkAndRefresh = async () => {
                const basic = await blackjackGetGameBasic(landId);
                // If we see active state OR we've waited too long, do full refresh
                if ((basic && basic.phase !== BlackjackPhase.NONE) || attempts > 5) {
                    await refreshGameState();
                    refetchBalance();
                } else {
                    attempts++;
                    setTimeout(checkAndRefresh, 1000);
                }
            };
            checkAndRefresh();
        } else {
            // Fallback for unknown state or error
            await refreshGameState();
            refetchBalance();
        }
    }, [refreshGameState, refetchBalance, landId]);

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

                return {
                    ...prev,
                    result: result.gameResult,
                    payout: result.payout || '0',
                    dealerCards: finalDealerCards,
                    dealerValue: finalDealerValue,
                    playerCards: finalPlayerCards,
                    playerValue: finalPlayerValue,
                    isActive: false, // Game ended
                    contractPhase: BlackjackPhase.RESOLVED,
                };
            });

            // Don't call refreshGameState() - it will overwrite our preserved cards
            // with empty data from the cleared contract
            refetchBalance();
            return;
        }

        // Game didn't end (e.g., hit without bust) - refresh to get updated state
        await refreshGameState();
        refetchBalance();
    }, [refreshGameState, refetchBalance]);

    // Handle approval success
    const handleApproveSuccess = useCallback(async () => {
        toast.success('Token approved!');
        if (address && config) {
            const allowance = await checkCasinoApproval(address, config.bettingToken);
            setHasApproval(allowance >= config.maxBet);
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

    // Validate bet and start deal
    const handleDealClick = useCallback(() => {
        const amount = parseFloat(gameState.betAmountInput);
        if (isNaN(amount) || amount <= 0) {
            setError('Please enter a valid bet amount');
            return;
        }
        if (amount > balanceVal) {
            setError('Insufficient balance');
            return;
        }
        if (config) {
            const amountWei = parseUnits(gameState.betAmountInput, 18);
            if (amountWei < config.minBet) {
                setError(`Minimum bet is ${formatUnits(config.minBet, 18)} ${tokenSymbol}`);
                return;
            }
            if (amountWei > config.maxBet) {
                setError(`Maximum bet is ${formatUnits(config.maxBet, 18)} ${tokenSymbol}`);
                return;
            }
        }
        setError(null);
        setTxInProgress('deal');
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
                            />
                            {gameState.hasSplit && gameState.splitCards.length > 0 && (
                                <CardHand
                                    cards={gameState.splitCards}
                                    label="HAND 2"
                                    value={gameState.splitValue}
                                />
                            )}
                        </div>
                    )}

                    {/* Result Display */}
                    {uiPhase === 'result' && gameState.result !== null && (
                        <div className="text-center py-4">
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
                            {parseFloat(gameState.payout) > 0 && (
                                <div className="text-lg text-white mt-2">
                                    Payout: {gameState.payout} {tokenSymbol}
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

                            {!hasApproval && config ? (
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
                                        onButtonClick={() => setTxInProgress(BlackjackAction.HIT)}
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
                                        onButtonClick={() => setTxInProgress(BlackjackAction.STAND)}
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
                                        disabled={false}
                                        buttonText="DOUBLE"
                                        buttonClassName="bg-yellow-600 hover:bg-yellow-700 text-white font-bold py-3 px-6 rounded-lg min-w-[90px] transition-all shadow-lg"
                                        onButtonClick={() => setTxInProgress(BlackjackAction.DOUBLE)}
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
                                            disabled={false}
                                            buttonText="SPLIT"
                                            buttonClassName="bg-purple-600 hover:bg-purple-700 text-white font-bold py-2 px-4 rounded-lg text-sm transition-all"
                                            onButtonClick={() => setTxInProgress(BlackjackAction.SPLIT)}
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
                                            onButtonClick={() => setTxInProgress(BlackjackAction.SURRENDER)}
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
                                            disabled={false}
                                            buttonText="SPLIT"
                                            buttonClassName="bg-purple-600 hover:bg-purple-700 text-white font-bold py-3 px-6 rounded-lg min-w-[90px] transition-all shadow-lg"
                                            onButtonClick={() => setTxInProgress(BlackjackAction.SPLIT)}
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
                                            onButtonClick={() => setTxInProgress(BlackjackAction.SURRENDER)}
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
