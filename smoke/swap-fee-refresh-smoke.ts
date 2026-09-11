import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { swapFeeQueryKey } from '../lib/swap/fee-query-key';
import type { SwapQuoteResponse } from '../lib/swap/types';

const owner = `0x${'1'.repeat(40)}`;
const quote: SwapQuoteResponse = {
  strategy: 'single_kyber', sellToken: 'ETH', buyToken: 'USDC', amountIn: '1000000000000000',
  expectedOut: '2000000', minOut: '1985000', taxBps: 0, marketSlippageBps: 75, warnings: [],
  quoteToken: 'first-credential', issuedAt: 1000, expiresAt: 61000,
  steps: [{ key: 'step1', kind: 'kyber', sellToken: 'ETH', buyToken: 'USDC', amountIn: '1000000000000000',
    expectedOut: '2000000', minOut: '1985000', taxBps: 0, marketSlippageBps: 75,
    routeLabel: 'Kyber', routeSources: ['pool-a'], warnings: [] }],
};

async function main() {
  const key = swapFeeQueryKey(owner, 8453, quote);
  const refreshed = { ...quote, quoteToken: 'refreshed-credential', issuedAt: 6000, expiresAt: 66000,
    expectedOut: '2100000', minOut: '2084250',
    steps: [{ ...quote.steps[0], expectedOut: '2100000', minOut: '2084250' }] };
  assert.deepEqual(swapFeeQueryKey(owner, 8453, refreshed), key, 'A price/credential refresh keeps the fee preview');
  assert.notDeepEqual(swapFeeQueryKey(`0x${'2'.repeat(40)}`, 8453, quote), key);
  assert.notDeepEqual(swapFeeQueryKey(owner, 1, quote), key);
  assert.notDeepEqual(swapFeeQueryKey(owner, 8453, null), key);
  for (const changed of [
    { ...quote, amountIn: '2000000000000000' },
    { ...quote, buyToken: 'ZORA' as const },
    { ...quote, steps: [{ ...quote.steps[0], routeSources: ['pool-b'] }] },
    { ...quote, steps: [{ ...quote.steps[0], approvalTarget: `0x${'3'.repeat(40)}` as const }] },
    { ...quote, steps: [{ ...quote.steps[0], taxBps: 500 }] },
  ]) assert.notDeepEqual(swapFeeQueryKey(owner, 8453, changed), key, 'A changed draft or route requires its own fee');

  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let credential = '';
  let finishRead: ((fee: bigint) => void) | undefined;
  const options = (q: SwapQuoteResponse) => ({
    queryKey: swapFeeQueryKey(owner, 8453, q), staleTime: 10_000,
    queryFn: () => {
      credential = q.quoteToken!;
      return new Promise<bigint>(resolve => { finishRead = resolve; });
    },
  });
  const observer = new QueryObserver(client, options(quote));
  const unsubscribe = observer.subscribe(() => {});
  try {
    assert.equal(observer.getCurrentResult().isPending, true);
    finishRead!(BigInt(1000));
    await observer.refetch();
    observer.setOptions(options(refreshed));
    assert.equal(observer.getCurrentResult().data, BigInt(1000));
    assert.equal(credential, quote.quoteToken, 'Quote rotation does not trigger another fee build');
    const refresh = observer.refetch();
    assert.equal(credential, refreshed.quoteToken, 'Periodic fee reads use the latest authorization');
    assert.equal(observer.getCurrentResult().data, BigInt(1000), 'Keep the estimate during a slow background read');
    assert.equal(observer.getCurrentResult().isPending, false);
    finishRead!(BigInt(1200));
    await refresh;
    assert.equal(observer.getCurrentResult().data, BigInt(1200));

    observer.setOptions({ ...options(refreshed), queryFn: async () => { throw new Error('Fee RPC unavailable'); } });
    await observer.refetch();
    assert.equal(observer.getCurrentResult().isError, true, 'Failed refreshes still prevent readiness');

    observer.setOptions(options({ ...quote, amountIn: '2000000000000000' }));
    assert.equal(observer.getCurrentResult().data, undefined, 'Never carry a fee into a different draft');
    assert.equal(observer.getCurrentResult().isPending, true);
    finishRead!(BigInt(2000));
    await observer.refetch();
  } finally {
    unsubscribe();
    client.clear();
  }
  console.log('Swap fee refresh smoke passed');
}
void main().catch(error => { console.error(error); process.exitCode = 1; });
