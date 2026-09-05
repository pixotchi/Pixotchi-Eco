import { BlackjackPhase } from '../public/abi/blackjack-abi';
import { getCardValue } from './blackjack-cards';
import { parseReceiptBlock } from './transaction-utils';
import type { BlackjackGameSnapshot } from './contracts';

/** Validate the read boundary before coercions can turn missing flags into false
 * or malformed cards into an apparently playable hand. */
export function parseBlackjackSnapshot(value: unknown): BlackjackGameSnapshot {
    if (!value || typeof value !== 'object') throw new Error('Invalid Blackjack snapshot');
    const envelope = value as Record<string, unknown>;
    const snapshot = envelope.snapshot ?? value;
    if (!snapshot || typeof snapshot !== 'object') throw new Error('Invalid Blackjack snapshot');
    const raw = snapshot as Record<string, unknown>;
    const field = (name: string, index: number) => Array.isArray(snapshot) ? snapshot[index] : raw[name];
    const flag = (name: string, index: number): boolean => {
        const result = field(name, index);
        if (typeof result !== 'boolean') throw new Error(`Invalid Blackjack ${name}`);
        return result;
    };
    const integer = (name: string, index: number, max: number): number => {
        const result = field(name, index);
        if (typeof result !== 'number' || !Number.isInteger(result) || result < 0 || result > max) throw new Error(`Invalid Blackjack ${name}`);
        return result;
    };
    const cards = (name: string, index: number): number[] => {
        const result = field(name, index);
        if (!Array.isArray(result) || !result.every(isValidCardId)) throw new Error(`Invalid Blackjack ${name}`);
        return result;
    };
    const player = field('player', 1);
    const betAmount = parseReceiptBlock(field('betAmount', 3));
    if (typeof player !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(player) || betAmount === undefined) throw new Error('Invalid Blackjack player or bet');
    return {
        isActive: flag('isActive', 0), player, phase: integer('phase', 2, BlackjackPhase.RESOLVED), betAmount,
        activeHandCount: integer('activeHandCount', 4, 2), hasSplit: flag('hasSplit', 5), actionHandIndex: integer('actionHandIndex', 6, 1),
        hand1Cards: cards('hand1Cards', 7), hand1Value: integer('hand1Value', 8, 255),
        hand2Cards: cards('hand2Cards', 9), hand2Value: integer('hand2Value', 10, 255),
        dealerCards: cards('dealerCards', 11), dealerValue: integer('dealerValue', 12, 255),
        canHit: flag('canHit', 13), canStand: flag('canStand', 14), canDouble: flag('canDouble', 15), canSplit: flag('canSplit', 16), canSurrender: flag('canSurrender', 17),
    };
}

export const deriveInitialPlayerActions = (cards: number[]) => {
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

export const isValidCardId = (value: unknown): value is number =>
    typeof value === 'number' && Number.isInteger(value) && value >= 0 && value < 52;

export const hasTrustedActionState = (snapshot: BlackjackGameSnapshot): boolean => {
    if (!snapshot.isActive || snapshot.phase !== BlackjackPhase.PLAYER_TURN) return false;
    const actionHandIndex = snapshot.actionHandIndex;
    if (actionHandIndex !== 0 && actionHandIndex !== 1) return false;
    if (actionHandIndex === 1 && !snapshot.hasSplit) return false;
    const handCards =
        actionHandIndex === 1
            ? (Array.isArray(snapshot.hand2Cards) ? snapshot.hand2Cards : [])
            : (Array.isArray(snapshot.hand1Cards) ? snapshot.hand1Cards : []);

    if (handCards.length === 0 || !handCards.every(isValidCardId)) return false;

    const hasTwoCards = handCards.length === 2;
    const canSplitByCards =
        hasTwoCards &&
        getCardValue(handCards[0]) === getCardValue(handCards[1]);

    if (snapshot.canDouble && !hasTwoCards) return false;
    if (snapshot.canSplit && (snapshot.hasSplit || actionHandIndex !== 0 || !hasTwoCards || !canSplitByCards)) return false;
    if (snapshot.canSurrender && (snapshot.hasSplit || actionHandIndex !== 0 || !hasTwoCards)) return false;

    return true;
};

export const reconcileTurnCards = (
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
