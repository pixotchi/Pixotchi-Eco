import { expect, test, type Page } from '@playwright/test';
import { build } from 'esbuild';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { getActivityHeadline, getActivityIcon } from '../../lib/activity-metadata';
import { PLANT_ART_MAP } from '../../lib/constants';

const A = '0x1111111111111111111111111111111111111111';
let bundle: string;
let css: string;
test.beforeAll(async () => {
  const io = path.resolve('tests/frontend/fixtures/social-low-io.tsx');
  const result = await build({ entryPoints: [path.resolve('tests/frontend/fixtures/social-low.tsx')], bundle: true, write: false, platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_SHOW_AIRDROP': '"false"', 'process.env.NEXT_PUBLIC_VERIFY_CLAIM_ENABLED': '"false"', 'process.env': '{}' }, plugins: [{ name: 'social-low-external-io', setup(builder) {
    builder.onResolve({ filter: /^(wagmi|next\/image|@privy-io\/react-auth(?:\/solana)?|@\/components\/(solana|tutorial|hooks\/usePrimaryName)|@\/hooks\/(useAuthSurface|useItemCatalogs|useTokenMetadata)|@\/lib\/(frame-context|smart-wallet-context|tab-visibility-context|chat-auth-client|base-chat-session-refresh|farcaster-miniapp-auth-client|mission-tracking|eth-mode-context|balance-context))$/ }, () => ({ path: io }));
    builder.onResolve({ filter: /(^|\/)contracts$/ }, () => ({ path: io }));
    builder.onResolve({ filter: /staking\/staking-provider$/ }, () => ({ path: io }));
    builder.onResolve({ filter: /^next\/dynamic$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/social-medium-dynamic.tsx') }));
    builder.onResolve({ filter: /(chat-profile-dialog|balance-card|transactions\/transfer-assets-dialog)$/ }, () => ({ path: path.resolve('tests/frontend/fixtures/social-medium-empty.tsx') }));
  } }] });
  bundle = result.outputFiles[0].text;
  const cssPath = path.resolve('app/globals.css');
  css = (await postcss([tailwind()]).process(await readFile(cssPath, 'utf8'), { from: cssPath })).css;
  for (const [family, weight, asset] of [
    ['CoinbaseFixture', '400', 'fonts/Coinbase-Sans/Coinbase_Sans-Regular-web-1.32.woff2'],
    ['CoinbaseFixture', '500', 'fonts/Coinbase-Sans/Coinbase_Sans-Medium-web-1.32.woff2'],
    ['CoinbaseFixture', '700', 'fonts/Coinbase-Sans/Coinbase_Sans-Bold-web-1.32.woff2'],
    ['PixelFixture', '400', 'fonts/pixelmix.woff2'],
  ]) css += `@font-face { font-family: ${family}; font-weight: ${weight}; src: url(data:font/woff2;base64,${(await readFile(path.resolve('public', asset))).toString('base64')}) format('woff2'); }`;
  css += ':root { --font-coinbase: CoinbaseFixture, system-ui; --font-pixel: PixelFixture, monospace; }';
});

