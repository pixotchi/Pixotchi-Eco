import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { carePurchaseLabel } from '../../lib/care-copy';

let bundle: string;
let css: string;
test.beforeAll(async () => {
  const io = path.resolve('tests/frontend/fixtures/gameplay-low-io.tsx');
  const tx = path.resolve('tests/frontend/fixtures/gameplay-low-transaction.tsx');
  const result = await build({ entryPoints: [path.resolve('tests/frontend/fixtures/gameplay-low.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'gameplay-external-io', setup(builder) {
    builder.onResolve({ filter: /^(wagmi|next\/image|ethereum-identity-kit|@\/components\/solana|@\/components\/hooks\/(usePrimaryName|useEnsAvatar)|@\/hooks\/(useSeedPurchaseQuote|useQuestRewardsAvailability|useQuestConfiguration)|@\/lib\/(farm-view-context|balance-context|smart-wallet-context|eth-mode-context|mission-tracking|efp-service))$/ }, () => ({ path: io }));
    builder.onResolve({ filter: /(^|\/)contracts$/ }, () => ({ path: io }));
    builder.onResolve({ filter: /(game-transaction|smart-wallet-transaction|approval-action-transaction|solana-bridge-button|swap-plant-name-bundle)$/ }, () => ({ path: tx }));
    builder.onResolve({ filter: /(^ethereum-identity-kit\/css$|identity-kit\.css$)/ }, () => ({ path: 'empty', namespace: 'empty-css' }));
    builder.onLoad({ filter: /.*/, namespace: 'empty-css' }, () => ({ contents: '', loader: 'js' }));
  } }] });
  bundle = result.outputFiles[0].text;
  const cssPath = path.resolve('app/globals.css');
  css = (await postcss([tailwind()]).process(await readFile(cssPath, 'utf8'), { from: cssPath })).css;
});

async function open(page: Page, scenario: string) {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://gameplay-low.test/**', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div>' }));
  await page.goto(`http://gameplay-low.test/?scenario=${scenario}`);
  await page.evaluate(() => document.documentElement.classList.add(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('[data-fixtures-ready]')).toBeVisible();
  expect(errors).toEqual([]);
}

test('empty farm selects the correct mint target without a large empty panel', async ({ page }) => {
  await open(page, 'empty');
  for (const asset of ['plant', 'land']) {
    await page.getByRole('button', { name: `Get your first ${asset}` }).click();
    await expect(page.getByLabel('Mint target')).toHaveText(asset);
    await expect(page.getByLabel('Navigation target')).toHaveText('mint');
  }
  expect(await page.locator('main').evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect((await page.getByText('Your farm starts here').locator('..').boundingBox())!.height).toBeLessThan(500);
});

test('both actual rename dialogs preserve Unicode drafts and explain contract validation', async ({ page }, testInfo) => {
  await open(page, 'names');
  for (const asset of ['plant', 'land']) {
    await page.getByRole('button', { name: new RegExp(`Change ${asset} name`, 'i') }).click();
    const input = page.getByRole('textbox', { name: 'New name' });
    await input.fill('🌻🌻🌻');
    await expect(input).toHaveValue('🌻🌻🌻');
    await expect(input).toHaveAttribute('aria-invalid', 'true');
    await expect(input).toHaveAccessibleDescription(/too long/);
    await expect(page.locator('[role=dialog] [data-transaction-controller]').last()).toBeDisabled();
    await input.fill('a');
    await expect(input).toHaveAccessibleDescription(/too short/);
    await input.fill('  ');
    await expect(input).toHaveAccessibleDescription(/Enter a name/);
    await input.fill('Café');
    await expect(input).toHaveAttribute('aria-invalid', 'false');
    await expect(page.locator('[role=dialog] [data-transaction-controller]').last()).toBeEnabled();
    await page.getByText('Exact name limits', { exact: true }).click();
    await expect(page.getByText(/Your name uses 5/)).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath(`rename-${asset}.png`) });
    await page.getByRole('button', { name: 'Close dialog', exact: true }).click();
  }
});

