// Production Tasks, FirstCare and tutorial; only wallet/policy/API boundaries are controlled.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, webkit, expect } from '@playwright/test';
const cwd = process.cwd();
const boundary = `
import React, { useSyncExternalStore } from 'react';
const config = new URLSearchParams(location.search);
export const state = window.tasksAudit = { address: config.has('disconnected') ? undefined : '0x1111111111111111111111111111111111111111', listeners: new Set() };
export const useAccount = () => ({ address: useSyncExternalStore(cb => { state.listeners.add(cb); return () => state.listeners.delete(cb); }, () => state.address) });
const ready = data => ({ status: 'ready', data });
const building = (id, level) => ({ id, level, isUpgrading: false, accumulatedPoints: 0n, accumulatedLifetime: 0n });
const land = tokenId => ({ tokenId: BigInt(tokenId), owner: state.address, accumulatedPlantPoints: 0n, accumulatedPlantLifetime: 0n });
const makeAssets = mode => {
 const unknown = { status: mode === 'error' ? 'error' : 'loading' };
 if (mode === 'loading' || mode === 'error') return { owner: state.address, lands: unknown, plants: unknown, farms: unknown, casinoEnabled: true };
 const lands = mode === 'no-lands' ? [] : [land(11), land(22)];
 return {
  owner: state.address, casinoEnabled: true, lands: ready(lands),
  plants: ready(mode === 'no-plants' ? [] : [{ id: 17, status: 0, owner: state.address }]),
  farms: ready(lands.map((item, index) => ({
   landId: item.tokenId.toString(), village: ready([building(0, 1)]),
   town: ready([building(5, index === 0 ? 1 : 0), building(7, mode === 'missing-farmer' ? 0 : index)]),
   casino: ready(index === 1),
  }))),
 };
};
state.assets = makeAssets('ready');
state.assetRetries = 0;
state.setAssets = mode => { state.assets = makeAssets(mode); state.listeners.forEach(cb => cb()); };
state.switchOwner = value => { state.address = value; state.setAssets('loading'); };
export const useMissionAssets = () => ({
 assets: useSyncExternalStore(cb => { state.listeners.add(cb); return () => state.listeners.delete(cb); }, () => state.assets),
 retry: () => { state.assetRetries++; state.setAssets('loading'); },
});
export const useIsSolanaWallet = () => false;
export const CLIENT_ENV = { GAMIFICATION_DISABLED_MESSAGE: 'Tasks paused for this season.' };
export const getClientGamificationPolicy = () => ({ visible: !config.has('hidden'), enabled: !config.has('disabled'), message: null });
export const flushMissionProgressOutbox = async () => {};
export const onMissionTrackingEvent = cb => { state.missionEvent = cb; return () => {}; };
export const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
export const CREATOR_TOKEN_ADDRESS = '0x1111111111111111111111111111111111111111';
export const CRYPTICPOET_TOKEN_ADDRESS = CREATOR_TOKEN_ADDRESS;
export const JESSE_TOKEN_ADDRESS = CREATOR_TOKEN_ADDRESS;
export const LEAF_CONTRACT_ADDRESS = CREATOR_TOKEN_ADDRESS;
export const PIXOTCHI_TOKEN_ADDRESS = CREATOR_TOKEN_ADDRESS;
`;
const fixture = `
import React, { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import TasksInfoDialog from '@/components/tasks/TasksInfoDialog';
import { FirstCareGuide } from '@/components/first-care-guide';
import SlideshowModal from '@/components/tutorial/SlideshowModal';
import { SlideshowProvider, useSlideshow } from '@/components/tutorial/SlideshowProvider';
import { openTasksDialog, onStakingDialogOpen } from '@/lib/app-events';
import { onPublicChatOpen, getPendingMissionLand } from '@/lib/mission-navigation';
import { readMissionPlant } from '@/lib/mission-plant-navigation';
import { readFirstCareProgress, parseFirstCareProgress } from '@/lib/first-care-progress';
import { useGameNavigation } from '@/hooks/useGameNavigation';
import { FarmViewProvider, useFarmView } from '@/lib/farm-view-context';
import { GM_TASK_IDS, GM_SECTION_REWARDS } from '@/lib/gamification-types';
import { MISSION_SECTIONS, parseMissionSummary } from '@/lib/mission-presentation';
import { readTutorialProgress } from '@/lib/tutorial-progress';
import { state, useAccount } from 'tasks-boundary';
const config = new URLSearchParams(location.search);
function FarmProbe() { const farm = useFarmView(); state.farm = farm; return <output>{farm.dashboardView}</output>; }
function App() {
 const { address } = useAccount();
 const nav = useGameNavigation(config.has('mini')); state.navigation = nav;
 const [destination,setDestination] = useState('');
 const tutorial = useSlideshow(); state.tutorial = tutorial;
 state.firstCare = () => parseFirstCareProgress(readFirstCareProgress(address));
 state.metadata = { GM_TASK_IDS, GM_SECTION_REWARDS, MISSION_SECTIONS, readTutorialProgress, parseMissionSummary };
 state.pendingLand = getPendingMissionLand;
 state.pendingPlant = readMissionPlant;
 useEffect(() => onStakingDialogOpen(() => setDestination('Staking destination')), []);
 useEffect(() => onPublicChatOpen(() => setDestination('Public chat destination')), []);
 return <><button onClick={openTasksDialog}>Open Tasks fixture</button><button onClick={tutorial.startIfFirstVisit}>First visit</button><button onClick={() => tutorial.start()}>Full guide</button>
 <output>{nav.activeTab} {destination}</output><FarmViewProvider isMiniApp={config.has('mini')}><FarmProbe /></FarmViewProvider>
 <FirstCareGuide hasPlant={false} owner={address} /><TasksInfoDialog /><SlideshowModal /></>;
}
createRoot(document.getElementById('root')).render(<SlideshowProvider><App /></SlideshowProvider>);
`;
const mocks = new Set(['lib/contracts', 'lib/env-config', 'lib/gamification-client', 'lib/mission-tracking', 'components/solana', 'hooks/useMissionAssets']);
const built = await build({
  stdin: { contents: fixture, sourcefile: 'tasks-fixture.jsx', resolveDir: cwd, loader: 'jsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
  plugins: [{ name: 'tasks-boundaries', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (args.path === 'tasks-boundary' || args.path === 'wagmi') return { path: 'boundary', namespace: 'tasks' };
      if (args.path === 'next/link') return { path: 'link', namespace: 'tasks' };
      if (args.path === 'next/image') return { path: 'image', namespace: 'tasks' };
      const resolved = args.path.startsWith('@/') ? args.path.slice(2) : args.path.startsWith('.') ? path.relative(cwd, path.resolve(args.resolveDir, args.path)).replaceAll('\\', '/') : '';
      if (mocks.has(resolved.replace(/\.(tsx?|jsx?)$/, ''))) return { path: 'boundary', namespace: 'tasks' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'tasks' }, args => ({ contents: args.path === 'link' ? 'import React from "react"; export default function Link(props) { return <a {...props} />; }' : args.path === 'image' ? 'import React from "react"; export default function Image({ fill, preload, ...props }) { return <img {...props} />; }' : boundary, loader: 'jsx', resolveDir: cwd }));
  } }],
});
const cssPath = path.join(cwd, 'app/globals.css');
const css = (await postcss([tailwind()]).process(await readFile(cssPath, 'utf8'), { from: cssPath })).css;
const server = createServer(async (req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(built.outputFiles[0].text); return; }
  if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(css); return; }
  if (req.url.startsWith('/icons/') || req.url.startsWith('/tutorial/') || req.url.startsWith('/PixotchiKit/')) {
    try { res.setHeader('Content-Type', req.url.endsWith('.svg') ? 'image/svg+xml' : 'image/webp'); res.end(await readFile(path.join(cwd, 'public', req.url))); }
    catch { res.writeHead(404); res.end(); }
    return;
  }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const output = path.join(cwd, 'output/medium-tasks-tutorial');
