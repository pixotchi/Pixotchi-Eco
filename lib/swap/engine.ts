import {
  encodeFunctionData,
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import { getBaseReadClient } from '@/lib/base-rpc';
import { BASESWAP_ROUTER_SWAP_ABI } from './base-swap-abi';
import {
  BASE_CHAIN_ID,
  BASESWAP_ROUTER_ADDRESS,
  BASIS_POINTS,
  MARKET_SLIPPAGE_BPS,
  SEED_TAX_BPS,
  SWAP_TOKEN_MAP,
  WETH_ADDRESS,
  getKyberTokenAddress,
  getTokenAddress,
  isNativeSwapToken,
  isSeedSwapToken,
} from './constants';
import { isAllowedUserSwapPair } from './rules';
import type {
  SwapBuildStepResponse,
  SwapQuoteResponse,
  SwapQuoteStep,
  SwapStepKind,
  SwapStrategy,
  SwapTokenId,
  UserSwapTokenId,
} from './types';

const KYBER_BASE_URL = 'https://aggregator-api.kyberswap.com/base/api/v1';
const KYBER_CLIENT_ID = process.env.KYBERSWAP_CLIENT_ID || 'pixotchi-app';
const KYBER_TIMEOUT_MS = 10_000;
const SWAP_DEADLINE_WINDOW_SECONDS = 60 * 10;

type KyberRouteSegment = {
  exchange?: string;
};

type KyberRouteSummary = {
  amountIn: string;
  amountOut: string;
  route: KyberRouteSegment[][];
};

type KyberRouteResponse = {
  code?: number;
  message?: string;
  data?: {
    routeSummary?: KyberRouteSummary;
    routerAddress?: Address;
  };
};

type KyberBuildResponse = {
  code?: number;
  message?: string;
  data?: {
    amountOut?: string;
    data?: Hex;
    routerAddress?: Address;
    transactionValue?: string;
  };
};

export class SwapBlockedError extends Error {}

type UserQuoteParams = {
  sellToken: UserSwapTokenId;
  buyToken: UserSwapTokenId;
  amountIn: bigint;
  originAddress?: Address;
};

type BuildStepParams = {
  kind: SwapStepKind;
  sellToken: SwapTokenId;
  buyToken: SwapTokenId;
  amountIn: bigint;
  sender: Address;
  recipient: Address;
};

export async function getSwapQuoteForUserPair({
  sellToken,
  buyToken,
  amountIn,
  originAddress,
}: UserQuoteParams): Promise<SwapQuoteResponse> {
  if (amountIn <= BigInt(0)) {
    throw new SwapBlockedError('Enter an amount greater than zero.');
  }

  if (!isAllowedUserSwapPair(sellToken, buyToken)) {
    return createBlockedQuote(
      sellToken,
      buyToken,
      amountIn,
      'That pair is not available in Pixotchi swaps.',
    );
  }

  try {
    const strategy = resolveStrategy(sellToken, buyToken);
    const step = await quoteKyberStep({
      key: 'step1',
      sellToken,
      buyToken,
      amountIn,
      originAddress,
    });

    return {
      strategy,
      sellToken,
      buyToken,
      amountIn: amountIn.toString(),
      expectedOut: step.expectedOut,
      minOut: step.minOut,
      taxBps: step.taxBps,
      marketSlippageBps: MARKET_SLIPPAGE_BPS,
      warnings: [],
      steps: [step],
    };
  } catch (error) {
    if (error instanceof SwapBlockedError) {
      return createBlockedQuote(sellToken, buyToken, amountIn, error.message);
    }

    throw error;
  }
}

export async function buildSwapStep({
  kind,
  sellToken,
  buyToken,
  amountIn,
  sender,
  recipient,
}: BuildStepParams): Promise<SwapBuildStepResponse> {
  if (amountIn <= BigInt(0)) {
    throw new SwapBlockedError('Amount must be greater than zero.');
  }

  const normalizedSender = getAddress(sender);
  const normalizedRecipient = getAddress(recipient);

  if (kind === 'kyber') {
    return buildKyberStep({
      sellToken,
      buyToken,
      amountIn,
      sender: normalizedSender,
      recipient: normalizedRecipient,
    });
  }

  return buildBaseSwapSeedStep({
    sellToken,
    buyToken,
    amountIn,
    recipient: normalizedRecipient,
  });
}

function resolveStrategy(
  sellToken: UserSwapTokenId,
  buyToken: UserSwapTokenId,
): SwapStrategy {
  void sellToken;
  void buyToken;
  return 'single_kyber';
}

function createBlockedQuote(
  sellToken: UserSwapTokenId,
  buyToken: UserSwapTokenId,
  amountIn: bigint,
  blockedReason: string,
): SwapQuoteResponse {
  return {
    strategy: 'blocked',
    sellToken,
    buyToken,
    amountIn: amountIn.toString(),
    expectedOut: '0',
    minOut: '0',
    taxBps: 0,
    marketSlippageBps: MARKET_SLIPPAGE_BPS,
    warnings: [],
    steps: [],
    blockedReason,
  };
}

async function quoteKyberStep({
  key,
  sellToken,
  buyToken,
  amountIn,
  originAddress,
}: {
  key: 'step1' | 'step2';
  sellToken: SwapTokenId;
  buyToken: SwapTokenId;
  amountIn: bigint;
  originAddress?: Address;
}): Promise<SwapQuoteStep> {
  assertKyberStep(sellToken, buyToken);

  const route = await fetchKyberRoute({
    sellToken,
    buyToken,
    amountIn,
    originAddress,
  });
  return createKyberQuoteStep({
    key,
    sellToken,
    buyToken,
    amountIn,
    route,
    originAddress,
  });
}

async function buildKyberStep({
  sellToken,
  buyToken,
  amountIn,
  sender,
  recipient,
}: {
  sellToken: SwapTokenId;
  buyToken: SwapTokenId;
  amountIn: bigint;
  sender: Address;
  recipient: Address;
}): Promise<SwapBuildStepResponse> {
  assertKyberStep(sellToken, buyToken);

  const route = await fetchKyberRoute({
    sellToken,
    buyToken,
    amountIn,
    originAddress: sender,
  });
  const build = await fetchKyberBuild({
    sellToken,
    buyToken,
    routeSummary: route.routeSummary,
    sender,
    recipient,
  });

  if (!build.data?.data || !build.data.routerAddress) {
    throw new Error('Kyber build response did not include executable transaction data.');
  }

  const quotedStep = await createKyberQuoteStep({
    key: 'step1',
    sellToken,
    buyToken,
    amountIn,
    route: {
      routeSummary: {
        ...route.routeSummary,
        amountOut: build.data.amountOut || route.routeSummary.amountOut,
      },
      routerAddress: build.data.routerAddress,
    },
    originAddress: sender,
  });

  return {
    step: {
      ...quotedStep,
      approvalTarget: isNativeSwapToken(sellToken)
        ? undefined
        : build.data.routerAddress,
    },
    approval: isNativeSwapToken(sellToken)
      ? null
      : {
          token: getTokenAddress(sellToken as Exclude<SwapTokenId, 'ETH'>),
          spender: build.data.routerAddress,
          requiredAmount: amountIn.toString(),
        },
    transaction: {
      to: build.data.routerAddress,
      data: build.data.data,
      value: build.data.transactionValue || '0',
      chainId: BASE_CHAIN_ID,
    },
  };
}

async function createKyberQuoteStep({
  key,
  sellToken,
  buyToken,
  amountIn,
  route,
  originAddress,
}: {
  key: 'step1' | 'step2';
  sellToken: SwapTokenId;
  buyToken: SwapTokenId;
  amountIn: bigint;
  route: { routeSummary: KyberRouteSummary; routerAddress: Address };
  originAddress?: Address;
}): Promise<SwapQuoteStep> {
  const routeSources = getKyberRouteSources(route.routeSummary);
  const displayQuote = await getKyberDisplayQuote({
    sellToken,
    buyToken,
    amountIn,
    routeSummary: route.routeSummary,
    originAddress,
  });

  return {
    key,
    kind: 'kyber',
    sellToken,
    buyToken,
    amountIn: amountIn.toString(),
    expectedOut: displayQuote.expectedOut.toString(),
    minOut: displayQuote.minOut.toString(),
    taxBps: displayQuote.taxBps,
    marketSlippageBps: MARKET_SLIPPAGE_BPS,
    routeLabel:
      routeSources.length > 0
        ? `Kyber via ${routeSources.join(' -> ')}`
        : 'Kyber Aggregator',
    routeSources,
    warnings: displayQuote.warnings,
    approvalTarget: isNativeSwapToken(sellToken)
      ? undefined
      : route.routerAddress,
    grossOut: displayQuote.grossOut?.toString(),
    effectiveIn: displayQuote.effectiveIn?.toString(),
  };
}

async function getKyberDisplayQuote({
  sellToken,
  buyToken,
  amountIn,
  routeSummary,
  originAddress,
}: {
  sellToken: SwapTokenId;
  buyToken: SwapTokenId;
  amountIn: bigint;
  routeSummary: KyberRouteSummary;
  originAddress?: Address;
}): Promise<{
  expectedOut: bigint;
  minOut: bigint;
  taxBps: number;
  warnings: string[];
  grossOut?: bigint;
  effectiveIn?: bigint;
}> {
  if (buyToken === 'SEED') {
    const grossOut = BigInt(routeSummary.amountOut);
    const expectedOut = applyDiscountBps(grossOut, SEED_TAX_BPS);
    const minOut = applyDiscountBps(expectedOut, MARKET_SLIPPAGE_BPS);

    return {
      expectedOut,
      minOut,
      taxBps: SEED_TAX_BPS,
      warnings: [
        'SEED applies a 5% transfer tax on output.',
        `Pixotchi builds the router transaction with ${formatBasisPoints(
          getKyberBuildSlippageBps(sellToken, buyToken),
        )} total tolerance so the swap stays 1 transaction.`,
      ],
      grossOut,
    };
  }

  if (sellToken === 'SEED') {
    const effectiveIn = applyDiscountBps(amountIn, SEED_TAX_BPS);
    let expectedOut = applyDiscountBps(BigInt(routeSummary.amountOut), SEED_TAX_BPS);

    if (effectiveIn > BigInt(0)) {
      try {
        const effectiveRoute = await fetchKyberRoute({
          sellToken,
          buyToken,
          amountIn: effectiveIn,
          originAddress,
        });
        expectedOut = BigInt(effectiveRoute.routeSummary.amountOut);
      } catch {
        // Fall back to scaling the raw quote when the display-only requote is unavailable.
      }
    }

    return {
      expectedOut,
      minOut: applyDiscountBps(expectedOut, MARKET_SLIPPAGE_BPS),
      taxBps: SEED_TAX_BPS,
      warnings: [
        'Only 95% of submitted SEED reaches the first pool after tax.',
        `Pixotchi builds the router transaction with ${formatBasisPoints(
          getKyberBuildSlippageBps(sellToken, buyToken),
        )} total tolerance so the swap stays 1 transaction.`,
      ],
      effectiveIn,
    };
  }

  const expectedOut = BigInt(routeSummary.amountOut);
  return {
    expectedOut,
    minOut: applyDiscountBps(expectedOut, MARKET_SLIPPAGE_BPS),
    taxBps: 0,
    warnings: [],
  };
}

async function quoteBaseSwapSeedStep({
  key,
  sellToken,
  buyToken,
  amountIn,
}: {
  key: 'step1' | 'step2';
  sellToken: SwapTokenId;
  buyToken: SwapTokenId;
  amountIn: bigint;
}): Promise<SwapQuoteStep> {
  assertBaseSwapSeedStep(sellToken, buyToken);

  const readClient = getBaseReadClient();

  if (buyToken === 'SEED') {
    const amountsOut = (await readClient.readContract({
      address: BASESWAP_ROUTER_ADDRESS,
      abi: BASESWAP_ROUTER_SWAP_ABI,
      functionName: 'getAmountsOut',
      args: [amountIn, [WETH_ADDRESS, getTokenAddress('SEED')]],
    })) as bigint[];
    const grossOut = amountsOut[1] ?? BigInt(0);

    if (grossOut <= BigInt(0)) {
      throw new SwapBlockedError('No direct BaseSwap liquidity is available for the SEED leg.');
    }

    const expectedOut = applyDiscountBps(grossOut, SEED_TAX_BPS);
    const minOut = applyDiscountBps(expectedOut, MARKET_SLIPPAGE_BPS);

    return {
      key,
      kind: 'baseswap_seed',
      sellToken,
      buyToken,
      amountIn: amountIn.toString(),
      expectedOut: expectedOut.toString(),
      minOut: minOut.toString(),
      taxBps: SEED_TAX_BPS,
      marketSlippageBps: MARKET_SLIPPAGE_BPS,
      routeLabel: 'BaseSwap direct WETH/SEED',
      routeSources: ['BaseSwap'],
      warnings: ['SEED applies a 5% transfer tax on output.'],
      approvalTarget: isNativeSwapToken(sellToken)
        ? undefined
        : BASESWAP_ROUTER_ADDRESS,
      grossOut: grossOut.toString(),
    };
  }

  const effectiveIn = applyDiscountBps(amountIn, SEED_TAX_BPS);
  const amountsOut = (await readClient.readContract({
    address: BASESWAP_ROUTER_ADDRESS,
    abi: BASESWAP_ROUTER_SWAP_ABI,
    functionName: 'getAmountsOut',
    args: [effectiveIn, [getTokenAddress('SEED'), WETH_ADDRESS]],
  })) as bigint[];
  const expectedOut = amountsOut[1] ?? BigInt(0);

  if (expectedOut <= BigInt(0)) {
    throw new SwapBlockedError('No direct BaseSwap liquidity is available for the SEED leg.');
  }

  const minOut = applyDiscountBps(expectedOut, MARKET_SLIPPAGE_BPS);

  return {
    key,
    kind: 'baseswap_seed',
    sellToken,
    buyToken,
    amountIn: amountIn.toString(),
    expectedOut: expectedOut.toString(),
    minOut: minOut.toString(),
    taxBps: SEED_TAX_BPS,
    marketSlippageBps: MARKET_SLIPPAGE_BPS,
    routeLabel: 'BaseSwap direct WETH/SEED',
    routeSources: ['BaseSwap'],
    warnings: ['Only 95% of the submitted SEED reaches the pool after tax.'],
    approvalTarget: BASESWAP_ROUTER_ADDRESS,
    effectiveIn: effectiveIn.toString(),
  };
}

async function buildBaseSwapSeedStep({
  sellToken,
  buyToken,
  amountIn,
  recipient,
}: {
  sellToken: SwapTokenId;
  buyToken: SwapTokenId;
  amountIn: bigint;
  recipient: Address;
}): Promise<SwapBuildStepResponse> {
  const step = await quoteBaseSwapSeedStep({
    key: 'step1',
    sellToken,
    buyToken,
    amountIn,
  });
  const deadline = BigInt(
    Math.floor(Date.now() / 1000) + SWAP_DEADLINE_WINDOW_SECONDS,
  );
  let data: Hex;
  let value = '0';

  if (sellToken === 'ETH' && buyToken === 'SEED') {
    data = encodeFunctionData({
      abi: BASESWAP_ROUTER_SWAP_ABI,
      functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
      args: [
        BigInt(step.minOut),
        [WETH_ADDRESS, getTokenAddress('SEED')],
        recipient,
        deadline,
      ],
    });
    value = amountIn.toString();
  } else if (sellToken === 'SEED' && buyToken === 'ETH') {
    data = encodeFunctionData({
      abi: BASESWAP_ROUTER_SWAP_ABI,
      functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
      args: [
        amountIn,
        BigInt(step.minOut),
        [getTokenAddress('SEED'), WETH_ADDRESS],
        recipient,
        deadline,
      ],
    });
  } else if (sellToken === 'WETH' && buyToken === 'SEED') {
    data = encodeFunctionData({
      abi: BASESWAP_ROUTER_SWAP_ABI,
      functionName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
      args: [
        amountIn,
        BigInt(step.minOut),
        [WETH_ADDRESS, getTokenAddress('SEED')],
        recipient,
        deadline,
      ],
    });
  } else if (sellToken === 'SEED' && buyToken === 'WETH') {
    data = encodeFunctionData({
      abi: BASESWAP_ROUTER_SWAP_ABI,
      functionName: 'swapExactTokensForTokensSupportingFeeOnTransferTokens',
      args: [
        amountIn,
        BigInt(step.minOut),
        [getTokenAddress('SEED'), WETH_ADDRESS],
        recipient,
        deadline,
      ],
    });
  } else {
    throw new SwapBlockedError('Unsupported BaseSwap SEED leg.');
  }

  return {
    step,
    approval:
      isNativeSwapToken(sellToken) || sellToken === 'ETH'
        ? null
        : {
            token: getTokenAddress(sellToken as Exclude<SwapTokenId, 'ETH'>),
            spender: BASESWAP_ROUTER_ADDRESS,
            requiredAmount: amountIn.toString(),
          },
    transaction: {
      to: BASESWAP_ROUTER_ADDRESS,
      data,
      value,
      chainId: BASE_CHAIN_ID,
    },
  };
}

async function fetchKyberRoute({
  sellToken,
  buyToken,
  amountIn,
  originAddress,
}: {
  sellToken: SwapTokenId;
  buyToken: SwapTokenId;
  amountIn: bigint;
  originAddress?: Address;
}): Promise<{ routeSummary: KyberRouteSummary; routerAddress: Address }> {
  const params = new URLSearchParams({
    tokenIn: getKyberTokenAddress(sellToken),
    tokenOut: getKyberTokenAddress(buyToken),
    amountIn: amountIn.toString(),
    excludeRFQSources: 'true',
    onlySinglePath: 'true',
    gasInclude: 'true',
  });

  if (originAddress) {
    params.set('origin', originAddress);
  }

  const response = await fetchWithTimeout<KyberRouteResponse>(
    `${KYBER_BASE_URL}/routes?${params.toString()}`,
    {
      method: 'GET',
      headers: {
        accept: 'application/json',
        'x-client-id': KYBER_CLIENT_ID,
      },
      cache: 'no-store',
    },
  );

  if (!response.data?.routeSummary || !response.data.routerAddress) {
    throw new Error('Kyber route response did not include a route.');
  }

  return {
    routeSummary: response.data.routeSummary,
    routerAddress: response.data.routerAddress,
  };
}

async function fetchKyberBuild({
  sellToken,
  buyToken,
  routeSummary,
  sender,
  recipient,
}: {
  sellToken: SwapTokenId;
  buyToken: SwapTokenId;
  routeSummary: KyberRouteSummary;
  sender: Address;
  recipient: Address;
}): Promise<KyberBuildResponse> {
  return fetchWithTimeout<KyberBuildResponse>(`${KYBER_BASE_URL}/route/build`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'x-client-id': KYBER_CLIENT_ID,
    },
    cache: 'no-store',
    body: JSON.stringify({
      routeSummary,
      sender,
      recipient,
      origin: sender,
      slippageTolerance: getKyberBuildSlippageBps(sellToken, buyToken),
      enableGasEstimation: false,
      source: 'pixotchi-app',
    }),
  });
}

