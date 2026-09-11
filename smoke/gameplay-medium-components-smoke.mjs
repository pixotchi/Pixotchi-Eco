// Production gameplay views/hooks/components with deterministic remote-read and
// wallet boundaries. No live wallet, storage export, or transaction submission.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from '@tailwindcss/postcss';
import { chromium, webkit, expect } from '@playwright/test';

const cwd = process.cwd();
const missionsOnly = process.argv.includes('--missions-only');
const refreshOnly = process.argv.includes('--refresh-only');
const batchEligibilityOnly = process.argv.includes('--batch-eligibility-only');
const boundary = `
import React, { useEffect, useRef } from 'react';
const params = new URLSearchParams(location.search);
export const address = '0x1111111111111111111111111111111111111111';
export const state = window.gameplayMedium = { reads: {}, sends: [], errors: [], next: 0, selectedMint: null };
const deferred = (kind, id) => new Promise((resolve,reject) => (state.reads[kind] ||= []).push({id,resolve,reject}));
export const useAccount = () => ({ address: params.has('solana') || params.get('scenario') === 'profile' ? undefined : params.get('scenario') === 'mission-land' ? state.owner : address });
export const useBlockNumber = () => ({ data: 1000n });
export const useBalance = () => ({ data: { value: 1000000000000000000n }, isLoading:false, isError:false, refetch:async()=>{} });
export const useBalances = () => ({ seedBalance:100000000000000000000000n, seedBalanceStatus:'ready', refreshBalances:async()=>{} });
export const useSmartWallet = () => state.smartWallet ?? ({ isSmartWallet:false, isLoading:false });
export const useEthModeSafe = () => ({ isEthMode:false });
export const useIsSolanaWallet = () => params.has('solana');
export const useTwinAddress = () => address;
export const SolanaNotSupported = ({feature}) => <span>{feature} unavailable on Solana</span>;
export const useFarmView = () => ({ setMintType:value=>state.selectedMint=value });
export const useTabVisibility = () => ({ isTabVisible:()=>true });
export const useLandQuestSlots = () => ({ refresh:async()=>{} });
export const useLandMap = () => ({ totalSupply:3, neighborData:{}, supplyStatus:'ready', neighborStatus:'ready', retryMapData:()=>{} });
export const PIXOTCHI_NFT_ADDRESS = address;
export const UNISWAP_ROUTER_ADDRESS = address;
export const WETH_ADDRESS = address;
export const PIXOTCHI_TOKEN_ADDRESS = address;
export const LAND_CONTRACT_ADDRESS = address;
export const LEAF_CONTRACT_ADDRESS = address;
export const JESSE_TOKEN_ADDRESS = address;
export const CREATOR_TOKEN_ADDRESS = address;
export const CRYPTICPOET_TOKEN_ADDRESS = address;
export const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
export const getAllGardenItems = () => deferred('garden');
export const getAllShopItems = () => deferred('shop');
export const checkTokenApproval = () => params.has('allowance') ? deferred('allowance') : Promise.resolve(100000000000000000000000n);
export const getFenceV2Config = () => deferred('config');
export const quoteFenceV2 = days => deferred('fence', days);
export const buildFenceV2PurchaseCall = (id,days) => ({address,functionName:'fenceV2Purchase',args:[BigInt(id),BigInt(days)]});
export const getEthQuoteForSeedAmount = () => deferred('eth');
export const getPlantNameChangePrice = () => deferred('namePrice');
export const getRevivePrice = () => deferred('revivePrice');
export const getTokenBalance = () => deferred('balance');
export const getPlantsByOwner = () => deferred('profilePlants');
export const getLandsByOwner = () => deferred('profileLands');
export const getStakeInfo = () => deferred('stake');
export const fetchEfpStats = () => deferred('social');
export const getVillageBuildingsByLandId = id => deferred('village',Number(id));
export const getTownBuildingsByLandId = id => deferred('town',Number(id));
export const barracksGetLandStateV2 = async () => ({isBuilt:false});
export const casinoIsBuilt = async () => params.get('scenario') === 'mission-land';
export const getLandById = async id => state.lands?.find(land=>land.tokenId===id);
export const checkLeafTokenApproval = () => deferred('landLeaf');
export const checkLandSpeedUpApproval = () => deferred('landSeed');
export const useOwnerResourceList = () => ({ isError:false,isLoading:state.landsLoaded===false,items:state.landsLoaded===false?[]:state.lands,reconcile:async()=>{} });
export const usePrimaryName = () => ({ name:'a-very-long-player-identity-that-must-remain-readable.base.eth', loading:false });
export const useTransactions = () => ({pendingTxs:[],txModalOpen:false,setTxModalOpen:()=>{}});
export const FollowButton = () => <button>Follow</button>;
export const ListRecordContracts = {};
export const formatListOpsTransaction = () => ({});
export const listOpAddListRecord = () => ({});
export const listOpRemoveListRecord = () => ({});
export const listOpRemoveTag = () => ({});
export const prepareMintTransaction = () => ({});
export const LandMapModal = () => null;
export const fetchFollowState = async () => false;
export const fetchProfileLists = async () => ({});
export const postMissionProgress = async () => ({ok:true});
export function Transaction(props) {
 const id = useRef(++state.next);
 const click = async () => { try { await props.onButtonClick?.(); await props.onBeforeSubmit?.(); state.sends.push(props.calls || props.actionCalls || { actionType:props.actionType,plantId:props.plantId,name:props.name }); } catch(error) {state.errors.push(error.message);props.onError?.(error);} };
 return <button data-controller={id.current} disabled={props.disabled} onClick={click}>{props.buttonText || 'Buy Item'}</button>;
}
export default function Boundary(props) {
 if (props.variant === 'embedded' && 'lands' in props) return <div data-batch-panel>Batch utility panel</div>;
 if ('selectedBuilding' in props) return <div data-detail-land={String(props.landId)} data-detail-building={props.selectedBuilding.id}>Details level {props.selectedBuilding.level}<button disabled={!props.allowancesReady}>Upgrade</button>{props.allowancesError && <button onClick={props.onRetryAllowances}>Retry land permission</button>}</div>;
 return <Transaction {...props} />;
}
`;
const fixture = `
import React, { Activity, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useCareSelection } from '@/hooks/useCareSelection';
import { careItemRevision } from '@/lib/care-catalog';
import { PlantCareCatalog } from '@/components/plant-care-catalog';
import ItemDetailsPanel from '@/components/item-details-panel';
import EditPlantName from '@/components/edit-plant-name';
import PlantProfileDialog from '@/components/plant-profile-dialog';
import LandsView from '@/components/tabs/lands-view';
import { EmptyFarm } from '@/components/empty-farm';
import { useReviveReadiness } from '@/hooks/useReviveReadiness';
import { GAME_NAVIGATION_EVENT } from '@/lib/game-navigation';
import { clearMissionLandForOwner, getPendingMissionLand, openMissionLand } from '@/lib/mission-navigation';
import { state, address } from 'medium-boundary';
const params = new URLSearchParams(location.search);
const plant = { id:7,name:'Original',owner:address,status:1,level:1,score:0,rewards:0,stars:0,strain:0,extensions:[],timeUntilStarving:Math.floor(Date.now()/1000)+864000,fenceV2:{v1Active:false,isActive:false,activeUntil:0} };
state.lands = [1,2].map(id=>({tokenId:BigInt(id),name:'Land '+id,owner:address,coordinateX:BigInt(id),coordinateY:0n,experiencePoints:0n,accumulatedPlantPoints:0n,accumulatedPlantLifetime:0n}));
state.allLands = state.lands;
const client = new QueryClient({defaultOptions:{queries:{retry:false,refetchOnWindowFocus:false}}});
state.client=client;
window.addEventListener(GAME_NAVIGATION_EVENT,e=>state.navigation=e.detail);
function Care() {
 const s=useCareSelection();state.care=s;
 return <><PlantCareCatalog {...s.catalogs} selectedItem={s.item} itemType={s.itemType} onRetryGarden={()=>s.catalogs.retryGarden()} onRetryShop={()=>s.catalogs.retryShop()}
 onSelect={({item,itemType})=>s.setSelection({id:item.id,itemType,reviewedRevision:careItemRevision(item,itemType)})} />
 {s.selection && <ItemDetailsPanel selectedItem={s.item} selectedPlant={plant} itemType={s.itemType} quantity={1} catalogStatus={s.status} catalogChanged={s.changed}
 onBeforePurchase={s.requireCurrent} onReviewCatalog={()=>s.setSelection({...s.selection,reviewedRevision:careItemRevision(s.item,s.itemType)})} onRetryCatalog={()=>s.catalogs.refreshItemType(s.itemType)} onPurchaseSuccess={()=>{}} />}</>;
}
function Revive() { const r=useReviveReadiness(address,7,true);state.revive=r;return <><button disabled={!r.ready} onClick={async()=>{try{await r.requireCurrent();state.sends.push('revive')}catch(e){state.errors.push(e.message)}}}>Revive</button>{['price','balance','allowance'].map(k=><button key={k} onClick={()=>r[k].refetch()}>Retry {k}</button>)}<output>{r.price.data?.toString()||'Unknown'}</output></>; }
function MissionLand() {
 const [mounted,setMounted]=useState(false),[visible,setVisible]=useState(true),[revision,setRevision]=useState(0);
 useEffect(()=>clearMissionLandForOwner(state.owner),[revision]);
 state.mission={open:openMissionLand,pending:getPendingMissionLand,mount:()=>setMounted(true),hide:()=>setVisible(false),show:()=>setVisible(true),
  load:()=>{state.landsLoaded=true;setRevision(n=>n+1)},
  owner:next=>{state.owner=next;setRevision(n=>n+1)}};
 return <><button onClick={()=>setVisible(false)}>Hide lands</button><Activity mode={visible?'visible':'hidden'}>{mounted?<LandsView/>:null}</Activity></>;
}
const scenario=params.get('scenario');
function BatchEligibility() {
 const [,setRevision]=useState(0);
 state.batchEligibility=(smart,count,loading=false)=>{state.smartWallet={isSmartWallet:smart,isLoading:loading};state.lands=state.allLands.slice(0,count);setRevision(n=>n+1)};
 return <LandsView/>;
}
if(scenario==='mission-land'){state.owner=address;state.landsLoaded=false;localStorage.setItem('pixotchi:selected-land-id','1');localStorage.setItem('pixotchi:selected-building-type','village');localStorage.setItem('pixotchi:selected-building-id','0');}
const app=scenario==='batch-eligibility'?<BatchEligibility/>:scenario==='mission-land'?<MissionLand/>:scenario==='lands'?<LandsView/>:scenario==='profile'?<PlantProfileDialog open onOpenChange={()=>{}} plant={plant}/>:scenario==='rename'?<EditPlantName plant={plant}/>:scenario==='empty'?<><EmptyFarm asset="plant"/><EmptyFarm asset="land"/></>:scenario==='revive'?<Revive/>:scenario==='fence'?<ItemDetailsPanel selectedItem={{id:'8',name:'Fence',category:'fence-v2',price:1n,effectTime:0}} selectedPlant={plant} itemType="shop" quantity={1} onPurchaseSuccess={()=>{}}/>:<Care/>;
createRoot(document.getElementById('root')).render(<QueryClientProvider client={client}><main style={{maxWidth:['lands','mission-land','batch-eligibility'].includes(scenario)?'none':420,margin:'auto',padding:16}}>{app}</main></QueryClientProvider>);
`;
const mocks = new Set(['lib/contracts','lib/balance-context','lib/smart-wallet-context','lib/eth-mode-context','lib/mission-tracking','lib/farm-view-context','lib/tab-visibility-context','lib/efp-service',
  'components/solana','components/hooks/usePrimaryName','components/transactions/game-transaction','components/transactions/solana-bridge-button','components/transactions/swap-buy-item-bundle','components/transactions/swap-fence-purchase-bundle',
  'components/transactions/batch-claim-card','components/transactions/batch-quest-start-card','components/building-details-panel','components/map/land-map-modal','hooks/useOwnerResourceList','hooks/useLandMap','hooks/useLandQuestSlots']);
