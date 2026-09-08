// Real Warehouse/picker/info/production components; controlled reads and transaction I/O.
import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, webkit, expect } from '@playwright/test';

const shared = `import React from 'react';const S=()=>window.buildingLow;`;
const mocks = {
  '@/lib/farm-view-context': `export const useFarmView=()=>({setMintType:()=>{}});`,
  '@/lib/game-navigation': `export const navigateToGameTab=()=>{};`,
  wagmi: `${shared}export const useAccount=()=>({address:S().owner});`,
  'next/image': `${shared}export default function Image({alt,width,height,...rest}){return <img alt={alt} width={width} height={height} className={rest.className} src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='32' height='32'%3E%3Crect x='4' y='4' width='24' height='24' rx='8' fill='%235e9368'/%3E%3C/svg%3E"/>}`,
  '@/lib/contracts': `${shared}
    export const LAND_CONTRACT_ADDRESS='0x1111111111111111111111111111111111111111';
    export const CREATOR_TOKEN_ADDRESS=LAND_CONTRACT_ADDRESS,PIXOTCHI_TOKEN_ADDRESS=LAND_CONTRACT_ADDRESS,LEAF_CONTRACT_ADDRESS=LAND_CONTRACT_ADDRESS,CRYPTICPOET_TOKEN_ADDRESS=LAND_CONTRACT_ADDRESS,JESSE_TOKEN_ADDRESS=LAND_CONTRACT_ADDRESS;
    export const ADDRESS_REGEX=/^0x[a-fA-F0-9]{40}$/;
    export const getPlantsByOwner=async()=>S().holdPlants?new Promise(resolve=>S().resolvePlants=resolve):S().plants;
    export const barracksGetConfigV2=async()=>{S().reads++;if(S().holdRules)return new Promise(resolve=>S().resolveRules=resolve);return S().failRules?null:S().config};`,
  '@/lib/mission-tracking': `${shared}export const postMissionProgress=payload=>S().missions.push(payload);`,
  '@/components/transactions/game-transaction': `${shared}import {Button} from '@/components/ui/button';export default function Transaction(p){const latest=React.useRef(p);latest.current=p;const [pending,setPending]=React.useState(false);React.useState(()=>{S().mounts++});return <Button disabled={p.disabled||pending} className={p.buttonClassName} onClick={()=>{p.onButtonClick?.();setPending(true);S().calls=p.calls;S().pending[p.calls[0].functionName]=()=>{setPending(false);latest.current.onSuccess?.({transactionHash:'0x'+'ab'.repeat(32)})};S().render()}}>{p.buttonText}</Button>};`,
  '@/components/transactions/building-claim-transaction': `${shared}export default p=><button>{p.buttonText}</button>;`,
};
const entry = `${shared}
  import {createRoot} from 'react-dom/client';import WarehousePanel from '@/components/building-details/WarehousePanel';
  import BuildingInfoDialog from '@/components/building-info-dialog';import ProductionPanel from '@/components/building-details/ProductionPanel';
  import {fixtureBarracks} from '@/app/qa/frontend/controller-data';
  const root=createRoot(document.getElementById('root'));let version=0;
  const base={id:8,level:1,maxLevel:10,productionRatePlantPointsPerDay:1000000000000n,productionRatePlantLifetimePerDay:3600n,accumulatedPoints:1000000000000n,accumulatedLifetime:3600n,levelUpgradeCostLeaf:1n,levelUpgradeCostSeedInstant:1n,levelUpgradeBlockInterval:100n,isUpgrading:false,blockHeightUpgradeInitiated:0n,blockHeightUntilUpgradeDone:0n};
  window.buildingLow={reset(mode='warehouse',changes={}){version++;this.revision=version;Object.assign(this,{mode,owner:'0x1111111111111111111111111111111111111111',landId:1n,mounts:0,pending:{},successes:0,missions:[],reads:0,holdRules:false,failRules:false,holdPlants:false,config:fixtureBarracks().config,calls:[],building:base,
    plants:Array.from({length:131},(_,i)=>({id:i+1,name:i===130?'Zinnia with an exceptionally long name that should not stretch the picker':i===1?'Basil':i===2?'Clover':i===0?'Aster':'Plant '+(i+1),timeUntilStarving:Math.floor(Date.now()/1000)+86400,score:1,level:1,status:1,rewards:0,stars:0,strain:0,timePlantBorn:'0',lastAttackUsed:'0',lastAttacked:'0',statusStr:'Alive',owner:'0x1111111111111111111111111111111111111111',extensions:[]})),...changes});this.render();},render(){const w=this;root.render(<main key={version} data-fixture-revision={version} className="mx-auto w-full max-w-lg space-y-4 p-4"><h1 className="text-xl font-semibold">{w.mode==='warehouse'?'Warehouse':w.mode==='production'?'Production':'Building information'}</h1>{w.mode==='warehouse'?<WarehousePanel landId={w.landId} warehousePoints={1234567890000n} warehouseLifetime={7200n} onApplySuccess={()=>{w.successes++}}/>:w.mode==='production'?<ProductionPanel building={w.building} landId={1n} onClaimSuccess={()=>{}}/>:<BuildingInfoDialog open onOpenChange={()=>{}} building={w.building} buildingType={w.mode==='production-info'?'village':'town'}/>}</main>);}};window.buildingLow.reset();`;
