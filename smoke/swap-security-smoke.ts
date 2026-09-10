import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { getKyberTokenAddress } from '../lib/swap/constants';
import { validateSwapExecution } from '../lib/swap/calldata';
import { SwapBuildInvalidError, SwapReviewRequiredError } from '../lib/swap/errors';
import { requiredSwapMinimum, getProtectedBuildSlippageBps } from '../lib/swap/policy';
import { parseSwapBuildStep, parseSwapQuote } from '../lib/swap/response';
import { signQuoteToken, verifyQuoteToken, type QuoteTokenPayload } from '../lib/swap/quote-token';
import { requireUnchangedSwapReview } from '../lib/swap/review';
import { buildSwapStep } from '../lib/swap/engine';
import { approveAndRebuildSwap } from '../lib/swap/approval-flow';
import { getSwapSafetyCounters, incrementSwapSafetyCounter } from '../lib/swap/metrics';
import { createPendingEvmRecord } from '../lib/pending-evm-transaction';
import { getPendingEvmReceiptTargets, TransactionVerificationUnavailableError } from '../lib/transaction-proof-verification';
import type { SwapQuoteStep, SwapQuoteResponse } from '../lib/swap/types';
import { createSwapBuildFixture, swapFixtureSender as sender } from './swap-security-fixtures';

const step: SwapQuoteStep = { key: 'step1', kind: 'kyber', sellToken: 'ETH', buyToken: 'USDC',
  amountIn: '1000000000000000', expectedOut: '1000000', minOut: '992500', taxBps: 0,
  marketSlippageBps: 75, routeLabel: 'Kyber', routeSources: [], warnings: [] };
const issuedAt = Date.now();
const quote: SwapQuoteResponse = { strategy: 'single_kyber', sellToken: step.sellToken as 'ETH', buyToken: 'USDC',
  amountIn: step.amountIn, expectedOut: step.expectedOut, minOut: step.minOut, taxBps: 0, marketSlippageBps: 75,
  steps: [step], warnings: [], quoteToken: 'fixture', issuedAt, expiresAt: issuedAt + 60_000 };
const terms: Omit<QuoteTokenPayload, 'v' | 'jti'> = {
  chainId: 8453, strategy: 'single_kyber', sender, recipient: sender, sellToken: 'ETH', buyToken: 'USDC',
  amountIn: step.amountIn, expectedOut: step.expectedOut, minOut: step.minOut, taxBps: 0, marketSlippageBps: 75,
  issuedAt, expiresAt: issuedAt + 60_000,
  steps: [{ key: 'step1', kind: 'kyber', sellToken: 'ETH', buyToken: 'USDC', amountIn: step.amountIn,
    expectedOut: step.expectedOut, minOut: step.minOut, taxBps: 0, marketSlippageBps: 75,
    sellAddress: getKyberTokenAddress('ETH'), buyAddress: getKyberTokenAddress('USDC') }],
};
const intent = { sender, recipient: sender, sellToken: step.sellToken, buyToken: step.buyToken,
  amountIn: step.amountIn, minOut: step.minOut };

