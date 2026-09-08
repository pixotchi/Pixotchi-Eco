// Real production React components and quote hook; only wallet/RPC/transaction
// boundaries are replaced. No dev route, live account or onchain mutation.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit, expect } from '@playwright/test';

const cwd = process.cwd();
const boundary = `
import React, { useEffect, useRef } from 'react';
const config = new URLSearchParams(location.search);
export const state = window.gameplayAudit = { reads: [], transactions: new Map(), nextId: 0, completed: null };
export const address = '0x1111111111111111111111111111111111111111';
export const useAccount = () => ({ address });
export const useBalance = () => ({ data: { value: 1000000000000000000n }, isLoading: false, isError: false, refetch: async () => {} });
export const useBalances = () => ({ seedBalance: 10000000000000000000000n, seedBalanceStatus: 'ready', refreshBalances: async () => {} });
export const useSmartWallet = () => ({ isSmartWallet: config.get('smart') === '1', isLoading: false });
export const useEthModeSafe = () => ({ isEthMode: config.get('eth') === '1' });
export const useIsSolanaWallet = () => false;
export const useTwinAddress = () => undefined;
export const SolanaNotSupported = () => <span>Unavailable via Solana</span>;
export const PIXOTCHI_NFT_ADDRESS = address;
export const PIXOTCHI_TOKEN_ADDRESS = address;
export const LAND_CONTRACT_ADDRESS = address;
export const UNISWAP_ROUTER_ADDRESS = address;
export const WETH_ADDRESS = address;
export const LEAF_CONTRACT_ADDRESS = address;
export const JESSE_TOKEN_ADDRESS = address;
export const CREATOR_TOKEN_ADDRESS = address;
export const CRYPTICPOET_TOKEN_ADDRESS = address;
export const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
export const checkTokenApproval = async () => 0n;
export const getPlantNameChangePrice = async () => 350000000000000000000n;
export const getFenceV2Config = async () => ({ minDurationDays: 1, maxDurationDays: 30 });
export const quoteFenceV2 = async () => 1000000000000000000n;
export const buildFenceV2PurchaseCall = (id, days) => ({ address, functionName: 'buyFence', args: [id, days] });
export const getEthQuoteForSeedAmount = amount => new Promise((resolve, reject) => state.reads.push({ amount, resolve, reject }));
export const postMissionProgress = async () => ({ ok: true });
export const getBuyGardenItemCall = (id, item) => ({ address, functionName: 'buyGardenItem', args: [id, item] });
export const getBuyShopItemCall = (id, item) => ({ address, functionName: 'buyShopItem', args: [id, item] });
export function Transaction(props) {
  const id = useRef(null);
  if (id.current === null) id.current = ++state.nextId;
  state.transactions.set(id.current, props);
  useEffect(() => () => state.transactions.delete(id.current), []);
  return <button data-transaction-id={id.current} data-intent={props.intentKey} disabled={props.disabled} onClick={() => props.onButtonClick?.()}>{props.buttonText || 'Buy Item'}</button>;
}
export const BuyGardenItemTransaction = Transaction;
export const BuyShopItemTransaction = Transaction;
export default Transaction;
`;

const fixture = `
import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import ItemDetailsPanel from '@/components/item-details-panel';
import EditPlantName from '@/components/edit-plant-name';
import { EditLandName } from '@/components/edit-land-name';
import { state, address } from 'gameplay-boundary';
const config = new URLSearchParams(location.search);
const plant = {
  id: 7, name: 'Old Plant', owner: address, status: 1, level: 1,
  timeUntilStarving: Math.floor(Date.now() / 1000) + (config.get('low') === '1' ? 3600 : 864000),
  fenceV2: { v1Active: config.get('v1') === '1', isActive: false, activeUntil: 0 },
};
const item = { id: '1', name: config.get('fence') === '1' ? 'Fence' : 'Water', price: 1000000000000000000n, points: 0, timeExtension: 86400, effectTime: 86400 };
const complete = (id, name) => { state.completed = { id: String(id), name }; };
const component = config.get('scenario') === 'land'
  ? <EditLandName land={{ tokenId: 1112n, name: 'Old Land', owner: address }} onNameChanged={complete} />
  : config.get('scenario') === 'plant'
    ? <EditPlantName plant={plant} onNameChanged={complete} />
    : <ItemDetailsPanel selectedItem={item} selectedPlant={plant} itemType={config.get('fence') === '1' ? 'shop' : 'garden'} quantity={1} onPurchaseSuccess={() => {}} />;
createRoot(document.getElementById('root')).render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{component}</QueryClientProvider>);
`;

