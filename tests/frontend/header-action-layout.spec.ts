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
  for (const [button, glyphSize] of [[chat, 24], [wallet, 24], [theme, 20]] as const) {
    const bounds = await button.boundingBox();
    expect(bounds?.width).toBe(44);
    expect(bounds?.height).toBe(44);
    expect(bounds!.x).toBeGreaterThanOrEqual(0);
    expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(page.viewportSize()!.width);
    const glyph = button.locator(':scope > img, :scope > svg').first();
    expect((await glyph.boundingBox())?.width).toBe(glyphSize);
    expect((await glyph.boundingBox())?.height).toBe(glyphSize);
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

test('status actions stay compact on mobile and fit across phone and tablet widths', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const width of [320, 390, 820, 864]) {
    await page.setViewportSize({ width, height: 844 });
    const actions = page.locator('[data-status-actions] button');
    await expect(actions.getByText('Stake', { exact: true })).toBeVisible();
    for (const action of await actions.all()) {
      const bounds = (await action.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBe(width < 864 ? 32 : 44);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await action.click({ trial: true });
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('short desktop navigation scrolls with pointer and keyboard while its indicator stays aligned', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 480 });
    const rail = page.locator('[data-viewport-shell="desktop-nav"]');
    await expect(rail).toBeVisible();
    expect(await rail.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await rail.evaluate(element => { element.scrollTop = 0; });
    await rail.hover();
    await page.mouse.wheel(0, 600);
    await expect.poll(() => rail.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const about = rail.getByRole('tab', { name: 'About', exact: true });
    await about.click();
    await expect(about).toHaveAttribute('aria-selected', 'true');
    const indicator = rail.locator('[data-main-nav-indicator="desktop"]');
    await expect.poll(async () => {
      const pill = (await indicator.boundingBox())!, tab = (await about.boundingBox())!;
      return Math.abs(pill.x - tab.x) + Math.abs(pill.y - tab.y) + Math.abs(pill.width - tab.width) + Math.abs(pill.height - tab.height);
    }).toBeLessThan(2);
    await about.focus();
    await page.keyboard.press('Home');
    const farm = rail.getByRole('tab', { name: 'Farm', exact: true });
    await expect(farm).toBeFocused();
    await expect(farm).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(about).toBeFocused();
    await expect(about).toHaveAttribute('aria-selected', 'true');
    const railBounds = (await rail.boundingBox())!, tabBounds = (await about.boundingBox())!;
    expect(tabBounds.y).toBeGreaterThanOrEqual(railBounds.y);
    expect(tabBounds.y + tabBounds.height).toBeLessThanOrEqual(railBounds.y + railBounds.height);
    await expect.poll(() => indicator.evaluate(element => element.getAnimations().length)).toBe(0);
  }
});

test('plant mint keeps readable tablet controls and preserves selection through layout changes', async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 864, height: 900 });
  await page.getByRole('tab', { name: 'Mint', exact: true }).click();
  const card = page.getByLabel('Plant mint', { exact: true });
  const picker = card.getByLabel('Choose a strain', { exact: true });
  await expect(picker).toBeVisible({ timeout: 30_000 });
  const choice = picker.locator('button:not(:disabled)').first();
  await choice.click();
  const originalPicker = await picker.elementHandle();
  for (const width of [864, 1024, 1440, 390, 864]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(choice).toHaveAttribute('aria-pressed', 'true');
    expect(await originalPicker!.evaluate(element => element.isConnected)).toBe(true);
    expect(await card.evaluate(element => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
    if (width >= 864) expect((await picker.boundingBox())!.width).toBeGreaterThanOrEqual(330);
    for (const button of await picker.getByRole('button').all()) {
      expect(await button.evaluate(element => element.scrollWidth <= element.clientWidth + 1 && element.scrollHeight <= element.clientHeight + 1)).toBe(true);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await originalPicker!.dispose();
});
