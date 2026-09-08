import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';

let bundle: string;
test.beforeAll(async () => {
  const result = await build({
    entryPoints: [path.resolve('tests/frontend/fixtures/economic-reads.tsx')],
    bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
    plugins: [{ name: 'economic-layout-io-only', setup(builder) {
      builder.onResolve({ filter: /^(wagmi|@\/lib\/base-rpc)$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/economic-read-io.ts') }));
      builder.onResolve({ filter: /(^|\/)base-rpc$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/economic-read-io.ts') }));
      builder.onResolve({ filter: /^@\/components\/transactions\/game-transaction$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/transaction-game-mock.tsx') }));
    } }],
  });
  bundle = result.outputFiles[0].text;
});

test.beforeEach(async ({ page }) => {
  // Use the application's compiled styles with real dialogs, substituting only reads and wallet submission.
  await page.goto('/qa/economy-layout');
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(elements => elements.map(element => (element as HTMLLinkElement).href));
  const css = await Promise.all(styles.map(async url => (await page.request.get(url)).text()));
  expect(css.length).toBeGreaterThan(0);
  const classes = await page.evaluate(() => ({ html: document.documentElement.className, body: document.body.className }));
  await page.route('http://economic-layout.test/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/staking/balance') return route.fulfill({ json: { success: true, balance: '10000000000000000000' } });
    if (url.pathname === '/api/staking/info') return route.fulfill({ json: { success: true, approved: true, stake: { staked: '5000000000000000000', rewards: '1000000000000000000' } } });
    if (url.pathname === '/rpc-fixture') return route.fulfill({ json: { amount: url.searchParams.get('kind') === 'allowance' ? '0' : '10000000000000000000' } });
    return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
  });
  await page.goto('http://economic-layout.test/');
  await page.evaluate(value => { document.documentElement.className = value.html; document.body.className = value.body; }, classes);
  await page.addStyleTag({ content: css.join('\n') });
  await page.addScriptTag({ content: bundle });
});

for (const enlarged of [false, true]) test(`economic dialogs keep controls reachable and text inside their scroll region${enlarged ? ' at 200% text size' : ''}`, async ({ page }) => {
  if (enlarged) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  for (const surface of ['staking', 'marketplace']) {
    await page.getByRole('button', { name: `Open ${surface}` }).click();
    const dialog = page.getByRole('dialog');
    const refresh = dialog.getByRole('button', { name: surface === 'staking' ? 'Refresh stake data' : 'Refresh', exact: true });
    await expect(refresh).toBeVisible();
    expect((await refresh.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    if (surface === 'marketplace') {
      const approve = dialog.getByRole('button', { name: 'Approve SEED', exact: true });
      await expect(approve).toBeEnabled();
      expect((await approve.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect(await approve.evaluate(element => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true);
      await page.route('**/rpc-fixture?**', route => route.fulfill({ json: { amount: '10000000000000000000' } }));
      await refresh.click();
      await dialog.getByRole('textbox', { name: 'Amount to sell' }).fill('1');
      await dialog.getByRole('textbox', { name: 'Price', exact: false }).fill('1');
      const create = dialog.getByRole('button', { name: 'Create Order', exact: true });
      await expect(create).toBeEnabled();
      expect((await create.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    }
    expect(await dialog.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await dialog.screenshot({ path: test.info().outputPath(`${surface}${enlarged ? '-200pct' : ''}.png`) });
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
  }
});
