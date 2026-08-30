"use client";

import React from 'react';

interface PlayingCardProps {
    /** Card value 0-51 (suit*13 + rank) */
    value: number;
    /** Whether to show the back of the card */
    hidden?: boolean;
    /** Small card variant */
    small?: boolean;
    /** Additional CSS classes */
    className?: string;
    /** Optional contextual accessible name (for example, "Dealer face-down card"). */
    ariaLabel?: string;
}

// Card display mappings
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const SUIT_COLORS: Record<string, 'red' | 'black'> = {
    '♠': 'black',
    '♥': 'red',
    '♦': 'red',
    '♣': 'black'
};
const RANK_NAMES: Record<string, string> = {
    A: 'Ace',
    J: 'Jack',
    Q: 'Queen',
    K: 'King',
};
const SUIT_NAMES: Record<string, string> = {
    '♠': 'spades',
    '♥': 'hearts',
    '♦': 'diamonds',
    '♣': 'clubs',
};

/**
 * Get card display info from a 0-51 card value
 */
function getCardDisplay(value: number) {
    const rank = RANKS[value % 13];
    const suit = SUITS[Math.floor(value / 13)];
    const color = SUIT_COLORS[suit];
    return { rank, suit, color };
}

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

/**
 * PlayingCard component - displays a playing card with rank and suit
 */
export default function PlayingCard({ value, hidden = false, small = false, className = '', ariaLabel }: PlayingCardProps) {
    // Original: 424x646 (Aspect Ratio: ~0.656)
    // Small: h-14 (56px) -> w-[36.7px]
    // Normal: h-24 (96px) -> w-[63px] (Increased size slightly for better visibility)

    // We'll use arbitrary values to match the exact aspect ratio
    const sizeClasses = small
        ? 'w-[37px] h-[56px] text-sm'
        : 'w-[63px] h-[96px] text-xl';

    if (hidden) {
        return (
            <div
                role="img"
                aria-label={ariaLabel ?? "Face-down card"}
                className={`${sizeClasses} rounded-[3px] border-2 border-white/10
                    relative overflow-hidden shadow-lg ${className}`}
            >
                {/* Use the custom card back image */}
                <div
                    className="absolute inset-0 bg-cover bg-center bg-no-repeat"
                    style={{ backgroundImage: "url('/icons/cardbj.png')" }}
                />
            </div>
        );
    }

    const { rank, suit, color } = getCardDisplay(value);
    const cardName = `${RANK_NAMES[rank] ?? rank} of ${SUIT_NAMES[suit]}`;

    return (
        <div
            role="img"
            aria-label={ariaLabel ?? cardName}
            className={`${sizeClasses} rounded-[3px] border-2 border-white/10
                  flex flex-col items-center justify-center shadow-lg bg-cover bg-center bg-no-repeat ${className}`}
            style={{ backgroundImage: "url('/icons/cardbjfront.png')" }}
        >
            <span aria-hidden="true" className={`font-bold ${color === 'red' ? 'text-red-600' : 'text-gray-900'}`}>
                {rank}
            </span>
            <span aria-hidden="true" className={`text-2xl ${color === 'red' ? 'text-red-600' : 'text-gray-900'}`}>
                {suit}
            </span>
        </div>
    );
}

/**
 * CardHand component - displays a hand of cards with staggered dealing animation
 */
export function CardHand({
    cards,
    label,
    value,
    hideHoleCard = false,
    small = false,
    statusText,
    statusClassName,
    dealId
}: {
    cards: number[];
    label: string;
    value?: number;
    hideHoleCard?: boolean;
    small?: boolean;
    statusText?: string;
    statusClassName?: string;
    /**
     * Bump per deal/round: the key used to be `value-index` alone, so a new
     * round dealing the same rank at the same position reconciled onto the old
     * DOM node and the deal animation silently skipped.
     */
    dealId?: string | number;
}) {
    return (
        <div
            className="flex min-w-0 flex-col items-center gap-2 rounded-[var(--radius-control)] border border-white/10 bg-black/25 px-3 py-3 shadow-[var(--shadow-hairline)]"
            role="group"
            aria-label={label}
        >
            <span className="text-xs font-semibold tracking-normal text-white/75">{label}</span>
            {/* perspective makes the deal's rotateY an actual 3D flip — with no
                perspective ancestor it rendered as a flat orthographic squash. */}
            <div
                className={`flex ${small ? '-space-x-4' : '-space-x-6'} pl-2 [perspective:800px]`}
                role="list"
                aria-label={`${label} cards`}
            >
                {cards.map((card, index) => (
                    <div
                        key={`${dealId ?? 'hand'}-${card}-${index}`}
                        role="listitem"
                        /* Base z on a CSS var so hover:z can actually win — the old
                           inline zIndex outranked hover:z-10 and lifted cards
                           stayed buried under their right-hand neighbour. */
                        className="animate-deal-card relative z-[var(--card-z)] transition-transform duration-[var(--motion-quick)] ease-[var(--ease-standard)] [@media(hover:hover)_and_(pointer:fine)]:hover:z-50 [@media(hover:hover)_and_(pointer:fine)]:hover:-translate-y-4"
                        style={{
                            animationDelay: `${index * 50}ms`,
                            '--card-z': index, // newer cards stack on top, left to right
                        } as React.CSSProperties}
                    >
                        <PlayingCard
                            value={card}
                            hidden={hideHoleCard && index === 1}
                            ariaLabel={hideHoleCard && index === 1 ? `${label} face-down card` : undefined}
                            small={small}
                            className="shadow-2xl"
                        />
                    </div>
                ))}
            </div>
            <div>
                {value !== undefined && !hideHoleCard && (
                    <div className="flex flex-col items-center gap-0.5">
                        <span className={`text-lg font-semibold transition-colors duration-[var(--motion-standard)] ${value > 21 ? 'text-red-400' : 'text-white'}`}>
                            {value > 21 ? 'BUST!' : value}
                        </span>
                        {statusText && (
                            <span className={`text-xs font-semibold ${statusClassName || 'text-white/80'}`}>
                                {statusText}
                            </span>
                        )}
                    </div>
                )}
            </div>
        </div>
    );
}
