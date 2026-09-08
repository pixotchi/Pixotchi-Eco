import { test, expect, type Locator } from '@playwright/test';
import { createRequire } from 'node:module';
import { openQaFixture } from './helpers/bootstrap';

const fixtureRequire = createRequire(`${process.cwd()}/package.json`);
const PNG = (fixtureRequire('pngjs') as { PNG: { sync: { read: (buffer: Buffer) => { width: number; height: number; data: Buffer } } } }).PNG;
const luminance = (rgb: number[]) => rgb.map(v => { const s = v / 255; return s <= .04045 ? s / 12.92 : ((s + .055) / 1.055) ** 2.4; }).reduce((sum, v, i) => sum + v * [.2126, .7152, .0722][i], 0);
const contrast = (a: number[], b: number[]) => { const [bright, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x); return (bright + .05) / (dark + .05); };

async function expectLabelContrast(target: Locator, label: string) {
  const color = await target.evaluate(node => {
    (node as HTMLElement).style.setProperty('transition', 'none', 'important');
    const canvas = document.createElement('canvas'); const context = canvas.getContext('2d')!;
    context.fillStyle = getComputedStyle(node).color; context.fillRect(0, 0, 1, 1);
    return [...context.getImageData(0, 0, 1, 1).data].slice(0, 3);
  });
  // Hide only the label after reading its ink. Pixels retain the real tint,
  // gradient and ancestor composition, rather than assuming a flat card.
  await target.evaluate(node => (node as HTMLElement).style.setProperty('color', 'transparent', 'important'));
  const png = PNG.sync.read(await target.screenshot());
  await target.evaluate(node => (node as HTMLElement).style.removeProperty('color'));
  for (const y of [4, Math.floor(png.height / 2), png.height - 5]) {
    const offset = (y * png.width + Math.floor(png.width / 2)) * 4;
    const background = [...png.data.subarray(offset, offset + 3)];
    expect(contrast(color, background), `${label} at y=${y}, ink=${color}, background=${background}`).toBeGreaterThanOrEqual(4.5);
  }
}

test.beforeEach(async ({ page }, testInfo) => {
  await openQaFixture(page, testInfo, '/qa/foundation');
});

test('information, links and success labels stay legible on actual themed surfaces', async ({ page }, testInfo) => {
  test.skip(!['390-light', '1440-dark', 'webkit-390-light'].includes(testInfo.project.name), 'Palette checks run in three representative engines and sizes.');
  test.setTimeout(120_000);
  // Compare settled palette states, including text hidden for pixel sampling.
  await page.locator('[data-contrast], [data-surface], html, body').evaluateAll(nodes => nodes.forEach(node => (node as HTMLElement).style.setProperty('transition', 'none', 'important')));
  for (const theme of ['light', 'dark', 'green', 'yellow', 'red', 'pink', 'blue', 'violet']) {
    await page.evaluate(value => { document.documentElement.className = value; }, theme);
    const targets = page.locator('[data-contrast]');
    for (const target of await targets.all()) {
      const label = `${theme}/${await target.getAttribute('data-contrast')}/${await target.locator('..').getAttribute('data-surface')}`;
      await expectLabelContrast(target, label);
      if (await target.getAttribute('data-contrast') === 'link') {
        await target.hover(); await expectLabelContrast(target, `${label}/hover`); await page.mouse.move(0, 0);
      }
    }
    await page.getByRole('button', { name: 'Open long menu' }).click();
    await page.keyboard.press('Home');
    const first = page.getByRole('menuitem', { name: 'Choice 1', exact: true });
    await expect(first).toBeFocused();
    await expectLabelContrast(first, `${theme}/highlighted-menu-item`);
    await page.keyboard.press('Escape');
  }
});

test('quantity entry handles range, invalid drafts and complete purchases with touch-sized controls', async ({ page }) => {
  const section = page.getByRole('region', { name: 'Direct quantity purchase' });
  const input = section.getByRole('textbox', { name: 'Quantity', exact: true });
  const buy = section.getByRole('button', { name: 'Buy selected quantity' });
  for (const name of ['Decrease quantity', 'Increase quantity']) {
    const bounds = (await section.getByRole('button', { name }).boundingBox())!;
    expect(bounds.width).toBeGreaterThanOrEqual(44); expect(bounds.height).toBeGreaterThanOrEqual(44);
  }
  await input.fill('80'); await buy.click();
  await expect(section.getByLabel('Purchased quantity')).toHaveText('80');
  await expect(section.getByRole('button', { name: 'Increase quantity' })).toBeDisabled();
  await input.fill('abc'); await input.press('Tab');
  await expect(input).toHaveAttribute('aria-invalid', 'true'); await expect(buy).toBeDisabled();
  await expect(input).toHaveAccessibleDescription('Enter a whole number from 1 to 80.');
  await input.fill('999'); await input.press('Tab'); await expect(input).toHaveValue('80');
  await input.fill('1'); await input.press('ArrowUp'); await expect(input).toHaveValue('2');
  await buy.click(); await expect(section.getByLabel('Purchased quantity')).toHaveText('2');
  await input.fill(''); await input.press('Escape'); await expect(input).toHaveValue('2'); await expect(buy).toBeEnabled();
});

