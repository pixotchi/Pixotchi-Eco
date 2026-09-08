import { test, expect } from '@playwright/test';
import { openFrontendFixture } from './helpers/bootstrap';

test.beforeEach(async ({ page }, testInfo) => {
  await openFrontendFixture(page, testInfo, 'controllers');
});

test('swap quote controller rejects a late quote after editing the draft', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Swap controller fixture' });
  await expect(region.getByLabel('Quote reads', { exact: true })).toHaveText('1');
  await region.getByLabel('Quote amount (wei)', { exact: true }).fill('2');
  await expect(region.getByLabel('Quote reads', { exact: true })).toHaveText('2');
  await region.getByRole('button', { name: 'Resolve first quote' }).click();
  await expect(region.getByLabel('Quote state', { exact: true })).not.toContainText('Ready 1');
  await region.getByRole('button', { name: 'Resolve newest quote' }).click();
  await expect(region.getByLabel('Quote state', { exact: true })).toHaveText('Ready 2');
  await region.getByRole('button', { name: 'Change quote wallet' }).click();
  await expect(region.getByLabel('Quote state', { exact: true })).not.toContainText('Ready');
  await expect(region.getByLabel('Quote reads', { exact: true })).toHaveText('3');
  await region.getByRole('button', { name: 'Resolve newest quote' }).click();
  await expect(region.getByLabel('Quote state', { exact: true })).toHaveText('Ready 2');
});

test('a hidden swap panel cancels quote reads while preserving the amount', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Swap controller fixture' });
  await expect(region.getByLabel('Quote reads', { exact: true })).toHaveText('1');
  await region.getByRole('button', { name: 'Hide quote panel' }).click();
  await region.getByRole('button', { name: 'Resolve first quote' }).click();
  await expect(region.getByLabel('Quote state', { exact: true })).toHaveText('idle');
  await expect(region.getByLabel('Quote amount (wei)', { exact: true })).toHaveValue('1');
  await region.getByRole('button', { name: 'Show quote panel' }).click();
  await expect(region.getByLabel('Quote reads', { exact: true })).toHaveText('2');
  await region.getByRole('button', { name: 'Resolve newest quote' }).click();
  await expect(region.getByLabel('Quote state', { exact: true })).toHaveText('Ready 1');
});

test('Barracks changes land during a read and recovers from a failed refresh', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Barracks controller fixture' });
  await expect(region.getByLabel('Barracks reads', { exact: true })).toHaveText(/^[1-9]\d*$/);
  await region.getByRole('button', { name: 'Change Barracks land' }).click();
  await region.getByRole('button', { name: 'Resolve first army' }).click();
  await expect(region.getByLabel('Stationed army', { exact: true })).toHaveCount(0);
  await region.getByRole('button', { name: 'Resolve newest army' }).click();
  await expect(region.getByLabel('Stationed army', { exact: true })).toHaveText('20 swordsmen');
  await region.getByRole('button', { name: 'Refresh army' }).click();
  await region.getByRole('button', { name: 'Fail army read' }).click();
  await expect(region.getByRole('alert')).toContainText('Army unavailable');
  await expect(region.getByLabel('Stationed army', { exact: true })).toHaveText('20 swordsmen (last known)');
  await region.getByRole('button', { name: 'Retry', exact: true }).click();
  await region.getByRole('button', { name: 'Resolve newest army' }).click();
  await expect(region.getByLabel('Stationed army', { exact: true })).toHaveText('20 swordsmen');
});

test('API ranking rejects malformed entries and preserves a cached disabled notice', async ({ page }) => {
  const region = page.getByRole('region', { name: 'API ranking controller fixture' });
  await expect(region.getByLabel('Stake reads', { exact: true })).toHaveText(/^[1-9]\d*$/);
  // Development StrictMode cancels and restarts the initial read; both observers still share each request.
  const initialReads = Number(await region.getByLabel('Stake reads', { exact: true }).textContent());
  await region.getByRole('button', { name: 'Return malformed stake' }).click();
  await expect(region.getByRole('alert')).toContainText('Stake unavailable');
  await region.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(region.getByLabel('Stake reads', { exact: true })).toHaveText(String(initialReads + 1));
  await region.getByRole('button', { name: 'Resolve stake' }).click();
  await expect(region.getByLabel('Stake entries', { exact: true })).toHaveText('1');
  await expect(region.getByLabel('Other stake observer', { exact: true })).toHaveText('1');
  await region.getByRole('button', { name: 'Pause Rocks service' }).click();
  await expect(region.getByLabel('Rocks availability', { exact: true })).toHaveText('Season paused');
  await region.getByRole('button', { name: 'Hide Rocks board' }).click();
  await region.getByRole('button', { name: 'Show Rocks board' }).click();
  await expect(region.getByLabel('Rocks availability', { exact: true })).toHaveText('Season paused');
});
