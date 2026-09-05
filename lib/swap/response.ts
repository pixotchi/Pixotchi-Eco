import { readAddress, readRecord, readSafeUint, readUint } from '../contract-value';
import { BASE_CHAIN_ID } from './constants';
import type { SwapBuildStepResponse, SwapQuoteResponse, SwapQuoteStep, SwapTokenId, UserSwapTokenId } from './types';

function token(value: unknown): SwapTokenId {
  if (value === 'ETH' || value === 'WETH' || value === 'USDC' || value === 'ZORA' || value === 'SEED' || value === 'JESSE' || value === 'PIXOTCHI') return value;
  throw new Error('Invalid quote token');
}
function userToken(value: unknown): UserSwapTokenId {
  const result = token(value);
  if (result === 'WETH') throw new Error('Invalid swap pair');
  return result;
}
function text(value: unknown): string {
  if (typeof value !== 'string') throw new Error('Invalid quote text');
  return value;
}
function amount(value: unknown): string {
  if (typeof value !== 'string' || !/^(0|[1-9]\d*)$/.test(value)) throw new Error('Invalid quote amount');
  readUint(value);
  return value;
}
function texts(value: unknown): string[] {
  if (!Array.isArray(value)) throw new Error('Invalid quote list');
  return value.map(text);
}

function parseStep(value: unknown): SwapQuoteStep {
  const step = readRecord(value);
  if (step.key !== 'step1' && step.key !== 'step2') throw new Error('Invalid swap step');
  if (step.kind !== 'kyber' && step.kind !== 'baseswap_seed') throw new Error('Invalid swap route');
  const result: SwapQuoteStep = { key: step.key, kind: step.kind, sellToken: token(step.sellToken), buyToken: token(step.buyToken),
    amountIn: amount(step.amountIn), expectedOut: amount(step.expectedOut), minOut: amount(step.minOut),
    taxBps: readSafeUint(step.taxBps, 10_000), marketSlippageBps: readSafeUint(step.marketSlippageBps, 10_000),
    routeLabel: text(step.routeLabel), routeSources: texts(step.routeSources), warnings: texts(step.warnings) };
  if (BigInt(result.minOut) > BigInt(result.expectedOut)) throw new Error('Invalid minimum swap output');
  if (step.approvalTarget !== undefined) result.approvalTarget = readAddress(step.approvalTarget);
  if (step.grossOut !== undefined) result.grossOut = amount(step.grossOut);
  if (step.effectiveIn !== undefined) result.effectiveIn = amount(step.effectiveIn);
  return result;
}

export function parseSwapQuote(value: unknown, request: { sellToken: UserSwapTokenId; buyToken: UserSwapTokenId; amountIn: bigint }): SwapQuoteResponse {
  const quote = readRecord(value);
  if (quote.strategy !== 'blocked' && quote.strategy !== 'single_kyber' && quote.strategy !== 'single_baseswap_seed' && quote.strategy !== 'two_step_via_weth') throw new Error('Invalid swap strategy');
  if (!Array.isArray(quote.steps)) throw new Error('Missing swap steps');
  const result: SwapQuoteResponse = { strategy: quote.strategy, sellToken: userToken(quote.sellToken), buyToken: userToken(quote.buyToken),
    amountIn: amount(quote.amountIn), expectedOut: amount(quote.expectedOut), minOut: amount(quote.minOut),
    taxBps: readSafeUint(quote.taxBps, 10_000), marketSlippageBps: readSafeUint(quote.marketSlippageBps, 10_000),
    warnings: texts(quote.warnings), steps: quote.steps.map(parseStep) };
  if (result.sellToken !== request.sellToken || result.buyToken !== request.buyToken || BigInt(result.amountIn) !== request.amountIn) throw new Error('Quote does not match this swap');
  if (BigInt(result.minOut) > BigInt(result.expectedOut)) throw new Error('Invalid minimum swap output');
  if (quote.blockedReason !== undefined) result.blockedReason = text(quote.blockedReason);
  if (quote.intermediateToken !== undefined) result.intermediateToken = token(quote.intermediateToken);
  if (result.strategy === 'blocked') {
    if (result.steps.length || !result.blockedReason) throw new Error('Invalid blocked swap');
    return result;
  }
  const count = result.strategy === 'two_step_via_weth' ? 2 : 1;
  if (result.steps.length !== count || result.steps[0].key !== 'step1' || (count === 2 && result.steps[1].key !== 'step2')) throw new Error('Incomplete swap route');
  if (!text(quote.quoteToken).trim()) throw new Error('Missing swap authorization');
  result.quoteToken = text(quote.quoteToken);
  result.issuedAt = readSafeUint(quote.issuedAt);
  result.expiresAt = readSafeUint(quote.expiresAt);
  if (result.expiresAt <= result.issuedAt) throw new Error('Invalid quote lifetime');
  return result;
}

export function parseSwapBuildStep(value: unknown, requested: SwapQuoteStep, amountIn: string): SwapBuildStepResponse {
  const payload = readRecord(value);
  const step = parseStep(payload.step);
  // The build endpoint quotes one leg at a time and labels it step1, including the second leg.
  // Match economic identity, then restore the presentation key of the requested route.
  if (step.kind !== requested.kind || step.sellToken !== requested.sellToken || step.buyToken !== requested.buyToken || step.amountIn !== amountIn) throw new Error('Swap transaction does not match the requested step');
  step.key = requested.key;
  const transaction = readRecord(payload.transaction);
  if (transaction.chainId !== BASE_CHAIN_ID) throw new Error('Swap transaction is on the wrong network');
  const data = text(transaction.data);
  if (!/^0x(?:[\da-fA-F]{2})*$/.test(data)) throw new Error('Invalid swap transaction data');
  const approval = payload.approval === null ? null : readRecord(payload.approval);
  return { step, transaction: { to: readAddress(transaction.to), data: data as `0x${string}`, value: amount(transaction.value), chainId: BASE_CHAIN_ID },
    approval: approval ? { token: readAddress(approval.token), spender: readAddress(approval.spender), requiredAmount: amount(approval.requiredAmount) } : null };
}

export class SwapRequestError extends Error {
  constructor(message: string, readonly status?: number) { super(message); this.name = 'SwapRequestError'; }
}
export async function fetchSwapJson(url: string, init: RequestInit): Promise<unknown> {
  const response = await fetch(url, init);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string' ? payload.error : `Request failed (${response.status})`;
    throw new SwapRequestError(message, response.status);
  }
  if (payload === null) throw new SwapRequestError('Invalid server response', response.status);
  return payload;
}