test('long menus keep the final choice reachable in a short mobile viewport', async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 360 });
  const trigger = page.getByRole('button', { name: 'Open long menu' });
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Open long menu' });
  const bounds = (await menu.boundingBox())!;
  expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.x + bounds.width).toBeLessThanOrEqual(320);
  expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(361);
  await page.keyboard.press('End');
  await expect(page.getByRole('menuitem', { name: 'Choice 50', exact: true })).toBeFocused();
  await expect(page.getByRole('menuitem', { name: 'Choice 50', exact: true })).toBeInViewport();
  await page.keyboard.press('Enter');
  await expect(page.getByLabel('Chosen menu item')).toHaveText('50'); await expect(trigger).toBeFocused();
});

test('compact token amounts retain their exact value in the title and accessible label', async ({ page }) => {
  const exact = '9,007,199,254,740,993.123456789123456789 SEED';
  const amount = page.getByRole('region', { name: 'Exact token amount' }).getByTitle(exact, { exact: true });
  await expect(amount).toBeVisible();
  await expect(amount).toHaveAttribute('aria-label', exact);
  expect(await amount.locator('..').evaluate(node => node.scrollWidth <= node.clientWidth + 1)).toBe(true);
});

test('large asset collections can be searched without losing selections or keyboard access', async ({ page }) => {
  const collection = page.getByRole('region', { name: 'Large asset collection' });
  const trigger = collection.getByRole('button');
  await trigger.focus(); await trigger.press('Enter');
  const search = page.getByRole('textbox', { name: 'Search land names or IDs' });
  await expect(search).toBeFocused();
  await page.keyboard.type('#50');
  await expect(page.getByRole('menuitemcheckbox')).toHaveCount(1);
  await search.press('ArrowDown');
  const match = page.getByRole('menuitemcheckbox', { name: 'Garden 50 #50' });
  await expect(match).toBeFocused(); await match.press('Space');
  await expect(match).toBeChecked();
  await expect(collection.getByLabel('Selected land IDs')).toHaveText('1,50');
  await page.keyboard.press('Shift+Tab'); await expect(search).toBeFocused();
  await page.keyboard.press('ControlOrMeta+A'); await page.keyboard.type('missing');
  await expect(page.getByRole('status').filter({ hasText: 'No matching lands.' })).toBeVisible();
  await expect(page.getByRole('menuitem', { name: 'Select matches' })).toBeDisabled();
  await search.press('Escape');
  await collection.getByRole('button').click();
  await expect(search).toHaveValue('');
  await expect(page.getByRole('menuitemcheckbox', { checked: true })).toHaveCount(2);
  await page.keyboard.press('Escape');
});

test('portaled scroll fades register on opening and follow text-only content changes', async ({ page }) => {
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.getByRole('button', { name: 'Open late dialog' }).click();
    const scroll = page.getByTestId('dynamic-scroll');
    await expect(scroll).not.toHaveAttribute('data-scroll-fade-bottom', 'true');
    await page.getByRole('button', { name: 'Toggle content length' }).click();
    await expect(scroll).toHaveAttribute('data-scroll-fade-bottom', 'true');
    await scroll.evaluate(node => node.scrollTo(0, node.scrollHeight));
    await expect(scroll).toHaveAttribute('data-scroll-fade-top', 'true');
    await expect(scroll).not.toHaveAttribute('data-scroll-fade-bottom', 'true');
    await page.getByRole('button', { name: 'Toggle content length' }).click();
    await expect(scroll).not.toHaveAttribute('data-scroll-fade-top', 'true');
    await page.getByRole('button', { name: 'Finish reading' }).click();
  }
});

test('connected tablet content uses the available width before the two-column breakpoint', async ({ page }) => {
  await page.setViewportSize({ width: 820, height: 900 });
  const bounds = (await page.getByTestId('tablet-shell').boundingBox())!;
  expect(bounds.width).toBeGreaterThan(700); expect(bounds.x + bounds.width).toBeLessThanOrEqual(820);
});

test('mint share uses a selectable mobile-sized field without making a network mutation', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.route('**/api/share/create', route => route.fulfill({ json: { shortUrl: 'https://example.test/plant-share' } }));
  await page.getByRole('button', { name: 'Open mint share' }).click();
  const field = page.getByRole('textbox');
  await expect(field).toHaveValue('example.test/plant-share');
  expect(await field.evaluate(node => parseFloat(getComputedStyle(node).fontSize))).toBeGreaterThanOrEqual(16);
  await field.focus();
  expect(await field.evaluate(node => (node as HTMLInputElement).selectionEnd! - (node as HTMLInputElement).selectionStart!)).toBe('example.test/plant-share'.length);
});
