import { test, expect } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { extractBasePayload, getPrimaryAccountAddress, readWalletProvider, readWalletSignature } from '../../lib/auth/base-wallet-boundary';
import { parsePublicChatSession } from '../../lib/auth/public-session-boundary';

let bundle: string;
const address = '0x1111111111111111111111111111111111111111';
test.beforeAll(async () => {
  const result = await build({ entryPoints: [path.resolve('tests/frontend/fixtures/auth-adapters-medium.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' }, plugins: [{ name: 'wallet-sdk-only', setup(builder) {
    builder.onResolve({ filter: /^@privy-io\/react-auth$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/auth-adapters-privy-mock.ts') }));
  } }] });
  bundle = result.outputFiles[0].text;
});
test.beforeEach(async ({ page }) => {
  await page.route('http://auth-adapter.test/**', route => {
    const url = route.request().url();
    if (url.includes('/base/nonce')) return route.fulfill({ json: { nonce: 'abcdefgh1234' } });
    if (url.includes('/api/')) return route.fulfill({ json: { address, authenticated: true, provider: 'base', method: 'base-siwe' } });
    return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
  });
});
async function open(page: import('@playwright/test').Page, query: string) {
  await page.goto(`http://auth-adapter.test/?${query}`); await page.addScriptTag({ content: bundle });
}
for (const mode of ['capability', 'rpc', 'fallback', 'legacy']) test(`ARC07/08 Base adapter validates and completes ${mode} negotiation`, async ({ page }) => {
  const submissions: unknown[] = [];
  await page.route('**/api/chat/auth/session', route => { if (route.request().method() === 'POST') submissions.push(route.request().postDataJSON()); return route.fulfill({ json: { address, authenticated: true, provider: 'base', method: 'base-siwe' } }); });
  await open(page, `mode=${mode}`);
  await page.getByRole('button', { name: 'Authenticate Base' }).click();
  await expect(page.getByLabel('Adapter status')).toHaveText('ready');
  await expect(page.getByLabel('Authenticated address')).toHaveText(address);
  expect(submissions).toHaveLength(1);
  expect(submissions[0]).toMatchObject({ address, provider: 'base', signature: `0x${'ab'.repeat(65)}` });
  if (mode === 'fallback' || mode === 'legacy') await expect(page.locator('html')).toHaveAttribute('data-rpc', /personal_sign/);
  if (mode === 'rpc') await expect(page.locator('html')).toHaveAttribute('data-rpc', /wallet_connect/);
});
test('ARC07 malformed capability never reaches session authentication', async ({ page }) => {
  let submissions = 0;
  page.on('request', request => { if (request.url().includes('/api/chat/auth/session') && request.method() === 'POST') submissions++; });
  await open(page, 'mode=malformed');
  await page.getByRole('button', { name: 'Authenticate Base' }).click();
  await expect(page.getByLabel('Adapter status')).toContainText('invalid sign-in signature');
  expect(submissions).toBe(0);
  await expect(page.getByLabel('Authenticated address')).toHaveText('none');
});
test('ARC07/08 Base personal sign deadline never authenticates an unresolved signature', async ({ page }) => {
  await open(page, 'mode=timeout'); await page.clock.install();
  await page.getByRole('button', { name: 'Authenticate Base' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-rpc', /personal_sign/);
  await page.clock.fastForward(12_100);
  await expect(page.getByLabel('Adapter status')).toHaveText('wallet_connect not supported');
  await expect(page.getByLabel('Authenticated address')).toHaveText('none');
});
for (const solana of [false, true]) test(`ARC05/08 ${solana ? 'Solana' : 'EVM'} Privy adapter persists sign-in failure`, async ({ page }) => {
  await open(page, `privy=1${solana ? '&solana=1' : ''}`);
  await expect(page.locator('html')).toHaveAttribute('data-login-requested', 'true');
  await page.getByRole('button', { name: 'Reject Privy' }).click();
  await expect(page.getByLabel('Auth error')).toContainText('sign the wallet message');
});
test('ARC03/08 Privy adapter discards a callback from before identity cleanup', async ({ page }) => {
  await open(page, 'privy=1');
  await expect(page.locator('html')).toHaveAttribute('data-login-requested', 'true');
  await page.getByRole('button', { name: 'Invalidate old login' }).click();
  await page.getByRole('button', { name: 'Complete Privy' }).click();
  await expect(page.getByLabel('Expected address')).toHaveText('none');
});
test('ARC07 wallet parsers reject malformed address, provider and signature shapes', () => {
  expect(getPrimaryAccountAddress([{ address: 'not-an-address' }])).toBeNull();
  expect(readWalletProvider({ request: 'not-callable' })).toBeNull();
  expect(readWalletSignature('0xabc')).toBeNull();
  expect(readWalletSignature('0xabcd')).toBe('0xabcd');
  expect(extractBasePayload({ accounts: [{ address, capabilities: { signInWithEthereum: { message: 123, signature: '0xabcd' } } }] })).toBeNull();
  expect(() => extractBasePayload({ accounts: [{ address, capabilities: { signInWithEthereum: { message: 'Wallet rejected' } } }] })).toThrow('Wallet rejected');
  expect(parsePublicChatSession({ address, authenticated: true, method: 'base-siwe', provider: 'privy' })).toBeNull();
  expect(parsePublicChatSession({ address: {}, authenticated: true, method: 'base-siwe', provider: 'base' })).toBeNull();
});

test('ARC03 Base signature arriving after cleanup cannot recreate a session', async ({ page }) => {
  let posts = 0;
  page.on('request', request => { if (request.url().includes('/api/chat/auth/session') && request.method() === 'POST') posts++; });
  await open(page, 'mode=held-signature');
  await page.getByRole('button', { name: 'Authenticate Base' }).click();
  await expect(page.getByLabel('Adapter status')).toHaveText('pending');
  await page.getByRole('button', { name: 'Invalidate sign-in' }).click();
  await page.getByRole('button', { name: 'Release signature' }).click();
  await expect(page.getByLabel('Adapter status')).toContainText('no longer current');
  expect(posts).toBe(0);
  await expect(page.getByLabel('Authenticated address')).toHaveText('none');
});
test('ARC03 a late Base session POST cannot publish an authoritative old identity', async ({ page }) => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let posts = 0;
  await page.route('**/api/chat/auth/session', async route => { posts++; await held; await route.fulfill({ json: { address, authenticated: true, provider: 'base', method: 'base-siwe' } }).catch(() => {}); });
  await open(page, 'mode=capability');
  await page.evaluate(() => { document.documentElement.dataset.sessionEvents = '0'; window.addEventListener('pixotchi:public-chat-session', () => { document.documentElement.dataset.sessionEvents = String(Number(document.documentElement.dataset.sessionEvents) + 1); }); });
  await page.getByRole('button', { name: 'Authenticate Base' }).click();
  await expect.poll(() => posts).toBe(1);
  await page.getByRole('button', { name: 'Invalidate sign-in' }).click(); release();
  await expect(page.getByLabel('Adapter status')).toContainText('no longer current');
  await expect(page.locator('html')).toHaveAttribute('data-session-events', '0');
  await expect(page.getByLabel('Authenticated address')).toHaveText('none');
});
test('ARC03 authenticated Privy hydration cannot undo a held identity cleanup', async ({ page }) => {
  await open(page, 'privy=1&owner=1');
  await expect(page.getByLabel('Expected address')).toHaveText(address);
  await page.getByRole('button', { name: 'Hold identity cleanup' }).click();
  await expect(page.getByLabel('Expected address')).toHaveText('none');
  await page.waitForTimeout(150);
  await expect(page.getByLabel('Expected address')).toHaveText('none');
  expect(await page.evaluate(() => localStorage.getItem('pixotchi:privyAuthAddress'))).toBe(null);
});
test('ARC05 rejected Base autologin settles busy state and leaves retry available', async ({ page }) => {
  await page.route('**/api/chat/auth/session', route => route.fulfill({ status: route.request().method() === 'POST' ? 403 : 401, json: { error: 'Sign-in service rejected' } }));
  await open(page, 'controller=1');
  await expect(page.getByLabel('Base error')).toHaveText('Sign-in service rejected');
  await expect(page.getByLabel('Base status')).toHaveText('idle');
  await expect(page.getByRole('button', { name: 'Connect again' })).toBeEnabled();
  await expect(page.getByLabel('Base identity')).toHaveText('none');
});
test('ARC03 an old Base signature cannot authenticate or disconnect a replacement owner', async ({ page }) => {
  let posts = 0;
  await page.route('**/api/chat/auth/session', route => { if (route.request().method() === 'POST') posts++; return route.fulfill({ status: 401, json: { error: 'No session' } }); });
  await open(page, 'controller=1&hold=1');
  await expect(page.getByLabel('Base owner')).toHaveText(address);
  await page.getByRole('button', { name: 'Switch owner' }).click();
  await page.getByRole('button', { name: 'Release signature' }).click();
  await expect(page.getByLabel('Base status')).toHaveText('idle');
  await expect(page.getByLabel('Base owner')).toHaveText('0x2222222222222222222222222222222222222222');
  expect(posts).toBe(0);
  await expect(page.getByLabel('Base identity')).toHaveText('none');
});
