import { getAddress, type Address } from 'viem';
import type { SwapTokenDefinition, SwapTokenId, UserSwapTokenId } from './types';

export const BASE_CHAIN_ID = 8453;
export const BASIS_POINTS = 10_000;
// Fixed 5% SEED transfer tax (protocol-level, not tunable).
export const SEED_TAX_BPS = 500;
// Fixed 0.75% market slippage — not user-adjustable. Picked at the upper
// end of the comfort range so routine pool movement doesn't revert swaps.
// SEED pairs get SEED_TAX_BPS added on top inside the engine.
export const MARKET_SLIPPAGE_BPS = 75;
export const MAX_APPROVAL_AMOUNT =
  (BigInt(2) ** BigInt(256)) - BigInt(1);
export const TOKEN_APPROVAL_THRESHOLD = BigInt(0);
export const SWAP_DEADLINE_WINDOW_SECONDS = 180;
export const SWAP_QUOTE_TTL_MS = 60_000;
export const SWAP_QUOTE_MAX_AGE_MS = 30_000;

export const KYBER_NATIVE_TOKEN_ADDRESS =
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as Address;
export const BASESWAP_ROUTER_ADDRESS =
  '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86' as Address;
export const WETH_ADDRESS =
  '0x4200000000000000000000000000000000000006' as Address;
export const SEED_ADDRESS =
  '0x546D239032b24eCEEE0cb05c92FC39090846adc7' as Address;
export const USDC_ADDRESS =
  '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address;
export const ZORA_ADDRESS =
  '0x1111111111166b7FE7bd91427724B487980aFc69' as Address;
export const JESSE_ADDRESS =
  '0x50f88fe97f72cd3e75b9eb4f747f59bceba80d59' as Address;
export const PIXOTCHI_ADDRESS =
  '0xa2ef17bb7eea1143196678337069dfa24d37d2ac' as Address;

export const SWAP_TOKEN_MAP: Record<SwapTokenId, SwapTokenDefinition> = {
  ETH: {
    id: 'ETH',
    symbol: 'ETH',
    displaySymbol: 'ETH',
    name: 'ETH',
    decimals: 18,
    chainId: BASE_CHAIN_ID,
    address: null,
    image: '/icons/ethlogo.svg',
    isNative: true,
  },
  WETH: {
    id: 'WETH',
    symbol: 'WETH',
    displaySymbol: 'WETH',
    name: 'Wrapped ETH',
    decimals: 18,
    chainId: BASE_CHAIN_ID,
    address: WETH_ADDRESS,
    image: '/icons/ethlogo.svg',
    isInternal: true,
  },
  USDC: {
    id: 'USDC',
    symbol: 'USDC',
    displaySymbol: 'USDC',
    name: 'USDC',
    decimals: 6,
    chainId: BASE_CHAIN_ID,
    address: USDC_ADDRESS,
    image: '/icons/usdc.png',
  },
  ZORA: {
    id: 'ZORA',
    symbol: 'ZORA',
    displaySymbol: 'ZORA',
    name: 'ZORA',
    decimals: 18,
    chainId: BASE_CHAIN_ID,
    address: ZORA_ADDRESS,
    image: '/icons/zora.png',
  },
  SEED: {
    id: 'SEED',
    symbol: 'SEED',
    displaySymbol: 'SEED',
    name: 'SEED',
    decimals: 18,
    chainId: BASE_CHAIN_ID,
    address: SEED_ADDRESS,
    image: '/PixotchiKit/COIN.svg',
  },
  JESSE: {
    id: 'JESSE',
    symbol: 'JESSE',
    displaySymbol: 'JESSE',
    name: 'JESSE',
    decimals: 18,
    chainId: BASE_CHAIN_ID,
    address: JESSE_ADDRESS,
    image: '/icons/jessetoken.png',
  },
  PIXOTCHI: {
    id: 'PIXOTCHI',
    symbol: 'PIXOTCHI',
    displaySymbol: 'PIXOTCHI',
    name: 'PIXOTCHI',
    decimals: 18,
    chainId: BASE_CHAIN_ID,
    address: PIXOTCHI_ADDRESS,
    image: '/icons/cc.png',
  },
};

export const USER_SWAP_TOKEN_IDS = [
  'ETH',
  'USDC',
  'ZORA',
  'SEED',
  'JESSE',
  'PIXOTCHI',
] as const satisfies readonly UserSwapTokenId[];

export const INTERNAL_INTERMEDIATE_TOKEN: SwapTokenId = 'WETH';

export function isSwapTokenId(value: string): value is SwapTokenId {
  return value in SWAP_TOKEN_MAP;
}

export function isUserSwapTokenId(value: string): value is UserSwapTokenId {
  return USER_SWAP_TOKEN_IDS.includes(value as UserSwapTokenId);
}

export function isNativeSwapToken(tokenId: SwapTokenId): boolean {
  return SWAP_TOKEN_MAP[tokenId].isNative === true;
}

export function isSeedSwapToken(tokenId: SwapTokenId): boolean {
  return tokenId === 'SEED';
}

export function getSwapToken(tokenId: SwapTokenId): SwapTokenDefinition {
  return SWAP_TOKEN_MAP[tokenId];
}

export function getTokenAddress(tokenId: Exclude<SwapTokenId, 'ETH'>): Address {
  const token = SWAP_TOKEN_MAP[tokenId];
  if (!token.address) {
    throw new Error(`Token ${tokenId} does not have a contract address`);
  }
  return token.address;
}

export function getKyberTokenAddress(tokenId: SwapTokenId): Address {
  if (tokenId === 'ETH') {
    return KYBER_NATIVE_TOKEN_ADDRESS;
  }

  return getTokenAddress(tokenId);
}

// Known KyberSwap MetaAggregationRouter deployments on Base.
// Server rejects any build response whose routerAddress is not in this set,
// preventing a compromised or spoofed aggregator response from directing
// user approvals / value to an arbitrary contract.
const KYBER_ROUTER_ALLOWLIST_RAW: readonly Address[] = [
  '0x6131B5fae19EA4f9D964eAc0408E4408b66337b5',
];

export const KYBER_ROUTER_ALLOWLIST: ReadonlySet<string> = new Set(
  KYBER_ROUTER_ALLOWLIST_RAW.map((address) => getAddress(address)),
);

export function isAllowedSwapRouter(address: string): boolean {
  try {
    return KYBER_ROUTER_ALLOWLIST.has(getAddress(address));
  } catch {
    return false;
  }
}
