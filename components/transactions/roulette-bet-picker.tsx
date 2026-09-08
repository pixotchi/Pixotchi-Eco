"use client";

import { useId, useMemo, useState } from 'react';
import { CasinoBetType } from '@/public/abi/casino-abi';
import { getRouletteCombinationOptions, type RouletteBetOption, type RouletteCombination } from '@/lib/roulette-bet-options';

const TYPES = [ ['straight', 'Single number'], ['split', 'Split — 2 numbers'], ['street', 'Street — 3 numbers'], ['corner', 'Corner — 4 numbers'], ['six-line', 'Six line — 6 numbers'], ['outside', 'Dozens, columns and outside bets'] ] as const;
type PickerType = typeof TYPES[number][0];

function getOptions(type: PickerType): RouletteBetOption[] {
  if (type === 'straight') return Array.from({ length: 37 }, (_, n) => ({ type: CasinoBetType.STRAIGHT, label: `Number ${n}`, numbers: [n] }));
  if (type !== 'outside') return getRouletteCombinationOptions(type as RouletteCombination);
  return [
    ...[1, 2, 3].map(n => ({ type: CasinoBetType.DOZEN, label: `${(n - 1) * 12 + 1}–${n * 12}`, numbers: [n] })),
    ...[1, 2, 3].map(n => ({ type: CasinoBetType.COLUMN, label: `Column ${n}`, numbers: [n] })),
    ...[[CasinoBetType.RED, 'Red'], [CasinoBetType.BLACK, 'Black'], [CasinoBetType.EVEN, 'Even'], [CasinoBetType.ODD, 'Odd'], [CasinoBetType.LOW, '1–18'], [CasinoBetType.HIGH, '19–36']].map(([type, label]) => ({ type: type as CasinoBetType, label: label as string, numbers: [] })),
  ];
}

export function RouletteBetPicker({ disabled, addBet, hasBet, payouts, stakeLabel }: {
  disabled: boolean;
  stakeLabel?: string;
  addBet: (type: CasinoBetType, label: string, numbers: number[]) => void;
  hasBet: (type: CasinoBetType, numbers: number[]) => boolean;
  payouts?: Partial<Record<CasinoBetType, number>>;
}) {
  const id = useId();
  const [type, setType] = useState<PickerType>('straight');
  const options = useMemo(() => getOptions(type), [type]);
  return <section aria-label="Roulette bet picker" className="space-y-2 rounded-lg border border-white/20 bg-gray-950/90 p-3 text-white">
    <label htmlFor={id} className="block text-sm font-semibold">Bet type</label>
    <select id={id} value={type} disabled={disabled} onChange={event => setType(event.target.value as PickerType)} className="min-h-11 w-full rounded-md border border-white/30 bg-gray-950 px-3 text-base text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
      {TYPES.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select>
    {stakeLabel && <p className="text-sm font-medium [overflow-wrap:anywhere]">Stake per choice: {stakeLabel}</p>}
    <p className="text-xs text-white/75">Choose a row to add the current stake. Payout odds show profit; a winning bet also returns its stake.</p>
    <div className="max-h-56 overflow-y-auto overscroll-contain rounded border border-white/15" role="group" aria-label={`${TYPES.find(([value]) => value === type)?.[1]} choices`}>
      {options.map(option => {
        const selected = hasBet(option.type, option.numbers);
        return <button key={`${option.type}:${option.numbers.join(',')}`} type="button" disabled={disabled || selected} aria-pressed={selected} aria-label={`Add ${option.label} bet`} onClick={() => addBet(option.type, option.label, option.numbers)} className="flex min-h-11 w-full items-center justify-between gap-3 border-b border-white/10 px-3 py-2 text-left text-sm last:border-b-0 hover:bg-white/10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white disabled:opacity-60">
          <span>{option.label}</span>
          <span className="shrink-0 text-xs text-white/75">{selected ? 'Added' : payouts?.[option.type] !== undefined ? `Pays ${payouts[option.type]}:1` : 'Choose'}</span>
        </button>;
      })}
    </div>
  </section>;
}
