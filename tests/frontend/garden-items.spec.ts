import { test, expect } from '@playwright/test';
import { openFrontendFixture } from './helpers/bootstrap';

test.beforeEach(async ({ page }, testInfo) => {
  await openFrontendFixture(page, testInfo, 'primitives');
  await page.evaluate(theme => document.documentElement.classList.add(theme), testInfo.project.name.endsWith('dark') ? 'dark' : 'light');
});

test('large garden items display their category, effects, price and artwork', async ({ page }, testInfo) => {
  const catalog = page.getByRole('region', { name: 'Care catalog' });
  await expect(catalog.getByRole('button')).toHaveCount(12);
  const lifetime = catalog.getByRole('region', { name: 'Add lifetime', exact: true });
  const points = catalog.getByRole('region', { name: 'Increase points', exact: true });
  const hybrids = catalog.getByRole('region', { name: 'Points and lifetime', exact: true });
  for (const group of [lifetime, points, hybrids]) {
    await expect(group.getByRole('button')).toHaveCount(4);
    const grid = group.locator('.grid');
    const columns = await grid.evaluate(node => getComputedStyle(node).gridTemplateColumns.split(' ').length);
    expect(columns).toBe(4);
    for (const card of await group.getByRole('button').all()) {
      const cardWidth = (await card.boundingBox())!.width;
      expect(cardWidth).toBeGreaterThanOrEqual(44);
      expect(await card.locator('span').evaluateAll(nodes => nodes.every(node => parseFloat(getComputedStyle(node).fontSize) >= 12))).toBe(true);
    }
  }
  expect(await hybrids.getByRole('button').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))))
    .toEqual(['Select Dream Dew', 'Select Nitro', 'Select Everdew', 'Select Superbloom']);
  const superbloom = hybrids.getByRole('button', { name: 'Select Superbloom' });
  const everdew = hybrids.getByRole('button', { name: 'Select Everdew' });
  const raincloud = lifetime.getByRole('button', { name: 'Select Raincloud' });
  await expect(superbloom).toContainText('+250,000 PTS');
  await expect(superbloom).toContainText('+14d lifetime');
  await expect(superbloom).toContainText('37,500 SEED');
  await expect(everdew).toContainText('+125,000 PTS');
  await expect(everdew).toContainText('+90d lifetime');
  await expect(everdew).toContainText('20,000 SEED');
  await expect(raincloud).toContainText('+7d lifetime');
  await expect(raincloud).toContainText('200 SEED');
  await expect(raincloud).not.toContainText('PTS');
  for (const [button, icon, name] of [[superbloom, 'superbloom', 'Superbloom'], [everdew, 'everdew', 'Everdew'], [raincloud, 'raincloud', 'Raincloud']] as const) {
    await button.scrollIntoViewIfNeeded();
    const artwork = button.locator(`img[src*="${icon}.png"]`);
    await expect(artwork).toHaveCount(1);
    await expect.poll(() => artwork.evaluate(image => (image as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
    expect(await button.evaluate(node => node.scrollWidth <= node.clientWidth + 1 && node.scrollHeight <= node.clientHeight + 1)).toBe(true);
    await button.click();
    const review = page.getByRole('dialog', { name: 'Care item review' });
    await expect(review.getByLabel('Quantity', { exact: true })).toHaveValue('1');
    await expect(review.getByLabel('Care review', { exact: true })).toContainText(name);
    await page.keyboard.press('Escape');
  }
  expect(await catalog.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await catalog.screenshot({ path: testInfo.outputPath('garden-catalog.png') });
});

test('ETH purchase quotes wait for the complete quantity and ignore a late old quote', async ({ page }) => {
  const fixture = page.getByRole('region', { name: 'SEED purchase quote fixture' });
  const submit = fixture.getByRole('button', { name: 'Submit quoted purchase' });
  await expect(fixture.getByLabel('Quote read count')).toHaveText('1');
  await fixture.getByRole('button', { name: 'Select ten items' }).click();
  await expect(submit).toBeDisabled();
  await expect(fixture.getByLabel('Quote read count')).toHaveText('2');
  await fixture.getByRole('button', { name: 'Resolve old one-item quote' }).click();
  await expect(fixture.getByLabel('Quoted SEED amount')).toHaveText('none');
  await expect(submit).toBeDisabled();
  await fixture.getByRole('button', { name: 'Resolve current quote' }).click();
  await expect(fixture.getByLabel('Quoted SEED amount')).toHaveText('375000000000000000000000');
  await expect(submit).toBeEnabled();
  await fixture.getByRole('button', { name: 'Clear quantity' }).click();
  await expect(submit).toBeDisabled();
  await expect(fixture.getByLabel('Quoted SEED amount')).toHaveText('none');
});

test('failed ETH quotes cannot submit until a successful retry', async ({ page }) => {
  const fixture = page.getByRole('region', { name: 'SEED purchase quote fixture' });
  const submit = fixture.getByRole('button', { name: 'Submit quoted purchase' });
  await expect(fixture.getByLabel('Quote read count')).toHaveText('1');
  await fixture.getByRole('button', { name: 'Fail current quote' }).click();
  await expect(fixture.getByRole('status').filter({ hasText: 'ETH quote unavailable' })).toBeVisible();
  await expect(submit).toBeDisabled();
  await fixture.getByRole('button', { name: 'Refresh ETH quote' }).click();
  await expect(fixture.getByLabel('Quote read count')).toHaveText('2');
  await fixture.getByRole('button', { name: 'Resolve current quote' }).click();
  await expect(submit).toBeEnabled();
  await fixture.getByRole('button', { name: 'Refresh ETH quote' }).click();
  await expect(submit).toBeDisabled();
  await expect(fixture.getByLabel('Quote read count')).toHaveText('3');
  await fixture.getByRole('button', { name: 'Fail current quote' }).click();
  await expect(fixture.getByLabel('Quoted SEED amount')).toHaveText('none');
  await expect(submit).toBeDisabled();
  await fixture.getByRole('button', { name: 'Use SEED payment' }).click();
  await expect(submit).toBeDisabled();
  await expect(fixture.getByLabel('Quoted SEED amount')).toHaveText('none');
});
