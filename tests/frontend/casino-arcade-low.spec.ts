import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { RED_NUMBERS as publicRedNumbers } from '../../public/abi/casino-abi';
import { RED_NUMBERS, rouletteBetWins, ROULETTE_BET_TYPE } from '../../lib/casino-hardening-rules.mjs';
import { isGameTransactionFailure } from '../../lib/game-transaction-status';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';
import { PIXOTCHI_NFT_ADDRESS } from '../../lib/contracts';

let bundle: string;
let css: string;
test.beforeAll(async () => {
  const cssPath = path.resolve('app/globals.css');
  const [script, styles] = await Promise.all([
    build({ entryPoints: ['tests/frontend/fixtures/casino-arcade-low.tsx'], bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
      plugins: [{ name: 'box-wallet-boundary', setup(builder) {
        builder.onResolve({ filter: /^(wagmi|\.\/game-transaction)$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/arcade-result-transaction.tsx') }));
      } }],
    }),
    readFile(cssPath, 'utf8').then(source => postcss([tailwind()]).process(source, { from: cssPath })),
  ]);
  bundle = script.outputFiles[0].text;
  css = styles.css;
});

test('Box results appear above the scrolled content for gains, losses, empty rounds and missing receipts', async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://box-result.test/**', route => route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' }));
  await page.goto('http://box-result.test');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => { document.documentElement.className = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; });
  await page.getByRole('button', { name: 'Open Box Game', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Arcade result fixture' });
  const content = dialog.getByLabel('Arcade content', { exact: true });
  const notification = page.locator('[data-app-toast="box-result"]');
  const cases = [
    { points: 120e12, time: 3600, message: 'Box result: +120 PTS • +1h lifetime', gain: true },
    { points: -120e12, time: -3600, message: 'Box result: −120 PTS • −1h lifetime', gain: false },
    { points: 0, time: 3600, message: 'Box result: +1h lifetime', gain: true },
    { points: -120e12, time: 3600, message: 'Box result: −120 PTS • +1h lifetime', gain: false },
    { points: 0, time: 0, message: 'Box result: no reward this time.', gain: false },
    { points: 0, time: 0, message: 'Box play confirmed. The result is unavailable; check Activity.', gain: false, missing: true },
  ];
  let index = 0;
  for (const result of cases) {
    await dialog.getByRole('button', { name: 'Play box', exact: true }).click();
    const event = parseAbiItem('event PlayedV2(uint256 indexed id, int256 points, int256 timeExtension, string gameName)');
    const logs = result.missing ? [] : [{ address: PIXOTCHI_NFT_ADDRESS,
      topics: encodeEventTopics({ abi: [event], eventName: 'PlayedV2', args: { id: BigInt(7) } }),
      data: encodeAbiParameters([{ type: 'int256' }, { type: 'int256' }, { type: 'string' }], [BigInt(result.points), BigInt(result.time), 'BoxGame']),
    }];
    const status = { statusName: 'success', statusData: { transactionReceipts: [{ transactionHash: `0x${String(++index).repeat(64)}`, logs }] } };
    await page.evaluate(status => window.dispatchEvent(new CustomEvent('fixture:box-status', { detail: status })), status);
    await expect(notification.getByRole('status')).toHaveText(result.message);
    await expect(notification).toBeInViewport();
    await expect(dialog.locator('[data-app-toast="box-result"]')).toHaveCount(1);
    await expect(notification.locator('[data-toast-icon="success"]')).toHaveCount(result.gain ? 1 : 0);
    expect(await notification.evaluate(element => element.closest('[aria-hidden="true"]'))).toBeNull();
    expect(await content.evaluate(element => element.scrollTop)).toBe(0);
    if (!result.missing) await expect(content.getByText('Box result', { exact: true })).not.toBeInViewport();
    expect(await notification.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    await expect(dialog.getByLabel('Result callbacks', { exact: true })).toHaveText(String(index));
    // A repeated receipt must not announce or apply the same result twice.
    await page.evaluate(status => window.dispatchEvent(new CustomEvent('fixture:box-status', { detail: status })), status);
    await expect(dialog.getByLabel('Result callbacks', { exact: true })).toHaveText(String(index));
    if (index === 1) await page.screenshot({ path: testInfo.outputPath('box-result-popup.png') });
  }
  expect(errors).toEqual([]);
});

test('CA16 shared rules preserve failure and roulette zero decisions', () => {
  expect(publicRedNumbers).toBe(RED_NUMBERS);
  expect(RED_NUMBERS).toHaveLength(18);
  for (const failure of ['error', 'failed', 'reverted', 'cancelled', 'canceled', 'rejected', 'transactionRejected', 'userRejected', 'buildError']) expect(isGameTransactionFailure(failure)).toBe(true);
  for (const pending of ['idle', 'buildingTransaction', 'transactionPending', 'confirmedSyncing', 'success', 'unresolved']) expect(isGameTransactionFailure(pending)).toBe(false);
  for (let number = 1; number <= 36; number++) expect(rouletteBetWins(ROULETTE_BET_TYPE.RED, [], number)).toBe(RED_NUMBERS.includes(number));
  expect(rouletteBetWins(ROULETTE_BET_TYPE.BLACK, [], 0)).toBe(false);
});

for (const reducedMotion of ['reduce', 'no-preference'] as const) test(`CA15 ${reducedMotion} reward legend stays readable and confirmed indices reach the pointer`, async ({ page }, testInfo) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion });
  await page.route('http://spinleaf.test/**', async route => {
    const pathname = new URL(route.request().url()).pathname;
    if (pathname === '/icons/spinleaf.png') return route.fulfill({ contentType: 'image/png', body: await readFile(path.resolve('public/icons/spinleaf.png')) });
    return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
  });
  await page.goto('http://spinleaf.test/');
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await page.evaluate(() => { document.documentElement.className = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; });
  const outcomes = page.getByRole('list', { name: 'Possible SpinLeaf outcomes' });
  await expect(outcomes.getByRole('listitem')).toHaveCount(6);
  await expect(outcomes).toContainText('−120 PTS');
  await expect(outcomes).toContainText('+3 LEAF');
  await expect(outcomes).toContainText('No reward');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const row of await outcomes.getByRole('listitem').all()) {
    const box = await row.boundingBox();
    expect(box?.width).toBeGreaterThan(200);
  }
  await page.screenshot({ path: testInfo.outputPath('spinleaf-rewards.png'), fullPage: true });
  const rotor = page.locator('svg').locator('..');
  for (const action of ['Prepare reveal', 'Result unavailable']) {
    await page.getByRole('button', { name: 'Start animation', exact: true }).click();
    await expect(rotor).toHaveClass(/animate-/);
    const before = await rotor.evaluate((element, reduced) => {
      if (reduced) {
        element.style.animation = 'none';
        element.style.transform = 'rotate(123deg)';
      } else {
        const animation = element.getAnimations()[0];
        if (!animation) throw new Error('Missing SpinLeaf animation');
        animation.pause();
        animation.currentTime = 510;
      }
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return ((Math.atan2(matrix.b, matrix.a) * 180 / Math.PI) + 360) % 360;
    }, reducedMotion === 'reduce');
    expect(before).toBeGreaterThan(10);
    await page.getByRole('button', { name: action, exact: true }).click();
    const after = await rotor.evaluate(element => {
      const matrix = new DOMMatrixReadOnly(getComputedStyle(element).transform);
      return ((Math.atan2(matrix.b, matrix.a) * 180 / Math.PI) + 360) % 360;
    });
    expect(Math.abs(after - before)).toBeLessThan(0.1);
  }
  for (const [index, angle] of [[0, 330], [5, 30]]) {
    await page.getByRole('button', { name: 'Start animation', exact: true }).click();
    await page.getByRole('button', { name: `Resolve outcome ${index + 1}`, exact: true }).click();
    await expect.poll(() => rotor.evaluate(element => element.style.transform)).toBe(`rotate(${angle}deg)`);
    // Compare the confirmed icon's actual transformed center with the wheel's top pointer.
    const alignment = await page.locator('svg image').nth(index).evaluate(image => {
      if (!(image instanceof SVGGraphicsElement)) throw new Error('Missing reward icon');
      const matrix = image.getScreenCTM();
      const x = Number(image.getAttribute('x')) + Number(image.getAttribute('width')) / 2;
      const y = Number(image.getAttribute('y')) + Number(image.getAttribute('height')) / 2;
      const point = new DOMPoint(x, y).matrixTransform(matrix ?? new DOMMatrix());
      const box = image.closest('svg')!.getBoundingClientRect();
      return { deltaX: Math.abs(point.x - (box.left + box.width / 2)), aboveCenter: point.y < box.top + box.height / 2 };
    });
    expect(alignment.deltaX).toBeLessThan(2);
    expect(alignment.aboveCenter).toBe(true);
  }
  await page.getByRole('button', { name: 'Start animation', exact: true }).click();
  await page.getByRole('button', { name: 'Result unavailable', exact: true }).click();
  await expect(rotor).not.toHaveClass(/transition-transform/);
  expect(errors).toEqual([]);
});
