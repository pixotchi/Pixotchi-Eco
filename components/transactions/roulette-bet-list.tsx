"use client";

import { Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function RouletteBetList({ bets, limit, locked, onClear, onRemove }: {
  bets: readonly { id: string; label: string; amount: string }[];
  limit: number; locked: boolean; onClear: () => void; onRemove: (id: string) => void;
}) {
  return <section aria-label="Placed roulette bets" className="space-y-2">
    <div className="flex items-center justify-between gap-2">
      <h3 className="text-xs font-semibold text-white/85">Bets {bets.length}/{limit}</h3>
      {bets.length > 0 && <Button type="button" variant="ghost" size="touchCompact" onClick={onClear} disabled={locked}
        className="text-white/80 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-white/10 [@media(hover:hover)_and_(pointer:fine)]:hover:text-white">
        <Trash2 className="h-4 w-4" aria-hidden="true" />Clear bets
      </Button>}
    </div>
    {bets.length === 0 ? <p className="rounded border border-dashed border-white/15 bg-black/20 p-2 text-center text-xs text-white/70">Tap the table to add bets</p>
      : <ul className="max-h-40 space-y-1 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]">
        {bets.map(bet => <li key={bet.id} className="flex min-w-0 items-center gap-2 rounded-md border border-white/15 bg-black/40 pl-2 text-xs">
          <span className="min-w-0 flex-1 break-words font-medium text-white">{bet.label}</span>
          <span className="min-w-0 max-w-[45%] text-right tabular-nums text-white/80 [overflow-wrap:anywhere]">{bet.amount}</span>
          <button type="button" onClick={() => onRemove(bet.id)} disabled={locked} aria-label={`Remove ${bet.label} bet`}
            className="inline-flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-md text-red-200 transition-colors [@media(hover:hover)_and_(pointer:fine)]:hover:bg-red-500/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/70 disabled:opacity-40">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </li>)}
      </ul>}
  </section>;
}
