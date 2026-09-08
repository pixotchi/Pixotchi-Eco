// Real PlantsView, care selection and review layout. Wallet, reads and
// transaction boundaries are deterministic; no wallet or chain is contacted.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import path from 'node:path';
import { build } from 'esbuild';
import { chromium, webkit, expect } from '@playwright/test';

const cwd = process.cwd();
const boundary = `
import React, {useSyncExternalStore} from 'react';
export const owner = '0x1111111111111111111111111111111111111111';
export const state = window.missionPlants = {owner, loaded:false, failed:false, shopStatus:'loading', shops:[], mounted:false, visible:false, revision:0, errors:[], sends:[]};
const listeners = new Set();
export function useStateSnapshot(){useSyncExternalStore(fn=>{listeners.add(fn);return()=>listeners.delete(fn)},()=>state.revision);return state;}
state.patch = values => {Object.assign(state,values);state.revision++;listeners.forEach(fn=>fn());};
state.plants = [1,2,3].map(id=>({id,owner,name:'Plant '+id,status:id===3?4:1,level:2,score:0,rewards:0,stars:0,strain:0,extensions:[],timeUntilStarving:Math.floor(Date.now()/1000)+864000}));
export const useAccount=()=>({address:useStateSnapshot().owner});
export const useIsSolanaWallet=()=>false;
export const useTwinAddress=()=>null;
export const SolanaNotSupported=()=>null;
export const useSmartWallet=()=>({isSmartWallet:false,isLoading:false});
export const useTabVisibility=()=>({isTabVisible:()=>true});
export const useOwnerResourceList=()=>{useStateSnapshot();return {items:state.loaded?state.plants:[],isLoading:!state.loaded,isError:state.failed,reconcile:async()=>true}};
export const useItemCatalogs=()=>{useStateSnapshot();return {gardenItems:[{id:'water',name:'Water',price:1,points:0,timeExtension:86400}],shopItems:state.shops,gardenStatus:'ready',shopStatus:state.shopStatus,retryGarden:()=>{},retryShop:()=>{},refreshItemType:async()=>({})}};
export const usePlantProtection=()=>[];
export const useReviveReadiness=()=>({price:{data:1n},balance:{data:10n},allowance:{data:10n},ready:true,requireCurrent:async()=>{}});
export const useQueryClient=()=>({setQueryData:()=>{}});
export const getPlantsByOwner=()=>{throw Error('Unexpected chain read')};
export const PIXOTCHI_NFT_ADDRESS=owner, ADDRESS_REGEX=/^0x/, CREATOR_TOKEN_ADDRESS=owner, CRYPTICPOET_TOKEN_ADDRESS=owner, JESSE_TOKEN_ADDRESS=owner, LEAF_CONTRACT_ADDRESS=owner, PIXOTCHI_TOKEN_ADDRESS=owner;
export const toast={error:message=>state.errors.push(message)};
export const FirstCareGuide=()=>null, PlantClaimSummary=()=>null, SpinPendingBanner=()=>null, EmptyFarm=()=> <p>No plants</p>;
export default function Boundary(props){
 if(props.plant && props.open) return <section role="dialog" aria-label="Arcade" data-plant={props.plant.id}><button onClick={()=>props.onOpenChange(false)}>Close arcade</button></section>;
 if(props.selectedItem) return <div data-review-plant={props.selectedPlant.id} data-review-item={props.selectedItem.id}>Item review</div>;
 if(props.actionCalls) return <button onClick={()=>state.sends.push(props.actionCalls)}>Submit transaction</button>;
 return null;
}
`;
const fixture = `
import React,{Activity,useEffect} from 'react';
import {createRoot} from 'react-dom/client';
import PlantsView from '@/components/tabs/plants-view';
import {openMissionPlant,readMissionPlant,clearMissionPlantForOwner} from '@/lib/mission-plant-navigation';
import {state,useStateSnapshot} from 'mission-boundary';
state.open=openMissionPlant;state.pending=readMissionPlant;
window.addEventListener('pixotchi:navigate-game',event=>state.navigation=event.detail);
function App(){useStateSnapshot();useEffect(()=>clearMissionPlantForOwner(state.owner),[state.owner]);return <main>{state.mounted&&<Activity mode={state.visible?'visible':'hidden'}><PlantsView/></Activity>}</main>}
createRoot(document.getElementById('root')).render(<React.StrictMode><App/></React.StrictMode>);
`;
const mocks = new Set(['components/edit-plant-name','components/plant-claim-summary','components/arcade/spin-pending-banner',
  'components/transactions/approval-action-transaction','components/transactions/claim-rewards-transaction','components/transactions/solana-bridge-button',
  'components/item-details-panel','components/arcade/ArcadeDialog','components/first-care-guide','components/empty-farm','components/solana',
  'components/PlantImage','components/countdown-timer','components/fence-timer','lib/contracts','lib/smart-wallet-context','lib/tab-visibility-context',
  'hooks/useOwnerResourceList','hooks/usePlantProtection','hooks/useReviveReadiness','hooks/useItemCatalogs']);
