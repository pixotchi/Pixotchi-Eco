import { formatUnits } from 'viem';
import { BlackjackPhase, BlackjackResult } from '@/lib/contracts';
import type { PlayingCardValue } from '@/components/ui/PlayingCard';

export const getResultText = (result: BlackjackResult): string => ({
    [BlackjackResult.NONE]: '', [BlackjackResult.PLAYER_WIN]: 'You won',
    [BlackjackResult.PLAYER_BLACKJACK]: 'Natural Blackjack', [BlackjackResult.DEALER_WIN]: 'You lost',
    [BlackjackResult.DEALER_BLACKJACK]: 'Dealer Blackjack', [BlackjackResult.PUSH]: 'Bet returned',
    [BlackjackResult.PLAYER_BUST]: 'You went over 21', [BlackjackResult.SURRENDERED]: 'Hand surrendered',
}[result] ?? '');


/**
 * Simplified UI phase model for server-signed randomness flow
 * No more commit-reveal phases!
 */
export type DialogPhase =
    | 'loading'    // Initial load
    | 'betting'    // Ready to place bet (will deal immediately)
    | 'playing'    // Taking actions (immediate results)
    | 'result';    // Game complete

export interface GameState {
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

export const initialGameState: GameState = {
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

export const getResultColorClass = (result: BlackjackResult): string => {
    if (WIN_RESULTS.has(result)) return 'text-green-300';
    if (LOSS_RESULTS.has(result)) return 'text-red-300';
    return 'text-yellow-300';
};


export function getBlackjackResultPresentation(gameState: GameState, uiPhase: DialogPhase, tokenDecimals: number | undefined, tokenSymbol: string) {
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
    return { resolvedPayout, netResultWei, roundResultLabel, blackjackResultAnnouncement };
}