// Resolve only documented infrastructure edges. Component UI, allowance routing,
// swap calldata builders, Radix dialogs and React Query run unchanged.
const mocks = new Set([
  'lib/contracts', 'lib/balance-context', 'lib/smart-wallet-context', 'lib/eth-mode-context', 'lib/mission-tracking',
  'components/solana', 'components/transactions/game-transaction',
  'components/transactions/buy-item-transaction', 'components/transactions/solana-bridge-button',
  'components/transactions/bundle-buy-transaction', 'components/transactions/swap-buy-item-bundle',
  'components/transactions/swap-fence-purchase-bundle',
]);
const result = await build({
  stdin: { contents: fixture, sourcefile: 'gameplay-fixture.jsx', resolveDir: cwd, loader: 'jsx' },
  bundle: true, write: false, outfile: 'gameplay-fixture.js', format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
  plugins: [{ name: 'gameplay-test-boundaries', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (args.path === 'gameplay-boundary' || args.path === 'wagmi') return { path: 'boundary', namespace: 'gameplay' };
      if (args.path === 'next/image') return { path: 'image', namespace: 'gameplay' };
      const resolved = args.path.startsWith('@/') ? args.path.slice(2)
        : args.path.startsWith('.') ? path.relative(cwd, path.resolve(args.resolveDir, args.path)).replaceAll('\\', '/') : '';
      if (mocks.has(resolved.replace(/\.(tsx?|jsx?)$/, ''))) return { path: 'boundary', namespace: 'gameplay' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'gameplay' }, args => ({
      contents: args.path === 'image' ? `import React from 'react'; export default function Image(props) { return <img {...props} />; }` : boundary,
      loader: 'jsx', resolveDir: cwd,
    }));
  } }],
});
const bundle = result.outputFiles.find(file => file.path.endsWith('.js')).text;
const bundledCss = result.outputFiles.filter(file => file.path.endsWith('.css')).map(file => file.text).join('\n');
const server = createServer((req, res) => {
  if (req.url === '/fixture.js') { res.setHeader('Content-Type', 'text/javascript'); res.end(bundle); return; }
  if (req.url === '/fixture.css') { res.setHeader('Content-Type', 'text/css'); res.end(bundledCss); return; }
  res.setHeader('Content-Type', 'text/html');
  res.end('<!doctype html><html><head><link rel="stylesheet" href="/fixture.css"><style>.pointer-events-auto{pointer-events:auto}svg{width:16px;height:16px}</style></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const origin = `http://127.0.0.1:${server.address().port}`;
const expectEnabled = async button => { await expect(button).toBeEnabled(); };
const expectDisabled = async button => { await expect(button).toBeDisabled(); };

async function run(browserType, viewport) {
  const browser = await browserType.launch();
  const page = await browser.newPage({ viewport });
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const go = async query => { await page.goto(`${origin}/?${query}`); await page.waitForFunction(() => window.gameplayAudit); };
  try {
    for (const smart of [0, 1]) for (const constraint of ['low=1', 'v1=1', 'low=1&v1=1']) {
      await go(`scenario=care&smart=${smart}&${constraint}`);
      const button = page.getByRole('button', { name: smart ? 'Approve + Buy Water' : 'Approve SEED', exact: true });
      await expectEnabled(button);
      const calls = await button.evaluate(node => window.gameplayAudit.transactions.get(Number(node.dataset.transactionId)).calls.map(call => call.functionName));
      assert.deepEqual(calls, smart ? ['approve', 'buyGardenItem'] : ['approve']);
    }
    for (const constraint of ['low=1', 'v1=1']) {
      await go(`scenario=care&smart=1&fence=1&${constraint}`);
      const reason = constraint === 'low=1' ? 'Fence duration exceeds plant lifetime' : 'Existing fence active. Wait for expiry.';
      await expectDisabled(page.getByRole('button', { name: reason, exact: true }));
      assert.equal(await page.locator('[data-transaction-id]:not([disabled])').count(), 0);
    }

    await go('scenario=plant&smart=1&eth=1');
    await page.getByRole('button', { name: 'Change plant name', exact: true }).click();
    await page.getByLabel('New name', { exact: true }).fill('New Plant');
    await page.waitForFunction(() => window.gameplayAudit.reads.length === 1);
    await expectDisabled(page.getByRole('button', { name: 'Updating ETH quote…', exact: true }));
    assert.equal(await page.getByRole('button', { name: /Approve.*SEED|Approve.*Change Name/ }).count(), 0);
    const ethController = await page.locator('[data-transaction-id]').getAttribute('data-transaction-id');
    await page.evaluate(() => window.gameplayAudit.reads.at(-1).reject(new Error('Quote offline')));
    await expectDisabled(page.getByRole('button', { name: 'ETH quote unavailable', exact: true }));
    assert.equal(await page.getByRole('button', { name: /Approve.*SEED|Approve.*Change Name/ }).count(), 0);
    await page.getByRole('button', { name: 'Retry ETH quote', exact: true }).click();
    await page.waitForFunction(() => window.gameplayAudit.reads.length === 2);
    await page.evaluate(() => {
      const read = window.gameplayAudit.reads.at(-1);
      read.resolve({ seedAmount: read.amount, ethAmount: 9n, ethAmountWithBuffer: 10n });
    });
    const rename = page.getByRole('button', { name: 'Change Name with ETH', exact: true });
    await expectEnabled(rename);
    assert.equal(await rename.getAttribute('data-transaction-id'), ethController);
    const intent = await rename.evaluate(node => window.gameplayAudit.transactions.get(Number(node.dataset.transactionId)).calls.map(call => ({ fn: call.functionName, value: String(call.value ?? 0), args: call.args.map(arg => String(arg)) })));
    assert.equal(intent[0].value, '10');
    assert.equal(intent[0].args[0], '350000000000000000000');
    assert.equal(intent[2].fn, 'setPlantName');
    assert.equal(intent[2].args[1], 'New Plant');
    await rename.click();
    await expectDisabled(page.getByLabel('New name', { exact: true }));
    assert.equal(await page.locator('[data-transaction-id]').getAttribute('data-transaction-id'), ethController);
    await page.waitForFunction(() => window.gameplayAudit.reads.length === 3);
    await page.evaluate(() => { const read = window.gameplayAudit.reads.at(-1); read.resolve({ seedAmount: read.amount, ethAmount: 9n, ethAmountWithBuffer: 10n }); });
    await page.waitForFunction(() => window.gameplayAudit.transactions.size > 0);
    await page.evaluate(id => window.gameplayAudit.transactions.get(Number(id)).onError(new Error('User rejected')), ethController);
    await expectEnabled(rename);
    await expectEnabled(page.getByLabel('New name', { exact: true }));

    await go('scenario=plant&smart=0&eth=0');
    await page.getByRole('button', { name: 'Change plant name', exact: true }).click();
    await page.getByLabel('New name', { exact: true }).fill('SEED Plant');
    await expectEnabled(page.getByRole('button', { name: 'Approve SEED', exact: true }));
    assert.equal(await page.getByRole('button', { name: /ETH quote|Name with ETH/ }).count(), 0);

    await go('scenario=land');
    await page.getByRole('button', { name: 'Change land name', exact: true }).click();
    await expectDisabled(page.getByRole('button', { name: 'Change Name', exact: true }));
    await expect(page.getByRole('status')).toContainText('Choose a different name to make a change.');
    await page.getByLabel('New name', { exact: true }).fill('New Land');
    const landButton = page.locator('[data-transaction-id]');
    const landController = await landButton.getAttribute('data-transaction-id');
    await expectEnabled(landButton);
    await landButton.click();
    await expectDisabled(landButton);
    await expectDisabled(page.getByLabel('New name', { exact: true }));
    assert.equal(await landButton.getAttribute('data-transaction-id'), landController);
    await page.evaluate(id => window.gameplayAudit.transactions.get(Number(id)).onError(new Error('User rejected')), landController);
    await expectEnabled(landButton);
    assert.equal(await landButton.getAttribute('data-transaction-id'), landController);
    await landButton.click();
    await page.evaluate(id => window.gameplayAudit.transactions.get(Number(id)).onSuccess({}), landController);
    await page.waitForFunction(() => window.gameplayAudit.completed?.name === 'New Land');
    assert.deepEqual(await page.evaluate(() => window.gameplayAudit.completed), { id: '1112', name: 'New Land' });
    assert.equal(await landButton.getAttribute('data-transaction-id'), landController);
    await page.getByRole('dialog').waitFor({ state: 'hidden' });
    assert.deepEqual(errors, []);
    console.log(`PASS ${browserType.name()} ${viewport.width}px: G01 regular/smart care + fence restrictions; G02 ETH pending/error/retry/calldata + explicit SEED; G03 stable controller rejection/success.`);
  } catch (error) {
    console.error({ url: page.url(), errors, body: await page.locator('body').innerText() });
    throw error;
  } finally { await browser.close(); }
}
try {
  await run(chromium, { width: 390, height: 844 });
  await run(webkit, { width: 1440, height: 900 });
} finally {
  await new Promise(resolve => server.close(resolve));
}
