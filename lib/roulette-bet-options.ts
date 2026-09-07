import { CasinoBetType } from '@/public/abi/casino-abi';

export type RouletteCombination = 'split' | 'street' | 'corner' | 'six-line';
export type RouletteBetOption = { type: CasinoBetType; label: string; numbers: number[] };

/** Canonical combinations supported by the betting table. */
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

export type RouletteTableTarget = RouletteBetOption & {
  anchor: number;
  position: 'right' | 'bottom' | 'corner' | 'top' | 'top-corner';
};

/** Anchor each combination once, in the table's 3/2/1 row orientation. */
export function getRouletteTableTargets(): RouletteTableTarget[] {
  return (['split', 'street', 'corner', 'six-line'] as const).flatMap(kind =>
    getRouletteCombinationOptions(kind).map(option => {
      const [first, second] = option.numbers;
      switch (kind) {
        case 'split':
          return { ...option, anchor: second - first === 1 ? second : first, position: second - first === 1 ? 'bottom' as const : 'right' as const };
        case 'street':
          return { ...option, anchor: first + 2, position: 'top' as const };
        case 'corner':
          return { ...option, anchor: first + 1, position: 'corner' as const };
        case 'six-line':
          return { ...option, anchor: first + 2, position: 'top-corner' as const };
      }
    }),
  );
}
