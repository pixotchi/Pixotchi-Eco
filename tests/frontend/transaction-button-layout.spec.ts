import { expect, test, type Locator } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import type { fixtureWallet } from './fixtures/transaction-core-wallet';

declare global {
  interface Window { fixtureWallet: typeof fixtureWallet }
}

let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    entryPoints: [path.resolve('tests/frontend/fixtures/transaction-button-layout.tsx')],
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
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
