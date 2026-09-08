// Actual building panels/hooks and primitives; only wallet/RPC/transaction boundaries are controlled.
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { createServer } from 'node:http';
import assert from 'node:assert/strict';
import path from 'node:path';

const previewEnabled = process.argv.includes('--preview');
const shared = `import React from 'react'; const S=()=>window.buildingTest;`;
const transaction = `${shared} import RealTransaction from 'building-real-game-transaction'; export default function Transaction(p){if(S().realTransactions)return <RealTransaction {...p} onError={e=>{S().lastError=e.message;S().render();p.onError?.(e)}}/>;return <button disabled={p.disabled} onClick={async()=>{try{await p.onButtonClick?.();if(p.disabled)return;S().sends++;if(S().complete)await p.onSuccess?.({});}catch(e){S().lastError=e.message;S().render();}}}>{p.buttonText}</button>}`;
const mocks = {
  wagmi: `${shared} import {useWalletClient as coreWallet} from 'building-core-wallet';export const useChainId=()=>8453;export const useAccount=()=>({address:S().owner,connector:{id:'transaction-core-fixture'}});export const useWalletClient=()=>S().realTransactions?coreWallet():({data:{}});export const useBlockNumber=()=>({data:S().block});
    export const useBalance=()=>({data:S().balanceMode==='loading'?undefined:{value:S().balance,decimals:6},isError:S().balanceMode==='error',refetch:async()=>{if(!S().balanceRetryFailure)S().balanceMode='ready';S().render();return {data:{value:S().balance}}}});`,
  'next/image': `${shared} export default function Image({fill,unoptimized,priority,...props}){return <img {...props}/>}`,
  '@/hooks/useTokenMetadata': `${shared} export const useTokenMetadata=()=>({symbol:S().metadataError?undefined:'TEST',decimals:S().metadataError?undefined:6,isReady:!S().metadataError,isError:S().metadataError,isLoading:false,refetch:async()=>{S().metadataError=false;S().render()}});`,
  '@/lib/env-config': `export const CLIENT_ENV={BARRACKS_PREVIEW_ENABLED:${previewEnabled}};`,
  '@/lib/casino-client': `export const getClientCasinoPolicy=()=>({playable:true,blackjackEnabled:true});`,
  '@/lib/transaction-refresh': `export const dispatchPostTransactionRefresh=()=>{};`,
  '@/lib/balance-context': `${shared} export const useBalances=()=>({pixotchiBalance:S().balance,leafBalance:S().balance,pixotchiBalanceStatus:S().balanceMode==='loading'?'unknown':S().balanceMode,leafBalanceStatus:S().balanceMode==='loading'?'unknown':S().balanceMode,balanceError:S().balanceMode==='error'?'balance unavailable':null,refreshBalances:async()=>{}});`,
  '@/components/transactions/building-upgrade-transaction': transaction,
  '@/components/transactions/building-speedup-transaction': transaction,
  '@/lib/mission-tracking': `export const postMissionProgress=()=>{};`,
  '@/lib/tab-visibility-context': `export const useTabVisibility=()=>({isTabVisible:()=>true});`,
  '@/hooks/useLandQuestSlots': `${shared} export const useLandQuestSlots=()=>({slots:S().slots,loading:S().questLoading,error:null,refresh:async()=>{}});`,
  '@/components/transactions/game-transaction': transaction,
  'wagmi/experimental': `export {useShowCallsStatus} from 'building-core-wallet';`,
  '@/lib/base-rpc': `export {waitForBaseReceipt, BaseRpcError, getBaseReadClient} from 'building-core-wallet';`,
  '@/lib/smart-wallet-context': `export {useSmartWallet} from 'building-core-wallet';`,
  '@/lib/owner-resource-invalidation': `export {reconcileOwnerResources,onOwnerResourceInvalidation,ownerInvalidationMatches,invalidateOwnerResources} from 'building-core-wallet';`,
  '@vercel/analytics': `export const track=()=>{};`,
  '@/lib/open-external': `export const handleExternalAnchorClick=()=>{};export const openExternalUrl=async()=>{};`,
  '@/lib/paymaster-context': `export const usePaymaster=()=>({isSponsored:false});`,
  '@/lib/builder-code': `export const getBuilderCapabilities=()=>({});export const transformCallsWithBuilderCode=calls=>calls;`,
  '@/lib/farcaster-miniapp-auth-client': `export const getMiniAppQuickAuthHeaders=async()=>({});`,
  '@/components/transactions/CasinoDialog': `${shared} export default p=>p.open?<div><p>Roulette recovery dialog</p><button onClick={()=>p.onSpinComplete?.()}>Refresh after round</button></div>:null;`,
  '@/components/transactions/BlackjackDialog': `${shared} export default p=>p.open?<div>Blackjack recovery dialog</div>:null;`,
  '@/components/transactions/BaccaratDialog': `${shared} export default p=>p.open?<div>Baccarat recovery dialog</div>:null;`,
  '@/lib/contracts': `${shared}
    export const LAND_CONTRACT_ADDRESS='0x1111111111111111111111111111111111111111';
    export const PIXOTCHI_TOKEN_ADDRESS=LAND_CONTRACT_ADDRESS,LEAF_CONTRACT_ADDRESS=LAND_CONTRACT_ADDRESS,CREATOR_TOKEN_ADDRESS=LAND_CONTRACT_ADDRESS,CRYPTICPOET_TOKEN_ADDRESS=LAND_CONTRACT_ADDRESS,JESSE_TOKEN_ADDRESS=LAND_CONTRACT_ADDRESS;
    export const ADDRESS_REGEX=/^0x[a-fA-F0-9]{40}$/;
    export const barracksGetConfigV2=async()=>{S().configReads++;if(S().configHold)return new Promise(resolve=>S().configPending=resolve);return S().configFailure?null:{...S().config,enabled:S().enabled}};
    export const barracksGetLandStateV2=async()=>({...S().army,isBuilt:S().built});
    export const barracksGetLastIncomingReportV2=async()=>{S().reportReads++;return S().report};
    export const barracksGetLastOutgoingReportV2=barracksGetLastIncomingReportV2;
    export const barracksGetEligibleAttackableLandIds=async()=>{S().targetReads++;if(S().targetsHold)return new Promise(resolve=>S().targetPending.push(resolve));if(S().targetsFailure)throw Error('targets unavailable');return S().targetIds};
    export const getLandsByIds=async ids=>ids.map(tokenId=>({tokenId,name:'Land '+tokenId,coordinateX:1n,coordinateY:2n}));
    export const barracksPreviewRaidV2=async(a,d,swordsmenRequested,phalanxRequested)=>({statusCode:0,attackerWon:true,swordsmenRequested,phalanxRequested,attackerSwordsmenLost:0n,attackerPhalanxLost:0n,defenderSwordsmenBefore:2n,defenderPhalanxBefore:1n,defenderSwordsmenLost:1n,defenderPhalanxLost:0n,estimatedPointsLoot:1000000000000n,estimatedLifetimeLoot:3600n,attackerPower:10n,defenderPower:5n});
    export const checkBarracksApproval=async()=>{if(S().allowanceFailure)throw Error('allowance unavailable');if(S().allowanceHold)return new Promise(resolve=>S().allowancePending.push(resolve));return S().allowance};
    export const buildBarracksBuildCall=id=>({address:LAND_CONTRACT_ADDRESS,functionName:'build',args:[id]});
    export const buildBarracksTrainCallV2=(...args)=>({address:LAND_CONTRACT_ADDRESS,functionName:'train',args});
    export const buildBarracksAttackCallV2=(...args)=>({address:LAND_CONTRACT_ADDRESS,functionName:'raid',args});
    export const buildCasinoBuildCall=buildBarracksBuildCall;
    export const casinoGetBuildingConfig=async()=>S().configHold?new Promise(resolve=>S().configPending=resolve):S().configFailure?null:{buildingToken:LAND_CONTRACT_ADDRESS,buildingCost:S().config.buildCost};
    export const casinoGetSupportedTokens=async()=>{if(S().configFailure)throw Error('tokens unavailable');return S().emptyTokens?[]:[LAND_CONTRACT_ADDRESS]};
    export const casinoGetTokenConfig=async()=>S().configFailure?null:{supported:true,enabled:true};
    export const blackjackGetTokenConfig=casinoGetTokenConfig,baccaratGetTokenConfig=casinoGetTokenConfig;
    export const casinoGetActiveBetV2=async()=>{if(S().roundHold)return new Promise(resolve=>S().roundPending.push(resolve));return S().roundFailure?null:{isActive:S().activeRound,bettingToken:LAND_CONTRACT_ADDRESS}};
    export const blackjackGetGameSnapshot=async()=>S().roundFailure?null:{isActive:false};
    export const blackjackGetGameToken=async()=>LAND_CONTRACT_ADDRESS;
    export const baccaratGetActiveGame=blackjackGetGameSnapshot;
    export const casinoGetStatsByToken=async()=>S().statsFailure?null:{totalWagered:1400001n,totalWon:2000000n,gamesPlayed:2n};
    export const blackjackGetStatsByToken=casinoGetStatsByToken,baccaratGetStatsByToken=casinoGetStatsByToken;
    export const checkCasinoApproval=checkBarracksApproval;
    export const ERC20_BALANCE_ABI=[];
    export const getQuestRewardSources=async()=>({seed:LAND_CONTRACT_ADDRESS,leaf:LAND_CONTRACT_ADDRESS,resolvedOnchain:true});
    export const getReadClient=()=>({multicall:async()=>{if(S().fundingFailure)throw Error('funding unavailable');return Array.from({length:4},()=>({status:'success',result:S().fundingBalance}))},getBlockNumber:async()=>S().block,readContract:async({functionName,args})=>{
      if(S().questFailure)throw Error('quest settings unavailable');
      if(functionName==='questGetDifficultyConfig')return [S().questDuration*(BigInt(args[0])+1n),100n,BigInt(args[0])+1n];
      if(functionName==='questGetAllRewardRanges')return S().ranges;
      throw Error('Unexpected read '+functionName);
    }});
  `,
};
const entry = `
  import React from 'react';import {createRoot} from 'react-dom/client';import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
  import UpgradePanel from '@/components/building-details/UpgradePanel';
  import BarracksPanel from '@/components/building-details/BarracksPanelV2';import CasinoPanel from '@/components/building-details/CasinoPanel';import FarmerHousePanel from '@/components/building-details/FarmerHousePanel';
  import {fixtureWallet} from 'building-core-wallet';window.approvalWallet=fixtureWallet;
  import {fixtureBarracks} from '@/app/qa/frontend/controller-data';
  const fixture=fixtureBarracks();let version=0;let client;const root=createRoot(document.getElementById('root'));
  window.buildingTest={reset(panel='barracks'){
    version++;localStorage.clear();fixtureWallet.walletCalls=0;fixtureWallet.rejectWallet=false;fixtureWallet.deferWallet=true;fixtureWallet.resolveWallet=null;client?.clear();client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    Object.assign(this,{panel,owner:'0x1111111111111111111111111111111111111111',landId:1n,block:1000n,built:false,enabled:true,
      config:{...fixture.config,buildCost:1400001n,swordsman:{...fixture.config.swordsman,trainingCost:1400001n},phalanx:{...fixture.config.phalanx,trainingCost:1400001n}},army:fixture.landState,report:fixture.lastOutgoingReport,
      balance:2000000n,balanceRetryFailure:false,balanceMode:'ready',allowance:2000000n,allowanceFailure:false,allowanceHold:false,allowancePending:[],configFailure:false,configHold:false,questLoading:false,metadataError:false,
      targetIds:[2n,3n],targetsHold:false,targetsFailure:false,targetPending:[],configReads:0,targetReads:0,reportReads:0,sends:0,lastError:'',complete:false,
      realTransactions:false,fundingBalance:999999999999999999999999n,fundingFailure:false,activeRound:false,roundFailure:false,roundHold:false,roundPending:[],statsFailure:false,emptyTokens:false,questFailure:false,questDuration:900n,
      slots:[{startBlock:0n,endBlock:0n,pseudoRndBlock:0n,coolDownBlock:0n,difficulty:0}],
      ranges:{minSeedReward:1000000n,maxSeedReward:3000000n,minLeafReward:2000000n,maxLeafReward:4000000n,minPlantLifetimeReward:3600n,maxPlantLifetimeReward:7200n,minPlantPointsReward:1000000000000n,maxPlantPointsReward:2000000000000n,minXpReward:1000000000000000000n,maxXpReward:2000000000000000000n}
    });this.render();},render(){const w=this;root.render(<QueryClientProvider client={client}><main key={version}>{w.panel==='barracks'?<BarracksPanel landId={w.landId} currentBlock={w.block} villageBuildings={[]} onUpdate={()=>{}}/>:w.panel==='casino'?<CasinoPanel landId={w.landId} initialIsBuilt={w.built}/>:w.panel==='upgrade'?<UpgradePanel landId={w.landId} buildingType='village' currentBlock={w.block} leafAllowance={w.allowance} seedAllowance={w.allowance} allowancesReady={!w.allowanceFailure} allowancesError={w.allowanceFailure?'approval status unavailable':null} building={{id:0,level:1,maxLevel:10,isUpgrading:false,levelUpgradeCostLeaf:1400001n,levelUpgradeCostSeedInstant:1400001n,levelUpgradeBlockInterval:100n,blockHeightUpgradeInitiated:0n,blockHeightUntilUpgradeDone:0n}} onUpgradeSuccess={()=>{}} onLeafApprovalSuccess={()=>{}} onSeedApprovalSuccess={()=>{}}/>:<FarmerHousePanel landId={w.landId} farmerHouseLevel={1} onQuestUpdate={()=>{}}/>}<output aria-label="Submission count">{w.sends}</output><output aria-label="Submission error">{w.lastError}</output></main></QueryClientProvider>);}};
  window.buildingTest.reset();
`;
const cwd=process.cwd();
const bundle=await build({stdin:{contents:entry,resolveDir:cwd,loader:'tsx'},bundle:true,write:false,platform:'browser',format:'iife',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"','process.env':'{}'},plugins:[{name:'building-boundaries',setup(b){
  b.onResolve({filter:/.*/},args=>{
    if(args.path==='building-real-game-transaction')return {path:path.resolve('components/transactions/game-transaction.tsx')};
    if(args.path==='building-core-wallet')return {path:path.resolve('tests/frontend/fixtures/transaction-core-wallet.ts')};
    const canonical=args.path.startsWith('.')?'@/'+path.relative(cwd,path.resolve(args.resolveDir,args.path)).replaceAll('\\','/'):args.path;
    const key=canonical in mocks?canonical:args.path in mocks?args.path:null;
    if(key)return {path:key,namespace:'building-mock'};
  });b.onLoad({filter:/.*/,namespace:'building-mock'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:cwd}));
}}]});
const server=createServer((req,res)=>{res.setHeader('Content-Type',req.url==='/app.js'?'text/javascript':'text/html');res.end(req.url==='/app.js'?bundle.outputFiles[0].text:'<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><div id="root"></div><script src="/app.js"></script>');});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const browser=await chromium.launch({headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.stack));
page.setDefaultTimeout(8000);
const url=`http://127.0.0.1:${server.address().port}`;
const reset=async(panel,changes={})=>{await page.evaluate(({panel,changes})=>{const w=window.buildingTest;w.reset(panel);Object.assign(w,changes);w.render();},{panel,changes});};
const text=async(value)=>page.getByText(value,{exact:true}).waitFor({timeout:8000});
const button=name=>page.getByRole('button',{name,exact:true});
try {
  await page.clock.install();
  await page.goto(url);
  for(const panel of ['barracks','casino']) {
    await reset(panel,{balanceMode:'error'});await text('Balance unavailable');
    assert.equal(await button('Approve TEST to Build').count(),0);
    await page.getByRole('alert').filter({hasText:'Balance unavailable'}).getByRole('button',{name:'Retry',exact:true}).click();
    await button('Build (1.400001 TEST)').waitFor();
    await reset(panel,{balance:1n,allowance:0n});await text('Insufficient TEST balance');assert.equal(await button('Approve TEST to Build').count(),0);
    await reset(panel,{allowanceFailure:true});await text('Approval status unavailable');assert.equal(await button('Approve TEST to Build').count(),0);
    await page.evaluate(()=>{window.buildingTest.allowanceFailure=false});
    await page.getByRole('alert').filter({hasText:'Approval status unavailable'}).getByRole('button',{name:'Retry',exact:true}).click();await button('Build (1.400001 TEST)').waitFor();
    console.log('PASS '+panel+': balance/allowance failures retry, shortage before approval, exact fractional cost');
  }
  await reset('barracks',{built:true,balanceMode:'loading',allowance:0n});await text('Checking balance…');assert.equal(await button('Approve TEST').count(),0);
  await reset('barracks',{built:true,enabled:false,allowance:0n});await text('Barracks is paused');assert.equal(await button('Approve TEST').count(),0);assert.equal(await button('Training unavailable').isDisabled(),true);
  await reset('barracks',{built:true});await button('Train 1 Swordsman').waitFor();await page.evaluate(()=>{window.buildingTest.enabled=false});await button('Train 1 Swordsman').click();await page.waitForFunction(()=>window.buildingTest.lastError.includes('unavailable'));assert.equal(await page.evaluate(()=>window.buildingTest.sends),0);
  console.log('PASS Barracks: training unknown is not shortage/approval; disabled service and fresh pause block training');
  await reset('barracks',{built:true});await page.getByRole('radio',{name:'Raid',exact:true}).click();await page.getByText('2 available',{exact:true}).waitFor();
  const reads=await page.evaluate(()=>({target:window.buildingTest.targetReads,config:window.buildingTest.configReads,report:window.buildingTest.reportReads}));
  for(let i=0;i<8;i++)await page.evaluate(()=>{window.buildingTest.block++;window.buildingTest.render()});
  assert.deepEqual(await page.evaluate(()=>({target:window.buildingTest.targetReads,config:window.buildingTest.configReads,report:window.buildingTest.reportReads})),reads);
  assert.equal(reads.report,0,'Report reads are not coupled to troop/target inspection');
  await page.getByLabel('Swordsmen to send (troops)',{exact:true}).fill('1');
  await page.evaluate(()=>{window.buildingTest.targetIds=[3n]});await button('Raid Land #2').click();await page.waitForFunction(()=>window.buildingTest.lastError.includes('no longer available'));assert.equal(await page.evaluate(()=>window.buildingTest.sends),0);
  await page.getByRole('radio',{name:'Latest reports',exact:true}).click();await page.waitForFunction(()=>window.buildingTest.reportReads===2);
  console.log('PASS Barracks: block ticks do not refetch; reports load on history; submit rechecks eligibility');
  await reset('barracks',{built:true});await page.getByRole('radio',{name:'Raid',exact:true}).click();await page.getByText('2 available',{exact:true}).waitFor();
  await page.getByRole('button',{name:/Land 2/}).click();await page.getByRole('menu').waitFor();
  await page.evaluate(()=>{window.buildingTest.targetsHold=true});await page.clock.runFor(30_010);
  await page.waitForFunction(()=>window.buildingTest.targetPending.length>0);assert.equal(await page.getByRole('menu').isVisible(),true);assert.equal(await page.locator('button[aria-haspopup="menu"]').isEnabled(),true);
  await page.getByRole('menuitem').filter({hasText:'Land 3'}).click();await page.evaluate(()=>{const w=window.buildingTest;w.targetsHold=false;w.targetPending.forEach(resolve=>resolve([2n,3n]));});
  await page.getByRole('button',{name:/Land 3/}).waitFor();
  await reset('barracks',{allowanceHold:true});await page.waitForFunction(()=>window.buildingTest.allowancePending.length===2);
  await page.evaluate(()=>{const w=window.buildingTest;w.owner='0x2222222222222222222222222222222222222222';w.allowanceHold=false;w.allowanceFailure=true;w.render()});await text('Approval status unavailable');
  await page.evaluate(()=>window.buildingTest.allowancePending.forEach(resolve=>resolve(99999999n)));assert.equal(await button('Build (1.400001 TEST)').count(),0);
  console.log('PASS Barracks: picker stays open/usable through held background refresh; late old-wallet allowance cannot unlock spending');
  for(const width of [320,820,1440]) {
    await page.setViewportSize({width,height:900});await reset('casino',{built:true,activeRound:true,configFailure:true});await button('Resume Roulette game').waitFor();await text('Casino configuration unavailable');assert.equal(await page.getByText('No casino tokens are configured yet.',{exact:true}).count(),0);
    await button('Resume Roulette game').click();await text('Roulette recovery dialog');
    await page.evaluate(()=>{window.buildingTest.roundFailure=true});await button('Refresh after round').click();await text('Some round statuses could not be checked');assert.equal(await button('Resume Roulette game').isEnabled(),true);
    console.log('PASS Casino: '+width+'px recovery survives configuration and later round-read outage');
  }
  await reset('casino',{built:true,roundFailure:true,configFailure:true});await button('Check Roulette round').waitFor();assert.equal(await button('Check Roulette round').isEnabled(),true);
  await reset('casino',{built:true,statsFailure:true});await text('Statistics unavailable');await page.evaluate(()=>{window.buildingTest.statsFailure=false});await page.getByRole('alert').filter({hasText:'Statistics unavailable'}).getByRole('button',{name:'Retry',exact:true}).click();await page.getByText('Games: 2',{exact:true}).first().waitFor();
  await reset('casino',{built:true,emptyTokens:true});await text('No casino tokens are configured yet.');assert.equal(await page.getByText('Casino configuration unavailable',{exact:true}).count(),0);
  console.log('PASS Casino: cold unknown round has explicit check; failed stats retry; valid empty configuration differs from failure');
  await reset('casino',{built:true,roundHold:true});await page.waitForFunction(()=>window.buildingTest.roundPending.length===1);
  await page.evaluate(()=>{const w=window.buildingTest;w.landId=2n;w.roundHold=false;w.render()});await button('Play Roulette').waitFor();
  await page.evaluate(()=>{const w=window.buildingTest;w.roundPending.forEach(resolve=>resolve({isActive:true,bettingToken:'0x1111111111111111111111111111111111111111'}));});
  assert.equal(await button('Resume Roulette game').count(),0);console.log('PASS Casino: late prior-land round cannot create a recovery action in the new land');
  for(const panel of ['barracks','casino','upgrade']) {
    await reset(panel,{realTransactions:true,built:panel==='barracks',allowance:0n});
    await button(panel==='barracks'?'Approve TEST':panel==='upgrade'?'Approve LEAF':'Approve TEST to Build').click();
    await page.waitForFunction(()=>window.approvalWallet.walletCalls===1&&window.approvalWallet.resolveWallet);
    if(panel==='barracks'){
      assert.equal(await page.getByRole('radio',{name:'Raid',exact:true}).isDisabled(),true);
      assert.equal(await page.getByLabel('Number to train (troops)',{exact:true}).isDisabled(),true);
      await page.evaluate(()=>{window.buildingTest.configFailure=true});await page.clock.runFor(30_010);
      await text('Barracks status unavailable');
    }else{
      await page.evaluate(()=>{window.buildingTest.balanceMode='error';window.buildingTest.balanceRetryFailure=true;window.buildingTest.render()});
    }
    await page.getByText('Confirm in your wallet',{exact:true}).waitFor();
    assert.equal(await page.evaluate(()=>window.approvalWallet.walletCalls),1);
    await page.evaluate(()=>{window.buildingTest.allowance=99999999n;window.approvalWallet.resolveWallet()});
    await page.clock.runFor(2000);
    await page.getByText(/Approve (TEST|LEAF).*completed/).first().waitFor();await page.clock.runFor(5001);
    if(panel==='barracks')await text('Training unavailable');else if(panel==='upgrade')await text('LEAF balance unavailable');else await text('Balance unavailable');
    console.log('PASS '+panel+': real approval wallet/controller and success feedback survive failed background reads; future spending remains gated');
  }
  await reset('barracks',{built:true});await button('Train 1 Swordsman').waitFor();
  await page.evaluate(()=>{const w=window.buildingTest;w.config={...w.config,swordsman:{...w.config.swordsman,trainingTimePerTroop:w.config.swordsman.trainingTimePerTroop+1n}}});
  await button('Train 1 Swordsman').click();await page.waitForFunction(()=>window.buildingTest.lastError.includes('terms changed'));assert.equal(await page.evaluate(()=>window.buildingTest.sends),0);
  console.log('PASS Barracks: duration-only training config change vetoes stale terms');
  await reset('quest');await button('Start').waitFor();await page.getByRole('radio',{name:/Medium/}).click();
  await page.getByText(/Estimated duration ~1h.*2× reward amounts/).waitFor();await page.getByText('Possible rewards',{exact:true}).click();await page.getByText('2–6',{exact:true}).waitFor();
  await page.evaluate(()=>{window.buildingTest.questDuration=1800n});await button('Start').click();await page.waitForFunction(()=>window.buildingTest.lastError.includes('Quest terms changed'));assert.equal(await page.evaluate(()=>window.buildingTest.sends),0);
  await reset('quest',{questFailure:true});await text('Quest terms unavailable');assert.equal(await button('Start').isDisabled(),true);await page.evaluate(()=>{window.buildingTest.questFailure=false});await page.getByRole('alert').filter({hasText:'Quest terms unavailable'}).getByRole('button',{name:'Retry',exact:true}).click();await button('Retry rewards').click();await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Start')?.disabled);
  console.log('PASS Quest: configured durations/reward multiplier, terms-change veto and read-error retry');
  await reset('quest',{slots:[{startBlock:1n,endBlock:900n,pseudoRndBlock:0n,coolDownBlock:0n,difficulty:0}]});
  await text('Ready to return');await button('Return now').waitFor();assert.equal(await page.getByText('Ready to commit',{exact:true}).count(),0);
  await page.getByText(/within ~8m 32s \(256 blocks\)/).waitFor();
  await reset('quest',{slots:[{startBlock:1n,endBlock:900n,pseudoRndBlock:999n,coolDownBlock:0n,difficulty:0}]});
  await text('Loot bag ready');await button('Open now').waitFor();assert.equal(await page.getByText('Committed',{exact:true}).count(),0);
  console.log('PASS BP14/17: player-facing quest states preserve Return/Open branches and use the shared exact block estimate.');
  for(const [panel,title] of [['barracks','Loading Barracks…'],['casino','Loading Casino…'],['quest','Loading quests…']]) {
    await reset(panel,{configHold:true,questLoading:true});await text(title);assert.equal(await page.getByRole('status').filter({hasText:title}).count(),1);
  }
  console.log('PASS BP18: real Barracks/Casino/Farmer House expose labeled initial loading during held reads.');
  if(previewEnabled){
    await reset('barracks',{built:true});await page.getByRole('radio',{name:'Raid',exact:true}).click();await page.getByText('2 available',{exact:true}).waitFor();
    await page.getByLabel('Swordsmen to send (troops)',{exact:true}).fill('1');await text("(Includes the target's home defense bonus)");
    assert.equal(await page.getByText('(Includes 10% home base bonus)',{exact:true}).count(),0);
    console.log('PASS BP16: enabled real raid-preview branch describes target-specific defense without asserting the maximum bonus.');
  }
  assert.deepEqual(errors,[]);console.log('Building P2 component regressions passed.');
} catch (error) { console.error('Fixture state:', await page.locator('body').innerText()); console.error('Runtime errors:', errors); throw error; }
finally {await browser.close();await new Promise(resolve=>server.close(resolve));}
