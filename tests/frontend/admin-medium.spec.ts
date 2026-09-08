import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { parseAdminAirdrop, parseAdminBroadcast, parseAdminClaims, parseAdminRpc, parseAdminChat, parseAdminFeedback, parseAdminLeaderboards, parseAdminAiMessages, parseAdminShare, parseAdminOperation } from '../../lib/admin-api-data';

const wallet = '0x1111111111111111111111111111111111111111';
const broadcast = { messages: [], stats: { totalMessages: 0, totalImpressions: 0, totalDismissals: 0 } };
const airdrop = { meta: { totalRecipients: 1, claimedCount: 0, serverWallet: wallet, balances: { seed: '100.5', leaf: '2', pixotchi: '0' }, requirements: { seed: { total: 100, remaining: 100 }, leaf: { total: 1, remaining: 1 }, pixotchi: { total: 0, remaining: 0 } } }, recipients: [{ address: wallet, seed: '100', leaf: '1', pixotchi: '0', claimed: false }] };
const claims = { stats: { total: 1, complete: 1, partial: 0, failed: 0, leafBonusSent: 0, seedBonusSent: 0 }, claims: [{ address: wallet, tokenId: 1, strainId: 1, status: 'complete' }] };
const rpc = { endpoints: [], summary: { total: 0, healthy: 0, degraded: 0, coolingDown: 0, avgLatencyMs: null, liveSuccessCount: 0, liveFailureCount: 0 } };
const chat = { messages: [], stats: { totalMessages: 0, activeUsers: 0, messagesLast24h: 0 } };
const notificationStats = { success: true, provider: 'neynar', stats: { plantTOD: { sentCount: 0, thresholdHours: 12, totalRuns: 0, recent: [], lastRun: null }, global: { sentCount: 0, recent: [] }, eligibleFids: [] } };
const eligible = { success: true, provider: 'neynar', eligible: [{ fid: 123, address: wallet, userThrottled: false, plants: [{ id: 7, hoursLeft: 2, throttled: false }] }], summary: { totalEligiblePlants: 1, wouldNotify: 1, fidsWithEligiblePlants: 1, throttledUsers: 0 } };
let bundle: string;
let baseBundle: string;
let appCss: string;
test.beforeAll(async () => {
  const compile = async (provider: 'base' | 'neynar') => {
    const result = await build({
      entryPoints: [path.resolve('tests/frontend/fixtures/admin-medium.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_NOTIFICATION_PROVIDER': JSON.stringify(provider), 'process.env': '{}' }, plugins: [{
        name: 'external-ui-only', setup(builder) {
          builder.onResolve({ filter: /^(next\/image|@\/components\/theme-selector)$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/architecture-medium-mocks.tsx') }));
        }
      }]
    });
    return result.outputFiles[0].text;
  };
  [bundle, baseBundle] = await Promise.all([compile('neynar'), compile('base')]);
  const cssPath = path.resolve('app/globals.css');
  appCss = (await postcss([tailwind()]).process(await readFile(cssPath, 'utf8'), { from: cssPath })).css;
});
test.beforeEach(async ({ page }) => {
  await page.route('http://admin.test/**', route => {
    const endpoint = new URL(route.request().url()).pathname;
    if (endpoint === '/api/admin/broadcast') return route.fulfill({ json: broadcast });
    if (endpoint === '/api/airdrop/manage') return route.fulfill({ json: airdrop });
    if (endpoint === '/api/admin/claims') return route.fulfill({ json: claims });
    if (endpoint === '/api/admin/rpc-status') return route.fulfill({ json: rpc });
    if (endpoint === '/api/chat/admin/messages') return route.fulfill({ json: chat });
    if (endpoint === '/api/admin/notifications') return route.fulfill({ json: notificationStats });
    if (endpoint === '/api/admin/feedback/list') return route.fulfill({ json: { feedback: [] } });
    if (endpoint === '/api/gamification/leaderboards') return route.fulfill({ json: { streakTop: [], missionTop: [] } });
    if (endpoint.startsWith('/api/')) return route.fulfill({ json: { success: true } });
    return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
  });
});
async function open(page: Page, provider: 'neynar' | 'base' = 'neynar', realStyles = false) {
  await page.goto('http://admin.test/');
  await page.addScriptTag({ content: provider === 'base' ? baseBundle : bundle });
  await page.addStyleTag({ content: realStyles ? appCss : '[role="dialog"]{position:fixed;inset:1rem;overflow:auto;background:white}[data-dialog-layout]{pointer-events:auto}' });
  if (realStyles) await page.evaluate(() => { document.documentElement.className = matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'; });
  await page.getByLabel('Admin key', { exact: true }).fill('fixture-key');
  await page.getByRole('button', { name: 'Access Dashboard' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard');
}
async function section(page: Page, name: string) { await page.getByRole('navigation', { name: 'Admin dashboard sections' }).getByRole('button', { name, exact: true }).click(); }

test('ARC-07 admin read DTOs reject malformed nested fields and action identities', () => {
  expect(parseAdminBroadcast(broadcast)).not.toBeNull();
  expect(parseAdminBroadcast({ ...broadcast, stats: { ...broadcast.stats, totalMessages: {} } })).toBeNull();
  expect(parseAdminAirdrop(airdrop)).not.toBeNull();
  expect(parseAdminAirdrop({ ...airdrop, meta: { ...airdrop.meta, balances: { ...airdrop.meta.balances, seed: 'NaN' } } })).toBeNull();
  expect(parseAdminAirdrop({ ...airdrop, recipients: [{ ...airdrop.recipients[0], address: {} }] })).toBeNull();
  expect(parseAdminClaims(claims)).not.toBeNull();
  expect(parseAdminClaims({ ...claims, claims: [{ ...claims.claims[0], address: 'bad target' }] })).toBeNull();
  expect(parseAdminChat(chat)).not.toBeNull();
  expect(parseAdminChat({ ...chat, messages: {} })).toBeNull();
  expect(parseAdminFeedback({ feedback: [{ id: '1', address: wallet, message: 'Hello', createdAt: 9e16 }] })).toBeNull();
  expect(parseAdminFeedback({ feedback: [{ id: '1', address: wallet, message: 'Keep this feedback', createdAt: 1000, farcasterDetails: { fid: -1 } }] })?.feedback[0]).toMatchObject({ message: 'Keep this feedback', farcasterDetails: null });
  expect(parseAdminRpc(rpc)).not.toBeNull();
  expect(parseAdminRpc({ ...rpc, endpoints: [{ url: 'rpc', ok: 'false' }] })).toBeNull();
  expect(parseAdminLeaderboards({ streakTop: [{ address: wallet, value: Infinity }], missionTop: [] })).toBeNull();
  expect(parseAdminAiMessages({ messages: [{ id: '1', address: wallet, displayName: 'User', conversationId: '1', model: 'model', type: 'assistant', message: 'Reply', timestamp: Date.now(), toolCalls: [{ toolName: {}, status: 'ok' }] }] })).toBeNull();
  expect(parseAdminShare({ shortUrl: 'javascript:alert(1)' })).toBeNull();
  expect(parseAdminOperation({ success: true, deleted: { walletClaims: 1, verifiedClaims: 1 }, message: 'All claims reset' })?.deleted).toEqual({ walletClaims: 1, verifiedClaims: 1 });
});

test('ARC-07/08 malformed broadcast stats recover without losing the unsent draft', async ({ page }) => {
  const crashes: string[] = []; page.on('pageerror', error => crashes.push(error.message));
  await page.route('**/api/admin/broadcast', route => route.fulfill({ json: { ...broadcast, stats: { totalMessages: {} } } }));
  await open(page);
  await expect(page.getByRole('alert')).toContainText('Broadcast data could not be read');
  await page.getByLabel('Title (Optional)').fill('Keep this title');
  await page.getByLabel('Message Content *', { exact: true }).fill('Keep this unsent message');
  await section(page, 'OG Images'); await page.getByLabel('Address / ENS / Basename').fill(wallet);
  await section(page, 'Broadcast');
  await expect(page.getByLabel('Title (Optional)')).toHaveValue('Keep this title');
  await page.route('**/api/admin/broadcast', route => route.fulfill({ json: broadcast }));
  await page.getByRole('button', { name: 'Retry loading data' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Message Content *', { exact: true })).toHaveValue('Keep this unsent message');
  await section(page, 'OG Images'); await expect(page.getByLabel('Address / ENS / Basename')).toHaveValue(wallet);
  expect(crashes).toEqual([]);
});

test('ARC-07/08 malformed airdrop requirements recover and preserve the CSV draft', async ({ page }) => {
  await open(page);
  await page.route('**/api/airdrop/manage', route => route.fulfill({ json: { ...airdrop, meta: { ...airdrop.meta, requirements: { seed: { remaining: 3 } } } } }));
  await section(page, 'Airdrop');
  await expect(page.getByRole('alert')).toContainText('Airdrop data could not be read');
  await expect(page.getByRole('button', { name: 'Clear All', exact: true })).toHaveCount(0);
  await page.getByLabel('Eligibility list CSV').fill('address,seed,leaf,pixotchi\nDraft only');
  await page.route('**/api/airdrop/manage', route => route.fulfill({ json: airdrop }));
  await page.getByRole('button', { name: 'Retry loading data' }).click();
  await expect(page.getByText('100.5', { exact: true })).toBeVisible();
  await section(page, 'Claims'); await section(page, 'Airdrop');
  await expect(page.getByLabel('Eligibility list CSV')).toHaveValue('address,seed,leaf,pixotchi\nDraft only');
});

test('ARC-07 invalid claim targets disable data actions and retry enables cancel-only review', async ({ page }) => {
  const writes: string[] = []; page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await open(page);
  await page.route('**/api/admin/claims', route => route.fulfill({ json: { ...claims, claims: [{ ...claims.claims[0], address: {} }] } }));
  await section(page, 'Claims');
  await expect(page.getByRole('alert')).toContainText('Claims data could not be read');
  await expect(page.getByRole('button', { name: 'Reset All', exact: true })).toHaveCount(0);
  await page.route('**/api/admin/claims', route => route.fulfill({ json: claims }));
  await page.getByRole('button', { name: 'Retry loading data' }).click();
  await page.getByRole('button', { name: 'Reset All', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset All Claims' });
  await dialog.getByLabel('Type RESET to confirm').fill('RESET');
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes).toEqual([]);
});

test('ARC-07 dashboard data errors are inline and retry across chat, feedback, RPC and leaderboards', async ({ page }) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  await open(page);
  const cases = [
    { section: 'Chat', endpoint: '/api/chat/admin/messages', value: chat },
    { section: 'Feedback', endpoint: '/api/admin/feedback/list', value: { feedback: [] } },
    { section: 'RPC', endpoint: '/api/admin/rpc-status', value: rpc },
    { section: 'Gamification', endpoint: '/api/gamification/leaderboards', value: { streakTop: [], missionTop: [] } },
  ];
  for (const row of cases) {
    await page.route(`**${row.endpoint}`, route => route.fulfill({ json: { malformed: true } }));
    await section(page, row.section);
    await expect(page.getByRole('alert')).toContainText('data could not be read');
    await page.route(`**${row.endpoint}`, route => route.fulfill({ json: row.value }));
    await page.getByRole('button', { name: 'Retry loading data' }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});

test('ARC-08 admin read timeout releases retry and switching sections cancels the old read', async ({ page }) => {
  await open(page); await page.clock.install();
  await page.route('**/api/admin/claims', () => { });
  await section(page, 'Claims'); await page.clock.fastForward(15_100);
  await expect(page.getByRole('alert')).toContainText('Claims request timed out');
  await section(page, 'Broadcast');
  await expect(page.getByLabel('Title (Optional)')).toBeVisible();
  await page.route('**/api/admin/claims', route => route.fulfill({ json: claims }));
  await section(page, 'Claims');
  await expect(page.getByRole('button', { name: 'Reset All', exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('ARC-07 notification stats and grouped keys reject malformed data and recover inline', async ({ page }) => {
  await open(page);
  await page.route('**/api/admin/notifications', route => route.fulfill({ json: { ...notificationStats, stats: {} } }));
  await section(page, 'Notifications');
  await expect(page.getByRole('alert')).toContainText('Invalid notification stats');
  await page.route('**/api/admin/notifications', route => route.fulfill({ json: notificationStats }));
  await page.getByRole('button', { name: 'Retry loading data' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await page.route('**/api/admin/notifications/keys?*', route => route.fulfill({ json: { success: true, totalKeys: 1, returnedKeys: 1, grouped: { bad: {} } } }));
  await page.getByRole('button', { name: 'Load Keys', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid notification keys');
  await page.route('**/api/admin/notifications/keys?*', route => route.fulfill({ json: { success: true, totalKeys: 0, returnedKeys: 0, grouped: {} } }));
  await page.getByRole('button', { name: 'Retry loading data' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('ARC-07 malformed eligibility refresh cannot reuse previous notification recipients', async ({ page }) => {
  const writes: string[] = []; page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await open(page); await section(page, 'Notifications');
  await page.route('**/api/admin/notifications/eligible', route => route.fulfill({ json: eligible }));
  await page.getByRole('button', { name: 'Check Eligible', exact: true }).click();
  await page.getByRole('button', { name: 'Send Notifications', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Send Notifications' });
  await expect(dialog.getByText('1 users will receive notifications', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.route('**/api/admin/notifications/eligible', route => route.fulfill({ json: { ...eligible, eligible: [{ ...eligible.eligible[0], fid: {} }] } }));
  await page.getByRole('button', { name: 'Check Eligible', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid eligible plants');
  await expect(page.getByRole('button', { name: 'Send Notifications', exact: true })).toBeDisabled();
  await page.route('**/api/admin/notifications/eligible', route => route.fulfill({ json: eligible }));
  await page.getByRole('button', { name: 'Retry loading data' }).click();
  await expect(page.getByRole('button', { name: 'Send Notifications', exact: true })).toBeEnabled();
  await page.getByLabel('Filter by Farcaster ID').fill('456');
  await expect(page.getByRole('button', { name: 'Send Notifications', exact: true })).toBeDisabled();
  expect(writes).toEqual([]);
});

test('ARC-07 AI message tool records are validated before rendering and can retry', async ({ page }) => {
  const time = Date.now();
  await open(page);
  await page.route('**/api/chat/ai/admin/conversations?*', route => route.fulfill({ json: { conversations: [{ id: 'one', address: wallet, title: 'Fixture conversation', model: 'model', createdAt: time, lastMessageAt: time, messageCount: 1, totalTokens: 1 }], stats: null } }));
  const reply = { id: 'reply', address: wallet, displayName: 'Assistant', conversationId: 'one', model: 'model', type: 'assistant', message: 'Verified reply', timestamp: time };
  await page.route('**/api/chat/ai/admin/messages?*', route => route.fulfill({ json: { messages: [{ ...reply, toolCalls: [{ toolName: {}, status: 'ok' }] }] } }));
  await section(page, 'AI Chat');
  await page.getByRole('button', { name: `View conversation with ${wallet}` }).click();
  await expect(page.getByRole('alert')).toContainText('Conversation data could not be read');
  await expect(page.getByText('Verified reply', { exact: true })).toHaveCount(0);
  await page.route('**/api/chat/ai/admin/messages?*', route => route.fulfill({ json: { messages: [reply] } }));
  await page.getByRole('button', { name: 'Retry loading data' }).click();
  await expect(page.getByText('Verified reply', { exact: true })).toBeVisible();
});

test('ARC-07 Base campaign preview validates recipients and expires when the draft changes', async ({ page }) => {
  const sends: string[] = []; page.on('request', request => { if (request.url().includes('/campaigns/send')) sends.push(request.url()); });
  await page.route('**/api/admin/notifications', route => route.fulfill({ json: { success: true, provider: 'base', stats: { plantTOD: notificationStats.stats.plantTOD, audience: { enabledCount: 0, currentSnapshot: null, history: [], syncState: null }, campaigns: { recent: [] } } } }));
  await open(page, 'base'); await section(page, 'Notifications');
  await page.getByLabel('Campaign title').fill('Draft reminder');
  await page.getByLabel('Campaign message').fill('Unsent campaign');
  const send = page.getByRole('button', { name: 'Send Campaign', exact: true });
  await expect(send).toBeDisabled();
  const preview = { recipients: [wallet], requestedCount: 1, resolvedCount: 1, snapshotCount: 1, snapshotMatchedCount: 1, notes: [] };
  await page.route('**/api/admin/notifications/campaigns/preview', route => route.fulfill({ json: { success: true, preview: { ...preview, recipients: [{}] } } }));
  await page.getByRole('button', { name: 'Preview', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Invalid campaign preview');
  await expect(send).toBeDisabled();
  await page.route('**/api/admin/notifications/campaigns/preview', route => route.fulfill({ json: { success: true, preview } }));
  await page.getByRole('button', { name: 'Retry loading data' }).click();
  await expect(send).toBeEnabled();
  await page.getByLabel('Campaign message').fill('Edited unsent campaign');
  await expect(send).toBeDisabled();
  await section(page, 'Broadcast'); await section(page, 'Notifications');
  await expect(page.getByLabel('Campaign title')).toHaveValue('Draft reminder');
  await expect(page.getByLabel('Campaign message')).toHaveValue('Edited unsent campaign');
  await expect(send).toBeDisabled();
  expect(sends).toEqual([]);
});

test('ARC-08/11 real application styles keep admin navigation, forms and long notification review within the viewport', async ({ page }, testInfo) => {
  const writes: string[] = []; page.on('request', request => { if (request.method() !== 'GET') writes.push(request.url()); });
  await open(page, 'neynar', true);
  const nav = page.getByRole('navigation', { name: 'Admin dashboard sections' });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  for (const button of await nav.getByRole('button').all()) {
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
  await page.screenshot({ path: testInfo.outputPath('admin-navigation-layout.png') });
  await page.getByLabel('Title (Optional)').fill('Long but unsent broadcast title');
  await page.getByLabel('Message Content *', { exact: true }).fill('Unsent content '.repeat(15));
  for (const field of await page.getByRole('textbox').all()) {
    const box = (await field.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
  await page.screenshot({ path: testInfo.outputPath('admin-broadcast-layout.png') });
  const createBroadcast = page.getByRole('button', { name: 'Create Broadcast', exact: true });
  await createBroadcast.scrollIntoViewIfNeeded();
  await expect(createBroadcast).toBeInViewport();
  await section(page, 'Notifications');
  await page.route('**/api/admin/notifications/eligible', route => route.fulfill({ json: { ...eligible, eligible: Array.from({ length: 150 }, (_, index) => ({ ...eligible.eligible[0], fid: index + 1 })), summary: { totalEligiblePlants: 150, wouldNotify: 150, fidsWithEligiblePlants: 150, throttledUsers: 0 } } }));
  await page.getByRole('button', { name: 'Check Eligible', exact: true }).click();
  await page.getByRole('button', { name: 'Send Notifications', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Send Notifications' });
  const surface = dialog.locator('[data-dialog-layout="form"]');
  const box = (await surface.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  expect(box.y).toBeGreaterThanOrEqual(0);
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height + 1);
  const scrollOwners = await surface.locator('*').evaluateAll(nodes => nodes.filter(node => ['auto', 'scroll'].includes(getComputedStyle(node).overflowY) && node.scrollHeight > node.clientHeight + 1).length);
  expect(scrollOwners).toBe(1);
  const cancel = dialog.getByRole('button', { name: 'Cancel', exact: true });
  const cancelBox = (await cancel.boundingBox())!;
  expect(cancelBox.height).toBeGreaterThanOrEqual(44);
  expect(cancelBox.y + cancelBox.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  await page.screenshot({ path: testInfo.outputPath('admin-notification-layout.png') });
  await cancel.click();
  expect(writes).toEqual([]);
});

test('ARC-07 the actual claims reset response shape is accepted after a mocked reset', async ({ page }) => {
  let resets = 0;
  await page.route('**/api/admin/claims?*', route => {
    expect(route.request().method()).toBe('DELETE');
    resets += 1;
    return route.fulfill({ json: { success: true, message: 'All claim records have been reset', deleted: { walletClaims: 1, verifiedClaims: 1 } } });
  });
  await open(page); await section(page, 'Claims');
  await page.getByRole('button', { name: 'Reset All', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset All Claims' });
  await dialog.getByLabel('Type RESET to confirm').fill('RESET');
  await dialog.getByRole('button', { name: 'Reset All', exact: true }).click();
  await expect(page.getByText('No claims found', { exact: true })).toBeVisible();
  expect(resets).toBe(1);
});

test('ARC-07 an AI conversation ID remains one encoded parameter in a mocked delete', async ({ page }) => {
  const conversationId = 'one&all=true';
  const deletes: string[] = [];
  await page.route('**/api/chat/ai/admin/conversations?*', route => {
    if (route.request().method() === 'DELETE') {
      deletes.push(route.request().url());
      return route.fulfill({ json: { success: true } });
    }
    return route.fulfill({ json: { conversations: [{ id: conversationId, address: wallet, title: 'Encoded ID fixture', model: 'model', createdAt: Date.now(), lastMessageAt: Date.now(), messageCount: 0, totalTokens: 0 }], stats: null } });
  });
  await open(page); await section(page, 'AI Chat');
  await page.getByRole('button', { name: `Delete conversation with ${wallet}`, exact: true }).click();
  await page.getByRole('dialog', { name: 'Delete Conversation' }).getByRole('button', { name: 'Delete', exact: true }).click();
  await expect.poll(() => deletes.length).toBe(1);
  expect(new URL(deletes[0]).searchParams.get('conversationId')).toBe(conversationId);
  expect(new URL(deletes[0]).searchParams.has('all')).toBe(false);
});

test('ARC-07 malformed optional feedback identity does not hide valid moderation records', async ({ page }) => {
  await page.route('**/api/admin/feedback/list', route => route.fulfill({ json: { feedback: [{ id: 'feedback-one', address: wallet, message: 'Please keep this moderation record visible', createdAt: Date.now(), farcasterDetails: { fid: -1 } }] } }));
  await open(page); await section(page, 'Feedback');
  await expect(page.getByText('Please keep this moderation record visible', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: `Delete feedback from ${wallet}`, exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
