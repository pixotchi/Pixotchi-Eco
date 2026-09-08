import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/qa/building-guards');
  await expect(page.getByRole('heading', { name: 'Building transaction guards' })).toBeVisible({ timeout: 30_000 });
});

test('quest return requires a fresh funded response before starting its deadline', async ({ page }) => {
  const quest = page.getByRole('region', { name: 'Quest return funding' });
  await expect(quest.getByRole('button', { name: 'Return farmer' })).toBeDisabled();
  await quest.getByRole('button', { name: 'Resolve funded rewards' }).click();
  await quest.getByRole('button', { name: 'Return farmer' }).click();
  await expect(quest.getByLabel('Reward read count')).toHaveText('2');
  await expect(quest.getByLabel('Quest submissions')).toHaveText('0');
  await quest.getByRole('button', { name: 'Resolve depleted rewards' }).click();
  await expect(quest.getByRole('alert')).toContainText('safely wait');
  await expect(quest.getByRole('button', { name: 'Return farmer' })).toBeDisabled();
  await expect(quest.getByLabel('Quest submissions')).toHaveText('0');
  await quest.getByRole('button', { name: 'Retry reward read' }).click();
  await quest.getByRole('button', { name: 'Resolve funded rewards' }).click();
  await quest.getByRole('button', { name: 'Return farmer' }).click();
  await quest.getByRole('button', { name: 'Resolve funded rewards' }).click();
  await expect(quest.getByLabel('Quest submissions')).toHaveText('1');
});

test('quest return read failure cannot reuse cached funding and has retry', async ({ page }) => {
  const quest = page.getByRole('region', { name: 'Quest return funding' });
  await quest.getByRole('button', { name: 'Resolve funded rewards' }).click();
  await quest.getByRole('button', { name: 'Return farmer' }).click();
  await quest.getByRole('button', { name: 'Fail reward read' }).click();
  await expect(quest.getByRole('alert')).toContainText("couldn't check");
  await expect(quest.getByRole('button', { name: 'Return farmer' })).toBeDisabled();
  await expect(quest.getByLabel('Quest submissions')).toHaveText('0');
  await quest.getByRole('button', { name: 'Retry reward read' }).click();
  await quest.getByRole('button', { name: 'Resolve funded rewards' }).click();
  await expect(quest.getByRole('button', { name: 'Return farmer' })).toBeEnabled();
});

test('committed loot uses its actual simulated reward when the conservative pool gate is unavailable', async ({ page }) => {
  const quest = page.getByRole('region', { name: 'Quest return funding' });
  await quest.getByRole('button', { name: 'Resolve depleted rewards' }).click();
  await expect(quest.getByRole('button', { name: 'Return farmer' })).toBeDisabled();
  await quest.getByRole('button', { name: 'Open committed loot' }).click();
  await quest.getByRole('button', { name: 'Fail loot simulation' }).click();
  await expect(quest.getByRole('alert')).toContainText("couldn't verify");
  await expect(quest.getByLabel('Loot submissions')).toHaveText('0');
  await quest.getByRole('button', { name: 'Open committed loot' }).click();
  await quest.getByRole('button', { name: 'Resolve payable loot' }).click();
  await expect(quest.getByLabel('Loot submissions')).toHaveText('1');
  await quest.getByRole('button', { name: 'Open committed loot' }).click();
  await quest.getByRole('button', { name: 'Resolve expired loot' }).click();
  await expect(quest.getByRole('alert')).toContainText('expired');
  await expect(quest.getByLabel('Loot submissions')).toHaveText('1');
});

test('changed reward settings are rechecked before return and a settings outage preserves committed recovery', async ({ page }) => {
  const quest = page.getByRole('region', { name: 'Quest return funding' });
  await quest.getByRole('button', { name: 'Resolve funded rewards' }).click();
  await quest.getByRole('button', { name: 'Return farmer' }).click();
  await quest.getByRole('button', { name: 'Resolve increased reward range' }).click();
  await expect(quest.getByRole('alert')).toContainText('safely wait');
  await expect(quest.getByLabel('Quest submissions')).toHaveText('0');
  await quest.getByRole('button', { name: 'Retry reward read' }).click();
  await quest.getByRole('button', { name: 'Fail quest settings read' }).click();
  await expect(quest.getByText('Rewards: error', { exact: true })).toBeVisible();
  await expect(quest.getByRole('button', { name: 'Return farmer' })).toBeDisabled();
  await quest.getByRole('button', { name: 'Open committed loot' }).click();
  await quest.getByRole('button', { name: 'Resolve payable loot' }).click();
  await expect(quest.getByLabel('Loot submissions')).toHaveText('1');
});

test('enabled raid preview rejects previous target, troop count and late response', async ({ page }) => {
  const raid = page.getByRole('region', { name: 'Raid preview identity' });
  await raid.getByRole('button', { name: 'Resolve current preview' }).click();
  await expect(raid.getByRole('button', { name: 'Submit raid' })).toBeEnabled();
  await raid.getByRole('button', { name: 'Select target 3' }).click();
  await expect(raid.getByRole('button', { name: 'Submit raid' })).toBeDisabled();
  await expect(raid.getByRole('status', { name: 'Raid preview status' })).toHaveText('Updating preview');
  await raid.getByRole('button', { name: 'Select target 4' }).click();
  await raid.getByRole('button', { name: 'Resolve current preview' }).click();
  await raid.getByRole('button', { name: 'Send 20 troops' }).click();
  await expect(raid.getByRole('button', { name: 'Submit raid' })).toBeDisabled();
  await raid.getByRole('button', { name: 'Resolve old target 3' }).click();
  await expect(raid.getByRole('status', { name: 'Raid preview status' })).toHaveText('Updating preview');
  await raid.getByRole('button', { name: 'Resolve current preview' }).click();
  await expect(raid.getByRole('status', { name: 'Raid preview status' })).toHaveText('Preview troops 20');
  await raid.getByRole('button', { name: 'Submit raid' }).click();
  await expect(raid.getByLabel('Raid submissions')).toHaveText('1');
});

test('raid preview is fenced by wallet, attacker, refresh failure and feature state', async ({ page }) => {
  const raid = page.getByRole('region', { name: 'Raid preview identity' });
  for (const change of ['Switch raid wallet', 'Switch attacker land', 'Next preview block']) {
    await raid.getByRole('button', { name: 'Resolve current preview' }).click();
    await expect(raid.getByRole('button', { name: 'Submit raid' })).toBeEnabled();
    await raid.getByRole('button', { name: change }).click();
    await expect(raid.getByRole('button', { name: 'Submit raid' })).toBeDisabled();
  }
  await raid.getByRole('button', { name: 'Fail current preview' }).click();
  await expect(raid.getByRole('alert')).toContainText('Raid preview unavailable');
  await expect(raid.getByRole('button', { name: 'Submit raid' })).toBeDisabled();
  await raid.getByRole('button', { name: 'Retry preview' }).click();
  await raid.getByRole('button', { name: 'Resolve current preview' }).click();
  await expect(raid.getByRole('button', { name: 'Submit raid' })).toBeEnabled();
  await raid.getByRole('button', { name: 'Disable preview feature' }).click();
  await expect(raid.getByRole('status', { name: 'Raid preview status' })).toHaveText('Preview unavailable');
});
