// Actual map components, React Query, Radix dialog and app CSS. Only remote
// contracts, name resolution and the separately audited profile are replaced.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, webkit, expect } from '@playwright/test';

const cwd = process.cwd();
const captureEvidence = !process.argv.includes('--no-captures');
const boundary = `
import React from 'react';
const config = new URLSearchParams(location.search);
export const state = window.mapAudit = { supplyReads: [], neighborReads: [], ownerReads: [], clicks: [] };
export const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
export const CREATOR_TOKEN_ADDRESS = '0x1111111111111111111111111111111111111111';
export const CRYPTICPOET_TOKEN_ADDRESS = CREATOR_TOKEN_ADDRESS;
export const JESSE_TOKEN_ADDRESS = CREATOR_TOKEN_ADDRESS;
export const LEAF_CONTRACT_ADDRESS = CREATOR_TOKEN_ADDRESS;
export const PIXOTCHI_TOKEN_ADDRESS = CREATOR_TOKEN_ADDRESS;
export const getLandSupply = () => new Promise((resolve, reject) => state.supplyReads.push({ resolve, reject }));
export const getLandLeaderboard = () => new Promise((resolve, reject) => state.neighborReads.push({ resolve, reject }));
export const getLandOwner = id => new Promise((resolve, reject) => state.ownerReads.push({ id, resolve, reject }));
export const usePrimaryName = address => ({ name: address ? config.get('name') || 'beleka.base.eth' : null, loading: false });
export default function Profile({ address, open }) { return open ? <div role="region" aria-label="Owner profile">{address}</div> : null; }
`;
const fixture = `
import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LandMapCanvas } from '@/components/map/land-map-canvas';
import { LandMapModal } from '@/components/map/land-map-modal';
import { useLandMap } from '@/hooks/useLandMap';
import { contractToVisual, getCoordinateFromTokenId } from '@/lib/land-utils';
import { applyMapPinch, getMapPlotStatus } from '@/lib/land-map-state';
import { state } from 'map-boundary';
const config = new URLSearchParams(location.search);
const owned = [{ tokenId: 1112n, owner: '0x1111111111111111111111111111111111111111', name: 'Owned land' }];
function App() {
  const [center, setCenter] = useState({ x: 0, y: 1 });
  const [zoom, setZoom] = useState(1);
  const [open, setOpen] = useState(true);
  const data = useLandMap(owned);
  state.data = data; state.view = { center, zoom }; state.setCenter = setCenter;
  state.math = { applyMapPinch, getMapPlotStatus };
  state.centerOwned = () => { const c = getCoordinateFromTokenId(1112); setCenter({ x: contractToVisual(c.x), y: contractToVisual(c.y) }); };
  return config.has('canvas') ? <div style={{ width: '100vw', height: '100dvh' }}>
    <LandMapCanvas center={center} zoom={zoom} onCenterChange={setCenter} onZoomChange={setZoom} userLands={owned} selectedLand={null} totalSupply={data.totalSupply} supplyIsCurrent={data.supplyStatus === 'ready'} onLandClick={id => state.clicks.push(id)} />
  </div> : <LandMapModal isOpen={open} onClose={() => setOpen(false)} userLands={owned} selectedLand={null} onSelectLand={land => state.clicks.push(Number(land.tokenId))} {...data} onRetryMapData={data.retryMapData} />;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><App /></QueryClientProvider>);
`;
const mocks = new Set(['lib/contracts', 'components/hooks/usePrimaryName', 'components/chat/chat-profile-dialog']);
const built = await build({
  stdin: { contents: fixture, sourcefile: 'map-fixture.jsx', resolveDir: cwd, loader: 'jsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
  plugins: [{ name: 'map-boundaries', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (args.path === 'map-boundary') return { path: 'boundary', namespace: 'map' };
      if (args.path === 'next/image') return { path: 'image', namespace: 'map' };
      const resolved = args.path.startsWith('@/') ? args.path.slice(2) : args.path.startsWith('.') ? path.relative(cwd, path.resolve(args.resolveDir, args.path)).replaceAll('\\', '/') : '';
      if (mocks.has(resolved.replace(/\.(tsx?|jsx?)$/, ''))) return { path: 'boundary', namespace: 'map' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'map' }, args => ({ contents: args.path === 'image' ? 'import React from "react"; export default function Image({ fill, ...props }) { return <img {...props} />; }' : boundary, loader: 'jsx', resolveDir: cwd }));
  } }],
});
const cssPath = path.join(cwd, 'app/globals.css');
const css = (await postcss([tailwind()]).process(await readFile(cssPath, 'utf8'), { from: cssPath })).css;
const server = createServer(async (req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(built.outputFiles[0].text); return; }
  if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return; }
  if (req.url.startsWith('/icons/')) {
    try { res.setHeader('Content-Type', req.url.endsWith('.svg') ? 'image/svg+xml' : 'image/webp'); res.end(await readFile(path.join(cwd, 'public', req.url))); }
    catch { res.writeHead(404); res.end(); }
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const output = path.join(cwd, 'output/medium-maps');
await mkdir(output, { recursive: true });

async function run(browserType, viewport) {
  const browser = await browserType.launch();
  const context = await browser.newContext({ viewport, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const go = async query => { await page.goto(`${origin}/?${query}`); await page.waitForFunction(() => window.mapAudit?.supplyReads.length > 0 && window.mapAudit?.neighborReads.length > 0); };
  const resolveData = () => page.evaluate(() => {
    window.mapAudit.supplyReads.at(-1).resolve({ totalSupply: 1500, maxSupply: 10000 });
    window.mapAudit.neighborReads.at(-1).resolve([{ landId: 1, name: 'Land #1' }]);
  });
  try {
    // Loading and failure never invent supply; a verified zero remains zero.
    await go('');
    // Independently check world-coordinate invariance, including zoom limits.
    const mathCases = await page.evaluate(() => {
      const apply = window.mapAudit.math.applyMapPinch;
      const view = { center: { x: 7, y: -3 }, zoom: 1 };
      const before = [{ x: 50, y: 100 }, { x: 150, y: 100 }];
      return [
        apply(view, before, [{ x: -300, y: 180 }, { x: 700, y: 180 }], { width: 400, height: 600 }),
        apply(view, before, [{ x: 195, y: 180 }, { x: 205, y: 180 }], { width: 400, height: 600 }),
        apply(view, [before[0], before[0]], [before[0], before[0]], { width: 400, height: 600 }),
      ];
    });
    assert.equal(mathCases[0].zoom, 5);
    assert.equal(mathCases[1].zoom, 0.2);
    // Original world point at the midpoint: (7 - 100/40, -3 + 200/40).
    for (const view of mathCases.slice(0, 2)) {
      assert.ok(Math.abs(view.center.x - 4.5) < 0.00001);
      assert.ok(Math.abs(view.center.y + 120 / (40 * view.zoom) - 2) < 0.00001);
    }
    assert.deepEqual(mathCases[2], { center: { x: 7, y: -3 }, zoom: 1 });
    await expect(page.getByText('Plot count unavailable', { exact: true })).toBeVisible();
    await page.evaluate(() => {
      window.mapAudit.supplyReads.at(-1).reject(new Error('Supply offline'));
      window.mapAudit.neighborReads.at(-1).reject(new Error('Neighbors offline'));
    });
    await expect(page.getByRole('button', { name: 'Retry map data', exact: true })).toBeVisible();
    assert.equal(await page.evaluate(() => window.mapAudit.data.totalSupply), null);
    await page.getByRole('button', { name: 'Retry map data', exact: true }).click();
    await page.waitForFunction(() => window.mapAudit.supplyReads.length === 2);
    await resolveData();
    await expect(page.getByText('1,500 Plots Discovered')).toBeVisible();
    await page.evaluate(() => { void window.mapAudit.data.retryMapData(); });
    await page.evaluate(() => {
      window.mapAudit.supplyReads.at(-1).reject(new Error('Refresh offline'));
      window.mapAudit.neighborReads.at(-1).reject(new Error('Refresh offline'));
    });
    await expect(page.getByText('Last verified count')).toBeVisible();
    assert.equal(await page.evaluate(() => window.mapAudit.data.totalSupply), 1500);

    // Real modal/canvas keyboard selection and full-width owner/details layout.
    await go(''); await resolveData();
    const canvas = page.getByRole('region', { name: 'Land map', exact: true });
    await canvas.focus(); await canvas.press('ArrowUp'); await canvas.press('Enter');
    await page.waitForFunction(() => window.mapAudit.ownerReads.length === 1);
    await page.evaluate(() => window.mapAudit.ownerReads.at(-1).reject(new Error('Owner offline')));
    await expect(page.getByText('Owner unavailable', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Retry owner lookup' }).click();
    await page.waitForFunction(() => window.mapAudit.ownerReads.length === 2);
    await page.evaluate(() => window.mapAudit.ownerReads.at(-1).resolve('0x2222222222222222222222222222222222222222'));
    const owner = page.locator('[data-map-owner]');
    await expect(owner).toHaveText('beleka.base.eth');
    assert.ok((await owner.boundingBox()).width >= viewport.width * 0.65 || viewport.width > 1000);
    assert.ok((await page.getByRole('button', { name: 'Open owner profile' }).boundingBox()).height >= 44);
    if (captureEvidence) await page.screenshot({ path: path.join(output, `${browserType.name()}-${viewport.width}-owner.png`) });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const details = page.getByRole('region', { name: 'Land details' });
    if (captureEvidence) await page.screenshot({ path: path.join(output, `${browserType.name()}-${viewport.width}-text-200.png`) });
    assert.ok(await details.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    assert.ok(await owner.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    await owner.scrollIntoViewIfNeeded();
    if (captureEvidence) await page.screenshot({ path: path.join(output, `${browserType.name()}-${viewport.width}-text-200.png`) });
    const mapBox = await canvas.boundingBox();
    const zoomButtonBox = await page.getByRole('button', { name: 'Zoom in on map' }).boundingBox();
    assert.ok(zoomButtonBox.y >= mapBox.y && zoomButtonBox.y + zoomButtonBox.height <= mapBox.y + mapBox.height + 1);
    await page.getByRole('button', { name: 'Open owner profile' }).scrollIntoViewIfNeeded();
    await page.getByRole('button', { name: 'Open owner profile' }).click();
    await expect(page.getByRole('region', { name: 'Owner profile' })).toContainText('0x2222222222222222222222222222222222222222');

    // One failed sprite must not reach drawImage; the canvas stays interactive.
    await page.route('**/icons/map/taken.webp', route => route.abort());
    await go('canvas=1'); await resolveData();
    await expect(page.getByRole('button', { name: 'Retry map artwork' })).toBeVisible();
    await page.getByRole('region', { name: 'Land map', exact: true }).press('Enter');
    assert.deepEqual(await page.evaluate(() => window.mapAudit.clicks), [1]);
    await page.unroute('**/icons/map/taken.webp');
    await page.getByRole('button', { name: 'Retry map artwork' }).click();
    await expect(page.getByRole('button', { name: 'Retry map artwork' })).toHaveCount(0);
    await page.evaluate(() => {
      const original = CanvasRenderingContext2D.prototype.drawImage;
      CanvasRenderingContext2D.prototype.drawImage = function () {
        CanvasRenderingContext2D.prototype.drawImage = original;
        throw new DOMException('Injected decoded-image failure', 'InvalidStateError');
      };
      window.mapAudit.setCenter({ x: 1, y: 1 });
    });
    await expect(page.getByRole('button', { name: 'Retry map artwork' })).toBeVisible();
    await page.getByRole('button', { name: 'Retry map artwork' }).click();
    await expect(page.getByRole('button', { name: 'Retry map artwork' })).toHaveCount(0);

    // Known owned lands remain owned even with no supply, and unknown plots
    // never use the unminted description. These are real canvas announcements.
    await go('canvas=1');
    await expect(page.locator('[aria-live="polite"]')).toContainText('Ownership data is unavailable');
    await page.evaluate(() => window.mapAudit.centerOwned());
    await expect(page.locator('[aria-live="polite"]')).toContainText('You own this plot');
    await page.evaluate(() => {
      window.mapAudit.supplyReads.at(-1).resolve({ totalSupply: 0, maxSupply: 10000 });
      window.mapAudit.neighborReads.at(-1).resolve([]);
    });
    await page.waitForFunction(() => window.mapAudit.data.totalSupply === 0);
    await expect(page.locator('[aria-live="polite"]')).toContainText('You own this plot');

    if (browserType === chromium) {
      await go('canvas=1'); await resolveData();
      const cdp = await context.newCDPSession(page);
      const touch = (type, points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([id, x, y]) => ({ id, x, y })) });
      const start = await page.evaluate(() => window.mapAudit.view);
      const a = [1, 70, 200], b = [2, 170, 200];
      await touch('touchStart', [a]); await touch('touchStart', [a, b]);
      await touch('touchMove', [[1, 50, 210], [2, 210, 210]]);
      await page.waitForFunction(() => window.mapAudit.view.zoom > 1.5);
      const pinched = await page.evaluate(() => window.mapAudit.view);
      const expected = await page.evaluate(({ start, viewport }) => window.mapAudit.math.applyMapPinch(start, [{ x: 70, y: 200 }, { x: 170, y: 200 }], [{ x: 50, y: 210 }, { x: 210, y: 210 }], viewport), { start, viewport });
      assert.ok(Math.abs(pinched.zoom - expected.zoom) < 0.001);
      assert.ok(Math.abs(pinched.center.x - expected.center.x) < 0.001);
      assert.ok(Math.abs(pinched.center.y - expected.center.y) < 0.001);
      await touch('touchEnd', [[2, 210, 210]]);
      await touch('touchMove', [[1, 82, 210]]);
      await page.waitForFunction(x => window.mapAudit.view.center.x < x - 0.4, pinched.center.x);
      assert.ok(Math.abs((await page.evaluate(() => window.mapAudit.view.center.x)) - (pinched.center.x - 0.5)) < 0.001);
      await touch('touchCancel', []);
      assert.deepEqual(await page.evaluate(() => window.mapAudit.clicks), []);
      // Releasing the first finger follows the same handoff, with no new tap.
      await touch('touchStart', [[1, 70, 200]]);
      await touch('touchStart', [[1, 70, 200], [2, 170, 200]]);
      await touch('touchEnd', [[1, 70, 200]]);
      const secondStart = await page.evaluate(() => window.mapAudit.view);
      await touch('touchMove', [[2, 202, 200]]);
      await page.waitForFunction(x => window.mapAudit.view.center.x < x - 0.4, secondStart.center.x);
      await touch('touchCancel', []);
      const cancelled = await page.evaluate(() => window.mapAudit.view);
      await page.mouse.move(220, 220);
      assert.deepEqual(await page.evaluate(() => window.mapAudit.view), cancelled);
    }
    assert.deepEqual(errors, []);
    console.log(`PASS ${browserType.name()} ${viewport.width}: supply/owner recovery, 200% text, sprite failure, owned/unknown plots${browserType === chromium ? ', trusted pinch-to-pan' : ''}`);
  } finally { await browser.close(); }
}
try {
  await run(chromium, { width: 320, height: 568 });
  await run(chromium, { width: 820, height: 1180 });
  await run(chromium, { width: 1440, height: 900 });
  await run(webkit, { width: 390, height: 844 });
} finally { server.close(); }