const bundle = await build({stdin:{contents:fixture,sourcefile:'mission-plant-fixture.jsx',loader:'jsx',resolveDir:cwd},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"','process.env':'{}'},plugins:[{name:'mission-boundaries',setup(builder){
 builder.onResolve({filter:/.*/},args=>{
  if(['mission-boundary','wagmi','@tanstack/react-query','react-hot-toast'].includes(args.path))return {path:'boundary',namespace:'mission'};
  if(args.path==='next/image')return {path:'image',namespace:'mission'};
  if(args.path==='next/dynamic')return {path:'dynamic',namespace:'mission'};
  const resolved=args.path.startsWith('@/')?args.path.slice(2):args.path.startsWith('.')?path.relative(cwd,path.resolve(args.resolveDir,args.path)).replaceAll('\\','/'):'';
  if(mocks.has(resolved.replace(/\.(tsx?|jsx?)$/,'')))return {path:'boundary',namespace:'mission'};
 });
 builder.onLoad({filter:/.*/,namespace:'mission'},args=>({contents:args.path==='image'?'import React from "react";export default function Image({fill,priority,unoptimized,...props}){return <img {...props}/>;}':args.path==='dynamic'?'import React from "react";export default function dynamic(load){const C=React.lazy(load);return props=><React.Suspense fallback={null}><C {...props}/></React.Suspense>;}':boundary,loader:'jsx',resolveDir:cwd}));
}}]});
const server=createServer((req,res)=>{
 if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript');res.end(bundle.outputFiles[0].text);return;}
 if(req.url.startsWith('/icons/')||req.url.startsWith('/PixotchiKit/')){res.writeHead(404);res.end();return;}
 res.setHeader('Content-Type','text/html');res.end('<html><body><div id="root"></div><script src="/fixture.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const origin=`http://127.0.0.1:${server.address().port}`;
try {
 for(const browserType of [chromium,webkit]){
  const browser=await browserType.launch();
  const page=await browser.newPage({viewport:{width:390,height:844}});
  const errors=[];page.on('pageerror',error=>errors.push(error.message));
  const patch=values=>page.evaluate(values=>window.missionPlants.patch(values),values);
  const open=(plantId,action)=>page.evaluate(({plantId,action})=>{const s=window.missionPlants;s.open({owner:s.owner,plantId,action});},{plantId,action});
  const pending=()=>page.evaluate(()=>window.missionPlants.pending());
  const focus=()=>page.evaluate(()=>document.activeElement?.id);
  const reset=async()=>{await page.goto(origin);await page.waitForFunction(()=>window.missionPlants?.open);};
  try {
   // Request precedes lazy mount and data. The second plant must be selected.
   await reset();await open(2,'arcade');
   assert.deepEqual(await page.evaluate(()=>window.missionPlants.navigation),{tab:'dashboard',dashboardView:'plants'});
   await patch({mounted:true,visible:true});await expect.poll(pending).not.toBeNull();
   await patch({loaded:true});await expect(page.getByRole('dialog',{name:'Arcade'})).toHaveAttribute('data-plant','2');await expect.poll(pending).toBeNull();
   await page.getByRole('button',{name:'Close arcade'}).click();
   // Hidden Activity tears down effects. Resuming must pick up the pending intent.
   await patch({visible:false});await open(1,'care');await expect.poll(pending).not.toBeNull();
   await patch({visible:true});await expect.poll(focus).toBe('plant-care');await expect.poll(pending).toBeNull();
   // Protection waits for a current catalog and uses its capability, not an ID.
   await open(2,'protection');await expect.poll(focus).toBe('plant-care');await expect.poll(pending).not.toBeNull();
   await patch({shopStatus:'ready',shops:[{id:'changed-fence-id',name:'New protection',category:'fence-v2',price:1,effectTime:0}]});
   await expect(page.locator('[data-review-item="changed-fence-id"]')).toHaveAttribute('data-review-plant','2');await expect.poll(pending).toBeNull();
   // Explicit care/protection requests for a now-dead plant lead to revival.
   await reset();await patch({mounted:true,visible:true,loaded:true});await open(3,'protection');await expect.poll(focus).toBe('plant-revival');await expect.poll(pending).toBeNull();
   // Manual plant changes cancel a delayed protection intent.
   await reset();await patch({mounted:true,visible:true,loaded:true});await open(1,'protection');await expect.poll(focus).toBe('plant-care');
   await page.getByRole('button',{name:'Next plant'}).click();await expect.poll(pending).toBeNull();
   await patch({shopStatus:'ready',shops:[{id:'new-fence',name:'Fence',category:'fence-v2',price:1,effectTime:0}]});await expect(page.getByRole('dialog')).toHaveCount(0);
   // Choosing a different care item also cancels a pending protection request.
   await reset();await patch({mounted:true,visible:true,loaded:true});await open(1,'protection');await expect.poll(focus).toBe('plant-care');
   await page.getByRole('button',{name:'Select Water',exact:true}).click();await expect.poll(pending).toBeNull();
   await patch({shopStatus:'ready',shops:[{id:'new-fence',name:'Fence',category:'fence-v2',price:1,effectTime:0}]});await expect(page.locator('[data-review-item="water"]')).toBeVisible();await expect(page.locator('[data-review-item="new-fence"]')).toHaveCount(0);
   // A failed owner read must not open a stale owned target.
   await reset();await patch({mounted:true,visible:true,loaded:true,failed:true});await open(2,'arcade');await expect(page.getByRole('dialog')).toHaveCount(0);await expect.poll(pending).not.toBeNull();
   await patch({failed:false});await expect(page.getByRole('dialog',{name:'Arcade'})).toHaveAttribute('data-plant','2');
   // Disconnect while hidden clears the request before reconnecting.
   await reset();await open(2,'arcade');await patch({owner:null});await expect.poll(pending).toBeNull();
   await patch({owner:'0x1111111111111111111111111111111111111111',mounted:true,visible:true,loaded:true});await expect(page.getByRole('dialog')).toHaveCount(0);
   // Missing or foreign-owned IDs cannot open any destination.
   await open(999,'arcade');await expect.poll(pending).toBeNull();await expect(page.getByRole('dialog')).toHaveCount(0);
   await patch({plants:[{id:9,owner:'0x2222222222222222222222222222222222222222',name:'Other wallet',status:1,level:2,score:0,rewards:0,stars:0,strain:0,extensions:[]}]});await open(9,'arcade');await expect.poll(pending).toBeNull();await expect(page.getByRole('dialog')).toHaveCount(0);
   assert.equal(await page.evaluate(()=>window.missionPlants.sends.length),0);
   assert.deepEqual(errors,[]);
   console.log(`${browserType.name()}: lazy mount, Activity resume, correct target, delayed protection, manual cancellation, revival, read failure and owner isolation passed`);
  } finally {await browser.close();}
 }
} finally {await new Promise(resolve=>server.close(resolve));}
