import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

const boundary = `
export const state = window.missionReads = {lands:[],plants:[],farms:[]};
export const CLIENT_ENV = {CASINO_ENABLED:true};
export const LAND_CONTRACT_ADDRESS = '0x1111111111111111111111111111111111111111';
export const getLandsByOwner = (owner,client,blockNumber) => new Promise((resolve,reject)=>state.lands.push({owner,blockNumber,resolve,reject}));
export const getPlantsByOwner = (owner,client,blockNumber) => new Promise((resolve,reject)=>state.plants.push({owner,blockNumber,resolve,reject}));
export const getReadClient = ()=>({multicall:args=>new Promise((resolve,reject)=>state.farms.push({...args,resolve,reject}))});
`;
const fixture = `
import React,{useState} from 'react';
import {createRoot} from 'react-dom/client';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {useMissionAssets} from '@/hooks/useMissionAssets';
import {resolveMissionAction} from '@/lib/mission-actions';
import {invalidateOwnerResources} from '@/lib/owner-resource-invalidation';
const client = new QueryClient({defaultOptions:{queries:{retry:false}}});
window.missionClient=client; window.invalidateMissionAssets=invalidateOwnerResources;
function App(){
 const [owner,setOwner]=useState('0x1111111111111111111111111111111111111111');
 const [open,setOpen]=useState(true);
 const {assets,retry}=useMissionAssets(owner,open);
 window.missionControl={setOwner,setOpen,retry};
 window.missionState={assets,quest:resolveMissionAction('s3_send_quest',assets),casino:resolveMissionAction('s3_play_casino_game',assets),plant:resolveMissionAction('s4_buy10_elements',assets)};
 return <pre>{JSON.stringify(window.missionState,(_,value)=>typeof value==='bigint'?String(value):value)}</pre>;
}
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><App/></QueryClientProvider>);
`;
const bundle = await build({
  stdin: { contents: fixture, sourcefile: 'mission-assets-hook-fixture.jsx', resolveDir: process.cwd(), loader: 'jsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
  plugins: [{ name: 'mission-boundary', setup(plugin) {
    plugin.onResolve({ filter: /^(?:@\/lib\/(?:contracts|env-config))$/ }, () => ({ path: 'mission-boundary', namespace: 'mission-boundary' }));
    plugin.onLoad({ filter: /.*/, namespace: 'mission-boundary' }, () => ({ contents: boundary, loader: 'js' }));
  } }],
});
const server = createServer((request, response) => {
  response.setHeader('Content-Type', request.url === '/app.js' ? 'text/javascript' : 'text/html');
  response.end(request.url === '/app.js' ? bundle.outputFiles[0].text : '<div id="root"></div><script src="/app.js"></script>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage();
const counts = () => page.evaluate(() => Object.fromEntries(Object.entries(window.missionReads).map(([key, value]) => [key, value.length])));
const waitCounts = async expected => page.waitForFunction(expected => Object.entries(expected).every(([key, count]) => window.missionReads[key].length >= count), expected);
const resolveLists = async (landIndex, plantIndex, ids) => page.evaluate(({landIndex,plantIndex,ids}) => {
  const owner = window.missionReads.lands[landIndex].owner;
  window.missionReads.lands[landIndex].resolve(ids.map(id => ({tokenId:BigInt(id),owner,accumulatedPlantPoints:0n,accumulatedPlantLifetime:0n})));
  window.missionReads.plants[plantIndex].resolve([]);
}, {landIndex,plantIndex,ids});
const resolveFarms = async (index, casinoFailure = false) => page.evaluate(({index,casinoFailure}) => {
  const read = window.missionReads.farms[index];
  read.resolve(read.contracts.map(call => {
    const built = call.args[0] === 12n;
    if (call.functionName === 'casinoIsBuilt') return casinoFailure ? {status:'failure',error:new Error('RPC unavailable')} : {status:'success',result:built};
    return {status:'success',result:call.functionName === 'townGetBuildingsByLandId'
      ? [{id:5,level:built?1:0,isUpgrading:false},{id:7,level:built?1:0,isUpgrading:false}]
      : [{id:0,level:1,isUpgrading:false,accumulatedPoints:0n,accumulatedLifetime:0n}]};
  }));
}, {index,casinoFailure});
try {
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await waitCounts({lands:1,plants:1});
  assert.equal(await page.evaluate(() => window.missionState.quest.disabled), true);
  await resolveLists(0,0,[11,12]);
  await waitCounts({farms:1});
  await resolveFarms(0);
  await page.waitForFunction(() => window.missionState.casino.label === 'Open Casino');
  assert.equal(await page.evaluate(() => window.missionState.casino.target.landId), '12');
  assert.equal(await page.evaluate(() => window.missionState.quest.label), 'Open quests');

  // A wallet switch cannot reuse the previous wallet's land or building target.
  await page.evaluate(() => window.missionControl.setOwner('0x2222222222222222222222222222222222222222'));
  await waitCounts({lands:2,plants:2});
  assert.equal(await page.evaluate(() => window.missionState.quest.disabled), true);
  await resolveLists(1,1,[]);
  await page.waitForFunction(() => window.missionState.quest.label === 'Mint a land');
  assert.equal(await page.evaluate(() => window.missionState.plant.label), 'Mint a plant');

  // Closing suppresses reads; reopening forces current ownership and facet checks.
  await page.evaluate(() => window.missionControl.setOpen(false));
  await page.evaluate(() => window.missionControl.setOwner('0x1111111111111111111111111111111111111111'));
  assert.deepEqual(await counts(), {lands:2,plants:2,farms:1});
  await page.evaluate(() => window.missionControl.setOpen(true));
  await waitCounts({lands:3,plants:3});
  await resolveLists(2,2,[11,12]);
  await waitCounts({farms:2});
  await resolveFarms(1,true);
  await page.waitForFunction(() => window.missionState.casino.retry === true);
  assert.equal(await page.evaluate(() => window.missionState.quest.label), 'Open quests');

  // Failed ownership refresh remains retryable, never an empty-wallet mint prompt.
  await page.evaluate(() => window.missionControl.retry());
  await waitCounts({lands:4,plants:4});
  await page.evaluate(() => {window.missionReads.lands[3].reject(new Error('RPC unavailable'));window.missionReads.plants[3].resolve([]);});
  await page.waitForFunction(() => window.missionState.quest.retry === true);

  // A receipt refresh uses the authoritative boundary and does not cancel a shared strong read.
  await page.evaluate(() => {
    const owner='0x1111111111111111111111111111111111111111';
    window.invalidateMissionAssets({address:owner,domains:['lands','buildings'],receiptBlock:90n,source:'test-build'});
  });
  await waitCounts({lands:5});
  assert.equal(await page.evaluate(() => String(window.missionReads.lands[4].blockNumber)), '90');
  await page.evaluate(() => window.missionReads.lands[4].resolve([{tokenId:12n,owner:'0x1111111111111111111111111111111111111111',accumulatedPlantPoints:0n,accumulatedPlantLifetime:0n}]));
  await page.waitForFunction(() => window.missionReads.farms.some(read => read.blockNumber === 90n));
  const receiptIndex = await page.evaluate(() => window.missionReads.farms.findIndex(read => read.blockNumber === 90n));
  await resolveFarms(receiptIndex);
  await page.waitForFunction(() => window.missionState.casino.label === 'Open Casino');

  await page.evaluate(() => {
    const owner='0x1111111111111111111111111111111111111111';
    window.strongReadPromise=window.missionClient.fetchQuery({queryKey:['landsByOwner',owner],staleTime:0,
      queryFn:({signal})=>new Promise(resolve=>{window.strongRead={signal,resolve};})});
    window.missionControl.retry();
  });
  await page.waitForFunction(() => window.missionClient.getQueryState(['landsByOwner','0x1111111111111111111111111111111111111111']).isInvalidated);
  assert.equal(await page.evaluate(() => window.strongRead.signal.aborted), false, 'Manual retry must preserve stronger owner reconciliation');
  assert.equal((await counts()).lands, 5, 'Manual retry must deduplicate the in-flight owner read');
  await page.evaluate(() => window.invalidateMissionAssets({
    address:'0x1111111111111111111111111111111111111111',domains:['lands','buildings'],receiptBlock:105n,source:'test-concurrent-build',
  }));
  assert.equal(await page.evaluate(() => window.strongRead.signal.aborted), false, 'Receipt invalidation must preserve stronger owner reconciliation');
  assert.equal((await counts()).lands, 5, 'No competing owner fetch should replace the strong in-flight read');
  await page.evaluate(() => window.strongRead.resolve([{tokenId:12n,owner:'0x1111111111111111111111111111111111111111',accumulatedPlantPoints:0n,accumulatedPlantLifetime:0n}]));
  await page.waitForFunction(() => window.missionReads.farms.some(read => read.blockNumber === 105n));
  const newerIndex = await page.evaluate(() => window.missionReads.farms.findIndex(read => read.blockNumber === 105n));
  await resolveFarms(newerIndex);
  await page.waitForFunction(() => window.missionState.casino.label === 'Open Casino');
  console.log('PASS mission asset hook: shared cache, wallet isolation, read gating, reopen refresh, independent facet failures, retry, receipt boundaries and concurrent owner reconciliation');
} finally {
  await browser.close();
  await new Promise(resolve => server.close(resolve));
}
