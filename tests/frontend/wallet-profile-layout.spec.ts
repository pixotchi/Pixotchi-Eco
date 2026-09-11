import { test, expect, type Locator, type Page } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

test.use({ trace: 'off', video: 'off' });
let bundle: string;
let css: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: [path.resolve('tests/frontend/fixtures/wallet-profile-layout.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'wallet-presentation-io', setup(builder) {
    builder.onResolve({ filter: /^(wagmi|next\/image|@farcaster\/miniapp-sdk|@privy-io\/react-auth(?:\/solana)?|@\/components\/(solana|airdrop-claim-card|hooks\/(usePrimaryName|useEnsAvatar))|@\/hooks\/useAuthSurface|@\/lib\/(balance-context|contracts|eth-mode-context|frame-context|smart-wallet-context|solana-constants|owner-resource-invalidation|disconnect-wallet-identity))$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/wallet-profile-layout-mocks.tsx') }));
    builder.onResolve({ filter: /transactions\/transfer-assets-dialog$/ }, () => ({ path: 'transfer', namespace: 'fixture-transfer' }));
    builder.onLoad({ filter: /.*/, namespace: 'fixture-transfer' }, () => ({ contents: 'export default function TransferAssetsDialog() { return null; }' }));
  } }] });
  bundle = result.outputFiles[0].text;
  const from = path.resolve('app/globals.css');
  css = (await postcss([tailwind()]).process(await readFile(from, 'utf8'), { from })).css;
});