async function main() {
  process.env.SWAP_QUOTE_SIGNING_SECRET = 'swap-security-smoke-only-signing-secret-0123456789';
  const token = signQuoteToken(terms);
  assert.equal(verifyQuoteToken(token)?.minOut, step.minOut);
  const unsigned = { ...terms, v: 'v2', jti: 'old' };
  const body = Buffer.from(JSON.stringify(unsigned)).toString('base64url');
  const signedOld = `${body}.${createHmac('sha256', process.env.SWAP_QUOTE_SIGNING_SECRET).update(body).digest('base64url')}`;
  assert.equal(verifyQuoteToken(signedOld), null, 'Authentically signed v2 cannot authorize a swap');
  assert.equal(verifyQuoteToken(signQuoteToken({ ...terms, issuedAt: issuedAt - 61_000, expiresAt: issuedAt - 1_000 })), null);
  assert.throws(() => signQuoteToken({ ...terms, recipient: '0x2222222222222222222222222222222222222222' }));
  assert.throws(() => signQuoteToken({ ...terms, minOut: '496250' }), 'Parent and step floor must agree');
  assert.deepEqual(parseSwapQuote(quote, { sellToken: 'ETH', buyToken: 'USDC', amountIn: BigInt(step.amountIn) }), quote);
  for (const unsupported of [
    { ...quote, strategy: 'two_step_via_weth', steps: [step, { ...step, key: 'step2' }] },
    { ...quote, steps: [{ ...step, minOut: '1' }] },
    { ...quote, steps: [{ ...step, kind: 'baseswap_seed' }] },
  ]) assert.throws(() => parseSwapQuote(unsupported, { sellToken: 'ETH', buyToken: 'USDC', amountIn: BigInt(step.amountIn) }));

  const valid = createSwapBuildFixture(step);
  assert.equal(parseSwapBuildStep(valid, step, step.amountIn, sender).step.minOut, step.minOut);
  for (const selector of ['swap', 'swapGeneric', 'swapSimpleMode'] as const) {
    const input = selector === 'swapSimpleMode' ? { ...step, sellToken: 'USDC' as const, buyToken: 'ETH' as const } : step;
    const built = createSwapBuildFixture(input, sender, selector);
    assert.equal(validateSwapExecution(built, { ...intent, sellToken: input.sellToken, buyToken: input.buyToken }), BigInt(step.minOut));
  }
  const weaker = createSwapBuildFixture({ ...step, expectedOut: '500000', minOut: '496250' });
  assert.throws(() => parseSwapBuildStep(weaker, step, step.amountIn, sender), SwapReviewRequiredError);
  assert.throws(() => validateSwapExecution(createSwapBuildFixture(step, sender, 'swap', { minimum: BigInt(496250) }), intent), SwapReviewRequiredError);
  for (const changed of [
    createSwapBuildFixture(step, sender, 'swap', { flags: BigInt(513) }),
    createSwapBuildFixture(step, sender, 'swap', { flags: BigInt(514) }),
    createSwapBuildFixture(step, sender, 'swap', { permit: '0x1234' }),
    createSwapBuildFixture(step, sender, 'swap', { fee: true }),
    createSwapBuildFixture(step, sender, 'swap', { recipient: '0x2222222222222222222222222222222222222222' }),
    createSwapBuildFixture(step, sender, 'swap', { amount: BigInt(1) }),
    { ...valid, transaction: { ...valid.transaction, data: '0x1234' as const } },
    { ...valid, transaction: { ...valid.transaction, value: '0' } },
    { ...valid, transaction: { ...valid.transaction, chainId: 1 } },
  ]) assert.throws(() => validateSwapExecution(changed, intent), SwapBuildInvalidError);
  const ercStep = { ...step, sellToken: 'USDC' as const, buyToken: 'ETH' as const };
  const erc = createSwapBuildFixture(ercStep);
  assert.throws(() => validateSwapExecution({ ...erc, approval: { ...erc.approval!, requiredAmount: '1' } },
    { ...intent, sellToken: 'USDC', buyToken: 'ETH' }), SwapBuildInvalidError);
  assert.doesNotThrow(() => requireUnchangedSwapReview(quote, { ...quote, minOut: '995000' }));
  assert.throws(() => requireUnchangedSwapReview(quote, { ...quote, minOut: '991000' }), SwapReviewRequiredError);

  // The same async controller used by the panel: a wallet approval remains
  // unresolved while the quote expires, then a lower refresh cannot reach build
  // or a second wallet request. Existing approval does not authorize worse terms.
  const reviewedErc: SwapQuoteResponse = { ...quote, sellToken: 'USDC', buyToken: 'ETH', steps: [ercStep] };
  const events: string[] = [];
  let finishApproval!: () => void;
  const waitingApproval = new Promise<void>(resolve => { finishApproval = resolve; });
  const delayed = approveAndRebuildSwap({ reviewed: reviewedErc, built: erc,
    approve: async () => { events.push('approval'); await waitingApproval; },
    now: () => issuedAt + 61_000,
    refresh: async () => { events.push('refresh'); return { ...reviewedErc, minOut: '900000' }; },
    build: async () => { events.push('build'); return erc; },
  }).then(() => { events.push('swap-wallet'); });
  assert.deepEqual(events, ['approval']);
  finishApproval();
  await assert.rejects(delayed, SwapReviewRequiredError);
  assert.deepEqual(events, ['approval', 'refresh']);
  events.length = 0;
  const freshToken = 'fresh-v3-token';
  const afterApproval = await approveAndRebuildSwap({ reviewed: reviewedErc, built: erc,
    approve: async () => { events.push('approval'); }, now: () => issuedAt + 61_000,
    refresh: async () => { events.push('refresh'); return { ...reviewedErc, quoteToken: freshToken, minOut: '993000' }; },
    build: async fresh => {
      events.push('build'); assert.equal(fresh.quoteToken, freshToken); assert.equal(fresh.minOut, '993000');
      return createSwapBuildFixture({ ...ercStep, minOut: '993000' });
    },
  });
  assert.equal(afterApproval.step.minOut, '993000');
  assert.deepEqual(events, ['approval', 'refresh', 'build']);
  await assert.rejects(approveAndRebuildSwap({ reviewed: reviewedErc, built: erc,
    approve: async () => {}, now: () => issuedAt + 1_000, refresh: async () => { throw new Error('Not stale'); },
    build: async () => createSwapBuildFixture({ ...ercStep, minOut: '900000' }),
  }), SwapReviewRequiredError, 'An immediate postapproval build cannot weaken the same review either');

  const beforeCounters = getSwapSafetyCounters();
  incrementSwapSafetyCounter('reviewRequired');
  assert.equal(getSwapSafetyCounters().reviewRequired, beforeCounters.reviewRequired + 1);
  assert.deepEqual(Object.keys(getSwapSafetyCounters()), ['quoteRejected', 'reviewRequired', 'buildRejected']);

  const firstHash = `0x${'1'.repeat(64)}` as const;
  const secondHash = `0x${'2'.repeat(64)}` as const;
  const replacementHash = `0x${'3'.repeat(64)}` as const;
  const pendingBatch = createPendingEvmRecord({ method: 'batch', callsDigest: firstHash,
    identity: { accountAddress: sender, chainId: 8453, intentKey: 'swap' },
    proof: { kind: 'calls', id: 'wallet-batch', hash: replacementHash } });
  assert.throws(() => getPendingEvmReceiptTargets(pendingBatch, [firstHash, secondHash]), TransactionVerificationUnavailableError);
  assert.deepEqual(getPendingEvmReceiptTargets({ ...pendingBatch,
    replacement: { disposition: 'repriced', previousHash: firstHash, transactionHash: replacementHash, verified: true },
  }, [firstHash, secondHash]), [replacementHash, secondHash], 'A replacement must not drop another batch receipt');

  const gross = BigInt('313077599154413371391');
  const net = gross * BigInt(9500) / BigInt(10000);
  const displayed = net * BigInt(9925) / BigInt(10000);
  const tolerance = getProtectedBuildSlippageBps(gross, displayed);
  assert.equal(tolerance, 571);
  assert(gross * BigInt(10000 - tolerance) / BigInt(10000) >= displayed);
  assert.equal(requiredSwapMinimum(BigInt(100), BigInt(120)), BigInt(120));

  // Exercise the real engine with a deterministic Kyber response. A stale
  // review cannot be reset by build, and build rounding gets a bounded retry.
  const originalFetch = globalThis.fetch;
  let amountOut = '1000000';
  let builds = 0;
  globalThis.fetch = async (_input, init) => {
    if (init?.method !== 'POST') return Response.json({ data: { routerAddress: valid.transaction.to,
      routeSummary: { amountIn: step.amountIn, amountOut, route: [] } } });
    builds++;
    const request = JSON.parse(init.body as string) as { slippageTolerance: number; deadline: number };
    assert(request.deadline > Math.floor(Date.now() / 1000));
    const output = BigInt(amountOut) - BigInt(1);
    const encodedMin = output * BigInt(10000 - request.slippageTolerance) / BigInt(10000);
    const built = createSwapBuildFixture(step, sender, 'swap', { minimum: encodedMin });
    return Response.json({ data: { data: built.transaction.data, amountOut: output.toString(),
      routerAddress: built.transaction.to, transactionValue: step.amountIn } });
  };
  try {
    const args = { kind: 'kyber' as const, sellToken: 'ETH' as const, buyToken: 'USDC' as const,
      amountIn: BigInt(step.amountIn), reviewedMinOut: BigInt(step.minOut), sender, recipient: sender };
    const built = await buildSwapStep(args);
    assert(BigInt(built.step.minOut) >= BigInt(step.minOut));
    assert.equal(builds, 2, 'One-unit provider rounding triggers only one stronger rebuild');
    amountOut = '500000';
    await assert.rejects(buildSwapStep(args), SwapReviewRequiredError);
    assert.equal(builds, 2, 'Unreachable reviewed floor stops before another build');
  } finally { globalThis.fetch = originalFetch; }
  console.log('Swap security: v3 economics, supported calldata, floor rounding, route changes and approvals passed.');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