async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    signal: AbortSignal.timeout(KYBER_TIMEOUT_MS),
  });

  const json = (await response.json()) as T & { message?: string };
  if (!response.ok) {
    const message = `${json?.message || 'Swap provider request failed'} (${response.status})`;
    if (response.status === 400 || response.status === 404 || response.status === 422) {
      throw new SwapBlockedError(message);
    }
    throw new Error(message);
  }

  return json;
}

function assertKyberStep(sellToken: SwapTokenId, buyToken: SwapTokenId) {
  if (sellToken === buyToken) {
    throw new SwapBlockedError('Swap legs must use distinct tokens.');
  }
}

function assertBaseSwapSeedStep(sellToken: SwapTokenId, buyToken: SwapTokenId) {
  const isValidPair =
    (sellToken === 'ETH' && buyToken === 'SEED') ||
    (sellToken === 'SEED' && buyToken === 'ETH') ||
    (sellToken === 'WETH' && buyToken === 'SEED') ||
    (sellToken === 'SEED' && buyToken === 'WETH');

  if (!isValidPair) {
    throw new SwapBlockedError('Only direct WETH/SEED BaseSwap legs are supported.');
  }
}

function applyDiscountBps(amount: bigint, bps: number): bigint {
  if (amount <= BigInt(0)) {
    return BigInt(0);
  }

  return (amount * BigInt(BASIS_POINTS - bps)) / BigInt(BASIS_POINTS);
}

function getKyberBuildSlippageBps(
  sellToken: SwapTokenId,
  buyToken: SwapTokenId,
): number {
  if (isSeedSwapToken(sellToken) || isSeedSwapToken(buyToken)) {
    return SEED_TAX_BPS + MARKET_SLIPPAGE_BPS;
  }

  return MARKET_SLIPPAGE_BPS;
}

function formatBasisPoints(bps: number): string {
  return `${(bps / 100).toFixed(2)}%`;
}

function getKyberRouteSources(routeSummary: KyberRouteSummary): string[] {
  const sources = new Set<string>();

  for (const path of routeSummary.route || []) {
    for (const hop of path) {
      if (hop.exchange) {
        sources.add(normalizeSourceName(hop.exchange));
      }
    }
  }

  return Array.from(sources);
}

function normalizeSourceName(source: string): string {
  return source
    .split('/')
    .map((part) =>
      part
        .split('-')
        .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
        .join('-'),
    )
    .join('/');
}

export function getSwapTokenLabel(tokenId: SwapTokenId): string {
  return SWAP_TOKEN_MAP[tokenId].displaySymbol;
}