test('asset titles stay centered with equal edit columns at phone tablet and desktop widths', async ({ page }) => {
  await open(page, 'title');
  for (const width of [320, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const heading = await page.getByRole('heading').boundingBox();
    const grid = await page.getByRole('heading').locator('..').boundingBox();
    const edit = await page.getByRole('button', { name: 'Edit name' }).boundingBox();
    expect(Math.abs(heading!.x + heading!.width / 2 - grid!.x - grid!.width / 2)).toBeLessThan(1);
    expect(edit!.width).toBeGreaterThanOrEqual(44); expect(edit!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('both rename drafts and pending controls survive live name refreshes', async ({ page }) => {
  for (const asset of ['plant', 'land']) {
    await open(page, 'names');
    await page.getByRole('button', { name: `Change ${asset} name`, exact: true }).click();
    const input = page.getByRole('textbox', { name: 'New name' });
    await input.fill('My draft');
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-name-refresh', { detail: 'Changed' })));
    await expect(input).toHaveValue('My draft');
    const controller = page.locator('[role=dialog] [data-transaction-controller]');
    const identity = await controller.getAttribute('data-controller-id');
    await controller.click();
    await expect(input).toBeDisabled();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent('fixture-name-refresh', { detail: 'Refreshed' })));
    await expect(input).toHaveValue('My draft');
    await expect(input).toBeDisabled();
    await expect(controller).toHaveAttribute('data-controller-id', identity!);
  }
});

test('old rename success timers and callbacks cannot dismiss a reopened draft', async ({ page }) => {
  await page.clock.install();
  for (const asset of ['plant', 'land']) for (const successBeforeClose of [true, false]) {
    await open(page, 'names');
    const trigger = page.getByRole('button', { name: `Change ${asset} name`, exact: true });
    await trigger.click();
    const input = page.getByRole('textbox', { name: 'New name' });
    await input.fill('My draft');
    await page.locator('[role=dialog] [data-transaction-controller]').click();
    await expect(input).toBeDisabled();
    if (successBeforeClose) {
      await page.evaluate(() => window.dispatchEvent(new Event('fixture-transaction-success')));
      await expect(input).toBeEnabled();
    }
    await page.keyboard.press('Escape');
    await trigger.click();
    await input.fill('Next draft');
    if (!successBeforeClose) await page.evaluate(() => window.dispatchEvent(new Event('fixture-transaction-success')));
    await page.clock.fastForward(1001);
    await expect(input).toHaveValue('Next draft');
    await expect(input).toBeEnabled();
    await expect(page.locator('output[aria-label="Next action"]')).toHaveText(`${asset}:1:My draft`);
  }
});

test('dead first-care guidance routes to revival and claim explains each consequence once', async ({ page }) => {
  await open(page, 'guidance');
  await expect(page.getByText('Revive your plant first')).toBeVisible();
  await expect(page.getByText(/Choose a care item/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Review revival' }).click();
  await expect(page.getByLabel('Next action')).toHaveText('revival');
  await expect(page.getByText(/Claiming removes all of this plant/)).toHaveCount(1);
  await expect(page.getByText('1.5 → 0 PTS')).toBeVisible();
  await expect(page.getByText('12 → 1')).toBeVisible();
  await expect(page.getByText('Current claimable reward')).toBeVisible();
  expect(carePurchaseLabel('Magic Berries', 3)).toBe('Buy 3 × Magic Berries');
  expect(carePurchaseLabel('Water', 1)).toBe('Buy Water');
});

test('empty warehouse retains resources, hides form work, and routes to plant minting', async ({ page }, testInfo) => {
  await open(page, 'warehouse');
  await expect(page.getByText('No plants in this wallet')).toBeVisible();
  await expect(page.getByText('12 PTS').first()).toBeVisible();
  await expect(page.getByText('60 min plant lifetime')).toBeVisible();
  await expect(page.getByRole('textbox')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Max', exact: true })).toHaveCount(0);
  // The controllers stay mounted during owner/read transitions.
  await expect(page.locator('[data-transaction-controller]')).toHaveCount(2);
  await page.screenshot({ path: testInfo.outputPath('warehouse-empty.png') });
  await page.getByRole('button', { name: 'Get your first plant' }).click();
  await expect(page.getByLabel('Mint target')).toHaveText('plant');
  await expect(page.getByLabel('Navigation target')).toHaveText('mint');
});

test('batch collection explains the supported route and suppresses zero gains', async ({ page }) => {
  await open(page, 'claim-locked');
  await expect(page.getByText('1 building remaining')).toBeVisible();
  await expect(page.getByText('This batch: 1 building', { exact: true })).toBeVisible();
  await expect(page.getByText(/\+0/)).toHaveCount(0);
  await page.getByRole('button', { name: 'Collect from a building' }).click();
  await expect(page.getByLabel('Next action')).toHaveText('village');
});

test('missing farmers take precedence and both quest limitations offer a next step', async ({ page }) => {
  await open(page, 'quest-empty');
  await expect(page.getByText('Smart Wallet Required')).toHaveCount(0);
  await page.getByRole('button', { name: 'View Farmer House' }).click();
  await expect(page.getByLabel('Next action')).toHaveText('farmer-house');
  await open(page, 'quest-locked');
  await page.getByRole('button', { name: 'Manage farmers individually' }).click();
  await expect(page.getByLabel('Next action')).toHaveText('farmer-house');
  await open(page, 'quest-pending');
  await expect(page.locator('[data-transaction-controller]')).toHaveCount(1);
  await expect(page.getByRole('button', { name: /Manage farmers individually|View Farmer House/ })).toHaveCount(0);
});

test('profile preserves the full long owner identity at 320px and doubled text size', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 900 });
  await open(page, 'profile');
  await page.evaluate(() => {
    document.querySelectorAll<HTMLElement>('[role=dialog] *').forEach(node => { const size = parseFloat(getComputedStyle(node).fontSize); node.dataset.originalSize = String(size); });
    document.querySelectorAll<HTMLElement>('[data-original-size]').forEach(node => { node.style.fontSize = `${Number(node.dataset.originalSize) * 2}px`; });
  });
  const identity = page.getByText(`${'averylongplayeridentity'.repeat(12)}.base.eth`, { exact: true });
  await expect(identity).toBeVisible();
  expect(await identity.evaluate(node => node.scrollWidth <= node.clientWidth)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});
