import { test, expect, type Page } from '@playwright/test';
import { openQaFixture } from './helpers/bootstrap';
const brokenAvatarLoads = new WeakMap<Page, number>();

test.beforeEach(async ({ page }, testInfo) => {
  await page.route('**/api/ens/avatars**', route => route.fulfill({ json: { avatars: { '0x9999999999999999999999999999999999999999': '/missing-fixture-avatar.png' } } }));
  brokenAvatarLoads.set(page, 0);
  await page.route('**/missing-fixture-avatar.png', async route => {
    await route.fulfill({ status: 404, body: '' });
    brokenAvatarLoads.set(page, (brokenAvatarLoads.get(page) ?? 0) + 1);
  });
  await openQaFixture(page, testInfo, '/qa/foundation');
});

test('disabled slotted links block child and parent handlers without trapping Tab', async ({ page }) => {
  const link = page.getByRole('link', { name: 'Guarded child link' });
  await expect(link).toHaveAttribute('aria-disabled', 'true');
  await expect(link).toHaveAttribute('tabindex', '-1');
  await link.dispatchEvent('click');
  await link.focus(); await page.keyboard.press('Enter'); await page.keyboard.press('Space');
  await expect(page.getByLabel('Link activations')).toHaveText('0');
  expect(new URL(page.url()).hash).toBe('');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'Toggle link availability' })).toBeFocused();
  await page.keyboard.press('Enter'); await link.click();
  await expect(page.getByLabel('Link activations')).toHaveText('4');
  await expect(page).toHaveURL(/#guarded-destination$/, { timeout: 15_000 });
});

test('notice wrappers forward labels, event handlers and deliberate live-region overrides', async ({ page }) => {
  await expect(page.getByTestId('forwarded-chip')).toHaveAttribute('id', 'low-chip');
  await expect(page.getByTestId('forwarded-chip')).toHaveAccessibleName('Readiness status');
  await expect(page.getByTestId('forwarded-chip')).toHaveAttribute('title', 'Status detail');
  await page.getByTestId('forwarded-chip').click();
  await expect(page.getByLabel('Link activations')).toHaveText('1');
  await expect(page.getByTestId('forwarded-balance')).toHaveAttribute('role', 'status');
  await expect(page.getByTestId('forwarded-balance')).toHaveAttribute('aria-live', 'off');
  await expect(page.getByTestId('forwarded-reason')).toHaveAttribute('role', 'note');
  await expect(page.getByRole('textbox', { name: 'Associated control' })).toHaveAccessibleDescription('Connect a wallet to continue.');
  await expect(page.getByTestId('forwarded-result')).toHaveAttribute('role', 'alert');
  await expect(page.getByTestId('forwarded-result')).toHaveAttribute('aria-live', 'assertive');
  await expect(page.getByTestId('forwarded-result')).toContainText('Reward confirmed');
});

