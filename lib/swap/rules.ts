import type { UserSwapTokenId } from './types';

type PairMap = Record<UserSwapTokenId, readonly UserSwapTokenId[]>;

const ALLOWED_TARGETS: PairMap = {
  ETH: ['USDC', 'ZORA', 'SEED', 'JESSE', 'PIXOTCHI'],
  USDC: ['ETH', 'ZORA', 'SEED', 'JESSE', 'PIXOTCHI'],
  ZORA: ['ETH', 'USDC', 'SEED', 'JESSE', 'PIXOTCHI'],
  SEED: ['ETH', 'USDC', 'ZORA', 'JESSE', 'PIXOTCHI'],
  JESSE: ['ETH', 'USDC', 'ZORA', 'SEED'],
  PIXOTCHI: ['ETH', 'USDC', 'ZORA', 'SEED'],
};

const ALLOWED_SOURCES: PairMap = (() => {
  const out = {} as Record<UserSwapTokenId, UserSwapTokenId[]>;
  (Object.keys(ALLOWED_TARGETS) as UserSwapTokenId[]).forEach((to) => {
    out[to] = [];
  });
  (Object.keys(ALLOWED_TARGETS) as UserSwapTokenId[]).forEach((from) => {
    for (const to of ALLOWED_TARGETS[from]) {
      out[to].push(from);
    }
  });
  return out as PairMap;
})();

const ALLOWED_PAIR_SET: ReadonlySet<string> = new Set(
  (Object.keys(ALLOWED_TARGETS) as UserSwapTokenId[]).flatMap((from) =>
    ALLOWED_TARGETS[from].map((to) => `${from}>${to}`),
  ),
);

export function getAllowedSwapSources(toToken: UserSwapTokenId): readonly UserSwapTokenId[] {
  return ALLOWED_SOURCES[toToken] ?? [];
}

export function getAllowedSwapTargets(fromToken: UserSwapTokenId): readonly UserSwapTokenId[] {
  return ALLOWED_TARGETS[fromToken] ?? [];
}

export function isAllowedUserSwapPair(
  fromToken: UserSwapTokenId,
  toToken: UserSwapTokenId,
): boolean {
  if (fromToken === toToken) return false;
  return ALLOWED_PAIR_SET.has(`${fromToken}>${toToken}`);
}

/**
 * Normalize the decimal formats supported by the swap amount field without
 * ever passing monetary input through an IEEE-754 number. `null` means the
 * edit is invalid and the controlled input should retain its previous value.
 */
export function sanitizeSwapDecimalInput(raw: string): string | null {
  const value = raw.trim();
  if (value === '') return '';

  // Plain integers and dot decimals are already canonical. Keeping trailing
  // dots allows natural incremental input such as "1." followed by "5".
  if (/^\d*(?:\.\d*)?$/.test(value)) {
    return value;
  }

  // A single comma with no dot is a locale decimal separator, matching the
  // field's established behaviour ("1,25" -> "1.25").
  if (/^\d*,\d*$/.test(value)) {
    return value.replace(',', '.');
  }

  // Commas are accepted as thousands separators only when every group is
  // complete. This prevents malformed input from being silently reinterpreted.
  if (/^\d{1,3}(?:,\d{3})+(?:\.\d*)?$/.test(value)) {
    return value.replace(/,/g, '');
  }

  // Reject exponent notation, signs, extra separators, and arbitrary text.
  // parseUnits receives only the exact decimal digits the user entered.
  return null;
}
