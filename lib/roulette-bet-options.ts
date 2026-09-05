import { CasinoBetType } from '@/public/abi/casino-abi';

export type RouletteCombination = 'split' | 'street' | 'corner' | 'six-line';
export type RouletteBetOption = { type: CasinoBetType; label: string; numbers: number[] };

/** Separate, labeled choices replace overlapping table-edge hit regions. */
export function getRouletteCombinationOptions(kind: RouletteCombination): RouletteBetOption[] {
  const result: RouletteBetOption[] = [];
  for (let base = 1; base <= 34; base += 3) {
    if (kind === 'street') result.push({ type: CasinoBetType.STREET, label: `Street ${base}–${base + 2}`, numbers: [base, base + 1, base + 2] });
    if (kind === 'six-line' && base < 34) result.push({ type: CasinoBetType.SIX_LINE, label: `6-Line ${base}–${base + 5}`, numbers: Array.from({ length: 6 }, (_, i) => base + i) });
    for (let row = 0; row < 3; row++) {
      const n = base + row;
      if (kind === 'split') {
        if (row < 2) result.push({ type: CasinoBetType.SPLIT, label: `Split ${n}–${n + 1}`, numbers: [n, n + 1] });
        if (base < 34) result.push({ type: CasinoBetType.SPLIT, label: `Split ${n}–${n + 3}`, numbers: [n, n + 3] });
      }
      if (kind === 'corner' && row < 2 && base < 34) {
        const numbers = [n, n + 1, n + 3, n + 4];
        result.push({ type: CasinoBetType.CORNER, label: `Corner ${numbers.join(', ')}`, numbers });
      }
    }
  }
  return result;
}
