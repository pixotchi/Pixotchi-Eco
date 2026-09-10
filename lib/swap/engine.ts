import {
  getAddress,
  type Address,
  type Hex,
} from 'viem';
import {
  BASE_CHAIN_ID,
  BASIS_POINTS,
  MARKET_SLIPPAGE_BPS,
  SEED_TAX_BPS,
  SWAP_DEADLINE_WINDOW_SECONDS,
  SWAP_TOKEN_MAP,
  getKyberTokenAddress,
  getTokenAddress,
  isAllowedSwapRouter,
  isNativeSwapToken,
} from './constants';
import { isAllowedUserSwapPair } from './rules';
import { validateSwapExecution } from './calldata';
import { SwapBuildInvalidError, SwapReviewRequiredError } from './errors';
import { getProtectedBuildSlippageBps, requiredSwapMinimum } from './policy';
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
export class SwapTransientError extends Error {}
export class SwapTimeoutError extends Error {}

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
  reviewedMinOut: bigint;
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
    throw new SwapBlockedError('Amount must be greater than zero.');
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
    const strategy: SwapStrategy = 'single_kyber';
    const step = await quoteKyberStep({
      key: 'step1',
      sellToken,
      buyToken,
      amountIn,
      originAddress,
    });
    if (BigInt(step.minOut) <= BigInt(0)) throw new SwapBlockedError('This amount is too small for a protected swap.');

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
  reviewedMinOut,
  sender,
  recipient,
}: BuildStepParams): Promise<SwapBuildStepResponse> {
  if (amountIn <= BigInt(0)) {
    throw new SwapBlockedError('Amount must be greater than zero.');
  }

  const normalizedSender = getAddress(sender);
  const normalizedRecipient = getAddress(recipient);

  if (kind !== 'kyber') throw new SwapBlockedError('Only a single Kyber swap is supported.');
  return buildKyberStep({
      sellToken,
      buyToken,
      amountIn,
      reviewedMinOut,
      sender: normalizedSender,
      recipient: normalizedRecipient,
  });
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

  if (!isAllowedSwapRouter(route.routerAddress)) {
    throw new SwapBlockedError(
      'Swap router is not on the approved list. Please refresh and try again.',
    );
  }

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
  reviewedMinOut,
  sender,
  recipient,
}: {
  sellToken: SwapTokenId;
  buyToken: SwapTokenId;
  amountIn: bigint;
  reviewedMinOut: bigint;
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

  if (!isAllowedSwapRouter(route.routerAddress)) {
    throw new SwapBlockedError(
      'Swap router is not on the approved list. Please refresh and try again.',
    );
  }

  const freshStep = await createKyberQuoteStep({ key: 'step1', sellToken, buyToken, amountIn, route, originAddress: sender });
  let minimum = requiredSwapMinimum(reviewedMinOut, BigInt(freshStep.minOut));
  if (BigInt(freshStep.expectedOut) < minimum) throw new SwapReviewRequiredError();
  let tolerance = getProtectedBuildSlippageBps(BigInt(route.routeSummary.amountOut), minimum);

  // A provider build can round amountOut differently from its route preview.
  // Permit one stricter rebuild; no attempt may weaken the reviewed floor.
  for (let attempt = 0; attempt < 2; attempt++) {
    const build = await fetchKyberBuild({ routeSummary: route.routeSummary, sender, recipient, slippageTolerance: tolerance });

    if (!build.data?.data || !build.data.routerAddress) {
      throw new SwapBuildInvalidError();
    }

    if (!isAllowedSwapRouter(build.data.routerAddress)) {
      throw new SwapBlockedError(
        'Swap router returned by the aggregator is not on the approved list.',
      );
    }

    const builtRouter = getAddress(build.data.routerAddress);

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
        routerAddress: builtRouter,
      },
      originAddress: sender,
    });

    minimum = requiredSwapMinimum(minimum, BigInt(quotedStep.minOut));
    if (BigInt(quotedStep.expectedOut) < minimum) throw new SwapReviewRequiredError();
    const response: SwapBuildStepResponse = {
      step: {
        ...quotedStep,
        minOut: minimum.toString(),
        approvalTarget: isNativeSwapToken(sellToken) ? undefined : builtRouter,
      },
      approval: isNativeSwapToken(sellToken)
        ? null
        : {
            token: getTokenAddress(sellToken as Exclude<SwapTokenId, 'ETH'>),
            spender: builtRouter,
            requiredAmount: amountIn.toString(),
          },
      transaction: {
        to: builtRouter,
        data: build.data.data,
        value: build.data.transactionValue || '0',
        chainId: BASE_CHAIN_ID,
      },
    };
    try {
      const enforced = validateSwapExecution(response, { sender, recipient, sellToken, buyToken,
        amountIn: amountIn.toString(), minOut: minimum.toString() });
      response.step.minOut = enforced.toString();
      return response;
    } catch (error) {
      if (!(error instanceof SwapReviewRequiredError) || attempt > 0 || tolerance === 0) throw error;
      tolerance = Math.max(0, Math.min(tolerance - 1,
        getProtectedBuildSlippageBps(BigInt(build.data.amountOut || route.routeSummary.amountOut), minimum)));
    }
  }
  throw new SwapReviewRequiredError();
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
        'The transaction enforces at least the minimum SEED shown after tax.',
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
        'The transaction enforces at least the minimum output shown after tax.',
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
  slippageTolerance,
}: {
  routeSummary: KyberRouteSummary;
  sender: Address;
  recipient: Address;
  slippageTolerance: number;
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
      slippageTolerance,
      deadline: Math.floor(Date.now() / 1000) + SWAP_DEADLINE_WINDOW_SECONDS,
      enableGasEstimation: false,
      source: 'pixotchi-app',
    }),
  });
}

async function fetchWithTimeout<T>(
  url: string,
  init: RequestInit,
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(KYBER_TIMEOUT_MS),
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new SwapTimeoutError('Swap provider timed out. Please try again.');
    }
    if (error instanceof Error && error.name === 'AbortError') {
      throw new SwapTimeoutError('Swap provider request was aborted.');
    }
    throw new SwapTransientError(
      error instanceof Error ? error.message : 'Swap provider is unreachable.',
    );
  }

  let json: (T & { message?: string }) | null = null;
  try {
    json = (await response.json()) as T & { message?: string };
  } catch {
    // Leave json null; handled below.
  }

  if (!response.ok) {
    const message = `${json?.message || 'Swap provider request failed'} (${response.status})`;
    if (response.status === 400 || response.status === 404 || response.status === 422) {
      throw new SwapBlockedError(message);
    }
    if (response.status === 429 || response.status >= 500) {
      throw new SwapTransientError(message);
    }
    throw new Error(message);
  }

  if (!json) {
    throw new SwapTransientError('Swap provider returned an invalid response.');
  }

  return json;
}

function assertKyberStep(sellToken: SwapTokenId, buyToken: SwapTokenId) {
  if (sellToken === buyToken) {
    throw new SwapBlockedError('Swap legs must use distinct tokens.');
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
