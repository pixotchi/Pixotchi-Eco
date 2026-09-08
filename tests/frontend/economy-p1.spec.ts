import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/qa/economy');
  await expect(page.getByTestId('quote-state')).toHaveText('ready', { timeout: 20_000 });
});

test('mint quote cannot survive a changed strain identity or amount', async ({ page }) => {
  await expect(page.getByTestId('quote-amount')).toHaveText('200');
  await page.getByRole('button', { name: 'Select different price' }).click();
  await expect(page.getByRole('button', { name: 'Submit ETH mint' })).toBeDisabled();
  await expect(page.getByTestId('quote-amount')).toHaveText('unavailable');
  await expect(page.getByTestId('quote-amount')).toHaveText('400');
  await page.getByRole('button', { name: 'Select same price' }).click();
  await expect(page.getByRole('button', { name: 'Submit ETH mint' })).toBeDisabled();
  await expect(page.getByTestId('quote-amount')).toHaveText('unavailable');
  await expect(page.getByTestId('quote-amount')).toHaveText('400');
});

test('ETH quote failure blocks submission and retry restores the selected payment', async ({ page }) => {
  await page.getByRole('button', { name: 'Fail quote' }).click();
  await expect(page.getByTestId('quote-state')).toHaveText('error');
  await expect(page.getByRole('button', { name: 'Submit ETH mint' })).toBeDisabled();
  await expect(page.getByTestId('quote-amount')).toHaveText('unavailable');
  await page.getByRole('button', { name: 'Retry ETH quote' }).click();
  await expect(page.getByTestId('quote-state')).toHaveText('ready');
  await expect(page.getByRole('button', { name: 'Submit ETH mint' })).toBeEnabled();
});

test('pre-submit quote changes require another review before signing', async ({ page }) => {
  await page.getByRole('button', { name: 'Change market price' }).click();
  await page.getByRole('button', { name: 'Submit ETH mint' }).click();
  await expect(page.getByRole('status')).toContainText('price changed');
  await expect(page.getByTestId('submissions')).toHaveText('0');
  await expect(page.getByTestId('quote-amount')).toHaveText('300');
  await page.getByRole('button', { name: 'Submit ETH mint' }).click();
  await expect(page.getByTestId('submissions')).toHaveText('1');
});

test('catalog refresh preserves identity and replaces selected price and supply', async ({ page }) => {
  await page.getByRole('button', { name: 'Load catalog' }).click();
  await page.getByRole('button', { name: 'Select second strain' }).click();
  await expect(page.getByTestId('catalog-price')).toHaveText('200');
  await page.getByRole('button', { name: 'Refresh sold-out catalog' }).click();
  await expect(page.getByTestId('catalog-selection')).toHaveText('2');
  await expect(page.getByTestId('catalog-price')).toHaveText('400');
  await expect(page.getByTestId('catalog-remaining')).toHaveText('0');
  await page.getByRole('button', { name: 'Remove selected strain' }).click();
  await expect(page.getByTestId('catalog-selection')).toHaveText('2');
  await expect(page.getByTestId('catalog-price')).toHaveText('unavailable');
});

test('load-more reaches oldest owned order and order 21 at one price', async ({ page }) => {
  const owned = page.getByLabel('All owned orders');
  await expect(owned.getByRole('button', { name: 'Cancel order 1', exact: true })).toHaveCount(0);
  await owned.getByRole('button', { name: 'Load more orders' }).click();
  await owned.getByRole('button', { name: 'Load more orders' }).click();
  await owned.getByRole('button', { name: 'Cancel order 1', exact: true }).click();
  await expect(page.getByTestId('cancelled-order')).toHaveText('1');
  await expect(owned.getByRole('button', { name: 'Load more orders' })).toHaveCount(0);
  const level = page.getByLabel('Price level');
  await level.getByRole('button', { name: 'Load more orders' }).click();
  await level.getByRole('button', { name: 'Cancel order 81', exact: true }).click();
  await expect(page.getByTestId('cancelled-order')).toHaveText('81');
});
