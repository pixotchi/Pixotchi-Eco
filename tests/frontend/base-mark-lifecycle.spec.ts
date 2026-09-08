import { expect, test } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';

let bundle: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: [path.resolve('tests/frontend/fixtures/base-marks.tsx')], bundle: true,
    write: false, format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' } });
  bundle = result.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  await page.goto('/qa/economy-layout');
  const styles = await page.locator('link[rel="stylesheet"]').evaluateAll(elements => elements.map(element => (element as HTMLLinkElement).href));
  const css = await Promise.all(styles.map(async url => (await page.request.get(url)).text()));
  await page.route('http://base-mark.test/**', route => route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' }));
  await page.goto('http://base-mark.test/');
  await page.addStyleTag({ content: css.join('\n') });
  await page.clock.install();
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => {
    let calls = 0;
    Math.random = () => { calls += 1; return ((calls % 8) + 0.5) / 8; };
    Object.assign(window, { getBaseColorCalls: () => calls });
  });
  await page.addScriptTag({ content: bundle });
  await expect(page.getByRole('status')).toHaveText('Connecting to Base');
});

test('both marks share identical decorative artwork and loading remains announced once', async ({ page }) => {
  const about = page.getByLabel('About mark').locator('svg');
  const loading = page.getByLabel('Loading mark').locator('svg');
  expect(await about.locator('path').evaluateAll(paths => paths.map(path => path.getAttribute('d'))))
    .toEqual(await loading.locator('path').evaluateAll(paths => paths.map(path => path.getAttribute('d'))));
  await expect(about).toHaveAttribute('aria-hidden', 'true');
  await expect(loading).toHaveAttribute('aria-hidden', 'true');
  await expect(page.getByRole('status')).toHaveCount(1);
});

test('color loops pause while hidden, with reduced motion and performance mode, resume, and clean up on unmount', async ({ page }) => {
  const colors = () => page.getByLabel('Loading mark').locator('path').evaluateAll(paths => paths.map(path => path.getAttribute('fill')));
  const readCalls = () => page.evaluate(() => (window as unknown as { getBaseColorCalls: () => number }).getBaseColorCalls());
  const initial = await colors();
  await page.clock.runFor(150);
  // Fake timers execute the color callback, but React commits its state on a
  // separate browser task. Observe that commit before measuring a pause.
  await expect.poll(colors, { message: 'the initial color tick is rendered' }).not.toEqual(initial);
  for (const mode of ['hidden', 'reduced', 'performance']) {
    if (mode === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
    if (mode === 'reduced') await page.emulateMedia({ reducedMotion: 'reduce' });
    if (mode === 'performance') await page.getByRole('button', { name: 'Toggle performance mode' }).click();
    const paused = await colors();
    const pausedCalls = await readCalls();
    await page.clock.runFor(4500);
    expect(await colors()).toEqual(paused);
    expect(await readCalls(), `${mode} stops color work`).toBe(pausedCalls);
    if (mode === 'hidden') await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
    if (mode === 'reduced') await page.emulateMedia({ reducedMotion: 'no-preference' });
    if (mode === 'performance') await page.getByRole('button', { name: 'Toggle performance mode' }).click();
    // Browser media-query events arrive on the rendering task queue, separately from emulation.
    await expect.poll(async () => { await page.clock.runFor(150); return readCalls(); }, { message: `${mode} resumes color work` }).toBeGreaterThan(pausedCalls);
    await expect.poll(colors, { message: `${mode} resumed colors are rendered before the next pause` }).not.toEqual(paused);
  }
  await page.getByRole('button', { name: 'Unmount marks' }).click();
  const stopped = await readCalls();
  await page.clock.runFor(4500);
  expect(await readCalls()).toBe(stopped);
});

test('touch activation ignores synthesized mouse echoes and a second tap closes the fixed-footprint mark', async ({ page }) => {
  const svg = page.getByLabel('About mark').locator('svg');
  const target = svg.locator('..');
  const footprint = await target.boundingBox();
  expect(footprint?.width).toBe(200);
  expect(footprint?.height).toBe(60);
  await target.dispatchEvent('touchstart');
  await expect(svg).toHaveClass(/opacity-100/);
  await target.dispatchEvent('mouseover');
  await target.dispatchEvent('mouseout');
  await expect(svg).toHaveClass(/opacity-100/);
  await target.dispatchEvent('touchstart');
  await expect(svg).toHaveClass(/opacity-0/);
  expect(await target.boundingBox()).toEqual(footprint);
});