async function open(page: Page, enlarged = false) {
  page.on('pageerror', error => { throw error; });
  await page.route('http://wallet-layout.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname !== '/') {
      const file = path.resolve('public', '.' + pathname);
      if (!file.startsWith(path.resolve('public') + path.sep)) return route.abort();
      const contentType = pathname.endsWith('.woff2') ? 'font/woff2' : pathname.endsWith('.svg') ? 'image/svg+xml' : 'image/png';
      return route.fulfill({ contentType, body: await readFile(file) });
    }
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><head></head><body><div id="root"></div></body></html>' });
  });
  await page.goto('http://wallet-layout.test/');
  await page.addStyleTag({ content: css });
  await page.addStyleTag({ content: `@font-face { font-family: 'Fixture Coinbase'; src: url('/fonts/Coinbase-Sans/Coinbase_Sans-Regular-web-1.32.woff2'); font-weight:400; } @font-face { font-family:'Fixture Coinbase';src:url('/fonts/Coinbase-Sans/Coinbase_Sans-Medium-web-1.32.woff2');font-weight:500; } @font-face {font-family:'Fixture Coinbase';src:url('/fonts/Coinbase-Sans/Coinbase_Sans-Bold-web-1.32.woff2');font-weight:700;} html {--font-coinbase:'Fixture Coinbase';}` });
  await page.evaluate(({ enlarged, dark }) => { document.documentElement.style.fontSize = enlarged ? '200%' : '100%'; document.documentElement.classList.toggle('dark', dark); }, { enlarged, dark: test.info().project.name.includes('dark') });
  await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Open wallet profile' }).click();
  await expect(page.getByRole('dialog', { name: 'Wallet Profile' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

async function expectUnoccluded(locator: Locator) {
  await locator.scrollIntoViewIfNeeded();
  await expect.poll(() => locator.evaluate(element => {
    const box = element.getBoundingClientRect();
    return [[0.15, 0.15], [0.85, 0.15], [0.5, 0.5], [0.15, 0.85], [0.85, 0.85]].every(([x, y]) => {
      const hit = document.elementFromPoint(box.x + box.width * x, box.y + box.height * y);
      return hit === element || (hit !== null && element.contains(hit));
    });
  })).toBe(true);
  await locator.click({ trial: true });
}

for (const enlarged of [false, true]) test(`Wallet Profile keeps content and actions visually usable at ${enlarged ? '200%' : '100%'} text`, async ({ page }) => {
  await open(page, enlarged);
  const surface = page.locator('[data-viewport-debug-dialog-surface]');
  const together = enlarged && page.viewportSize()!.width <= 390;
  await expect(surface).toHaveAttribute('data-dialog-scroll', together ? 'content' : 'body');
  const close = page.getByRole('button', { name: 'Close dialog' });
  await expect(close).toBeFocused();
  expect((await close.boundingBox())?.width).toBe(44);
  expect((await close.boundingBox())?.height).toBe(44);
  expect((await close.locator('svg').boundingBox())?.width).toBe(20);
  const titleBox = (await page.getByRole('heading', { name: 'Wallet Profile', exact: true }).boundingBox())!;
  const closeBox = (await close.boundingBox())!;
  expect(titleBox.y).toBeGreaterThanOrEqual((await surface.boundingBox())!.y);
  expect(titleBox.x + titleBox.width).toBeLessThanOrEqual(closeBox.x);
  await page.screenshot({ path: test.info().outputPath(`header-${enlarged ? '200' : '100'}pct.png`) });
  await expect(page.getByRole('switch', { name: /^(ETH Mode|Performance Mode)$/ })).toHaveCount(0);
  const token = page.getByTitle('3 PIXOTCHI', { exact: true });
  await expectUnoccluded(token);
  await expect(token).toHaveAttribute('aria-label', '3 PIXOTCHI');
  // The word PIXOTCHI must fit on one line even if the amount precedes it on another.
  expect((await token.boundingBox())!.height).toBeLessThanOrEqual(enlarged ? 88 : 44);
  await page.screenshot({ path: test.info().outputPath(`balances-${enlarged ? '200' : '100'}pct.png`) });
  const footer = page.locator('[data-dialog-footer]');
  for (const name of ['Transfer Assets', 'Disconnect Wallet']) {
    const action = page.getByRole('button', { name, exact: true });
    await expectUnoccluded(action);
    expect(await action.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  await page.screenshot({ path: test.info().outputPath(`actions-${enlarged ? '200' : '100'}pct.png`) });
  const footerBefore = (await footer.boundingBox())!.y;
  const owner = page.locator(together ? '[data-dialog-scroll-content]' : '[data-dialog-body]');
  await owner.evaluate(element => { element.scrollTop = 0; });
  if (!together) expect((await footer.boundingBox())!.y).toBeCloseTo(footerBefore, 0);
  const scrollOwners = await surface.evaluate(element => Array.from(element.querySelectorAll('*')).filter(node => node instanceof HTMLElement && /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1).length);
  expect(scrollOwners).toBe(1);
  await expectUnoccluded(close);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open wallet profile' })).toBeFocused();
});

test('Wallet Profile preserves focused controls through text resize and a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  await open(page);
  const copy = page.getByRole('button', { name: 'Copy wallet address', exact: true });
  const originalControl = await copy.elementHandle();
  await copy.focus();
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  await expect(page.locator('[data-viewport-debug-dialog-surface]')).toHaveAttribute('data-dialog-scroll', 'content');
  await expect(copy).toBeFocused();
  expect(await copy.evaluate((element, original) => element === original, originalControl)).toBe(true);
  await expectUnoccluded(copy);
  await page.setViewportSize({ width: 320, height: 420 });
  await expectUnoccluded(copy);
  await page.evaluate(() => { document.documentElement.style.fontSize = '100%'; });
  await page.setViewportSize({ width: 820, height: 900 });
  await expect(page.locator('[data-viewport-debug-dialog-surface]')).toHaveAttribute('data-dialog-scroll', 'body');
  await expect(copy).toBeFocused();
  expect(await copy.evaluate((element, original) => element === original, originalControl)).toBe(true);
  await expectUnoccluded(copy);
  const scrollers = await page.locator('[data-viewport-debug-dialog-surface]').evaluate(element => Array.from(element.querySelectorAll('*')).filter(node => node instanceof HTMLElement && /auto|scroll/.test(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1).length);
  expect(scrollers).toBe(1);
});
