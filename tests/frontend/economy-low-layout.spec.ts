import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => { await page.goto('/qa/economy-layout'); });

test('shared mint selection keeps wallet restrictions and submission locks', async ({ page }) => {
  const base = page.getByLabel('Base mint example', { exact: true });
  const solana = page.getByLabel('Solana mint example', { exact: true });
  await base.getByRole('button', { name: /^FLORA/ }).click();
  await expect(base.getByRole('button', { name: /^FLORA/ })).toHaveAttribute('aria-pressed', 'true');
  await expect(base.getByRole('button', { name: /^OG/ })).toHaveAttribute('aria-pressed', 'false');
  await expect(solana.getByRole('button', { name: /^FLORA/ })).toBeDisabled();
  await expect(solana.getByRole('button', { name: /^TYJ/ })).toBeDisabled();
  for (const panel of [base, solana]) {
    await expect(panel.getByRole('button', { name: /^Temporarily unavailable/ })).toBeDisabled();
    await expect(panel.getByRole('button', { name: /^Sold out/ })).toBeDisabled();
    await panel.getByRole('button', { name: 'Mint selected plant', exact: true }).click();
    await expect(panel.getByRole('button', { name: 'Confirming your mint transaction' })).toBeDisabled();
    for (const button of await panel.getByLabel('Choose a strain').getByRole('button').all()) await expect(button).toBeDisabled();
  }
});

for (const enlarged of [false, true]) test(`mint layouts wrap long prices, labels and actions${enlarged ? ' at 200% text size' : ''}`, async ({ page }) => {
  if (enlarged) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  await page.evaluate(() => document.fonts.ready);
  const examples = page.getByLabel('Mint layout examples', { exact: true });
  await examples.scrollIntoViewIfNeeded();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const button of await examples.getByRole('button').all()) {
    const box = await button.boundingBox();
    expect(box?.height).toBeGreaterThanOrEqual(44);
    expect(await button.evaluate(element => element.scrollHeight <= element.clientHeight + 1 && element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  }
  // Short status words must stay whole, including under real font/text scaling.
  // Button overflow alone cannot detect a badge splitting 'Sold' across lines.
  const statuses = examples.getByLabel('Choose a strain').getByText(/^(Sold|Base)$/, { exact: true });
  await expect(statuses).toHaveCount(4);
  for (const status of await statuses.all()) {
    const geometry = await status.evaluate(element => {
      const range = document.createRange();
      range.selectNodeContents(element);
      const textRects = Array.from(range.getClientRects()).filter(rect => rect.width > 0 && rect.height > 0);
      const badge = element.getBoundingClientRect();
      const card = element.closest('button')!.getBoundingClientRect();
      return {
        lines: new Set(textRects.map(rect => Math.round(rect.top))).size,
        contained: badge.left >= card.left && badge.right <= card.right &&
          textRects.every(rect => rect.left >= badge.left && rect.right <= badge.right),
      };
    });
    expect(geometry.lines, `${await status.textContent()} status line count`).toBe(1);
    expect(geometry.contained, `${await status.textContent()} status fits its card`).toBe(true);
  }
  for (const wallet of ['Base', 'Solana']) {
    await examples.getByLabel(`${wallet} mint example`, { exact: true }).getByLabel('Choose a strain')
      .screenshot({ path: test.info().outputPath(`${wallet.toLowerCase()}-strain-layout${enlarged ? '-200pct' : ''}.png`) });
  }
  const details = examples.getByLabel('Land mint details');
  expect(await details.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
  const selectable = examples.getByLabel('Base mint example', { exact: true }).getByRole('button', { name: /^OG/ });
  await selectable.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await expect(selectable).toBeFocused();
  expect(await selectable.evaluate(element => parseFloat(getComputedStyle(element).outlineWidth))).toBeGreaterThanOrEqual(2);
  const landAction = examples.getByRole('button', { name: 'Mint land for 1,234,567,890 SEED' });
  await landAction.scrollIntoViewIfNeeded();
  await expect(landAction).toBeInViewport();
  await examples.getByLabel('Land mint example', { exact: true }).screenshot({ path: test.info().outputPath(`land-layout${enlarged ? '-200pct' : ''}.png`) });
});