await mkdir(output, { recursive: true });

const day = {
  date: '2026-09-08', pts: 25,
  s1: { makeSwap: false, stakeSeed: false, claimStake: false, placeOrder: false, done: false },
  s2: { followPlayer: false, chatMessage: false, visitProfile: false, done: false },
  s3: { applyResources: false, sendQuest: false, claimProduction: false, playCasinoGame: false, done: false },
  s4: { buy10: true, buyElementsCount: 10, buyShield: true, collectStar: true, playArcade: true, done: true },
};
const incompleteDay = {
  ...day, pts: 0,
  s4: { buy10: false, buyElementsCount: 0, buyShield: false, collectStar: false, playArcade: false, done: false },
};
async function run(browserType, viewport) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport, reducedMotion: 'reduce' });
  const errors = [];
  const pending = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/api/gamification/**', route => { pending.push(route); });
  const go = async query => {
    pending.splice(0);
    await page.goto(`${origin}/?${query}`);
    await page.waitForFunction(() => window.tasksAudit?.tutorial);
  };
  const respond = async (failure = false, customDay = day) => {
    await expect.poll(() => pending.length).toBeGreaterThanOrEqual(2);
    await Promise.all(pending.splice(0).map(route => route.fulfill({ status: failure ? 503 : 200, contentType: 'application/json', body: JSON.stringify(failure ? { error: 'Offline' } : route.request().url().includes('/streak') ? { streak: { current: 3, best: 7 } } : { day: customDay, total: 125 }) }).catch(() => {})));
  };
  const openTasks = async () => {
    await page.getByRole('button', { name: 'Open Tasks fixture' }).click();
    await expect(page.getByRole('dialog', { name: "Farmer's Tasks" })).toBeVisible();
  };
  try {
    await go('mini=1'); await openTasks();
    await expect(page.getByText('Progress not yet available')).toHaveCount(15);
    await expect(page.locator('[data-task-summary-card]')).toContainText('Best —');
    assert.equal(await page.evaluate(() => window.tasksAudit.firstCare().tasks), false);
    await respond(true);
    await expect(page.getByRole('button', { name: 'Retry progress' })).toBeVisible();
    await expect(page.getByText('Progress not yet available')).toHaveCount(15);
    assert.equal(await page.evaluate(() => window.tasksAudit.firstCare().tasks), false);
    await page.getByRole('button', { name: 'Retry progress' }).click();
    await respond();
    await expect(page.getByText('25 Rocks earned', { exact: true })).toBeVisible();
    await expect(page.locator('[data-mission-id] p').filter({ hasText: /^Completed$/ })).toHaveCount(4);
    await expect.poll(() => page.evaluate(() => window.tasksAudit.firstCare().tasks)).toBe(true);
    await page.evaluate(() => window.tasksAudit.missionEvent({ payload: { address: window.tasksAudit.address }, status: 'success' }));
    await respond(true);
    await expect(page.getByText(/Showing last verified progress/)).toBeVisible();
    await expect(page.getByText('25 Rocks earned', { exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(output, `${browserType.name()}-${viewport.width}-tasks.png`) });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const tasksDialog = page.getByRole('dialog', { name: "Farmer's Tasks" });
    await page.screenshot({ path: path.join(output, `${browserType.name()}-${viewport.width}-tasks-200.png`) });
    assert.ok(await tasksDialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    const enlargedAction = page.getByRole('button', { name: 'Open Marketplace: Place a SEED/LEAF order', exact: true });
    await enlargedAction.scrollIntoViewIfNeeded();
    assert.ok((await enlargedAction.boundingBox()).height >= 44);
    await page.screenshot({ path: path.join(output, `${browserType.name()}-${viewport.width}-tasks-card-200.png`) });
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; });

    // Real navigation event consumers, including the Mini App's local Farm state.
    await page.getByRole('button', { name: 'Open Marketplace: Place a SEED/LEAF order', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.tasksAudit.farm.dashboardView)).toBe('lands');
    await expect.poll(() => page.evaluate(() => window.tasksAudit.navigation.activeTab)).toBe('dashboard');
    assert.deepEqual(await page.evaluate(() => {
      const { owner, landId, buildingType, buildingId } = window.tasksAudit.pendingLand();
      return { owner, landId, buildingType, buildingId };
    }), { owner: '0x1111111111111111111111111111111111111111', landId: '11', buildingType: 'town', buildingId: 5 });
    await openTasks(); await respond();
    await page.getByRole('button', { name: 'Open Staking: Stake SEED', exact: true }).click();
    await expect(page.getByText(/Staking destination/)).toBeVisible();
    await openTasks(); await respond();
    await page.getByRole('button', { name: 'Open public chat: Send a message in public chat', exact: true }).click();
    await expect(page.getByText(/Public chat destination/)).toBeVisible();
    await openTasks(); await respond();
    await page.getByRole('button', { name: 'Open Swap: Make a SEED swap', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.tasksAudit.navigation.activeTab)).toBe('swap');

    // A late previous-owner response never replaces the new owner's unknown state.
    await openTasks();
    await expect.poll(() => pending.length).toBe(2);
    const oldReads = pending.splice(0);
    await page.evaluate(() => window.tasksAudit.switchOwner('0x3333333333333333333333333333333333333333'));
    await expect(page.getByText('Progress not yet available')).toHaveCount(15);
    await expect.poll(() => page.evaluate(() => window.tasksAudit.pendingLand())).toBeNull();
    await Promise.all(oldReads.map(route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({ day, total: 999, streak: { current: 999, best: 999 } }) }).catch(() => {})));
    await respond(true);
    await expect(page.locator('[data-task-summary-card]')).not.toContainText('999');
    await expect(page.getByText('Progress not yet available')).toHaveCount(15);

    // Availability controls the next action without guessing that failed reads mean missing assets.
    // The shell and Farm provider are real on both Mini App and URL-backed web surfaces.
    for (const mini of [true, false]) {
      await go(mini ? 'mini=1' : '');
      await page.evaluate(() => window.tasksAudit.setAssets('loading'));
      await openTasks(); await respond(false, incompleteDay);
      const casinoTask = page.locator('[data-mission-id="s3_play_casino_game"]');
      await expect(casinoTask.getByRole('button', { name: 'Checking farm…: Play roulette, blackjack, or baccarat', exact: true })).toBeDisabled();
      await expect(page.getByRole('button', { name: /^Mint a / })).toHaveCount(0);
      await page.evaluate(() => window.tasksAudit.setAssets('error'));
      await casinoTask.getByRole('button', { name: 'Retry farm check: Play roulette, blackjack, or baccarat', exact: true }).click();
      await expect(page.getByRole('dialog', { name: "Farmer's Tasks" })).toBeVisible();
      assert.equal(await page.evaluate(() => window.tasksAudit.assetRetries), 1);
      await expect(casinoTask.getByRole('button')).toBeDisabled();

      await page.evaluate(() => window.tasksAudit.setAssets('no-lands'));
      await casinoTask.getByRole('button', { name: 'Mint a land: Play roulette, blackjack, or baccarat', exact: true }).click();
      await expect(page.getByRole('dialog')).toHaveCount(0);
      await expect.poll(() => page.evaluate(() => [window.tasksAudit.navigation.activeTab, window.tasksAudit.farm.mintType])).toEqual(['mint', 'land']);
      if (!mini) assert.equal(new URL(page.url()).searchParams.get('mintType'), 'land');

      await page.evaluate(() => window.tasksAudit.setAssets('ready'));
      await openTasks(); await respond(false, incompleteDay);
      await casinoTask.getByRole('button', { name: 'Open Casino: Play roulette, blackjack, or baccarat', exact: true }).click();
      await expect.poll(() => page.evaluate(() => [window.tasksAudit.navigation.activeTab, window.tasksAudit.farm.dashboardView])).toEqual(['dashboard', 'lands']);
      assert.deepEqual(await page.evaluate(() => {
        const { owner, landId, buildingType, buildingId } = window.tasksAudit.pendingLand();
        return { owner, landId, buildingType, buildingId };
      }), { owner: '0x1111111111111111111111111111111111111111', landId: '22', buildingType: 'town', buildingId: 6 });

      await page.evaluate(() => window.tasksAudit.setAssets('missing-farmer'));
      await openTasks(); await respond(false, incompleteDay);
      const questTask = page.locator('[data-mission-id="s3_send_quest"]');
      await questTask.getByRole('button', { name: 'Build Farmer House: Send a farmer on a quest', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => {
        const { owner, landId, buildingType, buildingId } = window.tasksAudit.pendingLand();
        return { owner, landId, buildingType, buildingId };
      }), { owner: '0x1111111111111111111111111111111111111111', landId: '11', buildingType: 'town', buildingId: 7 });

      await page.evaluate(() => window.tasksAudit.setAssets('ready'));
      await openTasks(); await respond(false, incompleteDay);
      await questTask.getByRole('button', { name: 'Open quests: Send a farmer on a quest', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => {
        const { landId, buildingId } = window.tasksAudit.pendingLand(); return { landId, buildingId };
      }), { landId: '22', buildingId: 7 });

      await openTasks(); await respond(false, incompleteDay);
      await page.getByRole('button', { name: 'Open plant care: Buy at least 10 elements', exact: true }).click();
      assert.deepEqual(await page.evaluate(() => {
        const { owner, plantId, action } = window.tasksAudit.pendingPlant(); return { owner, plantId, action };
      }), { owner: '0x1111111111111111111111111111111111111111', plantId: 17, action: 'care' });
      await expect.poll(() => page.evaluate(() => window.tasksAudit.farm.dashboardView)).toBe('plants');

      await page.evaluate(() => window.tasksAudit.setAssets('no-plants'));
      await openTasks(); await respond(false, incompleteDay);
      await page.getByRole('button', { name: 'Mint a plant: Buy at least 10 elements', exact: true }).click();
      await expect.poll(() => page.evaluate(() => [window.tasksAudit.navigation.activeTab, window.tasksAudit.farm.mintType])).toEqual(['mint', 'plant']);
      if (!mini) assert.equal(new URL(page.url()).searchParams.get('mintType'), null);
      await page.evaluate(() => window.tasksAudit.switchOwner('0x3333333333333333333333333333333333333333'));
      await expect.poll(() => page.evaluate(() => window.tasksAudit.pendingPlant())).toBeNull();
      await expect.poll(() => page.evaluate(() => window.tasksAudit.pendingLand())).toBeNull();
    }

    await go('disabled=1');
    await expect(page.getByRole('button', { name: "Farmer's Tasks", exact: true })).toHaveCount(0);
    await openTasks();
    await expect(page.getByText('Tasks are temporarily unavailable')).toBeVisible();
    await expect(page.locator('[data-task-summary-card]')).toHaveCount(0);
    await page.getByRole('button', { name: 'Close Tasks' }).click();
    await page.getByRole('button', { name: 'Full guide' }).click();
    await expect(page.getByText(/^Step 1 of 9/)).toBeVisible();
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await go('disconnected=1'); await openTasks();
    await expect(page.getByText(/Connect a supported EVM wallet/)).toBeVisible();
    await expect(page.locator('[data-mission-id]')).toHaveCount(0);

    // Quick start is three steps. Skip stores a pause, never completion.
    await go('');
    await page.evaluate(() => localStorage.removeItem('pixotchi:tutorial'));
    await page.getByRole('button', { name: 'First visit' }).click();
    await expect(page.getByText(/^Step 1 of 3/)).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect(page.getByText(/^Step 2 of 3/)).toBeVisible();
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    assert.deepEqual(await page.evaluate(() => { const p = JSON.parse(localStorage.getItem('pixotchi:tutorial')); return [p.completed, p.skipped, p.lastIndex]; }), [false, true, 1]);
    await page.getByRole('button', { name: 'First visit' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Full guide' }).click();
    await expect(page.getByText(/^Step 1 of 10/)).toBeVisible();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await page.getByRole('button', { name: 'Full guide' }).click();
    await expect(page.getByText(/^Step 2 of 10/)).toBeVisible();
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    const scroll = page.locator('.surface-scroll-fade').filter({ has: page.getByRole('heading', { name: 'Start Your Garden', exact: true }) });
    await scroll.evaluate(node => { node.scrollTop = node.scrollHeight; });
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await expect.poll(() => page.locator('.surface-scroll-fade').filter({ has: page.getByRole('heading', { name: 'Growing Your Plant', exact: true }) }).evaluate(node => node.scrollTop)).toBe(0);
    const tutorialDialog = page.getByRole('dialog', { name: /Pixotchi tutorial/ });
    assert.ok(await tutorialDialog.evaluate(node => node.scrollWidth <= node.clientWidth + 1));
    await page.screenshot({ path: path.join(output, `${browserType.name()}-${viewport.width}-tutorial-200.png`) });
    await page.getByRole('button', { name: 'Skip', exact: true }).click();
    await page.evaluate(() => { document.documentElement.style.fontSize = ''; localStorage.setItem('pixotchi:tutorial', JSON.stringify({ mode: 'full', lastIndex: -100, completed: false })); });
    await page.getByRole('button', { name: 'Full guide' }).click();
    await expect(page.getByText(/^Step 1 of 10/)).toBeVisible();
    await page.evaluate(() => window.tasksAudit.tutorial.goto(999));
    await expect(page.getByText(/^Step 10 of 10/)).toBeVisible();
    await page.getByRole('button', { name: 'Done', exact: true }).click();
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pixotchi:tutorial')).completed), true);
    await page.evaluate(() => localStorage.removeItem('pixotchi:tutorial'));
    await page.getByRole('button', { name: 'First visit' }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.getByRole('button', { name: 'Open my farm', exact: true }).click();
    await expect.poll(() => page.evaluate(() => window.tasksAudit.navigation.activeTab)).toBe('dashboard');
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('pixotchi:tutorial')).completed), true);
    const metadata = await page.evaluate(() => {
      const { GM_TASK_IDS, GM_SECTION_REWARDS, MISSION_SECTIONS, readTutorialProgress } = window.tasksAudit.metadata;
      return { ids: GM_TASK_IDS, presented: MISSION_SECTIONS.flatMap(section => section.tasks.map(task => task.id)), reward: Object.values(GM_SECTION_REWARDS).reduce((a, b) => a + b, 0), corrupt: readTutorialProgress('invalid', 3, 10), fractional: readTutorialProgress('{"mode":"full","lastIndex":3.9}', 3, 10)?.lastIndex };
    });
    assert.deepEqual(metadata.ids, metadata.presented);
    assert.equal(metadata.reward, 100); assert.equal(metadata.corrupt, null); assert.equal(metadata.fractional, 3);
    assert.deepEqual(errors, []);
    console.log(`PASS ${browserType.name()} ${viewport.width}: Tasks reads/owner scope, contextual targets and Mini/web mint navigation, First Care, tutorial progress/200% text`);
  } finally { await browser.close(); }
}
try {
  await run(chromium, { width: 320, height: 568 });
  await run(chromium, { width: 820, height: 1180 });
  await run(chromium, { width: 1440, height: 900 });
  await run(webkit, { width: 390, height: 844 });
} finally { server.close(); }
