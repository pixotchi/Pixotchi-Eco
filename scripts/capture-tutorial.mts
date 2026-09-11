/** Capture the actual app for tutorial artwork. Only read responses are seeded;
 * components, layout, icons and assets are the production implementation.
 * Run with npx tsx scripts/capture-tutorial.mts. No wallet writes are permitted.
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';
import { chromium, type Locator } from 'playwright';
import { decodeFunctionData, encodeFunctionResult, encodeAbiParameters, toFunctionSelector, multicall3Abi, type Abi, type Hex } from 'viem';
import { landAbi } from '../public/abi/pixotchi-v3-abi';

const root = process.cwd();
const out = path.join(root, 'output/tutorial-capture');
await fs.mkdir(out, { recursive: true });
const text = await fs.readFile('lib/contracts.ts', 'utf8');
const source = ts.createSourceFile('contracts.ts', text, ts.ScriptTarget.Latest, true);
let initializer = '';
function visit(node: ts.Node) {
  if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'PIXOTCHI_NFT_ABI') initializer = node.initializer!.getText(source);
  ts.forEachChild(node, visit);
}
visit(source);
const sandbox: { abi?: Abi } = {};
vm.runInNewContext(ts.transpile(`globalThis.abi = ${initializer}`, { target: ts.ScriptTarget.ES2022 }), sandbox);
const abi = [...sandbox.abi!, ...landAbi] as Abi;
const now = BigInt(Math.floor(Date.now() / 1000));
const owner = '0x1111111111111111111111111111111111111111';
let currentOwner = owner;
const plant = { id: 13468n, name: 'My first plant', timeUntilStarving: now + 259200n,
  score: 1250n * 10n ** 12n, timePlantBorn: now - 864000n, lastAttackUsed: 0n,
  lastAttacked: 0n, stars: 2n, strain: 1n, status: 0, statusStr: 'Great', level: 12n,
  owner, rewards: 0n, extensions: [] };
const land = { tokenId: 342n, tokenUri: '', mintDate: now - 864000n, owner,
  name: 'My first land', coordinateX: -9n, coordinateY: -9n, experiencePoints: 123n,
  accumulatedPlantPoints: 0n, accumulatedPlantLifetime: 0n, farmerAvatar: 0 };
const building = { id: 0, level: 1, maxLevel: 4, blockHeightUpgradeInitiated: 0n,
  blockHeightUntilUpgradeDone: 0n, isUpgrading: false, accumulatedPoints: 120n * 10n ** 12n,
  accumulatedLifetime: 3600n, levelUpgradeCostLeaf: 5000n * 10n ** 18n,
  levelUpgradeCostSeedInstant: 20n * 10n ** 18n, levelUpgradeCostSeed: 20n * 10n ** 18n,
  levelUpgradeBlockInterval: 1800n, productionRatePlantLifetimePerDay: 3600n,
  productionRatePlantPointsPerDay: 120n * 10n ** 12n, claimedBlockHeight: 0n };
const names = ['getPlantsByOwnerExtended', 'landGetByOwner', 'landGetById', 'villageGetVillageBuildingsByLandId', 'townGetBuildingsByLandId'];
const selectors = new Set(abi.filter(x => x.type === 'function' && names.includes(x.name)).map(x => toFunctionSelector(x)));
selectors.add('0x70a08231');
selectors.add('0xdd62ed3e');
function seeded(data: Hex): Hex | undefined {
  if (!selectors.has(data.slice(0, 10) as Hex)) return;
  if (data.startsWith('0x70a08231') || data.startsWith('0xdd62ed3e')) return encodeAbiParameters([{type:'uint256'}],[1000n * 10n ** 18n]);
  const { functionName, args } = decodeFunctionData({ abi, data });
  if (functionName === 'getPlantsByOwnerExtended') currentOwner = String(args![0]);
  const values: Record<string, unknown> = {
    getPlantsByOwnerExtended: [{ ...plant, owner: args![0] }],
    landGetByOwner: [{ ...land, owner: args![0] }],
    landGetById: {...land, owner:currentOwner},
    villageGetVillageBuildingsByLandId: [0, 3, 5].map(id => ({ ...building, id })),
    townGetBuildingsByLandId: [1, 3, 5, 7].map(id => ({ ...building, id })),
  };
  return encodeFunctionResult({ abi, functionName, result: values[functionName] });
}
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
await context.addInitScript(() => { localStorage.setItem('pixotchi-theme', 'dark'); });
await context.route('**/api/secret-garden/progress', r => r.fulfill({ json: {} }));
await context.route('**/api/chat/auth/session', r => r.fulfill({json:{address:currentOwner,authenticated:true,provider:'base',method:'base-siwe'}}));
await context.route('**/api/chat/messages*', r => r.fulfill({json:{messages:[{id:'tutorial-welcome',address:owner,displayName:'Fellow grower',message:'Welcome! Start with Plant care to keep your plant growing.',timestamp:Date.now()-60000}]}}));
await context.route('**/api/chat/ai/messages*', r => r.fulfill({json:{messages:[],conversationId:currentOwner}}));
await context.route('**/api/rpc', async route => {
  const body = route.request().postDataJSON();
  const requests = Array.isArray(body) ? body : [body];
  if (requests.some(r => /sendTransaction|sendRawTransaction|sendCalls|sendUserOperation/.test(r.method))) throw new Error('Tutorial capture attempted a wallet write');
  const response = await route.fetch();
  const json = await response.json();
  const responses = Array.isArray(json) ? json : [json];
  for (const r of requests) {
    if (r.method !== 'eth_call') continue;
    const reply = responses.find(x => x.id === r.id);
    if (!reply) continue;
    const data = r.params[0].data as Hex;
    const direct = seeded(data);
    if (direct) { delete reply.error; reply.result = direct; continue; }
    // Owner queries may arrive inside viem's shared aggregate3 read.
    if (data.startsWith('0x82ad56cb')) {
      const call = decodeFunctionData({ abi: multicall3Abi, data });
      const calls = call.args![0] as readonly { callData: Hex }[];
      if (!calls.some(c => selectors.has(c.callData.slice(0, 10) as Hex))) continue;
      const { decodeFunctionResult } = await import('viem');
      const original = decodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', data: reply.result }) as readonly {success:boolean;returnData:Hex}[];
      reply.result = encodeFunctionResult({ abi: multicall3Abi, functionName: 'aggregate3', result: original.map((entry, i) => {
        const replacement = seeded(calls[i].callData);
        return replacement ? { success: true, returnData: replacement } : entry;
      }) });
    }
  }
  await route.fulfill({ response, json: Array.isArray(json) ? responses : responses[0] });
});
const page = await context.newPage();
page.setDefaultTimeout(30000);
await page.goto('http://localhost:3000/?surface=test');
await page.getByRole('button', { name: 'Skip', exact: true }).click();
await page.getByRole('dialog').waitFor({state:'hidden'});
await page.addStyleTag({ content: 'nextjs-portal { display: none !important; }' });
async function shot(name: string, detail?: Locator) {
  if (detail && await detail.getAttribute('role') === 'dialog') detail = detail.locator('[data-dialog-layout]').first();
  await page.waitForFunction(() => !/Loading|Checking SEED spending permission/.test(document.body.innerText), {timeout: 30000});
  await page.evaluate(() => Promise.race([document.fonts.ready,new Promise(resolve=>setTimeout(resolve,5000))]));
  await page.locator('img:visible').evaluateAll(images => Promise.all(images.filter(img => {
    const rect = img.getBoundingClientRect();
    return rect.top < innerHeight && rect.bottom > 0;
  }).map(img => Promise.race([(img as HTMLImageElement).decode().catch(() => undefined),new Promise(resolve=>setTimeout(resolve,5000))]))));
  if (detail) await detail.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(out, `${name}-screen.png`), animations: 'disabled' });
  if (detail) await detail.screenshot({ path: path.join(out, `${name}-detail.png`), animations: 'disabled' });
  console.log('Captured', name);
}
if (process.argv.includes('--ranking-only')) {
  await page.getByRole('tab',{name:'Ranking',exact:true}).click();
  await page.getByRole('button',{name:'View plant profile',exact:true}).first().waitFor();
  await shot('ranking');
  await browser.close();
  process.exit(0);
}
if (process.argv.includes('--fence-only')) {
  await page.getByRole('button',{name:'Select Fence',exact:true}).click();
  await page.getByRole('dialog').getByText('Duration (days):',{exact:true}).waitFor();
  await shot('fence',page.getByRole('dialog'));
  await browser.close();
  process.exit(0);
}
await page.getByText('My first plant', { exact: true }).waitFor();
await shot('plant');
await shot('plant-card', page.locator('.surface-panel').filter({has:page.getByText('My first plant',{exact:true})}).last());
await fs.writeFile(path.join(out, 'farm-text.txt'), await page.locator('body').innerText());
await shot('care', page.getByRole('region', {name:'Add lifetime', exact:true}));
await page.getByRole('button',{name:'Select Water',exact:true}).click();
await page.getByRole('dialog').waitFor();
await page.getByRole('dialog').getByText('Effect:',{exact:true}).waitFor();
await page.getByRole('dialog').getByText('Checking SEED spending permission…',{exact:true}).waitFor({state:'hidden'});
await shot('care-review',page.getByRole('dialog'));
await fs.writeFile(path.join(out,'care-review-text.txt'),await page.getByRole('dialog').innerText());
await page.keyboard.press('Escape');
await page.getByRole('dialog').waitFor({state:'hidden'});
await page.getByRole('button',{name:'Select Fence',exact:true}).click();
await page.getByRole('dialog').waitFor();
await page.getByRole('dialog').getByText('Effect:',{exact:true}).waitFor();
await shot('fence',page.getByRole('dialog'));
await page.keyboard.press('Escape');
await page.getByRole('dialog').waitFor({state:'hidden'});
await page.getByRole('radio', {name:'Lands', exact:true}).click();
await page.getByRole('button', {name:'Select Solar Panels', exact:true}).waitFor();
await shot('land');
await shot('buildings',page.getByLabel('Choose a building',{exact:true}));
await page.getByRole('button',{name:'Select Solar Panels',exact:true}).click();
await shot('building-detail',page.getByRole('region',{name:'Selected building details',exact:true}));
await page.getByRole('radio',{name:'Town',exact:true}).click();
await shot('town',page.getByLabel('Choose a building',{exact:true}));
await fs.writeFile(path.join(out, 'land-text.txt'), await page.locator('body').innerText());
await page.getByRole('tab',{name:'Mint',exact:true}).click();
await page.getByRole('region',{name:'Choose a strain',exact:true}).waitFor();
await shot('mint',page.getByRole('region',{name:'Choose a strain',exact:true}));
await page.getByRole('tab',{name:'Swap',exact:true}).click();
await page.getByRole('tabpanel',{name:'Swap',exact:true}).getByRole('heading',{name:'Swap',exact:true}).waitFor();
await shot('swap',page.getByRole('tabpanel',{name:'Swap',exact:true}));
await page.getByRole('button',{name:'Open staking dialog',exact:true}).click();
await page.getByRole('dialog').getByText('Unclaimed LEAF',{exact:true}).waitFor();
await page.getByRole('dialog').getByText('Loading…',{exact:true}).first().waitFor({state:'hidden'});
await shot('stake',page.getByRole('dialog'));
await page.keyboard.press('Escape');
await page.getByRole('dialog').waitFor({state:'hidden'});
await page.getByRole('button',{name:'Open tasks',exact:true}).click();
await page.getByRole('dialog').getByRole('heading',{name:'Land',exact:true}).waitFor();
await shot('tasks',page.getByRole('dialog'));
await page.keyboard.press('Escape');
await page.getByRole('dialog').waitFor({state:'hidden'});
await page.getByRole('button',{name:'Settings',exact:true}).click();
await shot('settings',page.getByRole('menu'));
await page.keyboard.press('Escape');
await page.getByRole('menu').waitFor({state:'hidden'});
await page.getByRole('button',{name:'Open public chat',exact:true}).click();
await page.getByRole('dialog').waitFor();
const refresh = page.getByRole('button',{name:'Refresh session',exact:true});
if (await refresh.isVisible()) await refresh.click();
await page.getByText('Welcome! Start with Plant care to keep your plant growing.',{exact:true}).waitFor();
await shot('chat',page.getByRole('dialog'));
await page.keyboard.press('Escape');
await page.getByRole('dialog').waitFor({state:'hidden'});
await page.getByRole('tab',{name:'Ranking',exact:true}).click();
await page.getByRole('heading',{name:'Ranking',exact:true}).waitFor();
await page.getByRole('button',{name:'View plant profile',exact:true}).first().waitFor();
await shot('ranking');
await browser.close();
