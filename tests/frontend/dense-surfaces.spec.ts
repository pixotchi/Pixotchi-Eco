import { test, expect } from '@playwright/test';
import { openFrontendFixture } from './helpers/bootstrap';

test.beforeEach(async ({ page }, testInfo) => {
  await openFrontendFixture(page, testInfo, 'dense');
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.evaluate(theme => document.documentElement.classList.add(theme), testInfo.project.name.endsWith('dark') ? 'dark' : 'light');
});

test('battle reports preserve hidden intelligence and table semantics without overflow', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Barracks report fixture' });
  const defender = region.getByRole('table', { name: /Defender/ });
  await expect(defender.getByTitle('Unknown: no surviving troops returned')).toHaveCount(4);
  await expect(defender.getByRole('columnheader', { name: 'Swordsman' })).toBeVisible();
  await expect(region).toContainText('12345678901234567890');
  expect(await region.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await region.getByRole('button', { name: 'Defense report' }).click();
  await expect(defender).toContainText('9876');
  await expect(defender.getByTitle('Unknown: no surviving troops returned')).toHaveCount(0);
  await region.getByRole('button', { name: 'Empty report' }).click();
  await expect(region).toContainText('No attack report recorded yet');
  await expect(region.getByRole('table')).toHaveCount(0);
  await region.getByRole('button', { name: 'Failed report' }).click();
  await expect(region.getByRole('alert')).toContainText('Attack report unavailable');
  await expect(region).not.toContainText('No attack report recorded yet');
  await region.getByRole('button', { name: 'Retry' }).click();
  await expect(region.getByRole('table')).toHaveCount(2);
});

test('chat long content and profile actions fit with readable timestamps', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Chat message fixture' });
  await expect(region.getByRole('heading', { name: 'Your next steps' })).toBeVisible();
  const button = region.getByRole('button', { name: /Open profile for/ });
  const box = (await button.boundingBox())!;
  // Profile is a secondary inline action; it must not inflate every message header.
  expect(box.height).toBeGreaterThanOrEqual(24);
  expect(box.height).toBeLessThanOrEqual(28);
  await button.click();
  await expect(region.getByLabel('Fixture profile visits')).toHaveText('1');
  await expect(region.locator('time')).toHaveCount(3);
  expect(await region.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await region.getByRole('article').evaluateAll(els => els.every(el => el.scrollWidth <= el.clientWidth + 1))).toBe(true);
  const publicBubble = region.getByRole('article', { name: /Message from A very long/ });
  const assistantBubble = region.getByRole('article', { name: 'Message from Neural Seed', exact: true });
  const surface = (element: HTMLElement | SVGElement) => ({ background: getComputedStyle(element).backgroundColor, image: getComputedStyle(element).backgroundImage, border: getComputedStyle(element).borderTopWidth });
  const publicSurface = await publicBubble.evaluate(surface);
  expect(publicSurface).toEqual(await assistantBubble.evaluate(surface));
  expect(publicSurface.background).not.toBe('rgba(0, 0, 0, 0)');
  expect(publicSurface.image).toContain('linear-gradient');
  expect(publicSurface.border).toBe('1px');
  expect(await button.evaluate(el => getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
});

test('arcade values wrap and ranking columns keep continuous order', async ({ page }, testInfo) => {
  const region = page.getByRole('region', { name: 'Arcade readout fixture' });
  await expect(region.locator('dt')).toHaveText(['Stars available', 'Cooldown', 'Confirmation']);
  expect(await region.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (testInfo.project.use.viewport!.width >= 864) {
    const ranking = page.getByRole('region', { name: 'Ranking columns fixture' });
    await expect(ranking.getByText('Ranks #1-10', { exact: true })).toBeVisible();
    await expect(ranking.getByText('Rank #11', { exact: true })).toBeVisible();
    await expect(ranking.getByText('Player #11', { exact: true })).toBeVisible();
  }
});

test('reviewed dense surface appearance', async ({ page }, testInfo) => {
  test.skip(process.platform !== 'win32' || !['390-light', '1440-dark', 'webkit-390-light'].includes(testInfo.project.name), 'Baselines are reviewed on Windows in these three contexts.');
  await expect(page.getByRole('heading', { name: 'Your next steps' })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  for (const name of ['barracks', 'chat', 'arcade']) {
    const surface = page.locator(`[data-visual=${name}]`);
    await surface.scrollIntoViewIfNeeded();
    // Isolate raster comparisons from fractional origins in preceding fixtures.
    // This moves only the capture wrapper; component geometry remains unchanged.
    await surface.evaluate(element => {
      const { x, y } = element.getBoundingClientRect();
      element.style.translate = `${Math.round(x) - x}px ${Math.round(y) - y}px`;
    });
    await expect(surface).toHaveScreenshot(`${name}.png`, { animations: 'disabled', caret: 'hide', scale: 'css', threshold: name === 'chat' ? 0.05 : 0.2 });
  }
});

test('land ranking failures retry one shared read without becoming an empty result', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Land ranking query fixture' });
  await expect(region.getByLabel('Land ranking read count')).toHaveText('1');
  await region.getByRole('button', { name: 'Fail ranking read' }).click();
  await expect(region.getByRole('alert')).toContainText('Land ranking unavailable');
  await expect(region).not.toContainText('No lands ranked yet');
  await region.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(region.getByLabel('Land ranking read count')).toHaveText('2');
  await region.getByRole('button', { name: 'Resolve ranking read' }).click();
  await expect(region.getByRole('listitem')).toHaveText(['1. Land 2', '2. Land 1']);
  await expect(region.getByLabel('Second ranking observer count')).toHaveText('2');
});

test('spin configuration failure never advertises a ready action', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Spin read fixture' });
  await expect(region.getByRole('heading')).toHaveText('Spin status unavailable');
  await expect(region.getByRole('button', { name: 'Start fixture spin' })).toBeDisabled();
  await region.getByRole('button', { name: 'Retry spin read' }).click();
  await expect(region.getByRole('heading')).toHaveText('Loading spin status');
  await region.getByRole('button', { name: 'Resolve spin read' }).click();
  await expect(region.getByRole('button', { name: 'Start fixture spin' })).toBeEnabled();
  await region.getByRole('button', { name: 'Fail spin refresh' }).click();
  await expect(region.getByRole('heading')).toHaveText('Spin status unavailable');
  await expect(region.getByRole('button', { name: 'Start fixture spin' })).toBeDisabled();
});
