"use client";

import { useId, useMemo, useState } from 'react';
import { getRouletteCombinationOptions, type RouletteBetOption, type RouletteCombination } from '@/lib/roulette-bet-options';

export function RouletteCombinationPicker({ disabled, onSelect }: { disabled: boolean; onSelect: (option: RouletteBetOption) => void }) {
  const [kind, setKind] = useState<RouletteCombination>('split');
  const id = useId();
  const options = useMemo(() => getRouletteCombinationOptions(kind), [kind]);
  return (
    <details className="rounded-[var(--radius-control)] border border-white/20 bg-black/25 text-white">
      <summary className="min-h-11 cursor-pointer px-3 py-3 text-sm font-semibold focus-visible:outline-2 focus-visible:outline-white">Combination bets</summary>
      <div className="space-y-3 px-3 pb-3">
        <label htmlFor={id} className="block text-sm">Bet type</label>
        <select id={id} value={kind} onChange={e => setKind(e.target.value as RouletteCombination)} disabled={disabled} className="h-11 w-full rounded-lg border border-white/30 bg-slate-950 px-3 text-base text-white focus-visible:outline-2 focus-visible:outline-white">
          <option value="split">Split · 2 numbers</option>
          <option value="street">Street · 3 numbers</option>
          <option value="corner">Corner · 4 numbers</option>
          <option value="six-line">Six line · 6 numbers</option>
        </select>
        <div className="grid max-h-64 grid-cols-2 gap-2 overflow-y-auto p-1" role="group" aria-label={`${kind} bet choices`}>
          {options.map(option => <button key={option.numbers.join('-')} type="button" disabled={disabled} onClick={() => onSelect(option)} className="min-h-11 rounded-lg border border-white/25 bg-white/10 px-2 py-2 text-sm hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-white disabled:opacity-50">{option.label}</button>)}
        </div>
      </div>
    </details>
  );
}
