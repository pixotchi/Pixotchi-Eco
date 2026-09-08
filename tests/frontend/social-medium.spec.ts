import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { activityDate, activityInteger, blackjackActivityOutcome } from '../../lib/activity-presentation';
import { BlackjackResult } from '../../public/abi/blackjack-abi';
import { parseActivityViewState } from '../../hooks/useActivityViewState';

const A = '0x1111111111111111111111111111111111111111';
const B = '0x2222222222222222222222222222222222222222';
let bundle: string;
let css: string;
test.beforeAll(async () => {
  const io = path.resolve('tests/frontend/fixtures/social-medium-io.tsx');
  const result = await build({ entryPoints: [path.resolve('tests/frontend/fixtures/social-medium.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_SHOW_AIRDROP': '"true"', 'process.env': '{}' }, plugins: [{ name: 'social-external-io', setup(builder) {
    builder.onResolve({ filter: /^(wagmi|next\/image|@privy-io\/react-auth|@\/components\/(solana|tutorial|hooks\/usePrimaryName)|@\/hooks\/(useItemCatalogs|useTokenMetadata)|@\/lib\/(frame-context|smart-wallet-context|tab-visibility-context|chat-auth-client|base-chat-session-refresh|farcaster-miniapp-auth-client|mission-tracking))$/ }, () => ({ path: io }));
    builder.onResolve({ filter: /(^|\/)contracts$/ }, () => ({ path: io }));
    builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/social-medium-dynamic.tsx') }));
    builder.onResolve({ filter: /^@\/lib\/broadcast-navigation$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/social-medium-broadcast-io.ts') }));
    builder.onResolve({ filter: /(chat-profile-dialog|ai-elements\/message)$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/social-medium-empty.tsx') }));
  } }] });
  bundle = result.outputFiles[0].text;
  // Exercise the application's actual Tailwind output for scroll, touch and viewport checks.
  const cssPath = path.resolve('app/globals.css');
  css = (await postcss([tailwind()]).process(await readFile(cssPath, 'utf8'), { from: cssPath })).css;
});

const event = (id: number, overrides: Record<string, unknown> = {}) => ({ id: String(id), __typename: 'Played', timestamp: String(Math.floor(Date.now() / 1000) - id), nftId: '1', nftName: `Plant ${id}`, gameName: 'Arcade', points: '1000000000000', ...overrides });
async function open(page: Page, scenario: string, query = '') {
  await page.route('http://social-medium.test/**', route => {
    const url = new URL(route.request().url());
    if (url.pathname === '/api/activity/recent' || url.pathname === '/api/activity/my') return route.fulfill({ json: { activities: Array.from({ length: 36 }, (_, index) => event(index + 1)), plantIds: ['1'], landIds: ['1'] } });
    if (url.pathname === '/api/chat/messages') return route.fulfill({ json: { messages: [] } });
    if (url.pathname === '/api/chat/ai/messages') return route.fulfill({ json: { messages: [], conversationId: route.request().headers()['x-fixture-owner'] ?? A } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.fulfill({ contentType: 'text/html', body: '<div id="root"></div>' });
  });
  await page.goto(`http://social-medium.test/?scenario=${scenario}&surface=base&${query}`);
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('[data-fixtures-ready=true]')).toBeVisible();
}

test('Activity retains independent feed pages across rotation, refresh and old deep links', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page, 'activity', 'activityView=my&activityPage=2&activityFilter=plants');
  const next = page.getByRole('button', { name: 'Next', exact: true });
  await expect(next).toHaveCount(2);
  await expect(page.getByText('2 / 3', { exact: true })).toHaveCount(1);
  const scrollers = page.locator('[data-activity-feed-scroll]');
  await scrollers.evaluateAll(nodes => nodes.forEach(node => { node.scrollTop = 150; }));
  const leftScroll = await scrollers.first().evaluate(node => node.scrollTop);
  await next.nth(1).click();
  await expect.poll(() => scrollers.nth(1).evaluate(node => node.scrollTop)).toBe(0);
  expect(await scrollers.first().evaluate(node => node.scrollTop)).toBe(leftScroll);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByText('3 / 3', { exact: true })).toBeVisible();
  await page.reload(); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await expect(page.getByText('3 / 3', { exact: true })).toBeVisible();
});

test('Activity failed refresh keeps cached rows and local retry restores success', async ({ page }) => {
  await page.clock.install();
  await open(page, 'activity');
  await expect(page.locator('[data-activity-record] summary').first()).toContainText('Plant #1');
  await page.route('**/api/activity/**', route => route.fulfill({ status: 503, json: {} }));
  await page.getByRole('button', { name: 'Hide Activity' }).click();
  await page.clock.fastForward(31_000);
  await page.getByRole('button', { name: 'Show Activity' }).click();
  await expect(page.getByText('Showing saved activity').first()).toBeVisible();
  await expect(page.locator('[data-activity-record] summary').first()).toContainText('Plant #1');
  await page.unroute('**/api/activity/**');
  await page.getByRole('button', { name: 'Retry activity' }).first().click();
  await expect(page.getByText('Showing saved activity')).toHaveCount(0);
});

test('Activity enum outcomes, malformed amounts/dates and long identities remain readable', async ({ page }) => {
  await open(page, 'activity');
  const entries = [
    event(1, { __typename: 'BlackjackResultEvent', landId: '1', player: A, bettingToken: A, payout: '1000000000000000000', result: BlackjackResult.PUSH }),
    event(2, { __typename: 'BlackjackResultEvent', landId: '1', player: A, bettingToken: A, payout: '500000000000000000', result: BlackjackResult.SURRENDERED }),
    event(3, { timestamp: 'broken', leafAmount: 'not-a-number', nftName: 'A'.repeat(300), points: '-1000000000000' }),
    event(4, { __typename: 'LandNameChangedEvent', tokenId: '1', name: 'Home' }),
    event(5, { nftName: { malformed: true } }),
    event(6, { nftName: 'A healthy entry' }),
  ];
  await page.route('**/api/activity/**', route => route.fulfill({ json: { activities: entries, plantIds: ['1'], landIds: ['1'] } }));
  await page.reload(); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await expect(page.locator('[data-activity-record] summary').first()).toBeVisible();
  await page.locator('[data-activity-record] summary').evaluateAll(nodes => nodes.forEach(node => (node as HTMLElement).click()));
  await expect(page.getByText(/and pushed/).first()).toBeVisible();
  await expect(page.getByText(/and surrendered/).first()).toBeVisible();
  await expect(page.getByText('Time unavailable').first()).toBeVisible();
  await expect(page.getByText('Some reward details are unavailable').first()).toBeVisible();
  await expect(page.getByText(/Land #1.*\(You\).*Home/).first()).toBeVisible();
  await expect(page.getByText(/This activity entry is temporarily unavailable/).first()).toBeVisible();
  await expect(page.getByText('A healthy entry', { exact: false }).first()).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('Chat exposes separate history failure and retry, retaining cached messages', async ({ page }) => {
  await open(page, 'chat');
  await expect(page.getByLabel('Chat ready')).toHaveText('true');
  await page.route('**/api/chat/messages?**', route => route.fulfill({ status: 503, json: {} }));
  await page.getByRole('button', { name: 'Open public pane' }).click();
  await expect(page.getByText('Messages unavailable')).toBeVisible();
  await page.unroute('**/api/chat/messages?**');
  await page.route('**/api/chat/messages?**', route => route.fulfill({ json: { messages: [{ id: '1', address: B, displayName: 'B', message: 'A saved public message', timestamp: Date.now() - 1000 }] } }));
  await page.getByTestId('chat-pane').getByRole('button', { name: /Retry/ }).click();
  await expect(page.getByTestId('chat-pane').getByText('A saved public message', { exact: true })).toBeVisible();
  await page.route('**/api/chat/messages?**', route => route.fulfill({ status: 503, json: {} }));
  await page.getByRole('button', { name: 'Refresh public' }).click();
  await expect(page.getByText(/Showing the last loaded conversation/)).toBeVisible();
  await expect(page.getByTestId('chat-pane').getByText('A saved public message', { exact: true })).toBeVisible();
});

test('Public unread advances only in the visible pane at its latest message', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('chat-last-read', '1'));
  await open(page, 'chat');
  await expect(page.getByLabel('Chat ready')).toHaveText('true');
  let rows = Array.from({ length: 30 }, (_, index) => ({ id: String(index), address: B, displayName: 'B', message: `Public message ${index}`, timestamp: Date.now() - 5000 + index }));
  await page.route('**/api/chat/messages?**', route => route.fulfill({ json: { messages: rows } }));
  await page.getByRole('button', { name: 'Refresh public' }).click();
  await expect(page.getByLabel('Unread')).toHaveText('30');
  await page.getByRole('button', { name: 'Open AI pane' }).click();
  await expect(page.getByLabel('Unread')).toHaveText('30');
  await page.getByRole('button', { name: 'Open public pane' }).click();
  await expect(page.getByLabel('Unread')).toHaveText('0');
  const scroller = page.getByTestId('chat-pane').locator('.surface-scroll-fade');
  await scroller.evaluate(node => { node.scrollTop = 0; node.dispatchEvent(new Event('scroll')); });
  rows = [...rows, { id: '31', address: B, displayName: 'B', message: 'New while scrolled up', timestamp: Date.now() }];
  await page.getByRole('button', { name: 'Refresh public' }).click();
  await expect(page.getByLabel('Unread')).toHaveText('1');
  await scroller.evaluate(node => { node.scrollTop = node.scrollHeight; node.dispatchEvent(new Event('scroll')); });
  await expect(page.getByLabel('Unread')).toHaveText('0');
  // A small conversation can remain fully visible during a touch hold. Ending
  // the hold must reconcile read state even if the browser emits no scroll.
  rows = rows.slice(-1);
  await page.getByRole('button', { name: 'Refresh public' }).click();
  await scroller.dispatchEvent('touchstart');
  rows = [...rows, { id: '32', address: B, displayName: 'B', message: 'Visible during touch hold', timestamp: Date.now() }];
  await page.getByRole('button', { name: 'Refresh public' }).click();
  await expect(page.getByLabel('Unread')).toHaveText('1');
  await scroller.dispatchEvent('touchend');
  await expect(page.getByLabel('Unread')).toHaveText('0');
});

test('Wallet change fences pending private history and stops the AI send runtime', async ({ page }) => {
  await open(page, 'chat');
  await expect(page.getByLabel('Chat ready')).toHaveText('true');
  let finishHistory: (() => Promise<void>) | undefined;
  await page.route('**/api/chat/ai/messages?**', route => {
    if (route.request().headers()['x-fixture-owner'] === A) { finishHistory = () => route.fulfill({ json: { conversationId: A, messages: [{ id: 'old', address: A, displayName: 'You', message: 'Private history A', timestamp: Date.now(), type: 'user', conversationId: A, model: 'fixture' }] } }); return; }
    return route.fulfill({ json: { conversationId: B, messages: [] } });
  });
  let finishSend: (() => Promise<void>) | undefined;
  await page.route('**/api/chat/ai/send', route => { finishSend = () => route.fulfill({ status: 500, body: 'Old stream failure' }); });
  await page.getByRole('button', { name: 'Open AI pane' }).click();
  await expect.poll(() => Boolean(finishHistory)).toBe(true);
  await page.getByRole('button', { name: 'Ask AI' }).click();
  await expect.poll(() => Boolean(finishSend)).toBe(true);
  await page.getByRole('button', { name: 'Wallet B', exact: true }).click();
  await expect(page.getByLabel('Chat ready')).toHaveText('true');
  await finishHistory!().catch(() => {}); await finishSend!().catch(() => {});
  await expect(page.getByLabel('AI messages')).toHaveText('');
  await expect(page.getByText('Old stream failure')).toHaveCount(0);
});

test('AI send supersedes an older history snapshot for the same wallet', async ({ page }) => {
  await open(page, 'chat');
  await expect(page.getByLabel('Chat ready')).toHaveText('true');
  await page.getByRole('button', { name: 'Open AI pane' }).click();
  await expect(page.getByText('Ask Neural Seed!', { exact: true })).toBeVisible();
  let finishHistory: (() => Promise<void>) | undefined;
  await page.route('**/api/chat/ai/messages?**', route => { finishHistory = () => route.fulfill({ json: { conversationId: A, messages: [] } }); });
  let finishSend: (() => Promise<void>) | undefined;
  await page.route('**/api/chat/ai/send', route => { finishSend = () => route.fulfill({ status: 500, body: 'Fixture send failure' }); });
  await page.getByRole('button', { name: 'Refresh AI' }).click();
  await expect.poll(() => Boolean(finishHistory)).toBe(true);
  await page.getByRole('button', { name: 'Ask AI' }).click();
  await expect.poll(() => Boolean(finishSend)).toBe(true);
  await expect(page.getByLabel('AI messages')).toHaveText('A private question');
  await finishHistory!().catch(() => {});
  await expect(page.getByLabel('AI messages')).toHaveText('A private question');
  await finishSend!();
});

test('Manual chat recovery cannot clear a newly connected wallet session', async ({ page }) => {
  await open(page, 'chat');
  await expect(page.getByLabel('Chat ready')).toHaveText('true');
  await page.getByRole('button', { name: 'Retry chat session' }).click();
  await expect(page.getByLabel('Chat recoveries')).toHaveText('1');
  await page.getByRole('button', { name: 'Wallet B', exact: true }).click();
  await expect(page.getByLabel('Chat ready')).toHaveText('true');
  await page.getByRole('button', { name: 'Fail recovery' }).click();
  await expect(page.getByLabel('Chat ready')).toHaveText('true');
  await expect(page.getByLabel('Chat state')).toHaveText('ready');
});

test('Final automatic chat recovery exits loading when the asynchronous refresh fails', async ({ page }) => {
  await page.clock.install();
  await page.addInitScript(address => localStorage.setItem('pixotchi:baseAuthAddress', address), A);
  await open(page, 'chat', 'missingForA=1');
  await expect(page.getByLabel('Chat state')).toHaveText('error');
  await expect.poll(async () => {
    await page.clock.fastForward(1000);
    return page.getByLabel('Chat recoveries').textContent();
  }, { timeout: 15_000 }).toBe('1');
  await expect(page.getByLabel('Chat restoring')).toHaveText('true');
  await page.getByRole('button', { name: 'Fail recovery' }).click();
  await expect(page.getByLabel('Chat restoring')).toHaveText('false');
  await expect(page.getByLabel('Chat state')).toHaveText('error');
});

test('Feedback validates length and preserves edits made during submission', async ({ page }) => {
  await open(page, 'feedback');
  let finish: (() => Promise<void>) | undefined;
  await page.route('**/api/feedback/submit', route => { finish = () => route.fulfill({ json: { success: true } }); });
  await page.getByRole('button', { name: 'Open feedback dialog' }).click();
  const input = page.getByRole('textbox');
  await expect(input).toHaveAttribute('maxlength', '1000');
  await input.fill('short');
  await expect(page.getByRole('button', { name: 'Send Feedback' })).toBeDisabled();
  await input.fill('A useful feedback report');
  await page.getByRole('button', { name: 'Send Feedback' }).click();
  await expect.poll(() => Boolean(finish)).toBe(true);
  await input.fill('A useful feedback report with more detail');
  await finish!();
  await expect(input).toHaveValue('A useful feedback report with more detail');
  await expect(page.getByRole('dialog')).toBeVisible();
});

test('Feedback failure cannot attach itself to a reopened, edited draft', async ({ page }) => {
  await open(page, 'feedback');
  let finish: (() => Promise<void>) | undefined;
  await page.route('**/api/feedback/submit', route => { finish = () => route.fulfill({ status: 503, json: { error: 'Old report failed' } }); });
  await page.getByRole('button', { name: 'Open feedback dialog' }).click();
  await page.getByRole('textbox').fill('First feedback report');
  await page.getByRole('button', { name: 'Send Feedback' }).click();
  await expect.poll(() => Boolean(finish)).toBe(true);
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await page.getByRole('button', { name: 'Open feedback dialog' }).click();
  await page.getByRole('textbox').fill('New feedback report');
  await finish!();
  await expect(page.getByRole('textbox')).toHaveValue('New feedback report');
  await expect(page.getByText('Old report failed')).toHaveCount(0);
});

test('Verify review retains recovery details on failed status refresh', async ({ page }) => {
  await open(page, 'claim');
  await page.route('**/api/verify/status?**', route => route.fulfill({ json: { claimState: 'manual_review', claimData: { reservationId: 'claim-fixture-reference' } } }));
  await page.reload(); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await expect(page.getByText('Claim needs review')).toBeVisible();
  await expect(page.getByText('claim-fixture-reference')).toBeVisible();
  await expect(page.getByRole('link', { name: 'Open community support' })).toHaveAttribute('href', 'https://t.me/pixotchi');
  await page.route('**/api/verify/status?**', route => route.fulfill({ status: 503, json: {} }));
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByText('claim-fixture-reference')).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('latest status check failed');
});

test('Broadcast replacement resets timed exit and blocked link offers retry', async ({ page }) => {
  await page.clock.install();
  await open(page, 'overlay');
  await page.getByRole('button', { name: 'Open broadcast', exact: true }).click();
  await expect(page.getByText(/available in 15 seconds/)).toBeVisible();
  await page.clock.fastForward(15_000);
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Replace broadcast', includeHidden: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('button', { name: 'Continue', exact: true })).toHaveCount(0);
  await expect(page.getByText(/available in 15 seconds/)).toBeVisible();
  await page.evaluate(() => { window.open = () => null; });
  await page.getByRole('button', { name: 'Read announcement' }).click();
  await expect(page.getByRole('alert')).toContainText('Could not open this link');
});

test('An old broadcast action cannot dismiss a new presentation of the same message', async ({ page }) => {
  await open(page, 'overlay', 'slowBroadcast=1');
  await page.getByRole('button', { name: 'Open broadcast', exact: true }).click();
  await page.getByRole('button', { name: 'Read announcement' }).click();
  await expect(page.getByRole('button', { name: 'Read announcement' })).toBeDisabled();
  await page.getByRole('button', { name: 'Replace broadcast', includeHidden: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('dialog')).toContainText('Announcement second');
  await page.getByRole('button', { name: 'Open broadcast', exact: true, includeHidden: true }).evaluate((button: HTMLButtonElement) => button.click());
  await expect(page.getByRole('dialog')).toContainText('Announcement first');
  await page.evaluate(() => window.dispatchEvent(new Event('fixture:resolve-broadcast')));
  await expect(page.getByRole('dialog')).toContainText('Announcement first');
  await expect(page.getByRole('button', { name: 'Read announcement' })).toBeEnabled();
});

test('Airdrop exposes confirmed transaction and does not request an old-wallet signature', async ({ page }) => {
  await open(page, 'airdrop');
  const allocation = { eligible: true, seed: '1000000000000000000', leaf: '0', pixotchi: '0', claimed: false, status: 'eligible' };
  await page.route('**/api/airdrop/status?**', route => route.fulfill({ json: allocation }));
  await page.reload(); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  let finish: (() => Promise<void>) | undefined;
  await page.route('**/api/airdrop/claim?**', route => { finish = () => route.fulfill({ json: { message: 'Wallet A claim message', timestamp: Date.now() } }); });
  await page.getByRole('button', { name: 'Claim Airdrop' }).click();
  await expect.poll(() => Boolean(finish)).toBe(true);
  await page.getByRole('button', { name: 'Wallet B', exact: true }).click();
  await page.getByRole('button', { name: 'Wallet A', exact: true }).click();
  await finish!();
  await expect(page.getByLabel('Fixture signatures')).toHaveText('0');
  const tx = `0x${'a'.repeat(64)}`;
  await page.route('**/api/airdrop/status?**', route => route.fulfill({ json: { ...allocation, seed: '0', claimed: true, status: 'claimed', txHash: tx } }));
  await page.reload(); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await expect(page.getByRole('link', { name: 'View transaction' })).toHaveAttribute('href', `https://basescan.org/tx/${tx}`);
});

test('Airdrop failed submission reconciles to review with the original claim reference', async ({ page }) => {
  await open(page, 'airdrop');
  const allocation = { eligible: true, seed: '1000000000000000000', leaf: '0', pixotchi: '0', claimed: false, status: 'eligible' };
  let posted = false;
  let failStatus = false;
  let finishStatus: (() => Promise<void>) | undefined;
  await page.route('**/api/airdrop/status?**', route => {
    if (failStatus) return route.fulfill({ status: 503, json: {} });
    if (posted) { finishStatus = () => route.fulfill({ json: { ...allocation, status: 'failed', attemptId: 'attempt-original', operationId: 'operation-original' } }); return; }
    return route.fulfill({ json: allocation });
  });
  await page.route('**/api/airdrop/claim?**', route => route.fulfill({ json: { message: 'Claim fixture', timestamp: Date.now() } }));
  await page.route('**/api/airdrop/claim', route => { posted = true; return route.fulfill({ status: 500, json: { error: 'Transfer transaction failed' } }); });
  await page.reload(); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Claim Airdrop' }).click();
  await expect.poll(() => Boolean(finishStatus)).toBe(true);
  await expect(page.getByText('Checking your claim outcome')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Claim Airdrop' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Checking status…' })).toBeDisabled();
  await finishStatus!();
  await expect(page.getByText('Claim needs review')).toBeVisible();
  await expect(page.getByText('operation-original', { exact: true })).toBeVisible();
  await expect(page.getByText(A, { exact: true })).toBeVisible();
  failStatus = true;
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be checked');
  await expect(page.getByText('operation-original', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Claim Airdrop' })).toHaveCount(0);
  await expect(page.getByLabel('Fixture signatures')).toHaveText('1');
});

test('Airdrop interrupted submission stays gated through failed reconciliation and retries status only', async ({ page }) => {
  await open(page, 'airdrop');
  const allocation = { eligible: true, seed: '1000000000000000000', leaf: '0', pixotchi: '0', claimed: false, status: 'eligible' };
  let posts = 0;
  let statusMode: 'eligible' | 'error' | 'malformed' | 'claimed' = 'eligible';
  const tx = `0x${'b'.repeat(64)}`;
  await page.route('**/api/airdrop/status?**', route => statusMode === 'error'
    ? route.fulfill({ status: 503, json: {} })
    : route.fulfill({ json: statusMode === 'malformed' ? { eligible: true } : statusMode === 'claimed' ? { ...allocation, claimed: true, status: 'claimed', txHash: tx } : allocation }));
  await page.route('**/api/airdrop/claim?**', route => route.fulfill({ json: { message: 'Claim fixture', timestamp: Date.now() } }));
  await page.route('**/api/airdrop/claim', route => { posts += 1; statusMode = 'error'; return route.abort('failed'); });
  await page.reload(); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Claim Airdrop' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be checked');
  await expect(page.getByText('Checking your claim outcome')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Claim Airdrop' })).toHaveCount(0);
  statusMode = 'malformed';
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByRole('alert')).toContainText('could not be checked');
  await expect(page.getByRole('button', { name: 'Claim Airdrop' })).toHaveCount(0);
  statusMode = 'claimed';
  await page.getByRole('button', { name: 'Check status' }).click();
  await expect(page.getByRole('link', { name: 'View transaction' })).toHaveAttribute('href', `https://basescan.org/tx/${tx}`);
  await expect(page.getByLabel('Fixture signatures')).toHaveText('1');
  expect(posts).toBe(1);
});

test('Airdrop reconciliation cannot replace another wallet after an interrupted submission', async ({ page }) => {
  await open(page, 'airdrop');
  const allocation = { eligible: true, seed: '1000000000000000000', leaf: '0', pixotchi: '0', claimed: false, status: 'eligible' };
  let posted = false;
  let finishStatus: (() => Promise<void>) | undefined;
  await page.route('**/api/airdrop/status?**', route => {
    if (posted && new URL(route.request().url()).searchParams.get('address')?.toLowerCase() === A) {
      finishStatus = () => route.fulfill({ json: { ...allocation, status: 'failed', operationId: 'old-wallet-reference' } }); return;
    }
    return route.fulfill({ json: allocation });
  });
  await page.route('**/api/airdrop/claim?**', route => route.fulfill({ json: { message: 'Claim fixture', timestamp: Date.now() } }));
  await page.route('**/api/airdrop/claim', route => { posted = true; return route.abort('failed'); });
  await page.reload(); await page.addStyleTag({ content: css }); await page.addScriptTag({ content: bundle });
  await page.getByRole('button', { name: 'Claim Airdrop' }).click();
  await expect.poll(() => Boolean(finishStatus)).toBe(true);
  await page.getByRole('button', { name: 'Wallet B', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Claim Airdrop' })).toBeEnabled();
  await finishStatus!();
  await expect(page.getByRole('button', { name: 'Claim Airdrop' })).toBeEnabled();
  await expect(page.getByText('old-wallet-reference', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Claim needs review')).toHaveCount(0);
});

for (const performance of [false, true]) {
test(`Secret Garden binds first-touch reveal and keeps return reachable in landscape (performance=${performance})`, async ({ browser }, testInfo) => {
  const context = await browser.newContext({ hasTouch: true, viewport: { width: 844, height: 390 }, reducedMotion: 'reduce' });
  const page = await context.newPage();
  if (performance) await page.addInitScript(() => localStorage.setItem('pixotchi:performance-mode', '1'));
  await open(page, 'overlay');
  await page.getByRole('button', { name: 'Open Secret Garden' }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  const pixel = page.locator('[data-pixel=true]').nth(220);
  await pixel.dispatchEvent('pointerdown', { pointerId: 1, pointerType: 'touch', isPrimary: true, clientX: (await pixel.boundingBox())!.x + 1, clientY: (await pixel.boundingBox())!.y + 1 });
  await expect(page.locator('[data-hover=true]')).toHaveCount(1);
  await pixel.dispatchEvent('pointercancel', { pointerId: 1, pointerType: 'touch' });
  await expect(page.locator('[data-hover=true]')).toHaveCount(0);
  const returnButton = dialog.getByRole('button');
  await page.evaluate(() => document.documentElement.style.fontSize = '200%');
  await returnButton.scrollIntoViewIfNeeded();
  const bounds = (await returnButton.boundingBox())!;
  expect(bounds.y).toBeGreaterThanOrEqual(0); expect(bounds.y + bounds.height).toBeLessThanOrEqual(390);
  await page.screenshot({ path: testInfo.outputPath('secret-garden-landscape-200.png') });
  await returnButton.click(); await expect(dialog).toHaveCount(0);
  await page.getByRole('button', { name: 'Open Secret Garden' }).click();
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Return to the farm' }).click();
  await expect(dialog).toHaveCount(0);
  await context.close();
});
}

test('Activity parsing rejects invalid data and preserves every enum distinction', () => {
  for (const value of ['', 'broken', '1.5', null, {}, Number.MAX_SAFE_INTEGER + 1]) expect(activityInteger(value)).toBeNull();
  for (const value of ['', 'broken', Infinity, '1e99', -1]) expect(activityDate(value)).toBeNull();
  expect(activityInteger('1000000000000000000')).toBe(BigInt('1000000000000000000'));
  expect(blackjackActivityOutcome(BlackjackResult.PUSH)).toEqual({ label: 'pushed', won: false });
  expect(blackjackActivityOutcome(BlackjackResult.SURRENDERED)).toEqual({ label: 'surrendered', won: false });
  const state = parseActivityViewState(null, new URLSearchParams('activityView=my&activityPage=3&activityFilter=attacks&activityDirection=incoming'));
  expect(state.my).toEqual({ page: 3, category: 'attacks', direction: 'incoming' });
  expect(parseActivityViewState(JSON.stringify(state))).toEqual(state);
});
