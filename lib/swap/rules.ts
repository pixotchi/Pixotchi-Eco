import type { UserSwapTokenId } from './types';

type PairMap = Record<UserSwapTokenId, readonly UserSwapTokenId[]>;

const ALLOWED_TARGETS: PairMap = {
  ETH: ['SEED', 'JESSE', 'PIXOTCHI'],
  USDC: ['SEED', 'JESSE', 'PIXOTCHI'],
  SEED: ['ETH', 'USDC', 'JESSE', 'PIXOTCHI'],
  JESSE: ['ETH', 'USDC', 'SEED', 'PIXOTCHI'],
  PIXOTCHI: ['ETH', 'USDC', 'SEED', 'JESSE'],
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
