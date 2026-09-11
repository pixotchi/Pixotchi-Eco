import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { getAuthErrorCode, getAuthErrorMessage, readMiniAppPresentation, readWalletName } from '../../lib/auth-presentation-data';
import { parseStatusSnapshot, publicRpcMetrics } from '../../lib/status-snapshot';

let bundle: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: [path.resolve('tests/frontend/fixtures/architecture-medium.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_NOTIFICATION_PROVIDER': '"neynar"', 'process.env': '{}' }, plugins: [{ name: 'external-ui-only', setup(builder) {
    builder.onResolve({ filter: /^(wagmi|next\/image|@farcaster\/miniapp-sdk|@privy-io\/react-auth|@\/components\/(solana|theme-selector|auth\/surface-switch-buttons)|@\/lib\/(solana-auth-availability|balance-context|contracts))$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/architecture-medium-mocks.tsx') }));
  } }] });
  bundle = result.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  await page.route('http://architecture.test/**', route => {
    if (route.request().url().includes('/api/')) return route.fulfill({ json: { success: true, messages: [], stats: {}, endpoints: [], eligible: [], claims: [], conversations: [], recent: [] } });
    return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
  });
});
async function open(page: import('@playwright/test').Page, query: string) {
  await page.goto(`http://architecture.test/?${query}`);
  await page.addScriptTag({ content: bundle });
  await page.addStyleTag({ content: '[role="dialog"] { position: fixed; inset: 1rem; overflow: auto; background: white; } [data-dialog-layout] { pointer-events: auto; }' });
}

function query(page: import('@playwright/test').Page) {
  return Object.fromEntries(new URL(page.url()).searchParams);
}

test('ARC-01 web URLs contain only active tab state while retaining selections, scroll and reload continuity', async ({ page }) => {
  await page.addInitScript(() => history.replaceState({ ...history.state, fixtureState: { keep: 42 } }, '', location.href));
  await open(page, 'dashboardView=lands&leaderboardFilter=dead&surface=base&utm_source=shared&custom=keep#buildings');
  await expect(page.getByLabel('Farm view')).toHaveText('lands');
  await expect.poll(() => query(page)).toEqual({ dashboardView: 'lands', surface: 'base', utm_source: 'shared', custom: 'keep' });
  expect(await page.evaluate(() => history.state.fixtureState)).toEqual({ keep: 42 });
  await page.getByTestId('scroller').evaluate(element => { element.scrollTop = 450; element.dispatchEvent(new Event('scroll', { bubbles: true })); });
  await page.getByRole('button', { name: 'Swap', exact: true }).click();
  await expect(page.getByLabel('Farm view')).toHaveText('lands');
  await expect.poll(() => query(page)).toEqual({ tab: 'swap', surface: 'base', utm_source: 'shared', custom: 'keep' });
  expect(new URL(page.url()).hash).toBe('#buildings');
  await page.getByRole('button', { name: 'Ranking', exact: true }).click();
  await expect(page.getByLabel('Ranking filter')).toHaveValue('dead');
  await expect.poll(() => query(page)).toEqual({ tab: 'leaderboard', leaderboardFilter: 'dead', surface: 'base', utm_source: 'shared', custom: 'keep' });
  expect(await page.evaluate(() => history.state.fixtureState)).toEqual({ keep: 42 });
  await page.goBack();
  await expect(page.getByLabel('Active tab')).toHaveText('swap');
  expect(await page.evaluate(() => history.state.fixtureState)).toEqual({ keep: 42 });
  await page.goForward();
  await expect(page.getByLabel('Ranking filter')).toHaveValue('dead');
  await page.getByRole('button', { name: 'Farm', exact: true }).click();
  await expect.poll(() => page.getByTestId('scroller').evaluate(element => element.scrollTop)).toBe(450);
  await page.getByRole('button', { name: 'Swap', exact: true }).click();
  await page.reload(); await page.addScriptTag({ content: bundle });
  await expect(page.getByLabel('Active tab')).toHaveText('swap');
  await expect.poll(() => query(page)).toEqual({ tab: 'swap', surface: 'base', utm_source: 'shared', custom: 'keep' });
  expect(await page.evaluate(() => history.state.fixtureState)).toEqual({ keep: 42 });
  await page.getByRole('button', { name: 'Farm', exact: true }).click();
  await expect(page.getByLabel('Farm view')).toHaveText('lands');
  await page.getByRole('button', { name: 'Ranking', exact: true }).click();
  await expect(page.getByLabel('Ranking filter')).toHaveValue('dead');
});

