// Actual map, care, land artwork and timer components; only network/profile
// boundaries are replaced. No snapshots or application server are required.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, webkit, expect } from '@playwright/test';

const cwd = process.cwd();
const boundary = `
import React from 'react';
export const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
export const CREATOR_TOKEN_ADDRESS = '0x1111111111111111111111111111111111111111';
export const CRYPTICPOET_TOKEN_ADDRESS = CREATOR_TOKEN_ADDRESS;
export const JESSE_TOKEN_ADDRESS = CREATOR_TOKEN_ADDRESS;
export const LEAF_CONTRACT_ADDRESS = CREATOR_TOKEN_ADDRESS;
export const PIXOTCHI_TOKEN_ADDRESS = CREATOR_TOKEN_ADDRESS;
export const getLandOwner = async () => CREATOR_TOKEN_ADDRESS;
export const usePrimaryName = () => ({ name: 'beleka.base.eth', loading: false });
export default function Profile() { return null; }
`;
const fixture = `
import React, { Profiler, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { LandMapModal } from '@/components/map/land-map-modal';
import LandImage from '@/components/LandImage';
import { PlantCareCatalog } from '@/components/plant-care-catalog';
import CountdownTimer from '@/components/countdown-timer';
import FenceTimer from '@/components/fence-timer';
import { usePlantProtection } from '@/hooks/usePlantProtection';
import { queryKeys } from '@/lib/query-keys';
import { formatCountdownDuration, formatDurationSeconds } from '@/lib/duration-display';

const config = new URLSearchParams(location.search);
const A = '0x1111111111111111111111111111111111111111', B = '0x2222222222222222222222222222222222222222';
const state = window.lowAudit = { A, B, clicks: [], commits: { minute: 0, second: 0 }, invalidations: [],
  format: { formatCountdownDuration, formatDurationSeconds } };
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
for (const address of [A, B]) client.setQueryData(queryKeys.plantsByOwner(address), []);
const invalidate = client.invalidateQueries.bind(client);
client.invalidateQueries = options => { state.invalidations.push(options.queryKey); return invalidate(options); };
state.cacheInvalidated = owner => client.getQueryState(queryKeys.plantsByOwner(owner)).isInvalidated;
const land = { tokenId: 1n, owner: A, name: 'A quiet garden' };
const garden = Array.from({ length: 4 }, (_, id) => ({ id: String(id), name: ['Water', 'Extra nourishing fertilizer', 'Sunshine', 'Bee'][id], price: 123450000000000000000n, points: 12345678900000000, timeExtension: 90000 }));
function TimerFixture() {
  const [target, setTarget] = useState(0);
  state.setTarget = setTarget;
  return <div className="space-y-4 p-4">
    <Profiler id="minute" onRender={() => state.commits.minute++}><CountdownTimer timeUntilStarving={target} showSeconds={false} /></Profiler>
    <Profiler id="second" onRender={() => state.commits.second++}><FenceTimer effectUntil={target} /></Profiler>
  </div>;
}
function ProtectionFixture() {
  const [current, setCurrent] = useState({ owner: A, plant: null });
  state.setProtection = setCurrent;
  state.plant = (owner, id, v1, v2) => ({ id, owner, extensions: [{ shopItemOwned: v1 ? [{ name: 'Wooden Fence', effectIsOngoingActive: true, effectUntil: v1 }] : [] }], fenceV2: v2 ? { isActive: true, activeUntil: v2, totalDaysPurchased: 1 } : null });
  const protection = usePlantProtection(current.plant, current.owner);
  return <section aria-label="Protection" className="p-4">{protection.length ? protection.map(fence => <FenceTimer key={fence.type} effectUntil={fence.effectUntil} />) : 'No active protection'}</section>;
}
function App() {
  useEffect(() => { state.mounted = true; }, []);
  const [buildingType, setBuildingType] = useState('village');
  const [selectedLand, setLand] = useState(land);
  state.setBuildingType = setBuildingType; state.setLand = setLand;
  if (config.get('view') === 'art') return <div style={{ width: '100%', height: '80dvh', minHeight: 300 }}><LandImage selectedLand={selectedLand} buildingType={buildingType} villageBuildings={[{ id: 0, level: 1, isUpgrading: false }, { id: 3, level: 1, isUpgrading: true }, { id: 5, level: 2, isUpgrading: true }]} /></div>;
  if (config.get('view') === 'care') return <div style={{ maxWidth: 540, margin: 'auto', padding: 12 }}><PlantCareCatalog gardenItems={garden} shopItems={[{ id: 'fence', name: 'Fence', price: 0n, effectTime: 0 }]} selectedItem={null} itemType="garden" onSelect={option => state.clicks.push(option.item.id)} /></div>;
  if (config.get('view') === 'timers') return <TimerFixture />;
  if (config.get('view') === 'protection') return <ProtectionFixture />;
  return <LandMapModal isOpen onClose={() => {}} userLands={[land]} selectedLand={land} onSelectLand={next => state.clicks.push(next.tokenId.toString())} totalSupply={1500} neighborData={{}} />;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><App /></QueryClientProvider>);
`;
const mocks = new Set(['lib/contracts', 'components/hooks/usePrimaryName', 'components/chat/chat-profile-dialog']);
const built = await build({
  stdin: { contents: fixture, sourcefile: 'maps-time-low-fixture.jsx', resolveDir: cwd, loader: 'jsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"development"', 'process.env': '{}' },
  plugins: [{ name: 'low-boundaries', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (args.path === 'next/image') return { path: 'image', namespace: 'low' };
      const resolved = args.path.startsWith('@/') ? args.path.slice(2) : args.path.startsWith('.') ? path.relative(cwd, path.resolve(args.resolveDir, args.path)).replaceAll('\\', '/') : '';
      if (mocks.has(resolved.replace(/\.(tsx?|jsx?)$/, ''))) return { path: 'boundary', namespace: 'low' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'low' }, args => ({ contents: args.path === 'image' ? 'import React from "react"; export default function Image({ fill, ...props }) { return <img {...props} />; }' : boundary, loader: 'jsx', resolveDir: cwd }));
  } }],
});
const cssPath = path.join(cwd, 'app/globals.css');
const css = (await postcss([tailwind()]).process(await readFile(cssPath, 'utf8'), { from: cssPath })).css;
const server = createServer(async (req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(built.outputFiles[0].text); return; }
  if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return; }
  if (req.url.startsWith('/icons/')) {
    try {
      res.setHeader('Content-Type', req.url.endsWith('.svg') ? 'image/svg+xml' : req.url.endsWith('.png') ? 'image/png' : 'image/webp');
      res.end(await readFile(path.join(cwd, 'public', req.url)));
    } catch { res.writeHead(404); res.end(); }
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;

async function run(browserType, viewport) {
  const browser = await browserType.launch();
  const context = await browser.newContext({ viewport, hasTouch: true, reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const go = async view => { await page.goto(`${origin}/?view=${view}`, { waitUntil: 'domcontentloaded' }); await expect.poll(() => page.evaluate(() => Boolean(window.lowAudit?.mounted))).toBeTruthy(); };
  const noOverflow = async () => assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1));
  try {
    // Important effects/prices survive minimum widths and 200% text. The whole
    // card, not just its label, remains actionable.
    await go('care');
    for (const scale of [100, 200]) {
      await page.evaluate(scale => document.documentElement.style.fontSize = `${scale}%`, scale);
      await noOverflow();
      const cards = page.getByRole('button', { name: /^Select / });
      assert.equal(await cards.count(), 5);
      for (const card of await cards.all()) {
        assert.ok(await card.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
        const box = await card.boundingBox(); assert.ok(box.height >= 44 && box.width >= 44);
        const text = await card.locator('span').evaluateAll(nodes => nodes.map(node => parseFloat(getComputedStyle(node).fontSize)));
        assert.ok(text.every(size => size >= 12 * scale / 100));
      }
      await page.getByRole('button', { name: 'Select Extra nourishing fertilizer' }).click();
    }
    assert.deepEqual(await page.evaluate(() => window.lowAudit.clicks), ['1', '1']);
    await expect(page.getByText(/TOD/)).toHaveCount(0);

    // A missing optional layer keeps the scene and admits incomplete artwork.
    await page.route('**/icons/solar-layer.webp', route => route.abort());
    await go('art');
    await expect(page.getByText('Some building artwork is unavailable.')).toBeVisible();
    await expect(page.locator('img[src="/icons/village-start.png"]')).toBeVisible();
    await expect(page.locator('img[src="/icons/bee-layer.webp"]')).toBeVisible();
    assert.deepEqual(await page.locator('img').evaluateAll(nodes => nodes.map(node => node.getAttribute('src'))), ['/icons/village-start.png', '/icons/bee-layer.webp', '/icons/solar-layer.webp']);
    await expect(page.locator('img[src="/icons/solar-layer.webp"]')).toBeHidden();
    await expect(page.locator('img[src="/icons/soil-layer.webp"]')).toHaveCount(0);
    await page.unroute('**/icons/solar-layer.webp');
    await page.getByRole('button', { name: 'Retry artwork', exact: true }).click();
    await expect(page.locator('img[src="/icons/solar-layer.webp"]')).toBeVisible();
    await expect(page.getByText('Some building artwork is unavailable.')).toHaveCount(0);

    // Base failure never leaves a blank scene or a native broken-image icon.
    await page.route('**/icons/village-start.png', route => route.abort());
    await go('art');
    await expect(page.getByText('Land artwork unavailable', { exact: true })).toBeVisible();
    await expect(page.locator('img[src="/icons/solar-layer.webp"]')).toBeHidden();
    await page.evaluate(() => document.documentElement.style.fontSize = '200%');
    await noOverflow();
    const retry = page.getByRole('button', { name: 'Retry land artwork' });
    assert.ok((await retry.boundingBox()).height >= 44);
    await page.unroute('**/icons/village-start.png');
    await retry.click();
    await expect(page.locator('img[src="/icons/village-start.png"]')).toBeVisible();
    await expect(page.getByText('Land artwork unavailable', { exact: true })).toHaveCount(0);
    await page.evaluate(() => window.lowAudit.setBuildingType('town'));
    await expect(page.locator('img[src="/icons/town-small.png"]')).toBeVisible();
    await expect(page.locator('img[src="/icons/village-start.png"]')).toHaveCount(0);
    await expect(page.locator('img[src="/icons/solar-layer.webp"]')).toHaveCount(0);
    await page.evaluate(() => window.lowAudit.setLand(null));
    await expect(page.getByRole('img')).toHaveCount(0);

    let pendingBase;
    await page.route('**/icons/village-start.png', route => { pendingBase = route; });
    await go('art');
    await expect(page.getByText('Loading land artwork…')).toBeVisible();
    await page.evaluate(() => window.lowAudit.setBuildingType('town'));
    await expect(page.locator('img[src="/icons/town-small.png"]')).toBeVisible();
    await pendingBase.abort().catch(() => {});
    await page.unroute('**/icons/village-start.png');
    await expect(page.getByText('Land artwork unavailable', { exact: true })).toHaveCount(0);
    await expect(page.locator('img[src="/icons/town-small.png"]')).toBeVisible();

    // Exercise sprite failure in the real modal: the notice and the modal's
    // legend used to occupy the same top-left overlay coordinates.
    await page.route('**/icons/map/taken.webp', route => route.abort());
    await go('map');
    const artworkNotice = page.getByRole('status').filter({ hasText: 'Some map artwork is unavailable.' });
    const artworkRetry = page.getByRole('button', { name: 'Retry map artwork', exact: true });
    const failureCanvas = page.getByRole('region', { name: 'Land map', exact: true });
    await expect(artworkNotice).toBeVisible();
    await page.evaluate(() => { window.lowAudit.originalCanvas = document.querySelector('canvas'); });
    await failureCanvas.focus();
    await failureCanvas.press('ArrowRight');
    const mapPosition = await failureCanvas.evaluate(node => document.getElementById(node.getAttribute('aria-describedby').split(' ').at(-1)).textContent);
    for (const scale of [100, 200]) {
      await page.evaluate(scale => document.documentElement.style.fontSize = `${scale}%`, scale);
      const noticeBox = await artworkNotice.boundingBox();
      const legendBox = await page.getByText('Your land', { exact: true }).locator('..').locator('..').boundingBox();
      const mapBox = await failureCanvas.boundingBox();
      const dialogBox = await page.getByRole('dialog').boundingBox();
      const noticeScrolls = await artworkNotice.evaluate(node => node.scrollHeight > node.clientHeight + 1);
      if (noticeScrolls) {
        assert.ok(await artworkNotice.evaluate(node => {
          for (let ancestor = node; ancestor; ancestor = ancestor.parentElement) {
            if (getComputedStyle(ancestor).touchAction === 'none') return false;
          }
          return true;
        }), 'An ancestor must not disable native touch scrolling of the notice');
        await artworkNotice.evaluate(node => { node.scrollTop = 0; });
        if (browserType === chromium) {
          const cdp = await context.newCDPSession(page);
          const x = noticeBox.x + noticeBox.width / 2;
          const y = noticeBox.y + noticeBox.height - 16;
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ id: 1, x, y }] });
          for (const distance of [12, 24, 40, 60]) {
            await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ id: 1, x, y: y - distance }] });
          }
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
          await cdp.detach();
        } else {
          await page.mouse.move(noticeBox.x + noticeBox.width / 2, noticeBox.y + noticeBox.height / 2);
          await page.mouse.wheel(0, 100);
        }
        await expect.poll(() => artworkNotice.evaluate(node => node.scrollTop)).toBeGreaterThan(0);
      }
      await artworkRetry.scrollIntoViewIfNeeded();
      const retryBox = await artworkRetry.boundingBox();
      assert.ok(noticeBox.y + noticeBox.height <= mapBox.y + 1, `Artwork notice must reserve space above the map: ${JSON.stringify({ scale, noticeBox, legendBox, mapBox })}`);
      assert.ok(legendBox.y >= mapBox.y && legendBox.y + legendBox.height <= mapBox.y + mapBox.height + 1, 'Legend remains inside the visible map');
      const zoomBox = await page.getByRole('button', { name: 'Zoom in on map', exact: true }).boundingBox();
      assert.ok(legendBox.y + legendBox.height <= zoomBox.y + 1 || legendBox.x + legendBox.width <= zoomBox.x, `The warning leaves room for both the legend and map controls: ${JSON.stringify({ scale, noticeBox, legendBox, mapBox, zoomBox })}`);
      for (const box of [noticeBox, legendBox, retryBox]) {
        assert.ok(box.x >= dialogBox.x && box.x + box.width <= dialogBox.x + dialogBox.width + 1);
        assert.ok(box.y >= dialogBox.y && box.y + box.height <= dialogBox.y + dialogBox.height + 1);
      }
      assert.ok(await artworkRetry.evaluate(node => {
        const box = node.getBoundingClientRect();
        return node.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
      }), 'Artwork retry must not be covered by the legend or another overlay');
      await artworkRetry.click({ trial: true });
      await noOverflow();
      if (browserType === chromium && viewport.width === 320) {
        await page.screenshot({ path: path.join(cwd, 'output', `map-artwork-notice-320-${scale}.png`) });
      }
    }
    await page.unroute('**/icons/map/taken.webp');
    await artworkRetry.click();
    await expect(artworkNotice).toHaveCount(0);
    await expect(page.getByText('Your land', { exact: true })).toBeVisible();
    assert.ok(await page.evaluate(() => window.lowAudit.originalCanvas === document.querySelector('canvas')), 'Artwork retry retains the mounted canvas');
    assert.equal(await failureCanvas.evaluate(node => document.getElementById(node.getAttribute('aria-describedby').split(' ').at(-1)).textContent), mapPosition, 'Artwork retry retains the player’s map position and selected land');

    // DOM legend colors must exist in rendered canvas pixels under every theme.
    // The white diamond center and dashed selection provide shape distinctions.
    await go('map');
    await expect(page.getByText('Your land', { exact: true })).toBeVisible();
    await expect(page.getByText('Selected land', { exact: true })).toBeVisible();
    const canvas = page.getByRole('region', { name: 'Land map', exact: true });
    await page.waitForFunction(() => {
      const canvas = document.querySelector('canvas');
      if (!canvas?.width || !canvas.height) return false;
      const pixel = canvas.getContext('2d').getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      return pixel[0] === 255 && pixel[1] === 255 && pixel[2] === 255;
    });
    for (const theme of ['light', 'dark', 'green', 'yellow', 'red', 'pink', 'blue', 'violet']) {
      await page.evaluate(theme => document.documentElement.className = theme, theme);
      const result = await page.evaluate(() => {
        const row = text => [...document.querySelectorAll('span')].find(node => node.textContent === text).previousElementSibling;
        const owned = row('Your land'), selected = row('Selected land');
        const rgb = value => value.match(/\d+/g).slice(0, 3).map(Number);
        const colors = [rgb(getComputedStyle(owned).backgroundColor), rgb(getComputedStyle(selected).borderColor)];
        const canvas = document.querySelector('canvas'), ctx = canvas.getContext('2d');
        const pixels = ctx.getImageData(Math.floor(canvas.width / 2) - 22, Math.floor(canvas.height / 2) - 22, 44, 44).data;
        return { seen: colors.map(color => { for (let i = 0; i < pixels.length; i += 4) if (color.every((channel, index) => pixels[i + index] === channel)) return true; return false; }),
          symbol: owned.textContent, outline: getComputedStyle(selected).borderStyle };
      });
      assert.deepEqual(result.seen, [true, true], theme);
      assert.equal(result.symbol, '◆'); assert.equal(result.outline, 'dashed');
    }
    await page.evaluate(() => { document.documentElement.className = ''; document.documentElement.style.fontSize = '200%'; });
    await noOverflow();
    for (const name of ['Close world map', 'Zoom in on map', 'Zoom out on map', 'Center map on selected land']) {
      const box = await page.getByRole('button', { name, exact: true }).boundingBox();
      assert.ok(box.width >= 44 && box.height >= 44);
    }
    await canvas.focus();
    for (let step = 0; step < 4; step++) await canvas.press('ArrowRight');
    await canvas.press('Enter');
    const dismiss = page.getByRole('button', { name: 'Dismiss terrain details' });
    await expect(dismiss).toBeVisible();
    assert.ok((await dismiss.boundingBox()).height >= 44);
    await noOverflow();
    await dismiss.click();

    // Controlled browser clocks check actual hook commits, exact boundary
    // updates, stopping at expiry, and visibility catch-up.
    await page.clock.install({ time: new Date('2026-09-08T12:00:00Z') });
    await go('timers');
    await page.clock.pauseAt(new Date('2026-09-08T12:01:00Z'));
    await page.evaluate(() => window.lowAudit.setTarget(Date.now() / 1000 + 125));
    await expect(page.getByRole('timer', { name: 'Remaining lifetime' })).toHaveText('00h:03m');
    await expect(page.getByRole('timer', { name: 'Remaining fence protection' })).toHaveText('00h:02m:05s');
    const commits = await page.evaluate(() => ({ ...window.lowAudit.commits }));
    await page.clock.runFor(4000);
    assert.equal(await page.evaluate(() => window.lowAudit.commits.minute), commits.minute);
    assert.ok(await page.evaluate(() => window.lowAudit.commits.second) > commits.second);
    await page.clock.runFor(1000);
    await expect(page.getByRole('timer', { name: 'Remaining lifetime' })).toHaveText('00h:02m');
    await page.clock.runFor(61000);
    await expect(page.getByRole('timer', { name: 'Remaining lifetime' })).toHaveText('00h:01m');
    await page.clock.runFor(59000);
    await expect(page.getByRole('timer', { name: 'Remaining lifetime' })).toHaveText('00h:00m');
    await expect(page.getByRole('timer', { name: 'Remaining fence protection' })).toHaveText('00h:00m:00s');
    const stopped = await page.evaluate(() => ({ ...window.lowAudit.commits }));
    await page.clock.runFor(60000);
    assert.deepEqual(await page.evaluate(() => window.lowAudit.commits), stopped);
    await page.evaluate(() => window.lowAudit.setTarget(Date.now() / 1000 + 90061));
    await expect(page.getByRole('timer', { name: 'Remaining fence protection' })).toHaveText('1d 01h:01m:01s');
    await page.evaluate(() => document.documentElement.style.fontSize = '200%');
    await noOverflow();
    for (const timer of await page.getByRole('timer').all()) assert.ok(await timer.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    const dayFormats = await page.evaluate(() => {
      const { formatCountdownDuration: countdown, formatDurationSeconds: duration } = window.lowAudit.format;
      return [duration(90061n), duration(90061n, 'exact'), countdown(90061n), countdown(1n, false), countdown(-1n), countdown(86400n)];
    });
    assert.deepEqual(dayFormats, ['1d 1h', '1d 1h 1m 1s', '1d 01h:01m:01s', '00h:01m', '00h:00m:00s', '1d 00h:00m:00s']);
    for (const timer of await page.getByRole('timer').all()) assert.ok(await timer.evaluate(node => getComputedStyle(node).fontVariantNumeric.includes('tabular-nums')));
    await page.clock.setSystemTime(new Date('2026-09-10T12:00:00Z'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByRole('timer', { name: 'Remaining fence protection' })).toHaveText('00h:00m:00s');

    // V1 and V2 deadlines each reconcile once, even if the server retains an
    // expired active flag. Switching owners cannot invalidate the old owner.
    await go('protection');
    await page.clock.pauseAt(new Date('2026-09-10T12:01:00Z'));
    await page.evaluate(() => {
      const { A, plant, setProtection } = window.lowAudit, now = Math.floor(Date.now() / 1000);
      setProtection({ owner: A, plant: plant(A, 1, now + 15, now + 30) });
    });
    await expect(page.getByRole('timer')).toBeVisible();
    await page.clock.runFor(15000);
    await expect(page.getByRole('timer')).toBeVisible();
    await expect.poll(() => page.evaluate(() => window.lowAudit.invalidations)).toEqual([['plantsByOwner', '0x1111111111111111111111111111111111111111']]);
    await page.clock.runFor(15000);
    await expect(page.getByText('No active protection')).toBeVisible();
    assert.equal(await page.evaluate(() => window.lowAudit.invalidations.length), 2);
    assert.equal(await page.evaluate(() => window.lowAudit.cacheInvalidated(window.lowAudit.B)), false);
    await page.evaluate(() => {
      const { A, plant, setProtection } = window.lowAudit;
      setProtection({ owner: A, plant: plant(A, 1, Math.floor(Date.now() / 1000) - 15, Math.floor(Date.now() / 1000)) });
    });
    await page.clock.runFor(1);
    assert.equal(await page.evaluate(() => window.lowAudit.invalidations.length), 2);
    await page.evaluate(() => {
      const { A, plant, setProtection } = window.lowAudit;
      setProtection({ owner: A, plant: plant(A, 2, null, Math.floor(Date.now() / 1000) + 5) });
    });
    await expect(page.getByRole('timer')).toBeVisible();
    await page.evaluate(() => {
      const { B, plant, setProtection } = window.lowAudit;
      setProtection({ owner: B, plant: plant(B, 3, null, Math.floor(Date.now() / 1000) + 10) });
    });
    await expect(page.getByRole('timer')).toHaveText('00h:00m:10s');
    await page.clock.runFor(5000);
    assert.equal(await page.evaluate(() => window.lowAudit.invalidations.length), 2);
    await page.clock.setSystemTime(new Date('2026-09-12T12:00:00Z'));
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
    await expect(page.getByText('No active protection')).toBeVisible();
    assert.deepEqual(await page.evaluate(() => window.lowAudit.invalidations.at(-1)), ['plantsByOwner', '0x2222222222222222222222222222222222222222']);
    assert.equal(await page.evaluate(() => window.lowAudit.invalidations.length), 3);
    assert.deepEqual(errors, []);
    console.log(`PASS ${browserType.name()} ${viewport.width}: care/map 200%, matching shape/color legend, optional/base artwork recovery, minute cadence, exact expiry, owner-scoped protection reconciliation`);
  } finally { await browser.close(); }
}
try {
  if (!process.argv.includes('--webkit-only')) {
    await run(chromium, { width: 320, height: 568 });
    await run(chromium, { width: 820, height: 1180 });
    await run(chromium, { width: 1440, height: 900 });
  }
  await run(webkit, { width: 390, height: 844 });
} finally { server.close(); }
