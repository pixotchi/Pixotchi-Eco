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
  const theme = header.getByRole('button', { name: 'Settings', exact: true });
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
  await expect(page.getByRole('switch', { name: /^(ETH Mode|Performance Mode)$/ })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await theme.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  const menuBounds = await menu.boundingBox();
  expect(menuBounds!.width).toBe(enlarged ? 258 : 218);
  const socials = menu.getByRole('group', { name: 'Community', exact: true }).getByRole('menuitem');
  await expect(socials).toHaveCount(3);
  for (const social of await socials.all()) {
    await expect(social).toHaveText('');
    await expect(social).toHaveAttribute('aria-label', /^Open Pixotchi on /);
  }
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
  await expect(choices.first()).toHaveCSS('outline-style', 'solid');
  for (const name of ['Light', 'Dark', 'Green', 'Yellow', 'Red', 'Pink', 'Blue', 'Violet']) {
    await expect(menu.getByRole('menuitemradio', { name, exact: true })).toBeFocused();
    await page.keyboard.press('ArrowDown');
  }
  await page.keyboard.press('End');
  const lastSocial = menu.getByRole('menuitem', { name: 'Open Pixotchi on Farcaster', exact: true });
  await expect(lastSocial).toBeFocused();
  await expect(lastSocial).toBeInViewport();
  await menu.screenshot({ path: test.info().outputPath(`theme-menu${enlarged ? '-200pct' : ''}.png`) });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu')).toHaveCount(0);
  if (enlarged && page.viewportSize()!.width === 320) {
    await theme.click();
    const performance = page.getByRole('menuitemcheckbox', { name: 'Performance Mode', exact: true });
    await performance.scrollIntoViewIfNeeded();
    await expect(performance).toBeInViewport();
    await performance.focus();
    await page.keyboard.press('Space');
    await expect(performance).toBeChecked();
    await page.keyboard.press('Space');
    await expect(performance).not.toBeChecked();
    await menu.screenshot({ path: test.info().outputPath('performance-mode-200pct.png') });
    await page.keyboard.press('Escape');
    await expect(menu).toHaveCount(0);
  }
  await header.screenshot({ path: test.info().outputPath(`header${enlarged ? '-200pct' : ''}.png`) });
});

test.describe('Settings switches', () => {
  test.use({ hasTouch: true });

  test('only switches respond to taps and Performance Mode disables touch feedback', async ({ page }) => {
    await page.getByRole('button', { name: 'Settings', exact: true }).tap();
    const menu = page.getByRole('menu');
    await expect(menu.getByText('Interaction sounds', { exact: true })).toHaveCount(0);
    await expect(menu.getByRole('menuitemcheckbox', { name: 'Music', exact: true })).toBeVisible();
    for (const control of await menu.getByRole('menuitemcheckbox').all()) {
      const checked = await control.getAttribute('aria-checked');
      const row = control.locator('..');
      const label = row.locator(':scope > span');
      await label.tap();
      await label.dblclick();
      await expect(control).toHaveAttribute('aria-checked', checked!);
      await expect(row).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
      expect(await page.evaluate(() => getSelection()?.toString())).toBe('');
      const bounds = (await control.boundingBox())!;
      expect(bounds.width).toBe(44);
      expect(bounds.height).toBe(44);
    }

    const touch = menu.getByRole('menuitemcheckbox', { name: 'Touch feedback', exact: true });
    const performance = menu.getByRole('menuitemcheckbox', { name: 'Performance Mode', exact: true });
    await touch.tap();
    await expect(touch).toBeChecked();
    await performance.tap();
    await expect(performance).toBeChecked();
    await expect(touch).not.toBeChecked();
    await expect(touch).toBeDisabled();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pixotchi:sensory-feedback')!))).toEqual({ haptics: false });
    await expect(performance).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await expect(performance.locator('..')).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
    await menu.screenshot({ path: test.info().outputPath('settings-performance-mode.png') });

    await performance.focus();
    await page.keyboard.press('Space');
    await expect(performance).not.toBeChecked();
    await expect(touch).toBeEnabled();
    await expect(touch).not.toBeChecked();
    await page.keyboard.press('ArrowDown');
    await expect(touch).toBeFocused();
    await expect(touch).toHaveCSS('outline-style', 'solid');
    await page.keyboard.press('Space');
    await expect(touch).toBeChecked();
    await page.keyboard.press('Escape');
    await page.reload();
    await page.getByRole('button', { name: 'Settings', exact: true }).tap();
    await expect(touch).toBeChecked();
    await expect(performance).not.toBeChecked();
  });

  test('saved Performance Mode and changes from another tab keep touch feedback off', async ({ page, context }) => {
    test.setTimeout(60_000);
    await page.evaluate(() => {
      localStorage.setItem('pixotchi:performance-mode', '1');
      localStorage.setItem('pixotchi:sensory-feedback', JSON.stringify({ haptics: true, sounds: true }));
    });
    await page.reload();
    await page.getByRole('button', { name: 'Settings', exact: true }).click();
    const touch = page.getByRole('menuitemcheckbox', { name: 'Touch feedback', exact: true });
    const performance = page.getByRole('menuitemcheckbox', { name: 'Performance Mode', exact: true });
    await expect(performance).toBeChecked();
    await expect(touch).not.toBeChecked();
    await expect(touch).toBeDisabled();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem('pixotchi:sensory-feedback')!))).toEqual({ haptics: false });

    // A blank same-origin page changes storage without a second provider tree.
    const other = await context.newPage();
    await other.route('**/settings-storage-test', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Settings storage test</title>' }));
    await other.goto('/settings-storage-test');
    await other.evaluate(() => localStorage.setItem('pixotchi:sensory-feedback', JSON.stringify({ haptics: true })));
    await expect.poll(() => other.evaluate(() => JSON.parse(localStorage.getItem('pixotchi:sensory-feedback')!))).toEqual({ haptics: false });
    await expect(touch).not.toBeChecked();
    await other.evaluate(() => localStorage.setItem('pixotchi:performance-mode', '0'));
    await expect(performance).not.toBeChecked();
    await expect(touch).toBeEnabled();
    await expect(touch).not.toBeChecked();
    await touch.click();
    await expect(touch).toBeChecked();
    await other.evaluate(() => localStorage.setItem('pixotchi:performance-mode', '1'));
    await expect(performance).toBeChecked();
    await expect(touch).not.toBeChecked();
    await expect(touch).toBeDisabled();
    await other.close();
  });
});