test('one applied CSS palette immediately drives browser chrome for all themes', async ({ page }) => {
  for (const theme of ['light', 'dark', 'green', 'yellow', 'red', 'pink', 'blue', 'violet']) {
    const colors = await page.evaluate(async value => {
      document.documentElement.className = value;
      await new Promise<void>(resolve => queueMicrotask(resolve));
      const ctx = document.createElement('canvas').getContext('2d')!;
      const normalize = (color: string) => { ctx.fillStyle = color; return ctx.fillStyle; };
      return { canvas: normalize(`hsl(${getComputedStyle(document.documentElement).getPropertyValue('--background')})`), chrome: normalize(document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')!.content), count: document.querySelectorAll('meta[name="theme-color"]').length };
    }, theme);
    expect(colors.chrome, theme).toBe(colors.canvas); expect(colors.count).toBe(1);
  }
});

test('task surfaces agree while content groups stay quiet and wrapped headings stay readable', async ({ page }) => {
  const style = (id: string) => page.getByTestId(id).evaluate(node => { const s = getComputedStyle(node); return { background: s.backgroundColor, image: s.backgroundImage, border: s.borderTopColor, shadow: s.boxShadow, borderWidth: s.borderTopWidth }; });
  const card = await style('card-panel'), standard = await style('standard-panel');
  expect(card.background).toBe(standard.background); expect(card.border).toBe(standard.border);
  expect(card.image).toBe('none'); expect(standard.image).toBe('none');
  for (const id of ['quiet-inset', 'quiet-group']) { const result = await style(id); expect(result.image).toBe('none'); expect(result.shadow).toBe('none'); expect(result.borderWidth).toBe('0px'); }
  await page.evaluate(() => { document.documentElement.style.fontSize = '32px'; });
  const title = await page.getByTestId('card-panel').getByRole('heading').evaluate(node => { const s = getComputedStyle(node); return { line: parseFloat(s.lineHeight), font: parseFloat(s.fontSize), weight: s.fontWeight, height: node.getBoundingClientRect().height }; });
  expect(title.line / title.font).toBeGreaterThanOrEqual(1.3); expect(title.weight).toBe('700'); expect(title.height).toBeGreaterThan(title.line);
});

test('form layout owns one scroll body and keeps its footer within a short viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 440 });
  await page.getByRole('button', { name: 'Open shared form' }).click();
  const dialog = page.getByRole('dialog', { name: 'A longer title for a responsive player action' });
  await expect(dialog).toBeVisible();
  expect(await dialog.evaluate(node => getComputedStyle(node).outlineOffset)).toBe('3px');
  const surface = dialog.locator('[data-dialog-layout=form]');
  expect(await surface.evaluate(node => getComputedStyle(node).outlineOffset)).toBe('7px');
  const body = page.getByTestId('low-form-body'), footer = page.getByTestId('low-form-footer');
  const position = await footer.boundingBox();
  expect(position!.y).toBeGreaterThanOrEqual(0); expect(position!.y + position!.height).toBeLessThanOrEqual(440);
  expect(await body.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
  await body.evaluate(node => { node.scrollTop = node.scrollHeight; });
  await expect(footer.getByRole('button')).toBeInViewport();
  await footer.getByRole('button').click(); await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: 'Open shared form' })).toBeFocused();
});

