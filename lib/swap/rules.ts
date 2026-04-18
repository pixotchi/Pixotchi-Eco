import type { UserSwapTokenId } from './types';

export function getAllowedSwapSources(toToken: UserSwapTokenId): UserSwapTokenId[] {
  if (toToken === 'SEED') {
    return ['ETH', 'USDC', 'JESSE', 'PIXOTCHI'];
  }

  if (toToken === 'JESSE') {
    return ['ETH', 'USDC', 'SEED', 'PIXOTCHI'];
  }

  if (toToken === 'PIXOTCHI') {
    return ['ETH', 'USDC', 'SEED', 'JESSE'];
  }

  return ['SEED', 'JESSE', 'PIXOTCHI'];
}

export function getAllowedSwapTargets(fromToken: UserSwapTokenId): UserSwapTokenId[] {
  if (fromToken === 'SEED') {
    return ['ETH', 'USDC', 'JESSE', 'PIXOTCHI'];
  }

  if (fromToken === 'JESSE') {
    return ['ETH', 'USDC', 'SEED', 'PIXOTCHI'];
  }

  if (fromToken === 'PIXOTCHI') {
    return ['ETH', 'USDC', 'SEED', 'JESSE'];
  }

  return ['SEED', 'JESSE', 'PIXOTCHI'];
}

export function isAllowedUserSwapPair(
  fromToken: UserSwapTokenId,
  toToken: UserSwapTokenId,
): boolean {
  if (fromToken === toToken) {
    return false;
  }

  return getAllowedSwapTargets(fromToken).includes(toToken);
}
