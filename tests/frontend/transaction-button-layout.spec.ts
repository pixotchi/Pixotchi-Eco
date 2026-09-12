import { expect, test, type Locator } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import type { fixtureWallet } from './fixtures/transaction-core-wallet';

declare global {
  interface Window { fixtureWallet: typeof fixtureWallet; seedStaleApproval: () => void }
}

let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    entryPoints: [path.resolve('tests/frontend/fixtures/transaction-button-layout.tsx')],
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_BATCH_ROUTER_ADDRESS': '"0x9999999999999999999999999999999999999999"', 'process.env': '{}' },
    plugins: [{ name: 'wallet-io-only', setup(builder) {
      builder.onResolve({ filter: /^(wagmi(?:\/experimental)?|@vercel\/analytics|@\/lib\/(base-rpc|smart-wallet-context|owner-resource-invalidation|open-external))$/ }, () => ({
        path: path.resolve('tests/frontend/fixtures/transaction-core-wallet.ts'),
      }));
      builder.onResolve({ filter: /(^|\/)base-rpc$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/transaction-core-wallet.ts') }));
    } }],
  });
  bundle = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  // Real dialog, GameTransaction and controller markup with compiled app CSS.
  // Only wallet/RPC I/O is substituted, on an isolated origin with no real wallet.
  await page.goto('/qa/economy-layout');
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(elements => elements.map(element => (element as HTMLLinkElement).href));
  const css = await Promise.all(styles.map(async url => {
    const text = await (await page.request.get(url)).text();
    return text.replace(/url\((['"]?)([^)'"\s]+)\1\)/g, (match, _quote, asset: string) =>
      asset.startsWith('data:') ? match : `url("${new URL(asset, url).href}")`);
  }));
  expect(css.length).toBeGreaterThan(0);
  const classes = await page.evaluate(() => ({ html: document.documentElement.className, body: document.body.className }));
  await page.route('http://transaction-layout.test/**', async route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/staking/balance') return route.fulfill({ json: { success: true, balance: '10000000000000000000' } });
    if (url.pathname === '/api/staking/info') return route.fulfill({ json: { success: true, approved: true, stake: { staked: '5000000000000000000', rewards: '1000000000000000000' } } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: { success: true } });
    if (/\.(png|svg|webp)$/.test(url.pathname)) return route.fulfill({ response: await page.request.get(`http://localhost:3000${url.pathname}`) });
    return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
  });
  await page.goto('http://transaction-layout.test/');
  await page.evaluate(value => { document.documentElement.className = value.html; document.body.className = value.body; }, classes);
  await page.addStyleTag({ content: css.join('\n') });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => document.fonts.ready);
});