test('ARC-01 Back and Forward restore their own active URL instead of a newer cached filter', async ({ page }) => {
  await open(page, 'tab=leaderboard&leaderboardFilter=dead&leaderboardPage=3&surface=base');
  await expect(page.getByLabel('Ranking filter')).toHaveValue('dead');
  await expect(page.getByLabel('Ranking page')).toHaveText('3');
  await page.getByRole('button', { name: 'Swap', exact: true }).click();
  await page.getByRole('button', { name: 'Ranking', exact: true }).click();
  await page.getByLabel('Ranking filter').selectOption('attackable');
  await expect(page.getByLabel('Ranking page')).toHaveText('1');
  await expect.poll(() => query(page)).toEqual({ tab: 'leaderboard', leaderboardFilter: 'attackable', surface: 'base' });
  const entries = await page.evaluate(() => history.length);
  await page.getByRole('button', { name: 'Ranking', exact: true }).click();
  expect(await page.evaluate(() => history.length)).toBe(entries);
  await page.goBack();
  await expect(page.getByLabel('Active tab')).toHaveText('swap');
  await page.goBack();
  await expect(page.getByLabel('Ranking filter')).toHaveValue('dead');
  await expect(page.getByLabel('Ranking page')).toHaveText('3');
  await expect.poll(() => query(page)).toEqual({ tab: 'leaderboard', leaderboardFilter: 'dead', leaderboardPage: '3', surface: 'base' });
  await page.goForward();
  await expect(page.getByLabel('Active tab')).toHaveText('swap');
  await page.goForward();
  await expect(page.getByLabel('Ranking filter')).toHaveValue('attackable');
  await expect(page.getByLabel('Ranking page')).toHaveText('1');
  await page.reload(); await page.addScriptTag({ content: bundle });
  await expect(page.getByLabel('Ranking filter')).toHaveValue('attackable');
});