const bundle = await build({ stdin:{contents:fixture,sourcefile:'medium-fixture.jsx',resolveDir:cwd,loader:'jsx'},bundle:true,write:false,outfile:'medium-fixture.js',format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"','process.env.NEXT_PUBLIC_CASINO_ENABLED':JSON.stringify(missionsOnly?'true':'false'),'process.env':'{}'},
 plugins:[{name:'medium-boundaries',setup(builder){
  builder.onResolve({filter:/.*/},args=>{
   if(['medium-boundary','wagmi','ethereum-identity-kit'].includes(args.path))return {path:'boundary',namespace:'medium'};
   if(args.path==='ethereum-identity-kit/css')return {path:'empty',namespace:'medium'};
   if(args.path==='next/image')return {path:'image',namespace:'medium'};
   if(args.path==='next/dynamic')return {path:'dynamic',namespace:'medium'};
   const resolved=args.path.startsWith('@/')?args.path.slice(2):args.path.startsWith('.')?path.relative(cwd,path.resolve(args.resolveDir,args.path)).replaceAll('\\','/'):'';
   if(mocks.has(resolved.replace(/\.(tsx?|jsx?)$/,'')))return {path:'boundary',namespace:'medium'};
  });
  builder.onLoad({filter:/.*/,namespace:'medium'},args=>({contents:args.path==='empty'?'':args.path==='image'?'import React from "react"; export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>;}':args.path==='dynamic'?'import React from "react";export default function dynamic(load,{loading:Loading}={}){const C=React.lazy(load);return props=><React.Suspense fallback={Loading?<Loading/>:null}><C {...props}/></React.Suspense>;}':boundary,loader:'jsx',resolveDir:cwd}));
 }}]});