async function open(page: Page, scenario: string) {
  await page.route('https://social-low.test/**', async route => {
    const url = new URL(route.request().url());
    if (/^\/(icons|PixotchiKit)\/[\w./-]+\.(svg|png|webp)$/i.test(url.pathname) && !url.pathname.includes('..')) {
      const contentType = url.pathname.endsWith('.svg') ? 'image/svg+xml' : url.pathname.endsWith('.webp') ? 'image/webp' : 'image/png';
      return route.fulfill({ contentType, body: await readFile(path.resolve('public', `.${url.pathname}`)) });
    }
    if (url.pathname === '/api/chat/messages') return route.fulfill({ json: { messages: [] } });
    if (url.pathname === '/api/chat/ai/messages') return route.fulfill({ json: { messages: [], conversationId: A } });
    if (url.pathname.startsWith('/api/')) return route.fulfill({ json: {} });
    return route.fulfill({ contentType: 'text/html', body: '<html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><div id="root"></div></body></html>' });
  });
  await page.goto(`https://social-low.test/?scenario=${scenario}&surface=base`);
  await page.evaluate(() => document.documentElement.classList.add(matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
  await page.addStyleTag({ content: css });
  await page.addScriptTag({ content: bundle });
  await expect(page.locator('[data-low-ready]')).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
}

test('parallel panes retain their own sending locks and isolate header/public updates from AI', async ({ page }) => {
  await open(page, 'chat');
  await expect(page.getByLabel('public ready')).toHaveText('true');
  await page.getByRole('button', { name: 'Open chat' }).click();
  let finishPublic: (() => Promise<void>) | undefined;
  let finishAI: (() => Promise<void>) | undefined;
  let publicRequests = 0;
  await page.route('**/api/chat/send', route => { publicRequests += 1; finishPublic = () => route.fulfill({ json: { message: { id: 'accepted-public', address: A, displayName: 'You', message: 'A public draft', timestamp: Date.now() } } }); });
  await page.route('**/api/chat/ai/send', route => { finishAI = () => route.fulfill({ status: 500, body: 'AI fixture failure' }); });
  await page.getByRole('textbox', { name: 'Type a chat message' }).fill('A public draft');
  await page.getByRole('button', { name: 'Send chat message', exact: true }).click();
  await expect.poll(() => Boolean(finishPublic)).toBe(true);
  await expect(page.getByLabel('public sending')).toHaveText('true');
  const headerRenders = await page.getByLabel('Header renders').textContent();
  const publicRenders = await page.getByLabel('public renders').textContent();
  await page.getByRole('textbox', { name: 'Ask Neural Seed a question' }).fill('A private draft');
  await page.getByRole('button', { name: 'Send question to Neural Seed' }).click();
  await expect.poll(() => Boolean(finishAI)).toBe(true);
  await expect(page.getByLabel('Header renders')).toHaveText(headerRenders!);
  await expect(page.getByLabel('public renders')).toHaveText(publicRenders!);
  await finishAI!();
  await expect(page.getByLabel('ai sending')).toHaveText('false');
  await expect(page.getByLabel('public sending')).toHaveText('true');
  await page.getByRole('button', { name: 'Duplicate public send' }).click();
  expect(publicRequests).toBe(1);
  await expect(page.getByRole('textbox', { name: 'Type a chat message' })).toBeDisabled();
  await finishPublic!();
  await expect(page.getByLabel('public sending')).toHaveText('false');
  await expect(page.getByRole('textbox', { name: 'Type a chat message' })).toHaveValue('');
  await expect(page.getByRole('textbox', { name: 'Ask Neural Seed a question' })).toHaveValue('A private draft');
});

test('public completion leaves AI cancellable and its draft intact', async ({ page }) => {
  await open(page, 'chat');
  await expect(page.getByLabel('public ready')).toHaveText('true');
  await page.getByRole('button', { name: 'Open chat' }).click();
  let aiStarted = false;
  await page.route('**/api/chat/ai/send', () => { aiStarted = true; });
  await page.route('**/api/chat/send', route => route.fulfill({ json: { message: { id: 'accepted', address: A, displayName: 'You', message: 'Public', timestamp: Date.now() } } }));
  await page.getByRole('textbox', { name: 'Ask Neural Seed a question' }).fill('Private');
  await page.getByRole('button', { name: 'Send question to Neural Seed' }).click();
  await expect.poll(() => aiStarted).toBe(true);
  await page.getByRole('textbox', { name: 'Type a chat message' }).fill('Public');
  await page.getByRole('button', { name: 'Send chat message', exact: true }).click();
  await expect(page.getByLabel('public sending')).toHaveText('false');
  await expect(page.getByLabel('ai sending')).toHaveText('true');
  await page.getByRole('button', { name: 'Stop Neural Seed response' }).click();
  await expect(page.getByLabel('ai sending')).toHaveText('false');
  await expect(page.getByRole('textbox', { name: 'Ask Neural Seed a question' })).toHaveValue('Private');
});

test('streaming chunks and a new AI conversation do not rerender composers or abort a pending public send', async ({ page }) => {
  await open(page, 'chat');
  await expect(page.getByLabel('public ready')).toHaveText('true');
  await page.getByRole('button', { name: 'Open chat' }).click();
  let finishPublic: (() => Promise<void>) | undefined;
  await page.route('**/api/chat/send', route => { finishPublic = () => route.fulfill({ json: { message: { id: 'accepted-public', address: A, displayName: 'You', message: 'Public survives', timestamp: Date.now() } } }); });
  await page.evaluate(() => {
    const originalFetch = window.fetch;
    window.fetch = (input, init) => {
      if (String(input).includes('/api/chat/ai/send')) return Promise.resolve(new Response(new ReadableStream<Uint8Array>({ start(controller) {
        Object.assign(window, { pushAIChunk: (part: unknown) => controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(part)}\n\n`)), finishAIStream: () => controller.close() });
      } }), { headers: { 'Content-Type': 'text/event-stream', 'x-vercel-ai-ui-message-stream': 'v1' } }));
      return originalFetch(input, init);
    };
  });
  const push = (part: unknown) => page.evaluate(value => {
    if (!('pushAIChunk' in window) || typeof window.pushAIChunk !== 'function') throw new Error('AI transport has not started');
    window.pushAIChunk(value);
  }, part);
  await page.getByRole('textbox', { name: 'Type a chat message' }).fill('Public survives');
  await page.getByRole('button', { name: 'Send chat message', exact: true }).click();
  await expect.poll(() => Boolean(finishPublic)).toBe(true);
  await page.getByRole('textbox', { name: 'Ask Neural Seed a question' }).fill('Private question');
  await page.getByRole('button', { name: 'Send question to Neural Seed' }).click();
  await expect.poll(() => page.evaluate(() => 'pushAIChunk' in window)).toBe(true);
  await push({ type: 'start', messageId: 'assistant', messageMetadata: { conversationId: 'new-conversation' } });
  await push({ type: 'text-start', id: 'answer' });
  await push({ type: 'text-delta', id: 'answer', delta: 'First' });
  await expect(page.getByLabel('ai messages')).toContainText('First');
  await expect(page.getByLabel('Conversation id')).toHaveText('new-conversation');
  await expect(page.getByLabel('public sending')).toHaveText('true');
  const commits = await page.locator('#ai-composer').getAttribute('data-commits');
  const header = await page.getByLabel('Header renders').textContent();
  await push({ type: 'text-delta', id: 'answer', delta: ' second' });
  await expect(page.getByLabel('ai messages')).toContainText('First second');
  await expect(page.locator('#ai-composer')).toHaveAttribute('data-commits', commits!);
  await expect(page.getByLabel('Header renders')).toHaveText(header!);
  await finishPublic!();
  await expect(page.getByLabel('public sending')).toHaveText('false');
  await expect(page.getByLabel('public messages')).toHaveText('Public survives');
  await push({ type: 'text-end', id: 'answer' });
  await push({ type: 'finish', finishReason: 'stop' });
  await page.evaluate(() => {
    if (!('finishAIStream' in window) || typeof window.finishAIStream !== 'function') throw new Error('AI transport has not started');
    window.finishAIStream();
  });
  await expect(page.getByLabel('ai sending')).toHaveText('false');
});

test('accepted public send survives an older history result and releases its read gate', async ({ page }) => {
  await open(page, 'chat');
  await expect(page.getByLabel('public ready')).toHaveText('true');
  await page.getByRole('button', { name: 'Open chat' }).click();
  await expect(page.getByLabel('public loading')).toHaveText('false');
  let finishHistory: (() => Promise<void>) | undefined;
  await page.route('**/api/chat/messages?**', route => { finishHistory = () => route.fulfill({ json: { messages: [] } }); });
  await page.getByRole('button', { name: 'Refresh public history' }).click();
  await expect.poll(() => Boolean(finishHistory)).toBe(true);
  const message = { id: 'accepted-new', address: A, displayName: 'You', message: 'Newer accepted message', timestamp: Date.now() };
  await page.route('**/api/chat/send', route => route.fulfill({ json: { message } }));
  await page.getByRole('textbox', { name: 'Type a chat message' }).fill(message.message);
  await page.getByRole('button', { name: 'Send chat message', exact: true }).click();
  await expect(page.getByLabel('public sending')).toHaveText('false');
  await finishHistory!();
  await expect(page.getByLabel('public messages')).toHaveText(message.message);
  await expect(page.getByLabel('public loading')).toHaveText('false');
  await page.route('**/api/chat/messages?**', route => route.fulfill({ json: { messages: [message] } }));
  await page.getByRole('button', { name: 'Refresh public history' }).click();
  await expect(page.getByLabel('public loading')).toHaveText('false');
  await expect(page.getByLabel('public messages')).toHaveText(message.message);
});

test('public POST reconciles an accepted server echo already delivered by history once', async ({ page }) => {
  await open(page, 'chat');
  await expect(page.getByLabel('public ready')).toHaveText('true');
  await page.getByRole('button', { name: 'Open chat' }).click();
  await expect(page.getByLabel('public loading')).toHaveText('false');
  const message = { id: 'same-server-id', address: A, displayName: 'You', message: 'One accepted message', timestamp: Date.now() };
  let finishPublic: (() => Promise<void>) | undefined;
  await page.route('**/api/chat/send', route => { finishPublic = () => route.fulfill({ json: { message } }); });
  await page.getByRole('textbox', { name: 'Type a chat message' }).fill(message.message);
  await page.getByRole('button', { name: 'Send chat message', exact: true }).click();
  await expect.poll(() => Boolean(finishPublic)).toBe(true);
  await page.route('**/api/chat/messages?**', route => route.fulfill({ json: { messages: [message] } }));
  await page.getByRole('button', { name: 'Refresh public history' }).click();
  await expect(page.getByLabel('public loading')).toHaveText('false');
  await expect(page.getByLabel('public messages')).toHaveText(`${message.message}|${message.message}`);
  await finishPublic!();
  await expect(page.getByLabel('public sending')).toHaveText('false');
  await expect(page.getByLabel('public messages')).toHaveText(message.message);
});

test('Stop during AI credential preflight settles only that attempt and never dispatches its delayed question', async ({ page }) => {
  await open(page, 'chat');
  await expect(page.getByLabel('public ready')).toHaveText('true');
  await page.getByRole('button', { name: 'Open chat' }).click();
  await expect(page.getByLabel('public loading')).toHaveText('false');
  let requests = 0;
  await page.route('**/api/chat/ai/send', route => { requests += 1; return route.fulfill({ status: 500, body: 'Unexpected delayed dispatch' }); });
  await page.getByRole('button', { name: 'Delay next credential check' }).click();
  await page.getByRole('textbox', { name: 'Ask Neural Seed a question' }).fill('Do not send after Stop');
  await page.getByRole('button', { name: 'Send question to Neural Seed' }).click();
  await page.getByRole('button', { name: 'Stop Neural Seed response' }).click();
  await expect(page.getByLabel('ai sending')).toHaveText('false');
  await page.getByRole('button', { name: 'Finish credential check' }).click();
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(requests).toBe(0);
  await expect(page.getByRole('textbox', { name: 'Ask Neural Seed a question' })).toHaveValue('Do not send after Stop');
});

test('disabled claim capabilities do not mount eligibility readers', async ({ page }) => {
  let reads = 0;
  page.on('request', request => { if (/\/api\/(airdrop|verify)\//.test(request.url())) reads += 1; });
  await open(page, 'hidden-claims');
  await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))));
  expect(reads).toBe(0);
  await expect(page.getByRole('button')).toHaveCount(0);
});

test('unchanged markdown text still receives changed classes and renderer configuration', async ({ page }) => {
  await open(page, 'message');
  await expect(page.locator('.original-message')).toContainText('Unchanged message text');
  await page.getByRole('button', { name: 'Update markdown configuration' }).click();
  await expect(page.locator('.updated-message [data-updated-markdown=true]')).toHaveText('Unchanged message text');
});

test('Activity shows concise outcomes and keyboard-accessible complete details at enlarged text', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 320, height: 568 });
  await open(page, 'activity');
  const records = page.locator('[data-activity-record]');
  await expect(records).toHaveCount(5);
  const summary = records.first().locator('summary');
  await expect(summary).toContainText('1,290 PTS to Plant #42');
  await expect(summary).toContainText('Land #1112');
  const fourth = await records.nth(3).boundingBox();
  expect(fourth!.y + fourth!.height).toBeLessThan(568);
  await expect(page.getByRole('link', { name: 'View block', includeHidden: true })).toHaveCount(0);
  await summary.focus(); await page.keyboard.press('Enter');
  await expect(page.getByRole('link', { name: 'View block', includeHidden: true })).toHaveCount(0);
  const expandedDetails = records.first().getByText('from its warehouse to Plant #42', { exact: false });
  await expect(expandedDetails).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('activity-320-expanded.png') });
  await page.addStyleTag({ content: 'html { font-size: 200%; }' });
  await records.last().locator('summary').click();
  await expect(records.last()).toContainText('Some reward details are unavailable');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expandedDetails.scrollIntoViewIfNeeded();
  await expect(expandedDetails).toBeInViewport();
  await page.screenshot({ path: testInfo.outputPath('activity-320-text-200.png') });
});

test('ranking shares filter transitions and visible units across widths', async ({ page }, testInfo) => {
  await open(page, 'ranking');
  await expect(page.getByLabel('Filter state')).toHaveText('all:true');
  await page.getByRole('radio', { name: 'Attackable', exact: true }).click();
  await expect(page.getByLabel('Filter state')).toHaveText('attackable:false');
  await expect(page.getByRole('checkbox', { name: 'My Plants' })).toHaveCount(0);
  await page.getByRole('radio', { name: 'Dead', exact: true }).click();
  await page.getByRole('checkbox', { name: 'My Plants' }).check();
  await expect(page.getByLabel('Filter state')).toHaveText('dead:true');
  for (const width of [320, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await expect(page.getByText('12.34K')).toBeVisible();
    await expect(page.getByText('PTS', { exact: true })).toBeVisible();
    await expect(page.getByText('stars', { exact: true })).toBeVisible();
    const balance = page.getByRole('group', { name: 'Token balances' });
    if (width >= 640) await expect(balance.getByText('SEED', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`ranking-units-${width}.png`) });
  }
});

test('wallet export joins the nested dialog layer and restores its opener', async ({ page }) => {
  await open(page, 'wallet');
  await page.getByRole('button', { name: 'Open wallet', exact: true }).click();
  const opener = page.getByRole('button', { name: 'Export Embedded Wallet', exact: true });
  await opener.click();
  const nested = page.getByRole('dialog', { name: 'Export Embedded Wallet', exact: true });
  await expect(nested).toBeVisible();
  const layers = await nested.evaluate(node => [...document.querySelectorAll('[role=dialog]')].map(dialog => ({ title: dialog.getAttribute('aria-labelledby'), z: getComputedStyle(dialog).zIndex, isExport: dialog === node })));
  const current = layers.find(layer => layer.isExport)!;
  const parent = layers.find(layer => !layer.isExport)!;
  expect(Number(current.z)).toBeGreaterThan(Number(parent.z));
  await page.keyboard.press('Escape');
  await expect(nested).toHaveCount(0);
  await expect(opener).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(1);
});

test('About uses a deliberate heading outline', async ({ page }) => {
  await open(page, 'about');
  await expect(page.getByRole('heading', { name: 'About Pixotchi', level: 2 })).toBeVisible();
  await expect(page.locator('h1')).toHaveCount(1);
});

test('Activity canonical icon and result metadata preserve contract identity and signed rewards', () => {
  expect(Object.keys(PLANT_ART_MAP)).toEqual(['1', '2', '3', '4', '5']);
  const building = { __typename: 'TownUpgradedWithLeafEvent' as const, id: '1', timestamp: '1', landId: '1', buildingId: 7, upgradeCost: '1', xp: '1', blockHeight: '1' };
  expect(getActivityIcon(building).icon).toBe('/icons/farmer-house.png');
  expect(getActivityHeadline({ __typename: 'Played', id: '1', timestamp: '1', gameName: 'SpinGameV2', nftId: '1', nftName: 'Plant', points: '-1000000000000', timeExtension: '0' })).toBe('SpinLeaf: -1 PTS');
});