test('ARC-01 hidden React Activity updates retain local state without leaking query keys into another tab', async ({ page }) => {
  await open(page, 'tab=leaderboard&leaderboardFilter=dead&leaderboardPage=3&surface=base');
  await page.getByLabel('Ranking draft').fill('Keep this unfinished selection');
  await page.getByRole('button', { name: 'Swap', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Ranking panel' })).toBeHidden();
  await page.getByRole('button', { name: 'Complete background Ranking change' }).click();
  await expect.poll(() => query(page)).toEqual({ tab: 'swap', surface: 'base' });
  await page.getByRole('button', { name: 'Ranking', exact: true }).click();
  await expect(page.getByLabel('Ranking filter')).toHaveValue('attackable');
  await expect(page.getByLabel('Ranking page')).toHaveText('3');
  await expect(page.getByLabel('Ranking draft')).toHaveValue('Keep this unfinished selection');
  await expect.poll(() => query(page)).toEqual({ tab: 'leaderboard', leaderboardFilter: 'attackable', leaderboardPage: '3', surface: 'base' });
});

test('ARC-01 typed cross-tab navigation writes target options into one new history entry', async ({ page }) => {
  await open(page, 'surface=base#destination');
  await expect(page.getByLabel('Farm view')).toHaveText('plants');
  const entries = await page.evaluate(() => history.length);
  await page.getByRole('button', { name: 'Go to my lands' }).click();
  await expect(page.getByLabel('Farm view')).toHaveText('lands');
  await expect.poll(() => query(page)).toEqual({ dashboardView: 'lands', surface: 'base' });
  expect(await page.evaluate(() => history.length)).toBe(entries);
  await page.getByRole('button', { name: 'Show plants' }).click();
  await expect.poll(() => query(page)).toEqual({ surface: 'base' });
  await page.getByRole('button', { name: 'Mint a land' }).click();
  await expect(page.getByLabel('Active tab')).toHaveText('mint');
  await expect(page.getByLabel('Mint type')).toHaveText('land');
  await expect.poll(() => query(page)).toEqual({ tab: 'mint', mintType: 'land', surface: 'base' });
  expect(await page.evaluate(() => history.length)).toBe(entries + 1);
  await page.goBack();
  await expect(page.getByLabel('Active tab')).toHaveText('dashboard');
  await expect(page.getByLabel('Farm view')).toHaveText('plants');
  await expect.poll(() => query(page)).toEqual({ surface: 'base' });
  await page.goForward();
  await expect(page.getByLabel('Mint type')).toHaveText('land');
  await page.getByRole('button', { name: 'Go to my lands' }).click();
  await expect(page.getByLabel('Active tab')).toHaveText('dashboard');
  await expect(page.getByLabel('Farm view')).toHaveText('lands');
  await expect.poll(() => query(page)).toEqual({ dashboardView: 'lands', surface: 'base' });
  expect(new URL(page.url()).hash).toBe('#destination');
  await page.goBack();
  await expect(page.getByLabel('Active tab')).toHaveText('mint');
  await expect(page.getByLabel('Mint type')).toHaveText('land');
});

test('ARC-01 old Activity deep links migrate once, survive hidden panels and reset to a clean default URL', async ({ page }) => {
  await open(page, 'tab=activity&activityView=my&activityPage=2&activityFilter=attacks&activityDirection=incoming&surface=base');
  await expect(page.getByLabel('Activity scope')).toHaveValue('my');
  await expect(page.getByLabel('Activity feeds')).toHaveText(JSON.stringify({ all: { page: 1, category: 'all', direction: 'all' }, my: { page: 2, category: 'attacks', direction: 'incoming' } }));
  await expect.poll(() => query(page)).toEqual({ tab: 'activity', activityView: 'my', activityFeeds: JSON.stringify({ my: { page: 2, category: 'attacks', direction: 'incoming' } }), surface: 'base' });
  await page.getByRole('button', { name: 'Next personal activity page' }).click();
  await page.getByRole('button', { name: 'Swap', exact: true }).click();
  await expect.poll(() => query(page)).toEqual({ tab: 'swap', surface: 'base' });
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(page.getByLabel('Activity feeds')).toContainText('"page":3');
  await page.reload(); await page.addScriptTag({ content: bundle });
  await expect(page.getByLabel('Activity feeds')).toContainText('"page":3');
  await page.getByRole('button', { name: 'Reset activity' }).click();
  await expect.poll(() => query(page)).toEqual({ tab: 'activity', surface: 'base' });
  await expect(page.getByLabel('Activity feeds')).toHaveText(JSON.stringify({ all: { page: 1, category: 'all', direction: 'all' }, my: { page: 1, category: 'all', direction: 'all' } }));
  await page.reload(); await page.addScriptTag({ content: bundle });
  await expect(page.getByLabel('Activity scope')).toHaveValue('all');
  await expect.poll(() => query(page)).toEqual({ tab: 'activity', surface: 'base' });
});

test('ARC-01 Activity consumer effects see restored history before retained filters can overwrite it', async ({ page }) => {
  await open(page, `tab=activity&activityFeeds=${encodeURIComponent(JSON.stringify({ all: { page: 3 } }))}&surface=base`);
  const initialFeeds = JSON.stringify({ all: { page: 3, category: 'all', direction: 'all' }, my: { page: 1, category: 'all', direction: 'all' } });
  await expect(page.getByLabel('Activity feeds')).toHaveText(initialFeeds);
  await expect(page.getByLabel('Activity history mismatch')).toHaveText('none');
  await page.getByRole('button', { name: 'Mint', exact: true }).click();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await page.getByRole('button', { name: 'Show casino activity' }).click();
  await expect.poll(() => query(page)).toEqual({ tab: 'activity', activityFeeds: JSON.stringify({ all: { category: 'casino' } }), surface: 'base' });
  await page.getByRole('button', { name: 'Mint', exact: true }).click();
  await page.evaluate(() => history.go(-3));
  await expect(page.getByLabel('Active tab')).toHaveText('activity');
  await expect(page.getByLabel('Activity feeds')).toHaveText(initialFeeds);
  await expect(page.getByLabel('Activity history mismatch')).toHaveText('none');
  await expect.poll(() => query(page)).toEqual({ tab: 'activity', activityFeeds: JSON.stringify({ all: { page: 3 } }), surface: 'base' });
});

test('ARC-01 invalid and default deep-link values are removed without losing global parameters', async ({ page }) => {
  for (const invalidPage of ['0', '-1', '1.5', '3garbage', '1e2', '9007199254740992']) {
    await open(page, `tab=leaderboard&leaderboardFilter=all&leaderboardMine=0&leaderboardBoard=plants&leaderboardPage=${invalidPage}&surface=base#ranking`);
    await expect(page.getByLabel('Ranking page')).toHaveText('1');
    await expect.poll(() => query(page)).toEqual({ tab: 'leaderboard', surface: 'base' });
    expect(new URL(page.url()).hash).toBe('#ranking');
  }
  await open(page, 'tab=not-a-tab&dashboardView=not-a-view&leaderboardFilter=mine&mintType=invalid&surface=base#home');
  await expect(page.getByLabel('Active tab')).toHaveText('dashboard');
  await expect(page.getByLabel('Farm view')).toHaveText('plants');
  await expect.poll(() => query(page)).toEqual({ surface: 'base' });
  await page.getByRole('button', { name: 'Ranking', exact: true }).click();
  await expect(page.getByLabel('Ranking filter')).toHaveValue('all');
});

test('ARC-01 Mini App view persists and typed mint navigation works', async ({ page }) => {
  await open(page, 'mini=1&surface=base#mini');
  const initialUrl = page.url();
  await page.getByRole('button', { name: 'Show lands' }).click();
  await page.getByRole('button', { name: 'Swap', exact: true }).click();
  await page.getByRole('button', { name: 'Farm', exact: true }).click();
  await expect(page.getByLabel('Farm view')).toHaveText('lands');
  await page.getByRole('button', { name: 'Mint a land' }).click();
  await expect(page.getByLabel('Active tab')).toHaveText('mint');
  await expect(page.getByLabel('Mint type')).toHaveText('land');
  await page.getByRole('button', { name: 'Ranking', exact: true }).click();
  await page.getByLabel('Ranking filter').selectOption('dead');
  await page.getByRole('button', { name: 'Swap', exact: true }).click();
  await page.getByRole('button', { name: 'Ranking', exact: true }).click();
  await expect(page.getByLabel('Ranking filter')).toHaveValue('dead');
  expect(page.url()).toBe(initialUrl);
});
test('ARC-03 disconnect preserves preference, guidance and durable proof across reload', async ({ page }) => {
  await open(page, 'scenario=cache');
  const kept = ['pixotchi-theme', 'pixotchi:performance-mode', 'pixotchi:ethMode', 'pixotchi:ambient-audio', 'pixotchi:tutorial', 'pixotchi:first-care:0xabc', 'pixotchi:pending-evm:v2:8453:0xabc', 'pixotchi:transfer-assets:v1:0xabc'];
  await page.evaluate(keys => { for (const key of keys) localStorage.setItem(key, 'keep'); localStorage.setItem('wagmi.store', 'clear'); sessionStorage.setItem('privy:token', 'clear'); }, kept);
  await page.getByRole('button', { name: 'Disconnect' }).click();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('wagmi.store'))).toBe(null);
  await page.reload();
  expect(await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), kept)).toEqual(kept.map(() => 'keep'));
  expect(await page.evaluate(() => sessionStorage.getItem('privy:token'))).toBe(null);
});
test('ARC-04 failed Solana bootstrap offers retry and recovers Solana capability', async ({ page }) => {
  await open(page, 'scenario=bootstrap');
  await expect(page.getByRole('alert')).toContainText('Solana wallets could not be loaded');
  await expect(page.getByText('Solana wallets ready')).toHaveCount(0);
  await page.getByRole('button', { name: 'Retry Solana' }).click();
  await expect(page.getByText('Solana wallets ready')).toBeVisible();
});
test('ARC-04 alternate wallet requires explicit selection', async ({ page }) => {
  await open(page, 'scenario=bootstrap');
  await page.getByRole('button', { name: 'Use an Ethereum wallet instead' }).click();
  await expect(page.getByText('Ethereum selected explicitly')).toBeVisible();
});
test('ARC-05 Mini App retry tracks the actual wallet promise and keeps errors inline', async ({ page }) => {
  await open(page, 'scenario=auth');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Connecting...', exact: true })).toBeDisabled();
  await page.waitForTimeout(1500);
  await expect(page.getByRole('button', { name: 'Connecting...', exact: true })).toBeDisabled();
  await expect(page.getByLabel('Connect calls')).toHaveText('1');
  await page.getByRole('button', { name: 'Reject sign-in' }).click();
  await expect(page.getByRole('alert')).toContainText('Wallet declined');
  await page.getByRole('button', { name: 'Retry connection' }).click();
  await page.getByRole('button', { name: 'Complete sign-in' }).click();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByLabel('Connect calls')).toHaveText('2');
});
test('ARC-05 web sign-in failure stays visible with retry and alternative paths', async ({ page }) => {
  await open(page, 'scenario=auth&web=1');
  await page.getByRole('button', { name: 'Continue with wallet or email' }).click();
  await expect(page.getByRole('alert')).toContainText('Sign-in service unavailable');
  await expect(page.getByRole('button', { name: 'Try wallet or email again' })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Continue with Base' })).toBeEnabled();
});
test('ARC-08 retryable tab import preserves surrounding unsent draft', async ({ page }) => {
  await open(page, 'scenario=retry');
  await page.getByLabel('Retained draft').fill('valuable unsent draft');
  await page.getByRole('button', { name: 'Retry loading Farm' }).click();
  await expect(page.getByText('Farm loaded successfully')).toBeVisible();
  await expect(page.getByLabel('Retained draft')).toHaveValue('valuable unsent draft');
});
test('ARC-09 vendor wallet theme follows dark and chromatic app themes', async ({ page }) => {
  for (const theme of ['dark', 'light', 'green', 'yellow', 'red', 'pink', 'blue', 'violet']) {
    await open(page, `scenario=theme&theme=${theme}`);
    await expect(page.getByTestId('privy-theme')).toHaveAttribute('data-theme', theme === 'dark' ? 'dark' : 'light');
  }
});
test('ARC-07/10 invalid status response retains a dated last-known snapshot and can retry', async ({ page }) => {
  await open(page, 'scenario=status&stale=1');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('PIXOTCHI STATUS');
  await expect(page.getByRole('heading', { level: 2 })).toHaveText('Ecosystem App');
  await expect(page.getByText('Status is out of date.', { exact: false })).toBeVisible();
  await page.route('**/api/status/checks', route => route.fulfill({ json: { services: [{ status: 'invalid' }] } }));
  await page.getByRole('button', { name: 'Refresh system status' }).click();
  await expect(page.getByText('The status response was invalid.', { exact: false })).toBeVisible();
  await page.route('**/api/status/checks', route => route.fulfill({ json: { generatedAt: new Date().toISOString(), overall: 'degraded', services: [{ id: 'app', label: 'Ecosystem App', status: 'degraded' }] } }));
  await page.getByRole('button', { name: 'Retry status check' }).click();
  await expect(page.getByText('Status is out of date.', { exact: false })).toHaveCount(0);
  await expect(page.getByRole('region', { name: 'Overall ecosystem status' })).toContainText('Degraded');
});
test('ARC-10 hung request times out and releases manual retry', async ({ page }) => {
  await open(page, 'scenario=status');
  await page.clock.install();
  await page.route('**/api/status/checks', () => {});
  await page.getByRole('button', { name: 'Refresh system status' }).click();
  await page.clock.fastForward(12_100);
  await expect(page.getByText('The status request timed out.', { exact: false })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry status check' })).toBeEnabled();
});
test('ARC-11 real admin gate labels, inline rejected auth, and authenticated form semantics', async ({ page }) => {
  await open(page, 'scenario=admin');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Admin Access Required');
  await page.getByLabel('Admin key', { exact: true }).fill('fixture-only-key');
  await page.route('**/api/admin/auth', route => route.fulfill({ status: 401, json: {} }));
  await page.getByRole('button', { name: 'Access Dashboard' }).click();
  await expect(page.getByRole('alert')).toContainText('key was not accepted');
  await page.route('**/api/admin/auth', route => route.fulfill({ json: { success: true } }));
  await page.getByRole('button', { name: 'Access Dashboard' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard');
  await page.getByLabel('Title (Optional)').fill('Draft only');
  await page.getByLabel('Message Content *', { exact: true }).fill('Unsent draft');
  const type = page.getByRole('group', { name: 'Type', exact: true });
  await type.getByRole('button', { name: 'Warning' }).click();
  await expect(type.getByRole('button', { name: 'Warning' })).toHaveAttribute('aria-pressed', 'true');
  const priority = page.getByRole('group', { name: 'Priority', exact: true });
  await priority.getByRole('button', { name: 'High', exact: true }).click();
  await expect(priority.getByRole('button', { name: 'High', exact: true })).toHaveAttribute('aria-pressed', 'true');
});

test('ARC-07 auth and status boundaries reject malformed external fields', () => {
  expect(getAuthErrorMessage({ message: { unsafe: true } }, 'fallback')).toBe('fallback');
  expect(getAuthErrorMessage({ error: { message: 'Wallet rejected' } }, 'fallback')).toBe('Wallet rejected');
  expect(getAuthErrorCode({ code: Infinity })).toBe(null);
  expect(getAuthErrorCode({ error: { code: 4001 } })).toBe(4001);
  expect(readWalletName({ name: {}, standardWallet: { name: 'Phantom' } })).toBe('Phantom');
  expect(readMiniAppPresentation({ user: { fid: -1 }, client: { added: 'false', name: [] } })?.user.fid).toBe(undefined);
  expect(readMiniAppPresentation({ user: { fid: 123 }, client: { added: true } })?.client.added).toBe(true);
  const feedback = readMiniAppPresentation({ user: { username: ['invalid'], displayName: 'Grower' }, client: { platformType: 'web' } });
  expect(feedback?.user.username).toBe(undefined);
  expect(feedback?.user.displayName).toBe('Grower');
  expect(feedback?.client.platformType).toBe('web');
  expect(parseStatusSnapshot({ generatedAt: 'not-a-date', overall: 'operational', services: [] })).toBe(null);
  expect(publicRpcMetrics({ healthyCount: 9, totalCount: 2 })).toBe(undefined);
  expect(publicRpcMetrics({ healthyCount: 1, totalCount: 2 })).toEqual({ healthyCount: 1, totalCount: 2 });
});

test('ARC-11 authenticated admin navigation and typed confirmation never send on cancel', async ({ page }) => {
  await open(page, 'scenario=admin');
  await page.route('**/api/admin/claims', route => route.fulfill({ json: { success: true, stats: { total: 1, complete: 1, partial: 0, failed: 0, leafBonusSent: 0, seedBonusSent: 0 }, claims: [{ address: '0x1111111111111111111111111111111111111111', tokenId: 1, strainId: 1, status: 'complete' }] } }));
  const writes: string[] = [];
  page.on('request', request => { if (['POST', 'PUT', 'DELETE'].includes(request.method())) writes.push(request.url()); });
  await page.getByLabel('Admin key', { exact: true }).fill('fixture-only-key');
  await page.getByRole('button', { name: 'Access Dashboard' }).click();
  const nav = page.getByRole('navigation', { name: 'Admin dashboard sections' });
  for (const name of ['Feedback', 'Chat', 'AI Chat', 'Gamification', 'RPC', 'Notifications', 'OG Images', 'Airdrop', 'Claims', 'Broadcast']) {
    await nav.getByRole('button', { name, exact: true }).click();
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Dashboard');
    if (name === 'AI Chat') await expect(page.getByRole('alert')).toContainText('AI chat data could not be read');
  }
  await nav.getByRole('button', { name: 'Claims', exact: true }).click();
  await page.getByRole('button', { name: 'Reset All', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Reset All Claims' });
  await expect(dialog.locator('[data-dialog-layout]')).toHaveAttribute('data-dialog-layout', 'form');
  await expect(dialog.getByRole('button', { name: 'Reset All', exact: true })).toBeDisabled();
  await dialog.getByLabel('Type RESET to confirm').fill('RESET');
  await expect(dialog.getByRole('button', { name: 'Reset All', exact: true })).toBeEnabled();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect(writes).toEqual([]);
});

test('ARC-11 long notification review uses one body and cancels without sending', async ({ page }) => {
  await open(page, 'scenario=admin');
  await page.getByLabel('Admin key', { exact: true }).fill('fixture-only-key');
  await page.getByRole('button', { name: 'Access Dashboard' }).click();
  await page.getByRole('navigation', { name: 'Admin dashboard sections' }).getByRole('button', { name: 'Notifications', exact: true }).click();
  await page.route('**/api/admin/notifications/eligible', route => route.fulfill({ json: { success: true, eligible: Array.from({ length: 150 }, (_, index) => ({ fid: index + 1, plants: [{ id: index + 1, hoursLeft: 2, throttled: false }], userThrottled: false })), summary: { totalEligiblePlants: 150, wouldNotify: 150, fidsWithEligiblePlants: 150, throttledUsers: 0 } } }));
  await page.getByRole('button', { name: 'Check Eligible', exact: true }).click();
  await page.getByRole('button', { name: 'Send Notifications', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: 'Send Notifications' });
  await expect(dialog.locator('[data-dialog-layout]')).toHaveAttribute('data-dialog-layout', 'form');
  await expect(dialog.getByText('150 users will receive notifications', { exact: false })).toBeVisible();
  await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(dialog).toHaveCount(0);
});

test('FND-07 wallet balances retain exact values in the title and accessible label', async ({ page }) => {
  await open(page, 'scenario=balances');
  const exact = '1.000000000000000001 SEED';
  const amount = page.getByTitle(exact, { exact: true });
  await expect(amount).toBeVisible();
  await expect(amount).toHaveAttribute('aria-label', exact);
  expect(await page.locator('button button').count()).toBe(0);
});

test('ARC-04 real host boundary dismisses Mini App splash when web Solana bootstrap failed', async ({ page }) => {
  await open(page, 'scenario=host-boundary&surface=privysolana&mini=1');
  await expect(page.locator('html')).toHaveAttribute('data-host-ready', 'true');
  await expect(page.getByText('Host wallet mounted')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Retry Solana' })).toHaveCount(0);
  await open(page, 'scenario=host-boundary&surface=privysolana');
  await expect(page.getByText('Host wallet mounted')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Retry Solana' })).toBeVisible();
});
async function reconnectAfterDocumentReset(page: import('@playwright/test').Page) {
  const navigation = page.waitForEvent('framenavigated', { predicate: frame => frame === page.mainFrame() });
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await navigation;
  await page.waitForLoadState('load');
  await page.addScriptTag({ content: bundle });
  // This small fixture has no SDK hydration. Establish the replacement using
  // its first-document connect; real-Wagmi automatic restoration is covered by
  // auth-disconnect-final, including the required fresh-document boundary.
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
}
test('ARC-03 delayed disconnect cleanup cannot admit or erase a replacement wallet', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/api/chat/auth/session', async route => { await held; await route.fulfill({ json: { success: true } }); });
  await open(page, 'scenario=disconnect-race');
  await page.evaluate(() => localStorage.setItem('wagmi.store', 'wallet-A'));
  await page.getByRole('button', { name: 'Disconnect identity' }).click();
  await expect(page.getByText('Finishing sign-out...', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Connecting...', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Attempt direct reconnect' }).click();
  await expect(page.getByLabel('Wallet', { exact: true })).toHaveText('disconnected');
  expect(await page.evaluate(() => localStorage.getItem('wagmi.store'))).toBe(null);
  release();
  await expect(page.getByLabel('Cleanup finished')).toHaveText('true');
  await reconnectAfterDocumentReset(page);
  await expect(page.getByLabel('Wallet', { exact: true })).toHaveText('B');
  expect(await page.evaluate(() => [localStorage.getItem('wagmi.store'), sessionStorage.getItem('privy:token')])).toEqual(['wallet-B', 'wallet-B']);
});
test('ARC-03 stalled remote cleanup aborts and a late response cannot alter replacement identity', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let requests = 0;
  await page.route('**/api/chat/auth/session', async route => { if (++requests === 1) await held; await route.fulfill({ json: { success: true } }).catch(() => {}); });
  await open(page, 'scenario=disconnect-race');
  await page.clock.install();
  await page.getByRole('button', { name: 'Disconnect identity' }).click();
  await expect(page.getByText('Finishing sign-out...', { exact: true })).toBeVisible();
  await page.clock.fastForward(10_100);
  await expect(page.getByLabel('Cleanup finished')).toHaveText('true');
  await reconnectAfterDocumentReset(page);
  await expect(page.getByLabel('Wallet', { exact: true })).toHaveText('B');
  release();
  expect(await page.evaluate(() => [localStorage.getItem('wagmi.store'), sessionStorage.getItem('privy:token')])).toEqual(['wallet-B', 'wallet-B']);
});

test('ARC08 provider theme registry uses every shared theme once', async ({ page }) => {
  await open(page, 'scenario=theme-registry');
  await expect(page.getByLabel('Available themes')).toHaveText('light,dark,green,yellow,red,pink,blue,violet');
});
