import { expect, test, type Page, type Route } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';

const vendorUrl = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
const chartUrl = 'https://chart-fixture.test/widget';
const vendorScript = `(() => {
  const script = document.currentScript;
  const host = script.parentElement;
  const config = JSON.parse(script.textContent);
  window.top.chartExecutions.push(config);
  if (!host.isConnected) throw new Error('Vendor host was detached before execution');
  const frame = document.createElement('iframe');
  frame.title = 'Chart content';
  frame.src = '${chartUrl}';
  frame.style.cssText = 'width:100%;height:100%;border:0';
  host.querySelector('.tradingview-widget-container__widget')?.remove();
  host.append(frame);
  if (!frame.contentWindow) throw new Error('Vendor iframe contentWindow unavailable');
  window.addEventListener('message', () => {});
})();`;

let bundle: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: [path.resolve('tests/frontend/fixtures/tradingview-lifecycle.tsx')], bundle: true,
    write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' } });
  bundle = result.outputFiles[0].text;
});

async function mount(page: Page, performanceMode = false) {
  await page.route('http://tradingview-fixture.test/', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('http://tradingview-fixture.test/');
  await page.evaluate(enabled => {
    localStorage.setItem('pixotchi:performance-mode', enabled ? '1' : '0');
    Object.assign(window, { chartExecutions: [] });
  }, performanceMode);
  // This fixture tests browsing-context lifecycle; layout uses only a fixed
  // chart viewport and the production loading host's accessibility attribute.
  await page.addStyleTag({ content: 'iframe{width:100%;height:100%;border:0}[aria-hidden="true"]{visibility:hidden}.h-full{height:100%}.w-full{width:100%}' });
  await page.addScriptTag({ content: bundle });
}

const executions = (page: Page) => page.evaluate(() => (window as unknown as { chartExecutions: Array<{ theme: string; symbol: string }> }).chartExecutions);

test('waits for the chart frame, then reloads the theme and symbol without reloading on resize', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  let chartRequest: Route | undefined;
  await page.route(vendorUrl, route => route.fulfill({ contentType: 'text/javascript', body: vendorScript }));
  await page.route(chartUrl, route => { chartRequest = route; });
  await mount(page);
  await expect.poll(() => Boolean(chartRequest)).toBe(true);
  await expect(page.getByRole('status')).toHaveText('Loading chart…');
  await expect(page.locator('section iframe').locator('..')).toHaveAttribute('aria-hidden', 'true');
  await chartRequest!.fulfill({ contentType: 'text/html', body: '<p>Chart ready</p>' });
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.locator('section iframe')).toHaveAccessibleName('Price chart by TradingView');
  await expect(page.locator('section iframe').locator('..')).toHaveAttribute('aria-hidden', 'false');
  await page.unroute(chartUrl);
  await page.route(chartUrl, route => route.fulfill({ contentType: 'text/html', body: '<p>Chart ready</p>' }));
  await page.setViewportSize({ width: 864, height: 800 });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await executions(page)).toHaveLength(1);
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await expect.poll(async () => (await executions(page)).at(-1)?.theme).toBe('dark');
  await page.getByRole('button', { name: 'Change chart symbol' }).click();
  await expect.poll(async () => (await executions(page)).at(-1)?.symbol).toBe('COINBASE:ETHUSD');
  await expect(page.getByRole('status')).toHaveCount(0);
  await expect(page.locator('section iframe')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Activity and unmount dispose pending vendor documents before scripts can execute', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  const pending: Route[] = [];
  await page.route(vendorUrl, route => { pending.push(route); });
  await page.route(chartUrl, route => route.fulfill({ contentType: 'text/html', body: '<p>Chart ready</p>' }));
  await mount(page);
  await expect.poll(() => pending.length).toBe(1);
  await page.getByRole('button', { name: 'Toggle chart activity' }).click();
  await expect(page.locator('section iframe')).toHaveCount(0);
  await pending[0].fulfill({ contentType: 'text/javascript', body: vendorScript });
  await page.getByRole('button', { name: 'Toggle chart activity' }).click();
  await expect.poll(() => pending.length).toBe(2);
  await page.getByRole('button', { name: 'Toggle chart mount' }).click();
  await expect(page.locator('section iframe')).toHaveCount(0);
  await pending[1].fulfill({ contentType: 'text/javascript', body: vendorScript });
  await page.getByRole('button', { name: 'Toggle chart mount' }).click();
  await expect.poll(() => pending.length).toBe(3);
  await pending[2].fulfill({ contentType: 'text/javascript', body: vendorScript });
  await expect(page.getByRole('status')).toHaveCount(0);
  expect(await executions(page)).toHaveLength(1);
  expect(errors).toEqual([]);
});

test('performance mode creates no vendor frame and destroys a loading frame when enabled', async ({ page }) => {
  const pending: Route[] = [];
  await page.route(vendorUrl, route => { pending.push(route); });
  await mount(page, true);
  await expect(page.getByText('Chart paused', { exact: true })).toBeVisible();
  await expect(page.locator('section iframe')).toHaveCount(0);
  expect(pending).toHaveLength(0);
  await page.getByRole('button', { name: 'Toggle performance mode' }).click();
  await expect.poll(() => pending.length).toBe(1);
  await page.getByRole('button', { name: 'Toggle performance mode' }).click();
  await expect(page.getByText('Chart paused', { exact: true })).toBeVisible();
  await expect(page.locator('section iframe')).toHaveCount(0);
  await pending[0].fulfill({ contentType: 'text/javascript', body: vendorScript });
  expect(await executions(page)).toHaveLength(0);
});

test('script failures and stalled frames offer retry, and a retry can recover', async ({ page }) => {
  let attempt = 0;
  await page.route(vendorUrl, route => {
    attempt += 1;
    return attempt === 1 ? route.abort('failed') : route.fulfill({ contentType: 'text/javascript', body: vendorScript });
  });
  let chartRequest: Route | undefined;
  await page.route(chartUrl, route => { chartRequest = route; });
  await mount(page);
  await expect(page.getByRole('alert')).toContainText('Chart unavailable');
  await page.clock.install();
  await page.getByRole('button', { name: 'Retry chart' }).click();
  await expect.poll(() => Boolean(chartRequest)).toBe(true);
  await expect(page.getByRole('status')).toHaveText('Loading chart…');
  await page.clock.fastForward(30_001);
  await expect(page.getByRole('alert')).toContainText('Chart unavailable');
  // A slow iframe may still finish after the timeout. Its own load signal
  // recovers the existing chart, without a second request or a stale spinner.
  await chartRequest!.fulfill({ contentType: 'text/html', body: '<p>Chart ready</p>' });
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('section iframe').locator('..')).toHaveAttribute('aria-hidden', 'false');
  expect(attempt).toBe(2);
});
