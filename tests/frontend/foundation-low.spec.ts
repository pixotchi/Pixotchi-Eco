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
  await group.evaluate(node => (node as HTMLElement).style.setProperty('--motion-standard', '2s'));
  await group.getByRole('radio', { name: 'Two', exact: true }).click();
  const afterObserver = await pill.evaluate(async node => {
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    return node.getAnimations().map(animation => ({ state: animation.playState, duration: animation.effect?.getTiming().duration }));
  });
  expect(afterObserver).toEqual([{ state: 'running', duration: 2000 }]);

  const retarget = await pill.evaluate(async node => {
    const current = node.getAnimations()[0];
    current.pause(); current.currentTime = 500;
    const container = node.parentElement!;
    const previousLeft = node.getBoundingClientRect().left - container.getBoundingClientRect().left - container.clientLeft + container.scrollLeft;
    container.querySelector<HTMLButtonElement>('[role=radio]')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
    const next = node.getAnimations()[0];
    const first = (next?.effect as KeyframeEffect | null)?.getKeyframes()[0];
    return { state: next?.playState, delta: typeof first?.transform === 'string' ? Math.abs(new DOMMatrixReadOnly(first.transform).m41 - previousLeft) : null };
  });
  expect(retarget.state).toBe('running'); expect(retarget.delta).not.toBeNull(); expect(retarget.delta!).toBeLessThan(2);

  await group.getByRole('radio', { name: 'One', exact: true }).focus(); await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: 'Two', exact: true })).toBeChecked();
  await expect.poll(() => pill.evaluate(node => node.getAnimations().length)).toBe(0);
  await group.getByRole('radio', { name: 'One', exact: true }).click();
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect.poll(() => pill.evaluate(node => node.getAnimations().length)).toBe(0);
});

test('broken remote avatar renders the stable generated fallback', async ({ page }) => {
  const avatar = page.getByTestId('avatar-fallback');
  await avatar.scrollIntoViewIfNeeded();
  await expect.poll(() => brokenAvatarLoads.get(page)).toBeGreaterThan(0);
  await expect(avatar.locator('img')).toHaveCount(0);
  await expect(avatar.locator('svg')).toBeVisible();
  expect(await avatar.locator('svg').locator('..').evaluate(node => getComputedStyle(node).backgroundImage)).toContain('linear-gradient');
});
