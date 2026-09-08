import { expect, test } from '@playwright/test';

// This file opens the real development app. Retain only public screenshots,
// never a trace containing wallet-bearing development bundles or auth traffic.
test.use({ trace: 'off', video: 'off' });

test.beforeEach(async ({ page }) => {
  await page.goto('/?surface=test');
  const skip = page.getByRole('button', { name: 'Skip', exact: true });
  await skip.waitFor({ timeout: 10_000 }).catch(() => undefined);
  if (await skip.isVisible()) await skip.click();
  await expect(page.getByRole('banner', { name: 'Application header' })).toBeVisible();
});

for (const enlarged of [false, true]) test(`header icon actions stay visible, focused and clickable${enlarged ? ' with 200% text' : ''}`, async ({ page }) => {
  if (enlarged) await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
  const header = page.getByRole('banner', { name: 'Application header' });
  const chat = header.getByRole('button', { name: /^Open public chat/ });
  const wallet = header.getByRole('button', { name: 'Open wallet profile', exact: true });
  const theme = header.getByRole('button', { name: /^Current theme:/ });
  for (const button of [chat, wallet, theme]) {
    const bounds = await button.boundingBox();
    expect(bounds?.width).toBe(44);
    expect(bounds?.height).toBe(44);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    const glyph = button.locator(':scope > img, :scope > svg').first();
    expect((await glyph.boundingBox())?.width).toBe(20);
    expect((await glyph.boundingBox())?.height).toBe(20);
  }
  const swatch = theme.locator(':scope > span[aria-hidden="true"]');
  expect((await swatch.boundingBox())?.width).toBe(10);
  expect((await swatch.boundingBox())?.height).toBe(10);
  await chat.focus();
  await page.keyboard.press('Tab');
  await expect(wallet).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(theme).toBeFocused();
  expect(await theme.evaluate(element => getComputedStyle(element).boxShadow)).not.toBe('none');

  await chat.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await wallet.click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await theme.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const menuBounds = await menu.boundingBox();
  const choices = menu.getByRole('menuitemradio');
  await expect(choices).toHaveCount(8);
  for (const choice of await choices.all()) {
    const bounds = await choice.boundingBox();
    expect(bounds?.width).toBe(44);
    expect(bounds?.height).toBe(44);
    expect(bounds!.x).toBeGreaterThanOrEqual(menuBounds!.x);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(menuBounds!.x + menuBounds!.width);
    await choice.click({ trial: true });
  }
  await choices.first().focus();
  for (const name of ['Light', 'Dark', 'Green', 'Yellow', 'Red', 'Pink', 'Blue', 'Violet']) {
    await expect(menu.getByRole('menuitemradio', { name, exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
  }
  await menu.screenshot({ path: test.info().outputPath(`theme-menu${enlarged ? '-200pct' : ''}.png`) });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  if (enlarged && page.viewportSize()!.width === 320) {
    await wallet.click();
    const performance = page.getByRole('switch', { name: 'Performance Mode', exact: true });
    await performance.scrollIntoViewIfNeeded();
    await expect(performance).toBeInViewport();
    await performance.focus();
    await page.keyboard.press('Space');
    await expect(performance).toBeChecked();
    await page.keyboard.press('Space');
    await expect(performance).not.toBeChecked();
    await page.getByRole('dialog').screenshot({ path: test.info().outputPath('performance-mode-200pct.png') });
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  }
  await header.screenshot({ path: test.info().outputPath(`header${enlarged ? '-200pct' : ''}.png`) });
});
