"use client";
import styles from "./playing-card.module.css";

import type { CSSProperties } from 'react';
export { calculateHandValue, getCardValue } from '@/lib/blackjack-cards';

/** null is an unknown card, never a real Ace (card 0). */
export type PlayingCardValue = number | null;
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];
const SUITS = ['♠', '♥', '♦', '♣'];
const RANK_NAMES: Record<string, string> = { A: 'Ace', J: 'Jack', Q: 'Queen', K: 'King' };
const SUIT_NAMES = ['spades', 'hearts', 'diamonds', 'clubs'];

export default function PlayingCard({ value, hidden = false, small = false, className = '', ariaLabel }: {
    value: PlayingCardValue;
    hidden?: boolean;
    small?: boolean;
    className?: string;
    ariaLabel?: string;
}) {
    const unknown = value === null || !Number.isInteger(value) || value < 0 || value >= 52;
    const size = small ? 'h-[4.5rem] w-12' : 'h-[5.5rem] w-[3.625rem]';
    if (hidden || unknown) return <div role="img" aria-label={ariaLabel ?? (hidden ? 'Face-down card' : 'Card unavailable')}
        data-card-state={hidden ? 'hidden' : 'unknown'}
        className={`${size} relative shrink-0 overflow-hidden rounded border border-white/25 bg-slate-800 bg-cover bg-center shadow-sm ${className}`}
        style={{ backgroundImage: "url('/icons/cardbj.png')" }} />;
    const rank = RANKS[value % 13];
    const suitIndex = Math.floor(value / 13);
    const suit = SUITS[suitIndex];
    const ink = suitIndex === 1 || suitIndex === 2 ? 'text-red-700' : 'text-slate-950';
    return <div role="img" aria-label={ariaLabel ?? `${RANK_NAMES[rank] ?? rank} of ${SUIT_NAMES[suitIndex]}`}
        data-card-state="known"
        className={`${size} relative shrink-0 overflow-hidden rounded border border-white/30 bg-white bg-cover bg-center shadow-sm ${ink} ${className}`}
        style={{ backgroundImage: "url('/icons/cardbjfront.png')" }}>
        <span aria-hidden="true" className="absolute left-1 top-1 flex flex-col items-center text-sm font-bold leading-3.5"><span>{rank}</span><span>{suit}</span></span>
        <span aria-hidden="true" className="absolute inset-0 flex items-center justify-center text-2xl">{suit}</span>
        <span aria-hidden="true" className="absolute bottom-1 right-1 flex rotate-180 flex-col items-center text-sm font-bold leading-3.5"><span>{rank}</span><span>{suit}</span></span>
    </div>;
}

/** Every index remains visible to touch users; long hands wrap inside their panel. */
export function CardHand({ cards, label, value, hideHoleCard = false, small = false, active = false, statusText, statusClassName, dealId, className = "" }: {
    cards: readonly PlayingCardValue[];
    label: string;
    value?: number;
    hideHoleCard?: boolean;
    small?: boolean;
    active?: boolean;
    statusText?: string;
    statusClassName?: string;
    dealId?: string | number;
    className?: string;
}) {
    return <div role="group" aria-label={label} data-active-hand={active || undefined}
        className={`flex min-w-0 flex-col items-center gap-3 rounded-[var(--radius-control)] border p-3 ${active ? 'border-amber-300/70 bg-amber-950/35' : 'border-white/15 bg-black/25'} ${className}`} >
        <div className="flex min-h-5 flex-wrap items-center justify-center gap-2 text-sm font-semibold text-white/85">
            <span>{label}</span>{active && <span className="rounded bg-amber-200 px-1.5 py-0.5 text-xs text-amber-950">Your turn</span>}
        </div>
        <div role="list" aria-label={`${label} cards`} className="flex w-full flex-wrap items-start justify-center gap-2 [perspective:800px]">
            {cards.map((card, index) => <div key={`${dealId ?? 'hand'}-${card ?? 'unknown'}-${index}`} role="listitem"
                className={`${styles.deal} shrink-0`} style={{ animationDelay: `${Math.min(index, 5) * 40}ms` } as CSSProperties}>
                <PlayingCard value={card} hidden={hideHoleCard && index === 1} small={small}
                    ariaLabel={hideHoleCard && index === 1 ? `${label} face-down card` : card === null ? `${label} card unavailable` : undefined} />
            </div>)}
        </div>
        {cards.some(card => card === null) && !hideHoleCard && <p className="text-center text-xs text-white/75">Some card details are unavailable.</p>}
        {value !== undefined && !hideHoleCard && <div className="flex flex-col items-center gap-1">
            <span className={`text-lg font-semibold ${value > 21 ? 'text-red-200' : 'text-white'}`}>{value > 21 ? `Bust · ${value}` : value}</span>
            {statusText && <span className={`text-sm font-medium ${statusClassName || 'text-white/85'}`}>{statusText}</span>}
        </div>}
    </div>;
}
