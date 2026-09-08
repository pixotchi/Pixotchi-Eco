import { test, expect } from '@playwright/test';
import { openFrontendFixture } from './helpers/bootstrap';

test.beforeEach(async ({ page }, testInfo) => {
  await page.clock.install({ time: new Date('2026-09-05T09:59:00Z') });
  // Let Next/React finish asynchronous boot before stopping browser timers.
  await openFrontendFixture(page, testInfo, 'plant-attack');
  await page.clock.pauseAt(new Date('2026-09-05T10:00:00Z'));
  await page.getByRole('button', { name: 'Restart fixture timer' }).click();
  await page.evaluate(theme => document.documentElement.classList.add(theme), testInfo.project.name.endsWith('dark') ? 'dark' : 'light');
});

test('a single resting plant shows its countdown and targets return at expiry', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Plant attack fixture' });
  await expect(region.getByRole('heading')).toHaveText('Your plant is resting');
  await expect(region).toContainText('30 minutes');
  await expect(region.getByRole('timer')).toContainText('03s');
  await page.clock.runFor(1000);
  await expect(region.getByRole('timer')).toContainText('02s');
  expect(await region.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  await page.clock.runFor(2000);
  await expect(region.getByRole('list')).toContainText('Ready to attack');
  await expect(region.getByRole('timer')).toHaveCount(0);
});

test('target cooldowns expire without mislabelling a ready attacker', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Plant attack fixture' });
  await region.getByLabel('Attack scenario').selectOption('target-cooldown');
  await expect(region.getByRole('heading')).toHaveText('No eligible targets right now');
  await expect(region).toContainText('60 minutes');
  await expect(region.getByRole('timer')).toHaveCount(0);
  await page.clock.runFor(3000);
  await expect(region.getByRole('list')).toContainText('Ready to attack');
});

test('mixed plants, dead plants, no plants, and failed checks have distinct outcomes', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Plant attack fixture' });
  const scenario = region.getByLabel('Attack scenario');
  await scenario.selectOption('mixed');
  await expect(region.getByRole('list')).toContainText('Ready to attack');
  await scenario.selectOption('dead');
  await expect(region.getByRole('heading')).toHaveText('You need a living plant to attack');
  await scenario.selectOption('empty');
  await expect(region.getByRole('heading')).toHaveText('No plants to attack with');
  await scenario.selectOption('unavailable');
  await expect(region.getByRole('alert')).toContainText('Attack status unavailable');
  await region.getByRole('button', { name: 'Retry', exact: true }).click();
  await expect(region.getByRole('list')).toContainText('Ready to attack');
  await scenario.selectOption('no-targets');
  await expect(region).toContainText('lower level');
  await region.getByRole('button', { name: 'View all plants' }).click();
  await expect(region.getByRole('list')).toContainText('Not eligible');
});
