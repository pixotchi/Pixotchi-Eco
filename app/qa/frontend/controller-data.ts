import { normalizeBarracksConfigV2, normalizeBarracksLandStateV2, normalizeBarracksRaidReportV2 } from '@/lib/barracks-state';
import type { SwapQuoteResponse, UserSwapTokenId } from '@/lib/swap/types';

export const fixtureAddress = `0x${'1'.repeat(40)}` as const;
export const fixtureTroop = [fixtureAddress, BigInt(5), fixtureAddress, BigInt(10), BigInt(2), BigInt(3), BigInt(4), BigInt(5), BigInt(1000)];
export const fixtureConfig = [true, true, fixtureAddress, BigInt(10), fixtureAddress, BigInt(60), BigInt(120), 1000, 5000, BigInt(1), BigInt(2), fixtureTroop, fixtureTroop];
export const fixtureReport = Array.from({ length: 25 }, (_, index) => index === 4 ? false : BigInt(0));
export function fixtureBarracks(landId = BigInt(1)) {
  return { config: normalizeBarracksConfigV2(fixtureConfig),
    landState: normalizeBarracksLandStateV2([true, landId * BigInt(10), BigInt(50), 0, ...Array.from({ length: 10 }, () => BigInt(0)), BigInt(100), BigInt(50)]),
    lastOutgoingReport: normalizeBarracksRaidReportV2(fixtureReport), lastIncomingReport: normalizeBarracksRaidReportV2(fixtureReport) };
}
export function fixtureQuote({ sellToken = 'ETH', buyToken = 'SEED', amountIn = BigInt(1) }: { sellToken?: UserSwapTokenId; buyToken?: UserSwapTokenId; amountIn?: bigint } = {}): SwapQuoteResponse {
  return { strategy: 'single_kyber', sellToken, buyToken, amountIn: amountIn.toString(), expectedOut: '200', minOut: '190', taxBps: 0,
    marketSlippageBps: 50, warnings: [], quoteToken: 'fixture-token', issuedAt: 1000, expiresAt: 2000,
    steps: [{ key: 'step1', kind: 'kyber', sellToken, buyToken, amountIn: amountIn.toString(), expectedOut: '200', minOut: '190', taxBps: 0,
      marketSlippageBps: 50, routeLabel: 'Fixture route', routeSources: [], warnings: [] }] };
}
