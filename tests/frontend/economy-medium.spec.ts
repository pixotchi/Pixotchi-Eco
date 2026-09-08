import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { getPendingActionLabel } from '../../lib/transaction-feedback';
import { parseLastSwapTransaction, requireUnchangedSwapReview } from '../../lib/swap/review';
import type { SwapQuoteResponse } from '../../lib/swap/types';

const quote: SwapQuoteResponse = { strategy: 'single_baseswap_seed', sellToken: 'ETH', buyToken: 'SEED', amountIn: '1000000000000000000', expectedOut: '10000000000000000000', minOut: '9000000000000000000', marketSlippageBps: 75, taxBps: 500, warnings: [], quoteToken: 'fixture-signed-token', issuedAt: Date.now(), expiresAt: Date.now() + 60_000,
  steps: [{ key: 'step1', kind: 'baseswap_seed', sellToken: 'ETH', buyToken: 'SEED', amountIn: '1000000000000000000', expectedOut: '10000000000000000000', minOut: '9000000000000000000', marketSlippageBps: 75, taxBps: 500, routeLabel: 'BaseSwap', routeSources: [], warnings: [] }] };
let bundle: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: [path.resolve('tests/frontend/fixtures/swap-economic.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'swap-io-only', setup(builder) {
      builder.onResolve({ filter: /^(wagmi|@\/lib\/(base-rpc|smart-wallet-context|paymaster-context|tab-visibility-context|swap\/gas))$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/swap-economic-io.ts') }));
      builder.onResolve({ filter: /(^|\/)base-rpc$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/swap-economic-io.ts') }));
    } }] });
  bundle = result.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  await page.route('http://swap-economy.test/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/fixture-balance') return route.fulfill({ json: { value: '10000000000000000000' } });
    if (url.pathname === '/api/swap/quote') return route.fulfill({ json: { ...quote, issuedAt: Date.now(), expiresAt: Date.now() + 60_000 } });
    if (url.pathname === '/api/swap/build-step') return route.fulfill({ json: { step: quote.steps[0], approval: null, transaction: { to: '0x327Df1E6de05895d2ab08513aaDD9313Fe505d86', data: '0x12345678', value: quote.amountIn, chainId: 8453 } } });
    return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
  });
  await page.goto('http://swap-economy.test/');
  await page.addScriptTag({ content: bundle });
});

test('swap balance failure cannot become zero or insufficient funds and Retry restores ready', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Sell amount in ETH' }).fill('1');
  await expect(page.getByLabel('Swap quote review')).toContainText('Minimum received');
  await page.route('**/fixture-balance?**', route => route.fulfill({ status: 503, json: {} }));
  await page.getByRole('button', { name: 'Refresh fixture balances' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be verified');
  await expect(page.getByRole('button', { name: 'Balance Unavailable', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Max ETH', exact: true })).toBeDisabled();
  await expect(page.locator('main')).toContainText('last known');
  await page.unroute('**/fixture-balance?**');
  await page.getByRole('button', { name: 'Retry balances' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Max ETH', exact: true })).toBeEnabled();
});

test('swap always reviews minimum and tax with selected-token radio semantics', async ({ page }) => {
  await page.getByRole('textbox', { name: 'Sell amount in ETH' }).fill('1');
  const review = page.getByLabel('Swap quote review');
  await expect(review).toContainText('Minimum received');
  await expect(review).toContainText('9 SEED');
  await expect(review).toContainText('5.00%');
  await page.getByRole('button', { name: 'Select ETH', exact: true }).click();
  await expect(page.getByRole('menuitemradio', { name: 'ETH', exact: true })).toHaveAttribute('aria-checked', 'true');
});

test('review policy permits refreshed transport credentials but rejects changed financial terms', () => {
  expect(() => requireUnchangedSwapReview(quote, { ...quote, quoteToken: 'new-token', expiresAt: Date.now() + 90_000 })).not.toThrow();
  for (const change of [{ minOut: '8000000000000000000' }, { amountIn: '2000000000000000000' }, { taxBps: 600 }, { expectedOut: '11000000000000000000' }]) {
    expect(() => requireUnchangedSwapReview(quote, { ...quote, ...change })).toThrow('Review');
  }
});

test('receipt records stay owner-bound and pending labels describe the action', () => {
  const owner = `0x${'1'.repeat(40)}`;
  const record = JSON.stringify({ owner, hash: `0x${'a'.repeat(64)}`, action: 'swap', confirmedAt: 100 });
  expect(parseLastSwapTransaction(record, owner)?.action).toBe('swap');
  expect(parseLastSwapTransaction(record, `0x${'2'.repeat(40)}`)).toBeNull();
  expect(parseLastSwapTransaction(record.replace(`0x${'a'.repeat(64)}`, 'javascript:alert(1)'), owner)).toBeNull();
  expect(getPendingActionLabel('Unstake')).toBe('Unstaking…');
  expect(getPendingActionLabel('Approve SEED for Staking')).toBe('Approving…');
  expect(getPendingActionLabel('Approve + Mint')).toBe('Processing approval and action…');
});
