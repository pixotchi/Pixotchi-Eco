import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { getEconomicReadState } from '../../lib/economic-read-state';

let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    entryPoints: [path.resolve('tests/frontend/fixtures/economic-reads.tsx')],
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
    plugins: [{ name: 'economic-io-only', setup(builder) {
      builder.onResolve({ filter: /^(wagmi|@\/lib\/base-rpc)$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/economic-read-io.ts') }));
      builder.onResolve({ filter: /(^|\/)base-rpc$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/economic-read-io.ts') }));
      builder.onResolve({ filter: /^@\/components\/transactions\/game-transaction$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/transaction-game-mock.tsx') }));
    } }],
  });
  bundle = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  await page.route('http://economic-reads.test/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/staking/balance') return route.fulfill({ json: { success: true, balance: '10000000000000000000' } });
    if (url.pathname === '/api/staking/info') return route.fulfill({ json: { success: true, approved: true, stake: { staked: '5000000000000000000', rewards: '1000000000000000000' } } });
    if (url.pathname === '/rpc-fixture') return route.fulfill({ json: { amount: '10000000000000000000' } });
    return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
  });
  await page.goto('http://economic-reads.test/');
  await page.addScriptTag({ content: bundle });
  await page.addStyleTag({ content: '[role="dialog"] { position: fixed; inset: 0; overflow: auto; background: white; } [data-dialog-layout] { pointer-events: auto; }' });
});

test('economic readiness rejects stale identity, pending data and errors even with a retained snapshot', () => {
  const ready = { hasSnapshot: true, identityMatches: true, loading: false, error: null };
  expect(getEconomicReadState(ready)).toBe('ready');
  expect(getEconomicReadState({ ...ready, identityMatches: false })).toBe('loading');
  expect(getEconomicReadState({ ...ready, hasSnapshot: false })).toBe('loading');
  expect(getEconomicReadState({ ...ready, loading: true })).toBe('loading');
  expect(getEconomicReadState({ ...ready, loading: true, error: new Error('RPC unavailable') })).toBe('error');
});

test('staking initial failure offers Retry and never enables approval from default values', async ({ page }) => {
  await page.route('**/api/staking/info?**', route => route.fulfill({ status: 503, json: { success: false } }));
  await page.getByRole('button', { name: 'Open staking' }).click();
  const dialog = page.getByRole('dialog', { name: 'Stake SEED' });
  await expect(dialog.getByRole('alert')).toContainText('Could not load staking data');
  await expect(dialog.getByRole('button', { name: 'Approve SEED for Staking' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Claim Rewards', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Use maximum SEED' })).toBeDisabled();
  await expect(dialog).toContainText('Unavailable');
  await page.unroute('**/api/staking/info?**');
  await dialog.getByRole('button', { name: 'Retry staking data' }).click();
  await dialog.getByRole('textbox', { name: 'Amount to stake' }).fill('1');
  await expect(dialog.getByRole('button', { name: 'Stake', exact: true })).toBeEnabled();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
});