const cssPath=path.join(cwd,'app/globals.css');
const css=(await postcss([tailwind()]).process(await readFile(cssPath,'utf8'),{from:cssPath})).css + bundle.outputFiles.filter(file=>file.path.endsWith('.css')).map(file=>file.text).join('\n');
const server=createServer(async(req,res)=>{
 if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles.find(file=>file.path.endsWith('.js')).text);return;}
 if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css');res.end(css + `@font-face{font-family:Coinbase;src:url('/fonts/Coinbase-Sans/Coinbase_Sans-Regular-web-1.32.woff2');font-weight:400}@font-face{font-family:Coinbase;src:url('/fonts/Coinbase-Sans/Coinbase_Sans-Medium-web-1.32.woff2');font-weight:500 600}@font-face{font-family:Coinbase;src:url('/fonts/Coinbase-Sans/Coinbase_Sans-Bold-web-1.32.woff2');font-weight:700}@font-face{font-family:Pixelmix;src:url('/fonts/pixelmix.woff2')}html{--font-coinbase:Coinbase;--font-pixel:Pixelmix}body{font-family:Coinbase,sans-serif}`);return;}
 if(req.url.startsWith('/icons/')||req.url.startsWith('/PixotchiKit/')||req.url.startsWith('/fonts/')){try{res.setHeader('Content-Type',req.url.endsWith('.svg')?'image/svg+xml':req.url.endsWith('.woff2')?'font/woff2':'image/png');res.end(await readFile(path.join(cwd,'public',req.url)));}catch{res.writeHead(404);res.end();}return;}
 res.setHeader('Content-Type','text/html');res.end('<html class="light"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
await mkdir('output/medium-gameplay',{recursive:true});

async function run(browserType,viewport){
 const browser=await browserType.launch();const page=await browser.newPage({viewport});const pageErrors=[];
 page.on('pageerror',e=>pageErrors.push(e.message));
 const go=async query=>{await page.goto(origin+'/?'+query);await page.waitForFunction(()=>window.gameplayMedium);};
 const settle=async(kind,value,fail=false)=>{await page.waitForFunction(k=>window.gameplayMedium.reads[k]?.length,kind);await page.evaluate(({kind,value,fail})=>{const r=window.gameplayMedium.reads[kind].shift();if(fail)r.reject(new Error('Injected read failure'));else r.resolve(value);},{kind,value,fail});};
  const garden=price=>[{id:'1',name:'Water',price,points:0,timeExtension:86400},{id:'2',name:'Mystery sprout',price:2n,points:0,timeExtension:0}];
 try {
  if(refreshOnly) {
   await go('scenario=lands');
   const village = [{id:0,level:1,maxLevel:4,isUpgrading:false}];
   const town = [{id:7,level:1,maxLevel:3,isUpgrading:false}];
   await settle('village',village);await settle('town',town);await settle('landLeaf',10n);await settle('landSeed',10n);
   const grid=page.getByLabel('Choose a building',{exact:true});
   const choose=async(type,name)=>{
    if(viewport.width<1280)await page.getByRole('radio',{name:type,exact:true}).click();
    await page.getByRole('button',{name:'Select '+name,exact:true}).click();
   };
   const outstanding=()=>page.evaluate(()=>Object.fromEntries(['village','town'].map(k=>[k,window.gameplayMedium.reads[k].map(r=>r.id)])));
   await choose('Town','Warehouse');await choose('Village','Solar Panels');await choose('Town','Warehouse');
   assert.deepEqual(await outstanding(),{village:[],town:[]},'Selecting cached buildings must not refetch either area');
   const documentTop=()=>grid.evaluate(el=>el.getBoundingClientRect().top+scrollY);
   const originalTop=await documentTop();
   const status=page.getByRole('status').filter({has:page.locator('svg')});
   await page.clock.install();
   const refresh=()=>page.evaluate(()=>window.dispatchEvent(new Event('buildings:refresh')));
   await refresh();await expect(grid).toHaveAttribute('aria-busy','true');await page.clock.runFor(350);
   await expect(status).toHaveCount(0);assert.equal(await documentTop(),originalTop);
   await settle('village',village);await settle('town',town);await expect(grid).toHaveAttribute('aria-busy','false');
   await page.clock.runFor(600);await expect(status).toHaveCount(0);assert.equal(await documentTop(),originalTop);
   await refresh();await expect(grid).toHaveAttribute('aria-busy','true');await page.clock.runFor(600);
   await expect(page.getByTitle('Refreshing buildings',{exact:true})).toBeVisible();assert.equal(await documentTop(),originalTop);
   await grid.locator('..').locator('..').locator('..').screenshot({path:'output/medium-gameplay/'+browserType.name()+'-'+viewport.width+'-refresh-slow.png'});
   await choose('Village','Solar Panels');await choose('Town','Warehouse');
   assert.deepEqual(await outstanding(),{village:[1],town:[1]},'Changing areas during refresh must share the land request');
   await settle('village',village);await settle('town',town);await expect(grid).toHaveAttribute('aria-busy','false');
   await expect(page.locator('[data-detail-building="3"]')).toBeVisible();assert.equal(await documentTop(),originalTop);
   await expect(status).toHaveCount(0);
   await grid.locator('..').locator('..').locator('..').screenshot({path:'output/medium-gameplay/'+browserType.name()+'-'+viewport.width+'-refresh-settled.png'});
   // A superseded land must neither replace the new snapshot nor consume its follow-up.
   await refresh();await page.getByRole('button',{name:'Next land'}).click();
   await expect(page.locator('[data-detail-land="1"]')).toHaveCount(0);
   await refresh();await settle('village',village);await settle('town',town);
   await expect(page.locator('[data-detail-land="1"]')).toHaveCount(0);await expect(grid).toHaveAttribute('aria-busy','true');
   await settle('village',[{...village[0],level:4}]);await settle('town',town);await page.clock.runFor(1);
   assert.deepEqual(await outstanding(),{village:[2],town:[2]},'Only the current land may drain its queued refresh');
   await settle('village',[{...village[0],level:4}]);await settle('town',town);await expect(grid).toHaveAttribute('aria-busy','false');
   await choose('Village','Solar Panels');await expect(page.locator('[data-detail-land="2"]')).toContainText('Details level 4');
   assert.deepEqual(pageErrors,[]);console.log(browserType.name()+' '+viewport.width+': cached area selection, fast/slow refresh without layout shift, selection preservation, and stale-land queue passed');
   return;
  }
  if(batchEligibilityOnly) {
   await go('scenario=batch-eligibility');
   await settle('village',[{id:0,level:1,maxLevel:4,isUpgrading:false}]);await settle('town',[{id:7,level:1,maxLevel:3,isUpgrading:false}]);await settle('landLeaf',10n);await settle('landSeed',10n);
   const configure=async(smart,count,loading=false)=>page.evaluate(({smart,count,loading})=>window.gameplayMedium.batchEligibility(smart,count,loading),{smart,count,loading});
   const claim=page.getByRole('button',{name:'Open batch claim',exact:true});
   const quests=page.getByRole('button',{name:'Open batch quests',exact:true});
   for(const [smart,count,loading] of [[false,2,false],[false,1,false],[true,1,false],[true,2,true]]) {
    await configure(smart,count,loading);
    for(const section of ['village','town']) {
     if(viewport.width<1280)await page.getByRole('radio',{name:section==='village'?'Village':'Town',exact:true}).click();
     await expect(claim).toHaveCount(0);await expect(quests).toHaveCount(0);
    }
   }
   await configure(true,2);
   if(viewport.width<1280)await page.getByRole('radio',{name:'Village',exact:true}).click();
   await expect(claim).toBeVisible();await claim.click();await expect(page.locator('[data-batch-panel]')).toBeVisible();
   await configure(false,2);await expect(claim).toHaveCount(0);await expect(page.locator('[data-batch-panel]')).toHaveCount(0);
   await configure(true,2);
   if(viewport.width<1280)await page.getByRole('radio',{name:'Town',exact:true}).click();
   await expect(quests).toBeVisible();await quests.click();await expect(page.locator('[data-batch-panel]')).toBeVisible();
   await configure(true,1);await expect(quests).toHaveCount(0);await expect(page.locator('[data-batch-panel]')).toHaveCount(0);
   assert.deepEqual(pageErrors,[]);console.log(browserType.name()+' '+viewport.width+': batch eligibility, pending detection, and loss of wallet/land eligibility passed');
   return;
  }
  if(missionsOnly) {
   const target={owner:'0x1111111111111111111111111111111111111111',landId:'2',buildingType:'town',buildingId:7};
   const settleBuildings=async({fail=false}={})=>{
    await page.waitForFunction(()=>window.gameplayMedium.reads.village?.length&&window.gameplayMedium.reads.town?.length);
    await page.evaluate(fail=>{const s=window.gameplayMedium;for(const kind of ['village','town'])for(const r of s.reads[kind].splice(0)){if(fail)r.reject(new Error('Injected building read failure'));else r.resolve(kind==='village'?[{id:0,level:1,maxLevel:4,isUpgrading:false}]:[{id:7,level:1,maxLevel:3,isUpgrading:false}]);}},fail);
   };
   const open=async(next=target)=>page.evaluate(t=>window.gameplayMedium.mission.open(t),next);
   const pending=()=>page.evaluate(()=>window.gameplayMedium.mission.pending());
   const details=page.getByRole('region',{name:'Selected building details'});
   await go('scenario=mission-land');
   await open();await expect.poll(pending).toMatchObject(target);
   await expect(page.getByText('Buildings',{exact:true})).toHaveCount(0);
   await page.evaluate(()=>window.gameplayMedium.mission.mount());
   await expect(page.getByText('Loading your lands...', {exact:true})).toHaveCount(1);
   await expect.poll(pending).toMatchObject(target);
   await page.evaluate(()=>window.gameplayMedium.mission.load());
   await page.waitForFunction(()=>window.gameplayMedium.reads.village?.length>=1);
   assert.equal(await page.evaluate(()=>window.gameplayMedium.reads.village.every(read=>read.id===2)),true,'Stored land must not replace the mission destination');
   await settleBuildings();
   await expect(page.locator('[data-detail-land="2"][data-detail-building="7"]')).toBeVisible();
   await expect(details).toBeFocused();await expect.poll(pending).toBeNull();
   assert.deepEqual(await page.evaluate(()=>window.gameplayMedium.navigation),{tab:'dashboard',dashboardView:'lands'});

   // A fresh click on the same already-loaded target must focus it again.
   await page.getByRole('button',{name:'Hide lands'}).focus();await open();await expect(details).toBeFocused();await expect.poll(pending).toBeNull();
   await open({...target,buildingId:6});
   await expect(page.locator('[data-detail-land="2"][data-detail-building="6"]')).toBeVisible();await expect(details).toBeFocused();

   // New requests survive Activity cleanup and beat an older unfinished read.
   await page.getByRole('button',{name:'Hide lands'}).click();
   await open({...target,landId:'1',buildingId:6});await open({...target,landId:'1'});
   await expect.poll(pending).toMatchObject({...target,landId:'1'});
   await page.evaluate(()=>window.gameplayMedium.mission.show());
   await settleBuildings({fail:true});await expect(page.getByText('Buildings unavailable',{exact:true})).toBeVisible();
   await expect.poll(pending).toMatchObject({...target,landId:'1'});
   await page.getByRole('button',{name:/Retry/}).filter({visible:true}).click();
   await settleBuildings();
   await expect(page.locator('[data-detail-land="1"][data-detail-building="7"]')).toBeVisible();await expect(details).toBeFocused();await expect.poll(pending).toBeNull();

   await open({...target,landId:'1',buildingId:999});await expect.poll(pending).toBeNull();
   await expect(page.locator('[data-detail-building="999"]')).toHaveCount(0);
   await open({...target,landId:'99'});await expect.poll(pending).toBeNull();
   await expect(page.locator('[data-detail-land="99"]')).toHaveCount(0);
   await open({...target,owner:'0x2222222222222222222222222222222222222222'});await expect.poll(pending).toBeNull();

   // The continuously mounted owner lifecycle discards A→B→A while hidden.
   await page.getByRole('button',{name:'Hide lands'}).click();await open(target);
   await page.evaluate(()=>window.gameplayMedium.mission.owner('0x2222222222222222222222222222222222222222'));
   await expect.poll(pending).toBeNull();
   await page.evaluate(()=>window.gameplayMedium.mission.owner('0x1111111111111111111111111111111111111111'));
   await page.evaluate(()=>window.gameplayMedium.mission.show());await expect.poll(pending).toBeNull();
   assert.deepEqual(pageErrors,[]);
   console.log(browserType.name()+' '+viewport.width+': mission land lazy mount, owner list delay, exact land/building, repeat, Activity resume, latest click, retry, absent targets, and hidden owner swap passed');
   return;
  }
  await go('scenario=care');await expect(page.getByRole('status',{name:'Loading garden items'})).toBeVisible();
  await settle('garden',garden(1000000000000000000n));await settle('shop',null,true);
  await expect(page.getByRole('button',{name:'Select Water',exact:true})).toBeVisible();await expect(page.getByRole('button',{name:'Select Mystery sprout'})).toBeVisible();await expect(page.getByText('Shop items unavailable',{exact:true})).toBeVisible();
  await page.getByRole('button',{name:'Select Water',exact:true}).click();await expect(page.getByRole('button',{name:'Buy Water',exact:true})).toBeEnabled();
  await page.evaluate(items=>window.gameplayMedium.client.setQueryData(['item-catalogs','garden'],items),garden(2000000000000000000n));
  await expect(page.getByText('The price or effects changed. Review the updated details before buying.')).toBeVisible();await expect(page.getByRole('button',{name:'Review updated price and effects'})).toBeDisabled();
  await page.getByRole('button',{name:'Use updated details'}).click();await page.getByRole('button',{name:'Buy Water',exact:true}).click();await settle('garden',garden(3000000000000000000n));
  await expect.poll(()=>page.evaluate(()=>window.gameplayMedium.errors.length)).toBe(1);assert.equal(await page.evaluate(()=>window.gameplayMedium.sends.length),0);
  await page.getByRole('button',{name:'Use updated details'}).click();await page.getByRole('button',{name:'Buy Water',exact:true}).click();await settle('garden',garden(3000000000000000000n));
  await expect.poll(()=>page.evaluate(()=>window.gameplayMedium.sends.length)).toBe(1);
  await page.getByRole('button',{name:'Retry',exact:true}).click();await settle('shop',[{id:'44',name:'New charm',category:'shop',price:9n,effectTime:0}]);await expect(page.getByRole('button',{name:'Select New charm'})).toBeVisible();
  await page.evaluate(()=>window.gameplayMedium.client.setQueryData(['item-catalogs','garden'],[]));await expect(page.getByText(/This item is no longer available/)).toBeVisible();

  await go('scenario=fence');await settle('config',null,true);await expect(page.getByRole('button',{name:'Retry fence duration rules'})).toBeVisible();await expect(page.getByLabel('Duration (days):')).toHaveCount(0);
  await page.getByRole('button',{name:'Retry fence duration rules'}).click();await settle('config',{minDurationDays:2,maxDurationDays:5,pricePerDay:1n});await settle('fence',null,true);
  await expect(page.getByLabel('Duration (days):')).toHaveValue('2');await page.getByRole('button',{name:'Retry fence quote'}).click();await settle('fence',2n);await expect(page.getByRole('button',{name:'Buy Fence (2 days)'})).toBeEnabled();
  await page.screenshot({path:'output/medium-gameplay/'+browserType.name()+'-'+viewport.width+'-fence.png'});

  await go('scenario=revive&allowance=1');await settle('revivePrice',null,true);await settle('balance',10n);await settle('allowance',10n);await expect(page.getByRole('button',{name:'Revive',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Retry price',exact:true}).click();await settle('revivePrice',5n);await expect(page.getByRole('button',{name:'Revive',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Revive',exact:true}).click();await settle('revivePrice',7n);await settle('balance',10n);await settle('allowance',10n);await expect.poll(()=>page.evaluate(()=>window.gameplayMedium.errors.length)).toBe(1);assert.equal(await page.evaluate(()=>window.gameplayMedium.sends.length),0);

  await go('scenario=rename&solana=1');await page.getByRole('button',{name:'Change plant name',exact:true}).click();await settle('namePrice',null);await expect(page.getByRole('button',{name:'Retry rename price'})).toBeVisible();
  await page.getByRole('button',{name:'Retry rename price'}).click();await settle('namePrice',3n);await page.getByLabel('New name',{exact:true}).fill('Twin plant');await expect(page.getByRole('button',{name:'Change Name (via Bridge)'})).toBeEnabled();
  await page.getByRole('button',{name:'Change Name (via Bridge)'}).click();await settle('namePrice',3n);await expect.poll(()=>page.evaluate(()=>window.gameplayMedium.sends.length)).toBe(1);
  assert.deepEqual(await page.evaluate(()=>window.gameplayMedium.sends[0]),{actionType:'setName',plantId:7,name:'Twin plant'});

  await go('scenario=rename&allowance=1');await page.getByRole('button',{name:'Change plant name',exact:true}).click();await settle('namePrice',3n);await settle('allowance',null,true);
  await page.getByLabel('New name',{exact:true}).fill('Renamed plant');await expect(page.getByRole('button',{name:'SEED permission unavailable',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Retry SEED permission',exact:true}).click();await settle('allowance',10n);
  await expect(page.getByLabel('New name',{exact:true})).toHaveValue('Renamed plant');await expect(page.getByRole('button',{name:/^Change Name \(/})).toBeDisabled();
  await expect(page.getByRole('alert')).toContainText('This name is too long.');await page.getByLabel('New name',{exact:true}).fill('New plant');await expect(page.getByRole('button',{name:/^Change Name \(/})).toBeEnabled();

  await go('scenario=profile');await settle('profilePlants',[{},{}]);await settle('profileLands',null,true);await settle('stake',{staked:0n,rewards:0n});await settle('social',null);
  await expect(page.getByText('Lands unavailable',{exact:true})).toBeVisible();await expect(page.getByText('Social counts unavailable',{exact:true})).toBeVisible();await expect(page.getByText('No social data available')).toHaveCount(0);
  await page.getByRole('alert').filter({hasText:'Social counts unavailable'}).getByRole('button',{name:'Retry'}).click();await settle('social',{followersCount:0,followingCount:0});await expect(page.getByText('Followers',{exact:true})).toBeVisible();assert.equal(await page.getByText('Followers',{exact:true}).evaluate(el=>getComputedStyle(el.parentElement).cursor),'auto');
  await page.screenshot({path:'output/medium-gameplay/'+browserType.name()+'-'+viewport.width+'-profile.png'});

  await go('scenario=empty');await page.getByRole('button',{name:'Get your first land'}).click();assert.equal(await page.evaluate(()=>window.gameplayMedium.selectedMint),'land');await expect.poll(()=>page.evaluate(()=>JSON.stringify(window.gameplayMedium.navigation))).toContain('mint');

  await go('scenario=lands');await settle('village',[{id:0,level:1,maxLevel:4,isUpgrading:false}]);await settle('town',[]);await settle('landLeaf',null,true);await settle('landSeed',0n);
  await expect(page.getByRole('button',{name:'Select Solar Panels'})).toBeVisible();await expect(page.getByRole('button',{name:'Upgrade',exact:true})).toBeDisabled();
  await page.getByRole('button',{name:'Retry land permission'}).click();await settle('landLeaf',10n);await settle('landSeed',10n);await expect(page.getByRole('button',{name:'Upgrade',exact:true})).toBeEnabled();
  await page.getByRole('button',{name:'Next land'}).click();await expect(page.locator('[data-detail-land="1"]')).toHaveCount(0);await expect(page.getByRole('button',{name:'Select Solar Panels'})).toHaveCount(0);
  await settle('village',[{id:0,level:4,maxLevel:4,isUpgrading:false},{id:3,level:1,maxLevel:4,isUpgrading:false},{id:5,level:1,maxLevel:4,isUpgrading:false}]);await settle('town',[]);
  await page.getByRole('button',{name:'Select Solar Panels'}).click();await expect(page.locator('[data-detail-land="2"]')).toContainText('Details level 4');
  if(viewport.width<1280)await expect(page.getByRole('region',{name:'Selected building details'})).toBeFocused();
  await expect(page.getByRole('button',{name:'Back to buildings'})).toHaveCount(0);
  const tiles=page.locator('button[aria-label^="Select "]');const rects=await tiles.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}));for(const r of rects){assert.ok(r.w>=44&&r.h>=44);assert.ok(r.x>=0&&r.x+r.w<=viewport.width+1);}
  await page.screenshot({path:'output/medium-gameplay/'+browserType.name()+'-'+viewport.width+'-lands.png'});
  await page.addStyleTag({content:'html{font-size:200%}'});
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth)).toBe(viewport.width);
  const zoomRects=await tiles.evaluateAll(nodes=>nodes.map(n=>{const r=n.getBoundingClientRect();return {x:r.x,w:r.width}}));for(const r of zoomRects)assert.ok(r.w>=44&&r.x+r.w<=viewport.width+1);
  assert.equal(await tiles.evaluateAll(nodes=>nodes.some(node=>node.scrollWidth>node.clientWidth+1)),false);
  await tiles.first().scrollIntoViewIfNeeded();
  await page.screenshot({path:'output/medium-gameplay/'+browserType.name()+'-'+viewport.width+'-lands-200pct.png'});
  assert.deepEqual(pageErrors,[]);console.log(browserType.name()+' '+viewport.width+': catalog, stale review, fence/read recovery, revive, twin rename, profile, empty CTA, land switch/reveal passed');
 } finally {await browser.close();}
}
try{await run(chromium,{width:320,height:720});await run(webkit,{width:820,height:1180});await run(chromium,{width:1440,height:900});}finally{await new Promise(resolve=>server.close(resolve));}