const bundle = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false,
  platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
  plugins: [{ name: 'building-low-boundaries', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      const canonical = args.path.startsWith('.') ? '@/' + path.relative(process.cwd(), path.resolve(args.resolveDir, args.path)).replaceAll('\\', '/') : args.path;
      if (canonical in mocks) return { path: canonical, namespace: 'building-low' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'building-low' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: process.cwd() }));
  } }],
});
// Compile the real stylesheet in isolation so CI needs no application server.
const cssPath = path.resolve('app/globals.css');
const css = (await postcss([tailwind()]).process(await readFile(cssPath, 'utf8'), { from: cssPath })).css;
const server = createServer(async (request, response) => {
  response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : request.url === '/app.css' ? 'text/css' : 'text/html');
  response.end(request.url === '/app.js' ? bundle.outputFiles[0].text : request.url === '/app.css' ? css : '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><div id="root"></div><script src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const webkitPickerOnly = process.argv.includes('--webkit-picker');
const browser = await (webkitPickerOnly ? webkit : chromium).launch({ headless: true });
const page = await browser.newPage({ reducedMotion: 'reduce' });
const errors = [];
page.on('pageerror', error => errors.push(error.message));
page.setDefaultTimeout(8000);
const reset = async (mode, changes = {}) => {
  const revision = await page.evaluate(({ mode, changes }) => { window.buildingLow.reset(mode, changes); return window.buildingLow.revision; }, { mode, changes });
  await expect(page.locator('main')).toHaveAttribute('data-fixture-revision', String(revision));
};
const trigger = () => page.getByRole('button', { name: /^Plant to receive resources/ });
const output = path.resolve('output/playwright/low-buildings');
await mkdir(output, { recursive: true });
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  if (webkitPickerOnly) {
    await page.setViewportSize({ width: 390, height: 844 });
    for (let cycle = 0; cycle < 12; cycle++) {
      await reset('warehouse');await trigger().click();
      const search = page.getByRole('textbox', { name: 'Search plant names or IDs' });
      await search.fill('Basil');await page.getByRole('menuitemradio').first().click();
      await expect(trigger()).toContainText('Basil');
    }
    console.log('PASS WebKit picker: 12 open/search/select cycles without ResizeObserver errors.');
  } else {
  await page.evaluate(() => document.fonts.ready);
  for (const width of [320, 820, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(dark => document.documentElement.classList.toggle('dark', dark), width === 820);
    await reset('warehouse');await trigger().waitFor();await trigger().click();
    const options = page.getByRole('menuitemradio');await options.first().waitFor();
    assert.equal(await options.count(), 50);
    assert.equal(await options.first().getAttribute('aria-checked'), 'true');
    assert.ok((await options.first().boundingBox()).height >= 64);
    await page.waitForFunction(() => { const menu = document.querySelector('[role=menu]'); const trigger = document.querySelector('button[aria-haspopup=menu]'); return menu && trigger && Math.abs(menu.getBoundingClientRect().width - trigger.getBoundingClientRect().width) <= 1; });
    const menu = await page.getByRole('menu').boundingBox();
    const triggerBox = await page.locator('button[aria-haspopup="menu"]').boundingBox();
    assert.ok(menu.x >= 0 && menu.x + menu.width <= width + 1);
    assert.ok(Math.abs(menu.width - triggerBox.width) <= 1);
    await page.getByRole('textbox', { name: 'Search plant names or IDs' }).fill('131');
    await page.getByRole('menuitemradio').first().waitFor();assert.equal(await options.count(), 1);
    await page.screenshot({ path: path.join(output, `warehouse-picker-${width}.png`), fullPage: true });
    await options.first().click();await trigger().waitFor();
    assert.match(await trigger().innerText(), /Zinnia/);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
    await page.screenshot({ path: path.join(output, `warehouse-${width}.png`), fullPage: true });
  }
  console.log('PASS BP12/13/15: selected radio state, 50-row bound, ID search, 64px rows, matching width and long selection at 320/820/1440px.');
  await reset('warehouse');await trigger().focus();await page.keyboard.press('Enter');
  const search = page.getByRole('textbox', { name: 'Search plant names or IDs' });
  await search.waitFor();await page.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Search plant names or IDs');
  await search.fill('Basil');await search.press('ArrowDown');await page.keyboard.press('Enter');
  await trigger().waitFor();assert.match(await trigger().innerText(), /Basil/);
  await trigger().press('Enter');await search.fill('no-such-plant');await page.getByText('No matching plants.', { exact: true }).waitFor();
  await search.press('Escape');assert.equal(await trigger().evaluate(element => element === document.activeElement), true);
  await trigger().click();await page.getByRole('menuitem', { name: 'Show more plants (50 of 131)' }).click();assert.equal(await page.getByRole('menuitemradio').count(), 100);
  await page.keyboard.press('Escape');
  await page.getByLabel('Plant points to apply (PTS)', { exact: true }).fill('1.2345');
  await page.getByRole('button', { name: 'Apply points', exact: true }).click();
  assert.equal(await page.evaluate(() => window.buildingLow.calls[0].args[1]), 2n);
  await page.getByLabel('Plant lifetime to apply (minutes)', { exact: true }).fill('121');assert.equal(await page.getByRole('button', { name: 'Apply lifetime', exact: true }).isDisabled(), true);
  console.log('PASS BP13/15: keyboard search, selection, Escape focus return, no matches, pagination and selected destination/amount guards.');
  const choosePlant = async name => {
    await trigger().click();
    await page.getByRole('textbox', { name: 'Search plant names or IDs' }).fill(name);
    await page.getByRole('menuitemradio').first().click();
  };
  for (const mode of ['points', 'lifetime']) {
    await reset('warehouse');await choosePlant('Basil');
    const input = page.getByLabel(mode === 'points' ? 'Plant points to apply (PTS)' : 'Plant lifetime to apply (minutes)', { exact: true });
    const action = page.getByRole('button', { name: mode === 'points' ? 'Apply points' : 'Apply lifetime', exact: true });
    const fn = mode === 'points' ? 'wareHouseAssignPlantPoints' : 'wareHouseAssignLifeTime';
    await input.fill('1');await action.click();
    await choosePlant('Clover');await input.fill(mode === 'points' ? '0.5' : '2');
    await page.evaluate(fn => window.buildingLow.pending[fn](), fn);
    assert.equal(await input.inputValue(), mode === 'points' ? '0.5' : '2');
    assert.equal(await page.evaluate(() => window.buildingLow.calls[0].args[1]), 2n);
    assert.equal(await page.evaluate(() => window.buildingLow.mounts), 2, 'draft edits retain both submitted controllers');
    assert.equal(await page.evaluate(() => window.buildingLow.successes), 1, 'successful old target still refreshes its warehouse');
    // An edited-and-restored draft is new even when its string matches the submission.
    await input.fill('1');await action.click();await input.fill('2');await input.fill('1');
    await page.evaluate(fn => window.buildingLow.pending[fn](), fn);assert.equal(await input.inputValue(), '1');
    // The same untouched draft still clears normally, and the other mode is preserved.
    await action.click();await page.evaluate(fn => window.buildingLow.pending[fn](), fn);await expect(input).toHaveValue('');
    await input.fill('1');await action.click();
    await page.evaluate(() => { window.buildingLow.landId = 2n; window.buildingLow.render(); });
    await input.fill('2');await page.evaluate(fn => window.buildingLow.pending[fn](), fn);assert.equal(await input.inputValue(), '2');
    assert.equal(await page.evaluate(() => window.buildingLow.successes), 3, 'old land completion cannot run the replacement land callback');
    assert.equal(await page.evaluate(() => window.buildingLow.missions.length), 4, 'same-owner submitted mission proof survives a land change');
    await input.fill('1');await action.click();
    await page.evaluate(() => { window.buildingLow.owner = '0x2222222222222222222222222222222222222222'; window.buildingLow.render(); });
    await expect(trigger()).toContainText('Aster');await input.fill('2');await page.evaluate(fn => window.buildingLow.pending[fn](), fn);assert.equal(await input.inputValue(), '2');
    assert.equal(await page.evaluate(() => window.buildingLow.successes), 3, 'old owner completion cannot run the replacement owner callback');
    assert.equal(await page.evaluate(() => window.buildingLow.missions.length), 4, 'old owner proof cannot be attributed to the replacement owner');
  }
  console.log('PASS Warehouse confirmation ownership: held points/lifetime success preserves new target, revised amount, owner and land drafts; untouched submitted draft clears without remounting its controllers.');
  await reset('warehouse');await page.evaluate(()=>{window.buildingLow.plants=window.buildingLow.plants.slice(0,8);window.buildingLow.reset('warehouse',{plants:window.buildingLow.plants})});
  await trigger().focus();await trigger().press('ArrowDown');await page.getByRole('menuitemradio').first().waitFor();
  assert.equal(await page.getByRole('textbox',{name:'Search plant names or IDs'}).count(),0);await page.keyboard.press('c');await page.waitForFunction(()=>document.activeElement?.textContent?.includes('Clover'));await page.keyboard.press('Enter');
  await trigger().waitFor();assert.match(await trigger().innerText(),/Clover/);
  console.log('PASS BP13: small-collection typeahead selects by name without adding a search field.');
  await reset('warehouse', { holdPlants: true });await page.getByText('Loading your plants…', { exact: true }).waitFor();
  assert.equal(await trigger().count(), 0, 'unknown plant reads do not expose an interactive destination');
  await reset('info', { holdRules: true });await page.getByText('Loading Barracks rules…', { exact: true }).waitFor();
  await page.evaluate(() => window.buildingLow.resolveRules(null));await page.getByText('Barracks rules unavailable', { exact: true }).waitFor();
  await page.evaluate(() => { window.buildingLow.holdRules = false; });await page.getByRole('button', { name: 'Retry', exact: true }).click();
  await page.getByText('Battle Values', { exact: true }).waitFor();assert.equal(await page.evaluate(() => window.buildingLow.reads), 2);
  console.log('PASS BP18: labeled loading, disabled unknown target, rules failure and retry without closing the actual info dialog.');
  await reset('production');await page.getByText('Plant points per day', { exact: true }).waitFor();await page.getByText('Stored plant lifetime', { exact: true }).waitFor();
  await reset('production-info');await page.evaluate(() => { window.buildingLow.building = { ...window.buildingLow.building, id: 0 }; window.buildingLow.render(); });
  await page.getByText(/This level produces plant points and plant lifetime/).waitFor();
  console.log('PASS BP14/15: resource purpose follows selected level, consistent plant points/lifetime labels.');
  }
  assert.deepEqual(errors, []);console.log('Building low-priority component checks passed.');
} catch (error) { console.error('Geometry:', await page.evaluate(() => [...document.querySelectorAll('[role=menu],button[aria-haspopup=menu]')].map(e=>({tag:e.tagName,role:e.getAttribute('role'),width:e.getBoundingClientRect().width,classes:e.className,style:getComputedStyle(e).width,trigger:getComputedStyle(e).getPropertyValue('--radix-dropdown-menu-trigger-width')}))));await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});console.error('Fixture state:', await page.locator('body').innerText()); console.error('Runtime errors:', errors); throw error; } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
