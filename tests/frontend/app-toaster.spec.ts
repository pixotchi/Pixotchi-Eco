import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';

let bundle: string;
let css: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: [path.resolve('tests/frontend/fixtures/app-toaster.tsx')], bundle: true,
    write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' } });
  bundle = result.outputFiles[0].text;
  const cssPath = path.resolve('app/globals.css');
  css = (await postcss([tailwind()]).process(await readFile(cssPath, 'utf8'), { from: cssPath })).css;
});

test.beforeEach(async ({ page }) => {
  await page.route('https://app-toaster.test/**', route => route.fulfill({ contentType: 'text/html',
    body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' }));
  await page.goto('https://app-toaster.test');
  await page.evaluate(() => document.documentElement.classList.add(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  await page.addStyleTag({ content: css });
  await page.clock.install();
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole('button', { name: 'Open parent', exact: true })).toBeVisible();
});

async function hidden(page: Page, value: boolean) {
  await page.evaluate(value => {
    Object.defineProperty(document, 'hidden', { configurable: true, value });
    document.dispatchEvent(new Event('visibilitychange'));
  }, value);
  await flushReact(page);
}
async function signal(page: Page, name: string) {
  await page.evaluate(name => window.dispatchEvent(new Event(name)), name);
  await flushReact(page);
}
async function flushReact(page: Page) {
  await page.evaluate(() => new Promise<void>(resolve => { const channel = new MessageChannel(); channel.port1.onmessage = () => { channel.port1.close(); channel.port2.close(); resolve(); }; channel.port2.postMessage(null); }));
}
async function advance(page: Page, milliseconds: number) {
  await page.clock.runFor(milliseconds);
  // Flush React work scheduled separately from the fake clock's callbacks.
  await flushReact(page);
}

test('new notifications are announced in empty parent/nested dialogs and survive host unmounts', async ({ page }) => {
  await page.getByRole('button', { name: 'Open parent', exact: true }).click();
  await page.getByRole('button', { name: 'Open nested', exact: true }).click();
  await page.getByRole('button', { name: 'Show nested feedback' }).click();
  const status = page.getByRole('status').filter({ hasText: 'Nested action complete' });
  await expect(status).toBeVisible();
  expect(await status.evaluate(element => element.closest('[aria-hidden="true"]'))).toBeNull();
  await expect(page.locator('[data-rht-toaster]')).toHaveCount(1);
  await expect(page.getByRole('dialog', { name: 'Nested dialog' }).locator('[data-rht-toaster]')).toHaveCount(1);
  await advance(page, 1000);
  await page.getByRole('dialog', { name: 'Nested dialog' }).getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('dialog', { name: 'Parent dialog' }).locator('[data-rht-toaster]')).toHaveCount(1);
  await expect(status).toBeVisible();
  await advance(page, 1000);
  await page.getByRole('dialog', { name: 'Parent dialog' }).getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(status).toBeVisible();
  await advance(page, 2100);
  await expect(status).toHaveCount(0);
  await expect(page.locator('[data-rht-toaster]')).toHaveCount(1);
});

test('default loading toasts persist until settled and completed results expire', async ({ page }) => {
  await page.getByRole('button', { name: 'Start pending quote' }).click();
  await advance(page, 30000);
  await expect(page.getByRole('status')).toHaveText('Refreshing quote');
  await signal(page, 'fixture:finish');
  await expect(page.getByRole('status')).toHaveText('Quote refreshed');
  await advance(page, 3900);
  await expect(page.getByRole('status')).toHaveText('Quote refreshed');
  await advance(page, 200);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('a loading toast resolved and a new result created while hidden get exactly their visible display time', async ({ page }) => {
  await page.getByRole('button', { name: 'Start pending quote' }).click();
  await hidden(page, true);
  await advance(page, 10000);
  await signal(page, 'fixture:finish');
  await signal(page, 'fixture:notify');
  await expect(page.getByRole('status')).toHaveCount(2);
  await advance(page, 20000);
  await expect(page.getByRole('status')).toHaveCount(2);
  await hidden(page, false);
  await advance(page, 3900);
  await expect(page.getByRole('status')).toHaveCount(2);
  await advance(page, 200);
  await expect(page.getByRole('status')).toHaveCount(0);
});

for (const resumeFirst of ['hover', 'visibility'] as const) test(`overlapping hover and hidden pauses resume only after both clear (${resumeFirst} first)`, async ({ page }) => {
  await page.getByRole('button', { name: 'Show result', exact: true }).click();
  const status = page.getByRole('status');
  await expect(status).toHaveText('Visible result');
  await advance(page, 1000);
  await status.hover();
  await flushReact(page);
  await hidden(page, true);
  await advance(page, 5000);
  if (resumeFirst === 'hover') await page.mouse.move(1, 700);
  else await hidden(page, false);
  await advance(page, 5000);
  await expect(status).toHaveText('Visible result');
  if (resumeFirst === 'hover') await hidden(page, false);
  else await page.mouse.move(1, 700);
  await advance(page, 2800);
  await expect(status).toHaveText('Visible result');
  await advance(page, 300);
  await expect(status).toHaveCount(0);
});

test('explicitly dismissed infinite custom notifications are removed even while hidden', async ({ page }) => {
  await page.getByRole('button', { name: 'Show persistent custom' }).click();
  await advance(page, 30000);
  await expect(page.getByRole('status')).toHaveText('Persistent notice');
  await hidden(page, true);
  await signal(page, 'fixture:dismiss-custom');
  await advance(page, 350);
  await expect(page.locator('[data-app-toast="custom"]')).toHaveCount(0);
});

test('toast.promise replaces its loading notification once and expires after visibility resumes', async ({ page }) => {
  await page.getByRole('button', { name: 'Start promised action' }).click();
  await advance(page, 6000);
  await expect(page.getByRole('status')).toHaveText('Saving selection');
  await hidden(page, true);
  await advance(page, 6000);
  await signal(page, 'fixture:finish-promise');
  await expect(page.getByRole('status')).toHaveText('Selection saved');
  await expect(page.locator('[data-app-toast]')).toHaveCount(1);
  await advance(page, 6000);
  await hidden(page, false);
  await advance(page, 3900);
  await expect(page.getByRole('status')).toHaveText('Selection saved');
  await advance(page, 200);
  await expect(page.getByRole('status')).toHaveCount(0);
});

test('per-notification position wins over the default and reduced/performance modes disable stacking motion', async ({ page }) => {
  await page.getByRole('button', { name: 'Show positioned notices' }).click();
  const top = page.getByRole('status').filter({ hasText: 'Default position' });
  const bottom = page.getByRole('status').filter({ hasText: 'Bottom right position' });
  await expect(top).toBeVisible();
  await expect(bottom).toBeVisible();
  const topBox = (await top.boundingBox())!;
  const bottomBox = (await bottom.boundingBox())!;
  expect(topBox.y).toBeLessThan(80);
  expect(bottomBox.y).toBeGreaterThan(page.viewportSize()!.height - 120);
  expect(bottomBox.x).toBeGreaterThan(page.viewportSize()!.width / 2 - 100);
  const wrapper = page.locator('[data-app-toast="default-position"]');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => wrapper.evaluate(element => getComputedStyle(element).transitionProperty)).not.toContain('transform');
  await page.evaluate(() => document.documentElement.classList.add('performance-mode'));
  await expect.poll(() => wrapper.evaluate(element => getComputedStyle(element).transitionProperty)).toBe('none');
});