test('staking refresh failure preserves labeled values while disabling stake, unstake and claim', async ({ page }) => {
  await page.getByRole('button', { name: 'Open staking' }).click();
  const dialog = page.getByRole('dialog', { name: 'Stake SEED' });
  await dialog.getByRole('textbox', { name: 'Amount to stake' }).fill('1');
  await expect(dialog.getByRole('button', { name: 'Stake', exact: true })).toBeEnabled();
  await page.route('**/api/staking/balance?**', route => route.fulfill({ status: 503, json: { success: false } }));
  await dialog.getByRole('button', { name: 'Refresh stake data' }).click();
  await expect(dialog.getByRole('alert')).toContainText('Showing the last known values');
  await expect(dialog).toContainText('10 (last known)');
  await expect(dialog.getByRole('button', { name: 'Stake', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Claim Rewards', exact: true })).toBeDisabled();
  await dialog.getByRole('radio', { name: 'Unstake' }).click();
  await expect(dialog.getByRole('button', { name: 'Unstake', exact: true })).toBeDisabled();
  await expect(dialog).toContainText('5 (last known)');
});

test('staking malformed success is unavailable, while a complete zero snapshot is a real empty balance', async ({ page }) => {
  await page.route('**/api/staking/info?**', route => route.fulfill({ json: { success: true, approved: false, stake: null } }));
  await page.getByRole('button', { name: 'Open staking' }).click();
  const dialog = page.getByRole('dialog', { name: 'Stake SEED' });
  await expect(dialog.getByRole('alert')).toContainText('Could not load staking data');
  await page.route('**/api/staking/info?**', route => route.fulfill({ json: { success: true, approved: true, stake: { staked: '0', rewards: '0' } } }));
  await page.route('**/api/staking/balance?**', route => route.fulfill({ json: { success: true, balance: '0' } }));
  await dialog.getByRole('button', { name: 'Retry staking data' }).click();
  await expect(dialog.getByRole('button', { name: 'No rewards to claim' })).toBeDisabled();
  await expect(dialog.getByRole('alert')).toHaveCount(0);
  await expect(dialog).not.toContainText('Unavailable');
  await dialog.getByRole('textbox', { name: 'Amount to stake' }).fill('1');
  await expect(dialog.getByRole('alert')).toContainText('Amount exceeds wallet balance');
});

test('stake composite rejects missing required entries but accepts zero with missing optional reward metadata', async ({ page }) => {
  for (const required of ['stake', 'allowance']) {
    await page.getByRole('button', { name: `Read ${required} failure` }).click();
    await expect(page.getByLabel('Composite result')).toHaveText('unavailable');
  }
  await page.getByRole('button', { name: 'Read optional failure' }).click();
  await expect(page.getByLabel('Composite result')).toHaveText('ready:0:false');
});

test('marketplace failed balance refresh blocks trades, retains explicit last-known values and leaves escrow cancellation reachable', async ({ page }) => {
  await page.getByRole('button', { name: 'Open marketplace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Marketplace (Experimental)' });
  await dialog.getByRole('textbox', { name: 'Amount to sell' }).fill('1');
  await dialog.getByRole('textbox', { name: 'Price', exact: false }).fill('1');
  await expect(dialog.getByRole('button', { name: 'Create Order' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Take', exact: true })).toBeEnabled();
  await page.route('**/rpc-fixture?**', route => route.fulfill({ status: 503, json: {} }));
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('New trades and approvals are paused');
  await expect(dialog.getByRole('button', { name: 'Create Order' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: 'Balances unavailable' })).toBeDisabled();
  await expect(dialog).toContainText('10 (last known)');
  await expect(dialog.getByRole('button', { name: 'Cancel', exact: true })).toBeEnabled();
  await page.unroute('**/rpc-fixture?**');
  await dialog.getByRole('button', { name: 'Retry balances' }).click();
  await expect(dialog.getByRole('button', { name: 'Create Order' })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: 'Take', exact: true })).toBeEnabled();
  await expect(dialog).not.toContainText('last known');
});

test('marketplace initial read failure does not become low balance or an enabled approval', async ({ page }) => {
  await page.route('**/rpc-fixture?**', route => route.fulfill({ status: 503, json: {} }));
  await page.getByRole('button', { name: 'Open marketplace' }).click();
  const dialog = page.getByRole('dialog', { name: 'Marketplace (Experimental)' });
  await expect(dialog.getByRole('alert')).toContainText('Balances and approvals could not be refreshed');
  await expect(dialog.getByRole('button', { name: 'Balances unavailable' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /^Approve / })).toHaveCount(0);
  await expect(dialog).not.toContainText('Low balance');
});

test('marketplace selections expose radio state and support arrow-key changes', async ({ page }) => {
  await page.getByRole('button', { name: 'Open marketplace' }).click();
  const dialog = page.getByRole('dialog');
  const sell = dialog.getByRole('radiogroup', { name: 'Token to sell' });
  await sell.getByRole('radio', { name: 'Sell SEED', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(sell.getByRole('radio', { name: 'Sell LEAF', exact: true })).toBeChecked();
  await expect(sell.getByRole('radio', { name: 'Sell LEAF', exact: true })).toBeFocused();
  const orders = dialog.getByRole('radiogroup', { name: 'Orders to show' });
  await orders.getByRole('radio', { name: 'All', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(orders.getByRole('radio', { name: 'Mine', exact: true })).toBeChecked();
});

test('marketplace keeps a known approval controller visible but disabled while its snapshot refresh fails', async ({ page }) => {
  await page.route('**/rpc-fixture?**', route => route.fulfill({ json: { amount: new URL(route.request().url()).searchParams.get('kind') === 'allowance' ? '0' : '10000000000000000000' } }));
  await page.getByRole('button', { name: 'Open marketplace' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('button', { name: 'Approve SEED', exact: true })).toBeEnabled();
  await page.route('**/rpc-fixture?**', route => route.fulfill({ status: 503, json: {} }));
  await dialog.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('Balances and approvals could not be refreshed');
  await expect(dialog.getByRole('button', { name: 'Approve SEED', exact: true })).toBeDisabled();
});

for (const surface of ['staking', 'marketplace']) test(`${surface} cannot retain wallet A values or spending after wallet B fails to load`, async ({ page }) => {
  await page.getByRole('button', { name: `Open ${surface}` }).click();
  const dialog = page.getByRole('dialog');
  if (surface === 'staking') {
    await dialog.getByRole('textbox', { name: 'Amount to stake' }).fill('1');
    await expect(dialog.getByRole('button', { name: 'Stake', exact: true })).toBeEnabled();
  } else {
    await expect(dialog.getByRole('button', { name: 'Take', exact: true })).toBeEnabled();
  }
  await page.route('**/api/staking/**', route => route.fulfill({ status: 503, json: {} }));
  await page.route('**/rpc-fixture?**', route => route.fulfill({ status: 503, json: {} }));
  await page.evaluate(() => (window as unknown as { economyFixture: { switchWallet: () => void } }).economyFixture.switchWallet());
  await expect(dialog.getByRole('alert')).toBeVisible();
  await expect(dialog).not.toContainText('10 (last known)');
  if (surface === 'staking') {
    await expect(dialog.getByRole('button', { name: 'Approve SEED for Staking' })).toBeDisabled();
  } else {
    await expect(dialog.getByRole('button', { name: 'Balances unavailable' })).toBeDisabled();
  }
});
