import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }, testInfo) => {
  await page.goto('/qa/frontend');
  await expect(page.locator('[data-fixtures-ready=true]')).toBeVisible();
  await page.evaluate(theme => { document.documentElement.classList.add(theme); }, testInfo.project.name.endsWith('dark') ? 'dark' : 'light');
});

test('completed notification icons remain visible with every motion setting', async ({ page }) => {
  for (const mode of ['normal', 'system', 'motion-off', 'performance-mode']) {
    await page.emulateMedia({ reducedMotion: mode === 'system' ? 'reduce' : 'no-preference' });
    await page.evaluate(value => {
      document.documentElement.classList.remove('motion-off', 'performance-mode');
      if (value === 'motion-off' || value === 'performance-mode') document.documentElement.classList.add(value);
    }, mode);
    for (const state of ['success', 'error']) {
      await page.getByRole('button', { name: `Show ${state} notification`, exact: true }).click();
      const icon = page.locator(`[data-toast-icon="${state}"]`);
      await expect(icon).toBeVisible();
      const appearance = await icon.evaluate(node => {
        const style = getComputedStyle(node);
        return { opacity: style.opacity, animation: style.animationName, pathCount: node.querySelectorAll('path').length };
      });
      expect(appearance.opacity).toBe('1');
      expect(appearance.animation).toBe('none');
      expect(appearance.pathCount).toBeGreaterThan(0);
    }
    await page.getByRole('button', { name: 'Show pending notification', exact: true }).click();
    await expect(page.getByText('Fixture action pending', { exact: true })).toBeVisible();
    await expect(page.locator('[data-toast-icon]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Clear fixture notification', exact: true }).click();
  }
});

