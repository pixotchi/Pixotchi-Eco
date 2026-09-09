import { expect, test, type Locator } from '@playwright/test';

test.use({ trace: 'off', video: 'off' });

async function description(locator: Locator) {
  return locator.evaluate(node => (node.getAttribute('aria-describedby') ?? '').split(' ')
    .map(id => document.getElementById(id)?.textContent ?? '').join(' '));
}

test('building selection keeps its details and map details preserve the canvas and controls', async ({ page }, testInfo) => {
  const submitted: string[] = [];
  page.on('request', request => {
    if (request.method() !== 'POST') return;
    try {
      const data: unknown = request.postDataJSON();
      for (const entry of Array.isArray(data) ? data : [data]) {
        if (entry && typeof entry === 'object' && 'method' in entry && typeof entry.method === 'string'
          && /^(eth_sendTransaction|eth_sendRawTransaction|wallet_sendCalls|eth_sendUserOperation)$/.test(entry.method)) submitted.push(entry.method);
      }
    } catch { /* Only inspect method names in JSON-RPC envelopes. */ }
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Local Test Wallet', exact: true }).click();
  await expect(page.locator('[data-connected=true]')).toBeVisible({ timeout: 60_000 });
  const tutorial = page.getByRole('dialog', { name: /Pixotchi tutorial/ });
  await tutorial.getByRole('button', { name: 'Skip', exact: true }).click();
  await expect(tutorial).toBeHidden();
  await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
  await page.getByRole('radio', { name: 'Lands', exact: true }).click();
  const grid = page.getByLabel('Choose a building', { exact: true });
  const tile = grid.getByRole('button', { name: 'Select Solar Panels', exact: true });
  await expect(tile).toBeVisible({ timeout: 60_000 });
  const details = page.getByRole('region', { name: 'Selected building details', exact: true });

  await test.step('Reselect a building without replacing its detail/controller subtree', async () => {
    await tile.scrollIntoViewIfNeeded();
    await tile.click();
    await expect(details.getByRole('heading', { name: 'Solar Panels', exact: true })).toBeVisible();
    const detailCard = details.locator('.surface-detail').first();
    await detailCard.evaluate(node => node.setAttribute('data-navigation-continuity', 'retained'));
    await expect(details.getByRole('button', { name: 'Back to buildings', exact: true })).toHaveCount(0);
    if ((page.viewportSize()?.width ?? 0) < 1280) {
      await expect(details).toBeFocused();
      await page.screenshot({ path: testInfo.outputPath('building-selection.png') });
      await tile.scrollIntoViewIfNeeded();
      await tile.focus();
      await tile.press('Enter');
      await expect(details).toBeFocused();
    }
    await expect(tile).toHaveAttribute('aria-pressed', 'true');
    await expect(detailCard).toHaveAttribute('data-navigation-continuity', 'retained');
  });

  await test.step('Terrain and land details do not change map geometry, including enlarged text', async () => {
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.getByRole('button', { name: 'Open map', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'World Map', exact: true });
    const canvas = dialog.getByRole('region', { name: 'Land map', exact: true });
    await expect(canvas).toBeVisible();
    await dialog.evaluate(node => Promise.all(node.getAnimations().map(animation => animation.finished.catch(() => undefined))));
    await expect(dialog.getByText('Loading map data…', { exact: true })).toBeHidden();
    await expect(dialog.getByText('Loading neighbor details…', { exact: true })).toBeHidden();
    await canvas.focus();
    await expect.poll(() => description(canvas)).toContain('Selected.');
    const bounds = await canvas.boundingBox();
    for (let attempts = 0; attempts < 20 && !(await description(canvas)).includes('wilderness'); attempts++) await canvas.press('ArrowRight');
    await expect.poll(() => description(canvas)).toContain('wilderness');
    await canvas.press('Enter');
    const terrain = dialog.getByRole('region', { name: 'Terrain details', exact: true });
    await expect(terrain).toBeVisible();
    await expect.poll(() => canvas.boundingBox()).toEqual(bounds);
    await dialog.getByRole('button', { name: 'Zoom in on map', exact: true }).click();
    await expect.poll(() => canvas.boundingBox()).toEqual(bounds);
    await terrain.getByRole('button', { name: 'Dismiss terrain details', exact: true }).click();
    await expect(canvas).toBeFocused();
    await expect(terrain).toBeHidden();
    await expect.poll(() => canvas.boundingBox()).toEqual(bounds);
    await canvas.click({ position: { x: bounds!.width / 2, y: bounds!.height / 2 } });
    await expect(terrain).toBeVisible();
    await expect.poll(() => canvas.boundingBox()).toEqual(bounds);
    await terrain.getByRole('button', { name: 'Dismiss terrain details', exact: true }).click();
    await expect(canvas).toBeFocused();
    await expect(terrain).toBeHidden();

    for (let attempts = 0; attempts < 30; attempts++) {
      const status = await description(canvas);
      if (/Plot \d+\./.test(status) && !status.includes('You own this plot')) break;
      await canvas.press('ArrowRight');
    }
    expect(await description(canvas)).toMatch(/Plot \d+\./);
    expect(await description(canvas)).not.toContain('You own this plot');
    await canvas.press('Enter');
    const land = dialog.getByRole('region', { name: 'Land details', exact: true });
    await expect(land).toBeVisible();
    await expect.poll(() => canvas.boundingBox()).toEqual(bounds);
    await dialog.screenshot({ path: testInfo.outputPath('map-anchored-details.png') });

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.setViewportSize({ width: page.viewportSize()!.width, height: 440 });
    await page.addStyleTag({ content: 'html { font-size: 200% !important; }' });
    const panel = dialog.locator('[data-map-details=land]');
    await expect.poll(() => panel.evaluate(node => node.scrollHeight > node.clientHeight)).toBe(true);
    const zoom = dialog.getByRole('button', { name: 'Zoom out on map', exact: true });
    await expect(zoom).toBeInViewport();
    const panelBox = await panel.boundingBox(), zoomBox = await zoom.boundingBox();
    expect(panelBox!.y + panelBox!.height).toBeLessThanOrEqual(zoomBox!.y);
    await zoom.click();
    await land.getByRole('button', { name: 'Dismiss land details', exact: true }).click();
    await expect(canvas).toBeFocused();
    await expect(land).toBeHidden();
    await dialog.getByRole('button', { name: 'Close world map', exact: true }).click();
    await expect(dialog).toBeHidden();
  });
  expect(submitted, 'Navigation must not submit wallet transactions').toEqual([]);
});