test('invalid selection paints no pill, keyboard selects truthfully and resize remeasures geometry', async ({ page }) => {
  const group = page.getByRole('radiogroup', { name: 'Sample selection' });
  const pill = group.locator(':scope > span[aria-hidden=true]');
  await expect(group.locator('[aria-checked=true]')).toHaveCount(0);
  await expect(pill).toHaveCSS('opacity', '0');
  await group.getByRole('radio', { name: 'One', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Two', exact: true })).toBeChecked();
  await page.keyboard.press('ArrowLeft');
  await page.getByRole('button', { name: 'Resize sample labels' }).click();
  await page.getByRole('button', { name: 'Rotate sample selection' }).click();
  const selected = group.getByRole('radio', { name: 'First longer choice' });
  await expect.poll(async () => { const a = await pill.boundingBox(), b = await selected.boundingBox(); return Math.abs(a!.width - b!.width) + Math.abs(a!.height - b!.height) + Math.abs(a!.x - b!.x) + Math.abs(a!.y - b!.y); }).toBeLessThan(2);
  await selected.focus(); await page.keyboard.press('ArrowDown');
  await expect(group.getByRole('radio', { name: 'Two', exact: true })).toBeChecked();
  await page.getByRole('button', { name: 'Clear sample selection' }).click(); await expect(pill).toHaveCSS('opacity', '0');
});

test('normal pointer selection survives observer delivery and retargets while keyboard and reduced motion stay immediate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const group = page.getByRole('radiogroup', { name: 'Sample selection' });
  const pill = group.locator(':scope > span[aria-hidden=true]');
  await group.getByRole('radio', { name: 'One', exact: true }).click();
  const samples = await pill.evaluate(async node => {
    const container = node.parentElement!;
    const two = container.querySelectorAll<HTMLButtonElement>('[role=radio]')[1];
    const start = node.getBoundingClientRect().left;
    const target = two.getBoundingClientRect().left;
    two.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const middle = node.getBoundingClientRect().left;
    const before = node.getBoundingClientRect();
    container.querySelector<HTMLButtonElement>('[role=radio]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await new Promise<void>(resolve => queueMicrotask(resolve));
    const after = node.getBoundingClientRect();
    return { start, target, middle, jump: Math.abs(after.left - before.left) + Math.abs(after.width - before.width) };
  });
  expect(samples.middle).toBeGreaterThan(samples.start);
  expect(samples.middle).toBeLessThan(samples.target);
  expect(samples.jump).toBeLessThan(2);
  const alignment = async (name: string) => {
    const a = (await pill.boundingBox())!, b = (await group.getByRole('radio', { name, exact: true }).boundingBox())!;
    return Math.abs(a.x - b.x) + Math.abs(a.width - b.width);
  };
  await expect.poll(() => alignment('One')).toBeLessThan(2);
  await group.getByRole('radio', { name: 'One', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Two', exact: true })).toBeChecked();
  expect(await alignment('Two')).toBeLessThan(2);
  await group.getByRole('radio', { name: 'One', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => alignment('One')).toBeLessThan(2);

});

test('broken remote avatar renders the stable generated fallback', async ({ page }) => {
  const avatar = page.getByTestId('avatar-fallback');
  await avatar.scrollIntoViewIfNeeded();
  await expect.poll(() => brokenAvatarLoads.get(page)).toBeGreaterThan(0);
  await expect(avatar.locator('img')).toHaveCount(0);
  await expect(avatar.locator('svg')).toBeVisible();
  expect(await avatar.locator('svg').locator('..').evaluate(node => getComputedStyle(node).backgroundImage)).toContain('linear-gradient');
});

test('button press and release interpolate independent transforms while keyboard and reduced motion stay immediate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const button = page.getByRole('button', { name: 'Toggle link availability' });
  await button.scrollIntoViewIfNeeded();
  await button.evaluate(node => (node as HTMLElement).style.setProperty('--motion-quick', '2s'));
  await button.hover();
  const spatialTransitions = () => button.evaluate(node => node.getAnimations()
    .filter(animation => 'transitionProperty' in animation && ['scale', 'translate'].includes((animation as CSSTransition).transitionProperty))
    .map(animation => ({ property: (animation as CSSTransition).transitionProperty, duration: animation.effect?.getTiming().duration })));

  await page.mouse.down();
  await expect.poll(spatialTransitions).toEqual(expect.arrayContaining([
    { property: 'scale', duration: 2000 },
    { property: 'translate', duration: 2000 },
  ]));
  const pressedScale = await button.evaluate(node => {
    const animation = node.getAnimations().find(item => (item as CSSTransition).transitionProperty === 'scale')!;
    animation.pause();
    animation.currentTime = 500;
    return Number.parseFloat(getComputedStyle(node).scale);
  });
  expect(pressedScale).toBeGreaterThan(0.985);
  expect(pressedScale).toBeLessThan(1);
  // Releasing away from the target avoids triggering the fixture action.
  await page.mouse.move(0, 0);
  await page.mouse.up();
  await expect.poll(spatialTransitions).toEqual(expect.arrayContaining([
    expect.objectContaining({ property: 'scale' }),
  ]));

  // Keyboard modality disables the shared control's spatial transitions.
  await page.keyboard.press('Tab');
  await button.focus();
  await page.keyboard.down('Space');
  await expect.poll(spatialTransitions).toEqual([]);
  await page.keyboard.up('Space');

  await page.emulateMedia({ reducedMotion: 'reduce' });
  await button.hover();
  await page.mouse.down();
  await expect.poll(spatialTransitions).toEqual([]);
  await page.mouse.move(0, 0);
  await page.mouse.up();
});