test('amounts keep labels, units, Max and errors associated', async ({ page }, testInfo) => {
  const field = page.getByRole('textbox', { name: 'Points to add (PTS)' });
  await field.fill('100');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(page.getByRole('region', { name: 'Resource amount' }).getByRole('alert')).toContainText('Amount exceeds');
  await expect(page.getByRole('button', { name: 'Apply PTS', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Use maximum PTS' }).click();
  await expect(field).toHaveValue('70.5022');
  await expect(page.getByRole('button', { name: 'Apply PTS', exact: true })).toBeEnabled();
  if (testInfo.project.use.viewport!.width < 864) expect(await field.evaluate(node => getComputedStyle(node).fontSize)).toBe('16px');
});

test('selector matches its trigger and returns keyboard focus', async ({ page }) => {
  const trigger = page.getByRole('button', { name: 'Select a plant' });
  const triggerWidth = (await trigger.boundingBox())!.width;
  await trigger.click();
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  expect(Math.abs(triggerWidth - (await menu.boundingBox())!.width)).toBeLessThan(2);
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('catalog cards fit without overflow or quantity controls', async ({ page }) => {
  const catalog = page.getByRole('region', { name: 'Care catalog' });
  await expect(catalog.getByRole('button', { name: /quantity/ })).toHaveCount(0);
  const choices = catalog.getByLabel('Care choices', { exact: true });
  expect(Math.abs((await choices.boundingBox())!.width - (await catalog.boundingBox())!.width)).toBeLessThan(2);
  await expect(catalog.getByRole('button', { name: 'Select Water' })).toContainText('25.87 SEED');
  await expect(catalog.getByRole('button', { name: 'Select Water' })).toContainText('+12h lifetime');
  await catalog.getByRole('button', { name: 'Select Water' }).scrollIntoViewIfNeeded();
  const scrollTop = await page.evaluate(() => scrollY);
  await catalog.getByRole('button', { name: 'Select Water' }).click();
  const review = page.getByRole('dialog', { name: 'Care item review' });
  await expect(review).toBeVisible();
  await expect(review.getByLabel('Care review', { exact: true })).toHaveText('Review Water');
  expect(await page.evaluate(() => scrollY)).toBe(scrollTop);
  await page.keyboard.press('Escape');
  await expect(review).not.toBeVisible();
  await expect(catalog.getByRole('button', { name: 'Select Water' })).toBeFocused();
  expect(await page.evaluate(() => scrollY)).toBe(scrollTop);
  await expect(catalog.getByRole('button', { name: 'Select Water' })).toHaveAttribute('aria-pressed', 'true');
  expect(Math.abs((await choices.boundingBox())!.width - (await catalog.boundingBox())!.width)).toBeLessThan(2);
  expect(await catalog.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
  expect(await catalog.locator('[aria-haspopup="dialog"]').evaluateAll(items => items.every(item => item.scrollHeight <= item.clientHeight + 1))).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('care quantities are compact, edited in the popup and retained per item', async ({ page }) => {
  const catalog = page.getByRole('region', { name: 'Care catalog' });
  await catalog.getByRole('button', { name: 'Select Water' }).click();
  const review = page.getByRole('dialog', { name: 'Care item review' });
  const increase = review.getByRole('button', { name: 'Increase quantity' });
  await expect(review.getByLabel('Quantity', { exact: true })).toHaveText('1');
  await expect(review.getByRole('button', { name: 'Decrease quantity' })).toBeDisabled();
  const bounds = (await increase.boundingBox())!;
  expect(bounds.width).toBe(32);
  expect(bounds.height).toBe(32);
  expect(bounds.height).toBeLessThan((await review.getByRole('button', { name: 'Close dialog' }).boundingBox())!.height);
  await increase.focus();
  await increase.press('Space');
  await expect(increase).toBeFocused();
  await expect(review.getByLabel('Quantity', { exact: true })).toHaveText('2');
  await page.keyboard.press('Escape');
  await expect(catalog.getByRole('button', { name: /quantity/ })).toHaveCount(0);
  await catalog.getByRole('button', { name: 'Select Sunlight' }).click();
  await expect(review.getByLabel('Quantity', { exact: true })).toHaveText('1');
  await page.keyboard.press('Escape');
  await catalog.getByRole('button', { name: 'Select Water' }).click();
  await expect(review.getByLabel('Quantity', { exact: true })).toHaveText('2');
});

test('selecting the same care item reopens its review', async ({ page }) => {
  const catalog = page.getByRole('region', { name: 'Care catalog' });
  const item = catalog.getByRole('button', { name: 'Select Water' });
  const review = page.getByRole('dialog', { name: 'Care item review' });
  await item.click();
  await expect(review).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(item).toBeFocused();
  await item.scrollIntoViewIfNeeded();
  await item.focus();
  await item.press('Space');
  await expect(review).toBeVisible();
});

test('care sheet and form dialog stay above the keyboard and follow viewport panning', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const name of ['Select Water', 'Open spacing dialog']) {
    await page.getByRole('button', { name, exact: true }).click();
    const dialog = page.getByRole('dialog');
    const panel = dialog.locator('[data-viewport-debug-dialog-surface]');
    for (const top of [0, 65]) {
      await page.evaluate(offset => {
        document.documentElement.style.setProperty('--visual-viewport-height', '410px');
        document.documentElement.style.setProperty('--visual-viewport-offset-top', `${offset}px`);
      }, top);
      await expect.poll(async () => {
        const box = (await panel.boundingBox())!;
        return box.y >= top && box.y + box.height <= top + 411;
      }).toBe(true);
      await expect(dialog.getByRole('button', { name: 'Close dialog', exact: true })).toBeInViewport();
    }
    await page.evaluate(() => {
      document.documentElement.style.removeProperty('--visual-viewport-height');
      document.documentElement.style.removeProperty('--visual-viewport-offset-top');
    });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible();
  }
});

test('roulette number centers always select that straight number', async ({ page }) => {
  for (let number = 0; number <= 36; number++) {
    const button = page.getByRole('button', { name: `Bet straight on ${number}`, exact: true });
    await button.scrollIntoViewIfNeeded();
    const box = (await button.boundingBox())!;
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(page.getByLabel('Selected bet')).toHaveText(`0:${number}:${number}`);
  }
  await page.getByRole('button', { name: 'Split 3–6', exact: true }).click();
  await expect(page.getByLabel('Selected bet')).toHaveText('1:Split 3–6:3,6');
});

test('roulette combinations occupy their table edges without covering number centers', async ({ page }) => {
  const table = page.getByRole('group', { name: 'Roulette betting table', exact: true });
  const targets = table.locator('[data-roulette-combination]');
  await expect(targets).toHaveCount(102);
  const failures = await targets.evaluateAll(buttons => buttons.flatMap(button => {
    button.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    const label = button.getAttribute('aria-label')!;
    const numbers = label.replace(/^6-Line/, '').match(/\d+/g)!.map(Number);
    const cell = (number: number) => document.querySelector(`[aria-label="Bet straight on ${number}"]`)!.getBoundingClientRect();
    let x: number, y: number;
    const first = cell(numbers[0]);
    if (label.startsWith('Split')) {
      const second = cell(numbers[1]);
      if (numbers[1] - numbers[0] === 1) {
        x = first.x + first.width / 2; y = (first.top + second.bottom) / 2;
      } else {
        x = (first.right + second.left) / 2; y = first.y + first.height / 2;
      }
    } else if (label.startsWith('Corner')) {
      const opposite = cell(numbers[3]);
      x = (first.right + opposite.left) / 2; y = (first.top + opposite.bottom) / 2;
    } else {
      const top = cell(numbers[0] + 2);
      x = label.startsWith('Street') ? top.x + top.width / 2 : (top.right + cell(numbers[0] + 5).left) / 2;
      y = top.top + 8;
    }
    const hit = document.elementFromPoint(x, y)?.closest('button');
    return hit === button ? [] : [`${label}: hit ${hit?.getAttribute('aria-label')}`];
  }));
  expect(failures).toEqual([]);
  for (const [name, value] of [
    ['Split 1–2', '1:Split 1–2:1,2'], ['Split 33–36', '1:Split 33–36:33,36'],
    ['Corner 1, 2, 4, 5', '3:Corner 1, 2, 4, 5:1,2,4,5'],
    ['Street 34–36', '2:Street 34–36:34,35,36'], ['6-Line 1–6', '4:6-Line 1–6:1,2,3,4,5,6'],
  ]) {
    const target = table.getByRole('button', { name, exact: true });
    await target.click();
    await expect(page.getByLabel('Selected bet')).toHaveText(value);
    await expect(target).toHaveAttribute('aria-pressed', 'true');
  }
  const keyboardTarget = table.getByRole('button', { name: 'Street 1–3', exact: true });
  await keyboardTarget.focus();
  await keyboardTarget.press('Enter');
  await expect(page.getByLabel('Selected bet')).toHaveText('2:Street 1–3:1,2,3');
  await page.getByLabel('Lock roulette betting', { exact: true }).check();
  for (const button of await table.getByRole('button').all()) await expect(button).toBeDisabled();
  await expect(page.getByText('Combination bets', { exact: true })).toHaveCount(0);
});

test('failed reads have a retry and distinct empty state', async ({ page }) => {
  const region = page.getByRole('region', { name: 'Read failure' });
  await expect(region.getByRole('alert')).toContainText('Production unavailable');
  await region.getByRole('button', { name: 'Retry' }).click();
  await expect(region.getByRole('status')).toContainText('Nothing ready to collect');
});

test('trade review preserves exact give and receive amounts at extreme rates', async ({ page }) => {
  const review = page.getByRole('region', { name: 'Exact marketplace amounts' });
  await expect(review).toContainText('You give 1000000000000000000 SEED');
  await expect(review).toContainText('You receive 0.000000000000000001 LEAF');
  await expect(review).toContainText('Rate: <0.000000000000000001 LEAF per SEED');
  expect(await review.evaluate(el => el.scrollWidth <= el.clientWidth + 1)).toBe(true);
});

test('chat supports IME, multiline drafts and failure recovery', async ({ page }) => {
  const chat = page.getByRole('textbox', { name: 'Type a chat message' });
  const ai = page.getByRole('textbox', { name: 'Ask Neural Seed a question' });
  await chat.fill('Public draft');
  await ai.fill('AI draft');
  expect(await chat.getAttribute('aria-describedby')).not.toBe(await ai.getAttribute('aria-describedby'));
  await chat.dispatchEvent('keydown', { key: 'Enter', isComposing: true });
  await expect(page.getByLabel('Send count')).toHaveText('0');
  await chat.press('Shift+Enter');
  await chat.press('End');
  await chat.press('Enter');
  await expect(page.getByLabel('Send count')).toHaveText('1');
  await expect(chat).toHaveValue(/Public draft/);
  await page.setViewportSize({ width: 1024, height: 600 });
  await expect(ai).toHaveValue('AI draft');
  await page.getByRole('button', { name: 'Allow successful send' }).click();
  await page.getByRole('button', { name: 'Send chat message', exact: true }).click();
  await expect(chat).toHaveValue('');
  await expect(ai).toHaveValue('AI draft');
});

test('nested dialog dismisses one layer and restores focus', async ({ page }) => {
  const opener = page.getByRole('button', { name: 'Open fixture dialog' });
  await opener.click();
  const review = page.getByRole('button', { name: 'Review action' });
  await review.click();
  await expect(page.getByRole('dialog', { name: 'Confirm resource action' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Back to amount' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Confirm resource action' })).toBeHidden();
  await expect(review).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeHidden();
  await expect(opener).toBeFocused();
});

test('land resource badges fit beside Map and retain exact totals', async ({ page }) => {
  const fixture = page.getByRole('region', { name: 'Land resource fixture' });
  const badges = fixture.getByRole('group', { name: 'Available land resources' });
  await expect(badges).toContainText('2.5 PTS');
  await expect(badges.getByLabel('1h lifetime', { exact: true })).toBeVisible();
  await fixture.getByRole('button', { name: 'Use large land totals' }).click();
  await expect(badges.getByLabel('1,234,567,890.123456789012 PTS', { exact: true })).toHaveText('1.23B PTS');
  await expect(badges.getByLabel('400d 1h 2m 3s lifetime', { exact: true })).toHaveText('400d 1h');
  const image = (await fixture.getByLabel('Land illustration fixture', { exact: true }).boundingBox())!;
  const badgeBox = (await badges.boundingBox())!;
  const map = (await fixture.getByRole('button', { name: 'Open fixture map' }).boundingBox())!;
  expect(badgeBox.x).toBeGreaterThanOrEqual(map.x + map.width + 4);
  expect(badgeBox.x + badgeBox.width).toBeLessThanOrEqual(image.x + image.width);
  expect(badgeBox.y + badgeBox.height).toBeLessThanOrEqual(image.y + image.height);
  expect(await badges.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

test('nested Escape respects a feature that must keep its confirmation open', async ({ page }) => {
  await page.getByRole('checkbox', { name: 'Keep confirmation open on Escape' }).check();
  await page.getByRole('button', { name: 'Open fixture dialog' }).click();
  await page.getByRole('button', { name: 'Review action', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Back to amount' })).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Confirm resource action' })).toBeVisible();
  await page.getByRole('button', { name: 'Back to amount' }).click();
  await expect(page.getByRole('dialog', { name: 'Resource action', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('first care persists by wallet and urgent plants retain guidance', async ({ page }) => {
  const guide = page.getByRole('region', { name: 'First-care fixture' });
  await guide.getByText('Your next steps', { exact: true }).click();
  await guide.getByRole('button', { name: "Farmer's Tasks" }).click();
  await guide.getByRole('button', { name: 'Confirm fixture care' }).click();
  await expect(guide.locator('details')).toHaveCount(0);
  await page.reload();
  await expect(guide.locator('details')).toHaveCount(0);
  await guide.getByRole('button', { name: 'Switch fixture wallet' }).click();
  await expect(guide.getByText('Your next steps', { exact: true })).toBeVisible();
  await guide.getByRole('button', { name: 'Switch fixture wallet' }).click();
  await expect(guide.locator('details')).toHaveCount(0);
  await guide.getByRole('button', { name: 'Toggle urgent care' }).click();
  await expect(guide.getByText('Your plant needs care', { exact: true })).toBeVisible();
  await expect(guide).toContainText('Choose a care item');
});

test('game amounts remain readable with visible labels and associated errors', async ({ page }, testInfo) => {
  const field = page.getByRole('textbox', { name: 'Bet amount (SEED)' });
  await expect(field).toHaveAttribute('inputmode', 'decimal');
  await field.fill('2');
  await expect(field).toHaveAttribute('aria-invalid', 'true');
  await expect(field).toHaveAccessibleDescription('Your balance is 1 SEED.');
  const appearance = await field.evaluate(node => ({ color: getComputedStyle(node).color, font: parseFloat(getComputedStyle(node).fontSize) }));
  expect(appearance.color).toBe('rgb(255, 255, 255)');
  expect(appearance.font).toBeGreaterThanOrEqual(testInfo.project.use.viewport!.width < 864 ? 16 : 14);
});

test('dialog spacing variants retain a reachable footer in a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 430 });
  for (const padding of ['default', 'compact', 'none']) {
    await page.getByLabel('Dialog spacing', { exact: true }).selectOption(padding);
    await page.getByRole('button', { name: 'Open spacing dialog' }).click();
    const dialog = page.getByRole('dialog', { name: 'Spacing and viewport' });
    const panel = dialog.locator('[data-viewport-debug-dialog-surface]');
    const box = (await panel.boundingBox())!;
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(431);
    expect(await panel.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const body = dialog.getByTestId('spacing-dialog-body');
    expect(await body.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    const action = dialog.getByRole('button', { name: 'Finish spacing check' });
    await expect(action).toBeInViewport();
    await action.click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open spacing dialog' })).toBeFocused();
  }
});

test('uncertain transaction outcomes stay distinct from confirmed results', async ({ page }) => {
  const state = page.getByLabel('Transaction state', { exact: true });
  await state.selectOption('submissionAmbiguous');
  await expect(page.getByText('Your transaction may still complete.', { exact: true })).toBeVisible();
  await expect(page.getByText('Action complete', { exact: true })).toHaveCount(0);
  await state.selectOption('confirmedSyncing');
  await expect(page.getByText('Refresh your game to see the result.', { exact: true })).toBeVisible();
  await state.selectOption('success');
  await expect(page.getByText('Action complete', { exact: true })).toBeVisible();
});

test('quest overview and detail share reads and recover together after failure', async ({ page }) => {
  const overview = page.getByRole('region', { name: 'Quest overview observer' });
  const panel = page.getByRole('region', { name: 'Quest panel observer' });
  await expect(page.getByLabel('Quest network read count')).toHaveText('1');
  await page.getByRole('button', { name: 'Fail current quests' }).click();
  await expect(overview.getByRole('alert')).toBeVisible();
  await expect(panel.getByRole('alert')).toBeVisible();
  await overview.getByRole('button', { name: 'Retry quests' }).click();
  await expect(page.getByLabel('Quest network read count')).toHaveText('2');
  await page.getByRole('button', { name: 'Resolve current quests' }).click();
  await expect(overview).toContainText('3 available');
  await expect(panel).toContainText('3 available');
});

test('quest responses cannot cross wallet, land or network scope', async ({ page }) => {
  const overview = page.getByRole('region', { name: 'Quest overview observer' });
  await page.getByRole('button', { name: 'Select quest wallet B' }).click();
  await expect(page.getByLabel('Quest network read count')).toHaveText('2');
  await page.getByRole('button', { name: 'Resolve old wallet A' }).click();
  await expect(overview).toContainText('Checking quest timing');
  await expect(overview).not.toContainText('3 available');
  await page.getByRole('button', { name: 'Resolve current quests' }).click();
  await expect(overview).toContainText('2 available');
  await page.getByRole('button', { name: 'Select quest land 2' }).click();
  await expect(overview).toContainText('Checking quest timing');
  await page.getByRole('button', { name: 'Resolve current quests' }).click();
  await expect(overview).toContainText('2 available');
  await page.getByRole('button', { name: 'Select quest test network' }).click();
  await expect(overview).toContainText('Checking quest timing');
  await expect(page.getByLabel('Quest network read count')).toHaveText('4');
});

test('named dialog layouts keep long content and actions reachable at enlarged text size', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 430 });
  await page.addStyleTag({ content: 'html { font-size: 20px; }' });
  for (const layout of ['form', 'detail', 'game']) {
    await page.getByLabel('Dialog layout', { exact: true }).selectOption(layout);
    await page.getByRole('button', { name: 'Open layout dialog' }).click();
    const dialog = page.getByRole('dialog', { name: `${layout} layout` });
    const surface = dialog.locator('[data-dialog-layout]');
    const bounds = (await surface.boundingBox())!;
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(431);
    expect(await surface.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
    const scrollOwner = layout === 'game' ? surface : dialog.getByTestId('layout-content');
    expect(await scrollOwner.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    if (layout === 'form') await expect(dialog.getByRole('button', { name: 'Finish layout check' })).toBeInViewport();
    if (layout === 'game') {
      const headingSurface = await dialog.getByRole('button', { name: 'Close game layout dialog' }).evaluate(button => {
        const style = getComputedStyle(button.parentElement!);
        return { background: style.backgroundColor, border: style.borderBottomWidth };
      });
      expect(headingSurface).toEqual({ background: 'rgba(0, 0, 0, 0)', border: '0px' });
      const close = (await dialog.getByRole('button', { name: 'Close game layout dialog' }).boundingBox())!;
      const field = (await dialog.getByRole('textbox', { name: 'Layout amount (SEED)' }).boundingBox())!;
      expect(close.y + close.height).toBeLessThanOrEqual(field.y);
    }
    await dialog.getByRole('button', { name: 'Last content action' }).click();
    if (layout === 'game') await expect(dialog.getByRole('button', { name: 'Close game layout dialog' })).toBeInViewport();
    await dialog.getByRole('button', { name: 'Finish layout check' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('button', { name: 'Open layout dialog' })).toBeFocused();
  }
});

test('roulette removal targets stay distinct and preserve long amounts', async ({ page }) => {
  const bets = page.getByRole('region', { name: 'Bet removal fixture' });
  await expect(bets.getByRole('img', { name: 'ETH', exact: true })).toHaveCount(2);
  expect(await bets.getByRole('listitem').evaluateAll(rows => rows.every(row => row.scrollWidth <= row.clientWidth + 1))).toBe(true);
  for (const button of await bets.getByRole('button').all()) {
    const bounds = (await button.boundingBox())!;
    expect(bounds.height).toBeGreaterThanOrEqual(44);
    expect(bounds.width).toBeGreaterThanOrEqual(44);
  }
  expect(await bets.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  await bets.getByRole('button', { name: 'Remove Corner 1,2,4,5 bet' }).click();
  await expect(bets.getByText('0.000000000000000001')).toHaveCount(0);
  await expect(bets.getByText('999999999999999999.99')).toBeVisible();
  await bets.getByRole('button', { name: 'Clear bets' }).click();
  await expect(bets.getByText('Tap the table to add bets')).toBeVisible();
});

test('tiny and very large token amounts expose exact values without overflow', async ({ page }) => {
  const tokens = page.getByRole('region', { name: 'Token precision fixture' });
  await expect(tokens.getByLabel('0.000000000000000001 SEED', { exact: true })).toHaveText('<0.01 SEED');
  await expect(tokens.getByText('9,007,199,254,740,993.123456789123456789 SEED', { exact: true })).toBeVisible();
  await expect(tokens.getByText('~<0.000001 ETH', { exact: true })).toBeVisible();
  expect(await tokens.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

test('asset selectors preserve deliberate independent selections across refreshed holdings', async ({ page }) => {
  const transfer = page.getByRole('region', { name: 'Transfer selection fixture' });
  const plants = transfer.getByRole('button', { name: 'Plants selected 0 selected' });
  await plants.click();
  await expect(page.getByRole('menuitemcheckbox', { checked: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: 'Select all', exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox', { checked: true })).toHaveCount(2);
  await page.keyboard.press('Escape');
  await expect(transfer.getByRole('button', { name: 'Plants selected 2 selected' })).toBeFocused();
  await expect(transfer.getByRole('button', { name: 'Lands selected 0 selected' })).toBeVisible();
  await transfer.getByRole('button', { name: 'Refresh fixture assets' }).click();
  await transfer.getByRole('button', { name: 'Plants selected 1 selected' }).click();
  await expect(page.getByRole('menuitemcheckbox', { name: 'Plant #2' })).toBeChecked();
  await expect(page.getByRole('menuitemcheckbox', { name: /A very long plant/ })).not.toBeChecked();
  await page.getByRole('menuitem', { name: 'Clear', exact: true }).click();
  await expect(page.getByRole('menuitemcheckbox', { checked: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
});

test('unverified and approved allowance states do not expose a submission', async ({ page }) => {
  const transfer = page.getByRole('region', { name: 'Transfer selection fixture' });
  for (const [state, message] of [['loading', 'Checking plants approval'], ['error', 'Plants approval unavailable'], ['approved', 'Plants approved']]) {
    await transfer.getByLabel('Approval read state').selectOption(state);
    await expect(transfer.getByRole('status')).toContainText(message);
    await expect(transfer.getByRole('button', { name: 'Approve fixture plants' })).toHaveCount(0);
  }
  await transfer.getByLabel('Approval read state').selectOption('required');
  await expect(transfer.getByRole('button', { name: 'Approve fixture plants' })).toBeVisible();
});

test('production readouts retain tiny points and total lifetime without looking actionable', async ({ page }) => {
  const production = page.getByRole('region', { name: 'Production readouts fixture' });
  await expect(production).toContainText('<0.01 PTS');
  await expect(production).toContainText('400d 1h');
  await expect(production.getByText('Lifetime per day')).toHaveCount(0);
  await expect(production.getByRole('button')).toHaveCount(0);
  expect(await production.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

test('quest difficulty has distinct colors and retains arrow-key selection', async ({ page }) => {
  const group = page.getByRole('radiogroup', { name: 'Quest difficulty', exact: true });
  const easy = group.getByRole('radio', { name: 'Easy 3h', exact: true });
  const medium = group.getByRole('radio', { name: 'Med 6h', exact: true });
  const hard = group.getByRole('radio', { name: 'Hard 12h', exact: true });
  const colors = await group.getByRole('radio').evaluateAll(nodes => nodes.map(node => getComputedStyle(node).color));
  expect(new Set(colors).size).toBe(3);
  await expect(easy).toHaveAttribute('aria-checked', 'true');
  await easy.focus();
  await page.keyboard.press('ArrowRight');
  await expect(medium).toBeFocused();
  await expect(medium).toHaveAttribute('aria-checked', 'true');
  await hard.click();
  await expect(hard).toHaveAttribute('aria-checked', 'true');
  expect(await group.evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
  for (const option of [easy, medium, hard]) expect((await option.boundingBox())!.height).toBeGreaterThanOrEqual(40);
});