async function expectContentInside(button: Locator) {
  await expect(button).toBeVisible();
  const geometry = await button.evaluate(element => {
    const bounds = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    const inset = {
      left: bounds.left + parseFloat(style.paddingLeft), right: bounds.right - parseFloat(style.paddingRight),
      top: bounds.top + parseFloat(style.paddingTop), bottom: bounds.bottom - parseFloat(style.paddingBottom),
    };
    // scrollWidth alone misses text spilling out on the left of a centered flex row.
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
    const rects: DOMRect[] = [];
    while (walker.nextNode()) {
      if (!walker.currentNode.textContent?.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(walker.currentNode);
      rects.push(...Array.from(range.getClientRects()));
    }
    const spinner = element.querySelector('[data-testid="ockSpinner"]')?.getBoundingClientRect();
    if (spinner) rects.push(spinner);
    return {
      fits: rects.every(rect => rect.left >= inset.left - 1 && rect.right <= inset.right + 1
        && rect.top >= inset.top - 2 && rect.bottom <= inset.bottom + 2),
      noOverflow: element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1,
      height: bounds.height,
    };
  });
  expect(geometry.fits, 'Label and spinner stay within the button padding').toBe(true);
  expect(geometry.noOverflow).toBe(true);
  expect(geometry.height).toBeGreaterThanOrEqual(44);
}

for (const collection of ['Plants', 'Lands']) test(`transfer ${collection} approval has one pending and failure notification`, async ({ page }) => {
  await page.evaluate(() => {
    window.fixtureWallet.deferWallet = true;
  });
  if (collection === 'Lands') await page.evaluate(() => { window.fixtureWallet.walletError = 'insufficient funds for gas'; });
  await page.getByRole('button', { name: 'Open transfer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Transfer Assets', exact: true });
  await dialog.getByRole('button', { name: `Approve ${collection}`, exact: true }).click();
  await expect(dialog.getByText(/^Confirm in your wallet/)).toHaveCount(1);
  const popup = dialog.locator('[data-testid="ockToast"][data-state="open"]');
  await expect(popup).toContainText('Confirm in your wallet');
  await expect(popup).toBeInViewport();
  await expect(popup.getByRole('status')).toHaveCount(1);
  await expect(dialog.locator('[data-app-toast]')).toHaveCount(0);
  await dialog.screenshot({ path: test.info().outputPath(`transfer-${collection.toLowerCase()}-pending.png`) });
  await expect.poll(() => page.evaluate(() => Boolean(window.fixtureWallet.resolveWallet))).toBe(true);
  await page.evaluate(() => window.fixtureWallet.resolveWallet?.());
  await expect(dialog.getByText(collection === 'Plants' ? /^Action canceled/ : /^That didn’t go through/)).toHaveCount(1);
  await expect(popup).toContainText(collection === 'Plants' ? 'Action canceled' : 'That didn’t go through');
  await expect(dialog.locator('[data-app-toast]')).toHaveCount(0);
  expect(await page.evaluate(() => window.fixtureWallet.walletCalls)).toBe(1);
});

test('transfer approval keeps its approved badge and success popup', async ({ page }) => {
  await page.evaluate(() => { window.fixtureWallet.rejectWallet = false; window.fixtureWallet.deferWallet = true; });
  await page.getByRole('button', { name: 'Open transfer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Transfer Assets', exact: true });
  await dialog.getByRole('button', { name: 'Approve Lands', exact: true }).click();
  await expect.poll(() => page.evaluate(() => Boolean(window.fixtureWallet.resolveWallet))).toBe(true);
  await page.evaluate(() => { window.fixtureWallet.nftApprovals = true; window.fixtureWallet.resolveWallet?.(); });
  await expect(dialog.locator('[data-rht-toaster]')).toContainText('Lands approved');
  await expect(dialog.locator('p[role="status"]').filter({ hasText: 'Lands approved' })).toHaveCount(1);
  await expect(dialog.locator('[data-testid="ockToast"][data-state="open"]')).toHaveCount(0);
});

test('final asset transfer has one status popup and retains its review', async ({ page }) => {
  await page.evaluate(() => {
    window.fixtureWallet.deferWallet = true;
    localStorage.setItem(`pixotchi:transfer-assets:v1:8453:${window.fixtureWallet.accountAddress}`, JSON.stringify({
      version: 1, accountAddress: window.fixtureWallet.accountAddress, targetAddress: `0x${'4'.repeat(40)}`, chainId: 8453,
      planId: 'single-feedback-review', createdAt: Date.now(), phase: 'ready', nextStepIndex: 0,
      steps: [{ kind: 'land', landId: '1112' }], successfulPlantIds: [], successfulLandIds: [], failedPlantIds: [], failedLandIds: [],
    }));
  });
  await page.getByRole('button', { name: 'Open transfer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Confirm Transfer', exact: true });
  await expect(dialog).toContainText('Lands (1): #1112');
  await dialog.getByRole('checkbox', { name: 'I understand this action is irreversible.' }).check();
  await dialog.getByRole('button', { name: 'Confirm & Send', exact: true }).click();
  await expect(dialog.getByText(/^Confirm in your wallet/)).toHaveCount(1);
  await expect(dialog.getByTestId('ockToast')).toBeInViewport();
  await expect(dialog).toContainText('Lands (1): #1112');
  await expect.poll(() => page.evaluate(() => Boolean(window.fixtureWallet.resolveWallet))).toBe(true);
  await page.evaluate(() => window.fixtureWallet.resolveWallet?.());
  await expect(dialog.getByText(/^Action canceled/)).toHaveCount(1);
  expect(await page.evaluate(() => window.fixtureWallet.walletCalls)).toBe(1);
});

test('dismissing a delayed approval popup keeps recovery reachable without duplicate status', async ({ page }) => {
  await page.getByRole('button', { name: 'Open transfer', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Transfer Assets', exact: true });
  await expect(dialog.getByRole('button', { name: 'Approve Plants', exact: true })).toBeEnabled();
  await page.evaluate(() => window.seedStaleApproval());
  const popup = dialog.locator('[data-testid="ockToast"][data-state="open"]');
  await expect(popup).toContainText('Confirmation delayed');
  await expect(dialog.getByText('More options', { exact: true })).toHaveCount(1);
  await popup.getByRole('button', { name: 'Dismiss transaction status' }).click();
  await expect(dialog.getByTestId('ockToast')).toHaveCount(0);
  await expect(dialog.getByText('Confirmation delayed', { exact: true })).toHaveCount(0);
  await expect(dialog.getByText('More options', { exact: true })).toHaveCount(1);
  await dialog.getByText('More options', { exact: true }).click();
  await dialog.locator('details').getByRole('button', { name: 'Continue', exact: true }).click();
  await expect(dialog.getByRole('button', { name: 'Approve Plants', exact: true })).toBeEnabled();
  expect(await page.evaluate(() => window.fixtureWallet.walletCalls)).toBe(0);
});

for (const enlarged of [false, true]) {
  test(`staking labels fit while idle, claiming, rejected and confirmed${enlarged ? ' at 200% text' : ''}`, async ({ page }) => {
    if (enlarged) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    await page.getByRole('button', { name: 'Open staking', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Stake SEED' });
    const claim = dialog.getByRole('button', { name: 'Claim Rewards', exact: true });
    await expect(claim).toBeEnabled();
    await expectContentInside(claim);
    await page.evaluate(() => { window.fixtureWallet.deferWallet = true; });
    await claim.click();
    const pending = dialog.getByRole('button', { name: 'Claiming rewards…', exact: true });
    await expect(pending).toBeDisabled();
    await expectContentInside(pending);
    await expect(pending.getByTestId('ockSpinner')).toBeVisible();
    const stakeBox = (await dialog.getByRole('button', { name: 'Stake', exact: true }).boundingBox())!;
    const claimBox = (await pending.boundingBox())!;
    if (Math.abs(stakeBox.y - claimBox.y) < 1) expect(stakeBox.height).toBeCloseTo(claimBox.height, 0);
    await dialog.screenshot({ path: test.info().outputPath(`staking-claiming${enlarged ? '-200pct' : ''}.png`) });
    await expect.poll(() => page.evaluate(() => Boolean(window.fixtureWallet.resolveWallet))).toBe(true);
    await page.evaluate(() => window.fixtureWallet.resolveWallet?.());
    const retry = dialog.getByTestId('ockTransactionButton_Button').filter({ hasText: 'Try again' });
    await expect(retry).toBeEnabled();
    await expectContentInside(retry);
    await page.evaluate(() => { window.fixtureWallet.rejectWallet = false; });
    await retry.click();
    const success = dialog.getByTestId('ockTransactionButton_Button').filter({ hasText: 'View transaction' });
    await expect(success).toBeEnabled();
    await expectContentInside(success);
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  });

  test(`compact transaction buttons contain disabled and delayed labels${enlarged ? ' at 200% text' : ''}`, async ({ page }) => {
    if (enlarged) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const actions = page.getByRole('region', { name: 'Compact transaction actions' });
    await expectContentInside(actions.getByRole('button', { name: 'Insufficient SEED balance', exact: true }));
    await page.evaluate(() => { window.fixtureWallet.ambiguousWallet = true; });
    await actions.getByRole('button', { name: 'Claim', exact: true }).click();
    const delayed = actions.getByTestId('ockTransactionButton_Button');
    await expect(delayed).toHaveText('Confirmation delayed');
    await expectContentInside(delayed);
  });
}