test('status actions stay compact and keep labels and balances visible across phone and desktop widths', async ({ page }) => {
  await page.evaluate(() => document.fonts.ready);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const width of [320, 390, 820, 864, 1440]) {
    await page.setViewportSize({ width, height: 844 });
    const balances = page.getByRole('group', { name: 'Token balances', exact: true });
    for (const name of ['SEED', 'LEAF', 'PIXOTCHI']) {
      const item = balances.locator(':scope > div').filter({ hasText: `${name} balance` });
      await expect(item.locator('img')).toBeVisible();
      await expect(item).toBeInViewport();
      // Live values can grow while loading. Verify reachability in the strip's
      // intended horizontal scroll area, allowing subpixel scroll rounding.
      await expect.poll(() => item.evaluate(element => {
        element.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' });
        const bounds = element.getBoundingClientRect();
        const groupBounds = element.parentElement!.getBoundingClientRect();
        return bounds.left >= groupBounds.left - 1 && bounds.right <= groupBounds.right + 1;
      })).toBe(true);
    }
    const actions = page.locator('[data-status-actions] button');
    await expect(page.getByRole('button', { name: 'Open staking dialog', exact: true })).toBeVisible();
    for (const name of ['Tasks', 'Stake']) {
      const label = actions.getByText(name, { exact: true });
      await expect(label).toBeVisible();
      expect((await label.boundingBox())!.height).toBeGreaterThanOrEqual(12);
      expect(await label.evaluate(element => getComputedStyle(element).position)).not.toBe('absolute');
    }
    for (const action of await actions.all()) {
      const bounds = (await action.boundingBox())!;
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      expect(bounds.height).toBe(width <= 380 ? 28 : 32);
      expect(bounds.x).toBeGreaterThanOrEqual(0);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(width);
      await action.click({ trial: true });
    }
    if (width < 640) {
      expect((await page.locator('[data-viewport-shell="status"]').boundingBox())!.height).toBe(width <= 380 ? 32 : 36);
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
});

test('Settings About stays reachable while five primary tabs retain keyboard navigation', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 844 });
  const navigation = page.getByRole('navigation', { name: 'Main navigation' });
  const tabs = navigation.getByRole('tab');
  await expect(tabs).toHaveText(['Farm', 'Mint', 'Activity', 'Ranking', 'Swap']);
  for (const tab of await tabs.all()) {
    const bounds = (await tab.boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44);
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(await tab.locator('span').evaluate(element => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(12);
  }
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  for (const tab of await tabs.all()) {
    expect(await tab.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    const label = tab.locator('span');
    expect(await label.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.evaluate(() => { document.documentElement.style.fontSize = ''; });
  await page.getByRole('button', { name: 'Open wallet profile', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Game guide & about', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  const theme = page.getByRole('button', { name: 'Settings', exact: true });
  await theme.click();
  const about = page.getByRole('menuitem', { name: 'About', exact: true });
  const music = page.getByRole('menuitemcheckbox', { name: 'Music', exact: true });
  const musicBounds = (await music.boundingBox())!;
  expect((await about.boundingBox())!.y).toBeGreaterThanOrEqual(musicBounds.y + musicBounds.height);
  await page.getByRole('menuitem', { name: 'Service status', exact: true }).focus();
  await page.keyboard.press('ArrowDown');
  await expect(about).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect(theme).toBeFocused();
  await expect(page.getByRole('heading', { name: 'About Pixotchi', exact: true })).toBeVisible();
  await expect(page.getByRole('tabpanel', { name: 'About', exact: true })).toBeVisible();
  await expect(navigation.locator('[role="tab"][aria-selected="true"]')).toHaveCount(0);
  await expect(navigation.locator('[data-main-nav-indicator]')).toHaveCSS('opacity', '0');
  const farm = navigation.getByRole('tab', { name: 'Farm', exact: true });
  await expect(farm).toHaveAttribute('tabindex', '0');
  await farm.focus();
  await page.keyboard.press('ArrowRight');
  const mint = navigation.getByRole('tab', { name: 'Mint', exact: true });
  await expect(mint).toBeFocused();
  await expect(mint).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Home');
  await expect(farm).toBeFocused();
  await expect(farm).toHaveAttribute('aria-selected', 'true');
});

test('Settings hands dialog focus back to the gear and preserves feedback and tutorial progress', async ({ page }) => {
  const settings = page.getByRole('button', { name: 'Settings', exact: true });
  const draft = 'A draft to keep while exploring Settings.';
  for (let attempt = 0; attempt < 2; attempt++) {
    await settings.click();
    await page.getByRole('menuitem', { name: 'Feedback', exact: true }).click();
    const input = page.getByRole('textbox', { name: 'Feedback', exact: true });
    await expect(input).toBeFocused();
    if (attempt === 0) await input.fill(draft);
    else await expect(input).toHaveValue(draft);
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(settings).toBeFocused();
  }
  await settings.click();
  await page.getByRole('menuitem', { name: 'Tutorial', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: /^Pixotchi tutorial:/ });
  await expect(dialog.getByText(/^Step 1 of/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Next', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(dialog.getByText(/^Step 2 of/)).toBeVisible();
  await dialog.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(settings).toBeFocused();
  await settings.click();
  await page.getByRole('menuitem', { name: 'Tutorial', exact: true }).click();
  await expect(dialog.getByText(/^Step 2 of/)).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(settings).toBeFocused();
});

test('free-plant guidance stays compact on desktop and leads paid choices on phones', async ({ page }) => {
  await page.route('**/api/verify/status?**', route => route.fulfill({ json: { enabled: true, claimState: 'unclaimed' } }));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('tab', { name: 'Mint', exact: true }).click();
  const eligibility = page.getByRole('button', { name: 'Check eligibility & claim', exact: true });
  const claim = page.getByRole('region', { name: 'Free plant claim', exact: true });
  const paid = page.getByRole('heading', { name: 'Mint a Plant', exact: true });
  await expect(eligibility).toBeVisible();
  await expect(paid).toBeVisible();
  const originalEligibility = await eligibility.elementHandle();
  for (const width of [320, 390, 820, 864, 1440, 2275, 390]) {
    await page.setViewportSize({ width, height: 900 });
    const action = (await eligibility.boundingBox())!, heading = (await paid.boundingBox())!;
    if (width < 864) expect(action.y + action.height).toBeLessThan(heading.y);
    else {
      const plant = (await page.getByLabel('Plant mint', { exact: true }).boundingBox())!;
      expect(action.x).toBeGreaterThan(plant.x + plant.width);
      const land = (await page.getByRole('heading', { name: 'Mint Land', exact: true }).boundingBox())!;
      expect(action.y + action.height).toBeLessThan(land.y);
    }
    expect((await claim.boundingBox())!.width).toBeLessThanOrEqual(448);
    expect(action.height).toBeGreaterThanOrEqual(44);
    expect(await eligibility.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
    expect(await originalEligibility!.evaluate(element => element.isConnected)).toBe(true);
  }
  await originalEligibility!.dispose();
});

test('short desktop navigation scrolls with pointer and keyboard while its indicator stays aligned', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const width of [1280, 1440]) {
    await page.setViewportSize({ width, height: 400 });
    const rail = page.locator('[data-viewport-shell="desktop-nav"]');
    await expect(rail).toBeVisible();
    await expect(rail.getByRole('tab')).toHaveText(['Farm', 'Mint', 'Activity', 'Ranking', 'Swap']);
    expect(await rail.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
    await rail.evaluate(element => { element.scrollTop = 0; });
    await rail.hover();
    await page.mouse.wheel(0, 600);
    await expect.poll(() => rail.evaluate(element => element.scrollTop)).toBeGreaterThan(0);
    const swap = rail.getByRole('tab', { name: 'Swap', exact: true });
    await swap.click();
    await expect(swap).toHaveAttribute('aria-selected', 'true');
    const indicator = rail.locator('[data-main-nav-indicator="desktop"]');
    await expect.poll(async () => {
      const pill = (await indicator.boundingBox())!, tab = (await swap.boundingBox())!;
      return Math.abs(pill.x - tab.x) + Math.abs(pill.y - tab.y) + Math.abs(pill.width - tab.width) + Math.abs(pill.height - tab.height);
    }).toBeLessThan(2);
    await swap.focus();
    await page.keyboard.press('Home');
    const farm = rail.getByRole('tab', { name: 'Farm', exact: true });
    await expect(farm).toBeFocused();
    await expect(farm).toHaveAttribute('aria-selected', 'true');
    await page.keyboard.press('End');
    await expect(swap).toBeFocused();
    await expect(swap).toHaveAttribute('aria-selected', 'true');
    const railBounds = (await rail.boundingBox())!, tabBounds = (await swap.boundingBox())!;
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
