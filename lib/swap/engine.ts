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
  INTERNAL_INTERMEDIATE_TOKEN,
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
    if (strategy === 'single_kyber') {
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
        taxBps: 0,
        marketSlippageBps: MARKET_SLIPPAGE_BPS,
        warnings: [],
        steps: [step],
      };
    }

    if (strategy === 'single_baseswap_seed') {
      const step = await quoteBaseSwapSeedStep({
        key: 'step1',
        sellToken,
        buyToken,
        amountIn,
      });

      return {
        strategy,
        sellToken,
        buyToken,
        amountIn: amountIn.toString(),
        expectedOut: step.expectedOut,
        minOut: step.minOut,
        taxBps: SEED_TAX_BPS,
        marketSlippageBps: MARKET_SLIPPAGE_BPS,
        warnings: ['SEED executes directly against the BaseSwap WETH/SEED pool.'],
        steps: [step],
      };
    }

    const steps =
      buyToken === 'SEED'
        ? await quoteBuySeedCompositeSteps({
            sellToken,
            buyToken,
            amountIn,
            originAddress,
          })
        : await quoteSellSeedCompositeSteps({
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
      expectedOut: steps[1].expectedOut,
      minOut: steps[1].minOut,
      taxBps: SEED_TAX_BPS,
      marketSlippageBps: MARKET_SLIPPAGE_BPS,
      warnings: [
        'This route executes in 2 swap transactions.',
        'The SEED leg always runs on the BaseSwap WETH/SEED pool.',
        'Step 2 requotes from the actual WETH received after step 1.',
      ],
      steps,
      intermediateToken: INTERNAL_INTERMEDIATE_TOKEN,
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
  if (sellToken === 'SEED' && buyToken === 'ETH') {
    return 'single_baseswap_seed';
  }

  if (sellToken === 'ETH' && buyToken === 'SEED') {
    return 'single_baseswap_seed';
  }

  if (sellToken === 'SEED' || buyToken === 'SEED') {
    return 'two_step_via_weth';
  }

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

async function quoteBuySeedCompositeSteps({
  sellToken,
  buyToken,
  amountIn,
  originAddress,
}: UserQuoteParams): Promise<[SwapQuoteStep, SwapQuoteStep]> {
  const firstStep = await quoteKyberStep({
    key: 'step1',
    sellToken,
    buyToken: 'WETH',
    amountIn,
    originAddress,
  });
  const secondStep = await quoteBaseSwapSeedStep({
    key: 'step2',
    sellToken: 'WETH',
    buyToken,
    amountIn: BigInt(firstStep.expectedOut),
  });

  return [firstStep, secondStep];
}

async function quoteSellSeedCompositeSteps({
  sellToken,
  buyToken,
  amountIn,
  originAddress,
}: UserQuoteParams): Promise<[SwapQuoteStep, SwapQuoteStep]> {
  const firstStep = await quoteBaseSwapSeedStep({
    key: 'step1',
    sellToken,
    buyToken: 'WETH',
    amountIn,
  });
  const secondStep = await quoteKyberStep({
    key: 'step2',
    sellToken: 'WETH',
    buyToken,
    amountIn: BigInt(firstStep.expectedOut),
    originAddress,
  });

  return [firstStep, secondStep];
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
  const expectedOut = BigInt(route.routeSummary.amountOut);
  const minOut = applyDiscountBps(expectedOut, MARKET_SLIPPAGE_BPS);
  const routeSources = getKyberRouteSources(route.routeSummary);

  return {
    key,
    kind: 'kyber',
    sellToken,
    buyToken,
    amountIn: amountIn.toString(),
    expectedOut: expectedOut.toString(),
    minOut: minOut.toString(),
    taxBps: 0,
    marketSlippageBps: MARKET_SLIPPAGE_BPS,
    routeLabel:
      routeSources.length > 0
        ? `Kyber via ${routeSources.join(' -> ')}`
        : 'Kyber Aggregator',
    routeSources,
    warnings: [],
    approvalTarget: isNativeSwapToken(sellToken)
      ? undefined
      : route.routerAddress,
  };
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
    routeSummary: route.routeSummary,
    sender,
    recipient,
  });

  if (!build.data?.data || !build.data.routerAddress) {
    throw new Error('Kyber build response did not include executable transaction data.');
  }

  const routeSources = getKyberRouteSources(route.routeSummary);
  const amountOut = BigInt(build.data.amountOut || route.routeSummary.amountOut);
  const minOut = applyDiscountBps(amountOut, MARKET_SLIPPAGE_BPS);

  return {
    step: {
      key: 'step1',
      kind: 'kyber',
      sellToken,
      buyToken,
      amountIn: amountIn.toString(),
      expectedOut: amountOut.toString(),
      minOut: minOut.toString(),
      taxBps: 0,
      marketSlippageBps: MARKET_SLIPPAGE_BPS,
      routeLabel:
        routeSources.length > 0
          ? `Kyber via ${routeSources.join(' -> ')}`
          : 'Kyber Aggregator',
      routeSources,
      warnings: [],
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
  routeSummary,
  sender,
  recipient,
}: {
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
      slippageTolerance: MARKET_SLIPPAGE_BPS,
      enableGasEstimation: true,
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

  if (isSeedSwapToken(sellToken) || isSeedSwapToken(buyToken)) {
    throw new SwapBlockedError('Kyber cannot execute SEED legs in this swap flow.');
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
