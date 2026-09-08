import { test, expect, type Page } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';

test.use({ trace: 'off', video: 'off' });
test.beforeEach(async ({ page }) => { page.on('pageerror', error => { throw error; }); });
let bundle: string;
test.beforeAll(async () => {
  const result = await build({ entryPoints: [path.resolve('tests/frontend/fixtures/auth-disconnect-final.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'no-persisted-identity', setup(builder) {
    builder.onResolve({ filter: /(cache-utils|session-storage-manager|chat-auth-client)$/ }, args => ({ path: args.path, namespace: 'synthetic-auth-io' }));
    builder.onLoad({ filter: /.*/, namespace: 'synthetic-auth-io' }, args => ({ contents: args.path.endsWith('cache-utils')
      ? 'export const clearAuthCaches = async () => {};'
      : args.path.endsWith('session-storage-manager')
        ? 'export const sessionStorageManager = {markPrivyLogoutIntent: async () => {}, clearAuthState: async () => {}};'
        : 'export const clearPublicChatSession = async signal => { await fetch("/logout", {method: "DELETE", signal}); };', loader: 'js' }));
  } }] });
  bundle = result.outputFiles[0].text;
});
async function open(page: Page, query = '', nextOwner = 'A') {
  let documents = 0;
  await page.route('http://disconnect.test/**', route => {
    if (new URL(route.request().url()).pathname === '/fixture.js') return route.fulfill({ contentType: 'application/javascript', body: bundle });
    if (route.request().method() === 'DELETE') return route.fulfill({ status: 204 });
    documents++;
    return route.fulfill({ contentType: 'text/html', body: `<div id="root" data-next-owner="${documents > 1 ? nextOwner : 'A'}" data-document="${documents}"></div><script src="/fixture.js"></script>` });
  });
  await page.goto(`http://disconnect.test/?${query}`);
  await expect(page.getByLabel('Wallet connection')).toHaveText('connected');
}
test('disconnect waits for the actual Wagmi connector before reporting success or releasing reconnect', async ({ page }) => {
  await open(page, 'hold-disconnect');
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await expect(page.locator('html')).toHaveAttribute('data-disconnect-calls', '1');
  await expect(page.getByLabel('Cleanup status')).toHaveText('pending');
  await expect(page.getByLabel('Disconnect result')).toHaveText('pending');
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: 'Release disconnect' }).click();
  await expect(page.getByLabel('Wallet connection')).toHaveText('disconnected');
  await expect(page.getByLabel('Disconnect result')).toHaveText('disconnected');
  await expect(page.getByLabel('Cleanup status')).toHaveText('idle');
});
test('stalled SDK cleanup keeps reconnect fenced and offers a fresh signed-out document without a logout loop', async ({ page }) => {
  await open(page, 'hold-disconnect', 'B');
  await page.clock.install();
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await expect(page.getByLabel('Cleanup status')).toHaveText('pending');
  await page.clock.fastForward(15_100);
  await expect(page.getByRole('button', { name: 'Reconnect Mini App' })).toBeDisabled();
  await page.getByRole('button', { name: 'Reload app safely' }).click();
  await expect(page).toHaveURL(/walletSession=signedout/);
  await expect(page.locator('#root')).toHaveAttribute('data-document', '2');
  await expect(page.getByLabel('Wallet connection')).toHaveText('disconnected');
  await expect(page.getByLabel('SDK connection count')).toHaveText('0');
  await expect(page.getByLabel('Cleanup status')).toHaveText('idle');
  await page.getByRole('button', { name: 'Reconnect Mini App' }).click();
  await expect(page.locator('#root')).toHaveAttribute('data-document', '3');
  await expect(page).not.toHaveURL(/walletSession=signedout/);
  await expect(page.getByLabel('Player connection')).toHaveText('connected');
  await expect(page.getByLabel('Wallet address')).toHaveText('0x2222222222222222222222222222222222222222');
});
test('an unresolved vendor logout gets the same bounded recovery before connector disconnect starts', async ({ page }) => {
  await open(page, 'hold-logout');
  await page.clock.install();
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await page.clock.fastForward(15_100);
  await expect(page.getByRole('button', { name: 'Reload app safely' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Reconnect Mini App' })).toBeDisabled();
  await expect(page.locator('html')).not.toHaveAttribute('data-disconnect-calls');
  await page.getByRole('button', { name: 'Reload app safely' }).click();
  await expect(page).toHaveURL(/walletSession=signedout/);
  await expect(page.getByLabel('Player connection')).toHaveText('disconnected');
  await expect(page.getByLabel('Cleanup status')).toHaveText('idle');
});
test('recovery remains fenced when the original SDK cleanup finishes during the reload request', async ({ page }) => {
  await open(page, 'hold-disconnect');
  await page.clock.install();
  const releases: (() => void)[] = [];
  await page.route('**/logout', async route => {
    await new Promise<void>(resolve => { releases.push(resolve); });
    await route.fulfill({ status: 204 }).catch(() => {});
  });
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await page.clock.fastForward(15_100);
  await page.getByRole('button', { name: 'Reload app safely' }).click();
  await expect.poll(() => releases.length).toBe(1);
  await page.getByRole('button', { name: 'Release disconnect' }).click();
  await expect.poll(() => releases.length).toBe(2);
  releases[1]();
  await expect(page.getByLabel('Disconnect result')).toHaveText('disconnected');
  await expect(page.getByLabel('Cleanup status')).toHaveText('pending');
  await expect(page.getByRole('button', { name: 'Reconnect Mini App' })).toBeDisabled();
  releases[0]();
  await expect(page).toHaveURL(/walletSession=signedout/);
  await expect(page.getByLabel('Wallet connection')).toHaveText('disconnected');
});
for (const remount of [false, true]) test(`explicit Mini App reconnect after cleanup replaces the old SDK document before owner B connects (remount=${remount})`, async ({ page }) => {
  await open(page, '', 'B');
  await page.getByRole('button', { name: 'Hold next connect' }).click();
  await page.getByRole('button', { name: 'Start queued provider reconnect' }).click();
  await expect(page.getByLabel('Wallet connection')).toHaveText('reconnecting');
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await expect(page.getByLabel('Disconnect result')).toHaveText('disconnected');
  if (remount) await page.getByRole('button', { name: 'Remount provider' }).click();
  await page.getByRole('button', { name: 'Reconnect Mini App' }).click();
  await expect(page.locator('#root')).toHaveAttribute('data-document', '2');
  await expect(page.getByLabel('Player connection')).toHaveText('connected');
  await expect(page.getByLabel('Wallet address')).toHaveText('0x2222222222222222222222222222222222222222');
  // This release control belongs to the new document and cannot reach A's
  // outstanding promise in the destroyed execution context.
  await page.getByRole('button', { name: 'Release connect' }).click();
  await expect(page.getByLabel('Wallet address')).toHaveText('0x2222222222222222222222222222222222222222');
});
test('a provider remount during remote cleanup cannot silently reconnect the signed-out wallet', async ({ page }) => {
  await open(page);
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  await page.route('**/logout', async route => { await held; await route.fulfill({ status: 204 }).catch(() => {}); });
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await expect(page.getByLabel('Wallet connection')).toHaveText('disconnected');
  await page.getByRole('button', { name: 'Remount provider' }).click();
  await expect(page.getByLabel('Wallet connection')).toHaveText('disconnected');
  release();
  await expect(page.getByLabel('Cleanup status')).toHaveText('idle');
  await expect(page.getByLabel('Wallet connection')).toHaveText('disconnected');
  await page.getByRole('button', { name: 'Remount provider' }).click();
  await expect(page.getByLabel('Wallet connection')).toHaveText('disconnected');
});
test('a rejected Wagmi disconnect reports failure, releases cleanup and supports an explicit retry', async ({ page }) => {
  await open(page, 'hold-disconnect');
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await page.getByRole('button', { name: 'Reject disconnect' }).click();
  await expect(page.getByLabel('Disconnect result')).toHaveText('Wallet refused disconnect');
  await expect(page.getByLabel('Cleanup status')).toHaveText('idle');
  await expect(page.getByLabel('Player connection')).toHaveText('disconnected');
  await expect(page.getByRole('button', { name: 'Connect wallet', exact: true })).toBeEnabled();
  await expect(page.getByLabel('Wallet connection')).toHaveText('disconnected');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByLabel('Player connection')).toHaveText('connected');
});
test('a wallet connect promise resolving after sign-out is retired without restoring the player session', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await expect(page.getByLabel('Cleanup status')).toHaveText('idle');
  await expect(page.getByLabel('Wallet connection')).toHaveText('disconnected');
  await page.getByRole('button', { name: 'Hold next connect' }).click();
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByLabel('Wallet connection')).toHaveText('connecting');
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await expect(page.getByLabel('Disconnect result')).toHaveText('disconnected');
  await page.getByRole('button', { name: 'Release connect' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-connect-calls', '2');
  await expect(page.locator('html')).toHaveAttribute('data-disconnect-calls', '2');
  await expect(page.getByLabel('Wallet connection')).toHaveText('disconnected');
  await expect(page.getByLabel('Player connection')).toHaveText('disconnected');
});
test('a different provider config cannot bypass sign-out intent', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await expect(page.getByLabel('Cleanup status')).toHaveText('idle');
  await page.getByRole('button', { name: 'Replace provider config' }).click();
  await expect(page.getByLabel('Wallet connection')).toHaveText('disconnected');
  await expect(page.locator('html')).toHaveAttribute('data-connect-calls', '1');
  await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
  await expect(page.getByLabel('Player connection')).toHaveText('connected');
});
test('a queued SDK reconnect cannot leave an invisible active connection after cleanup', async ({ page }) => {
  await open(page);
  await page.getByRole('button', { name: 'Hold next connect' }).click();
  await page.getByRole('button', { name: 'Start queued provider reconnect' }).click();
  await expect(page.getByLabel('Wallet connection')).toHaveText('reconnecting');
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await expect(page.getByLabel('Disconnect result')).toHaveText('disconnected');
  await page.getByRole('button', { name: 'Release connect' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-connect-calls', '2');
  await expect(page.getByLabel('Wallet connection')).toHaveText('disconnected');
  await expect(page.getByLabel('SDK connection count')).toHaveText('0');
  await expect(page.locator('html')).toHaveAttribute('data-disconnect-calls', '2');
});
test('two explicit connect and disconnect cycles remain signed out after subsequent provider remounts', async ({ page }) => {
  await open(page);
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
    await expect(page.getByLabel('Disconnect result')).toHaveText('disconnected');
    await expect(page.getByLabel('Wallet connection')).toHaveText('disconnected');
    await page.getByRole('button', { name: 'Remount provider' }).click();
    await expect(page.getByLabel('Wallet connection')).toHaveText('disconnected');
    await page.getByRole('button', { name: 'Connect wallet', exact: true }).click();
    await expect(page.getByLabel('Player connection')).toHaveText('connected');
  }
  await page.getByRole('button', { name: 'Disconnect wallet', exact: true }).click();
  await expect(page.getByLabel('Wallet connection')).toHaveText('disconnected');
  await expect(page.locator('html')).toHaveAttribute('data-connect-calls', '3');
});
