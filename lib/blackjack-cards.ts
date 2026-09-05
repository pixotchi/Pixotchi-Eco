/**
 * Get the blackjack value of a card
 */
export function getCardValue(cardValue: number): number {
    const rank = (cardValue % 13) + 1;
    if (rank === 1) return 11; // Ace (may be soft)
    if (rank >= 10) return 10; // 10, J, Q, K
    return rank;
}

/**
 * Calculate optimal hand value (handles soft aces)
 */
export function calculateHandValue(cards: number[]): number {
    let value = 0;
    let aces = 0;

    for (const card of cards) {
        const cardVal = getCardValue(card);
        if (cardVal === 11) aces++;
        value += cardVal;
    }

    // Convert aces from 11 to 1 if busting
    while (value > 21 && aces > 0) {
        value -= 10;
        aces--;
    }

    return value;
}
