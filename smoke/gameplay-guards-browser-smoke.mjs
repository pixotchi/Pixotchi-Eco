import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

// Render the production panels with injected read/wallet boundaries. No RPC or wallet calls.
const mocks = {
  contracts: `
    export const LAND_CONTRACT_ADDRESS='0x1111111111111111111111111111111111111111';
    export const getReadClient=()=>({simulateContract:async()=>({result:[true,0,1n]}),getBlockNumber:async()=>window.fixture.block,
      multicall:async({contracts})=>contracts.map(()=>({status:'success',result:[{id:7,level:3,isUpgrading:window.fixture.construction}]}))});
    export const getStakeAllowance=async()=>{if(window.fixture.failAllowance)throw Error('offline');return window.fixture.freshAllowance;};
    export const buildApproveStakeCall=()=>({functionName:'approve'});
    export const buildClaimRewardsCall=()=>({functionName:'claimRewards'});
    export const buildStakeCall=amount=>({functionName:'stake',args:[amount]});
    export const buildUnstakeCall=amount=>({functionName:'withdraw',args:[amount]});
    export const CREATOR_TOKEN_ADDRESS=LAND_CONTRACT_ADDRESS;
    export const QUEST_DIFFICULTIES=[{id:0,label:'Easy'},{id:1,label:'Medium'},{id:2,label:'Hard'}];
    export const isQuestDifficultyId=x=>[0,1,2].includes(x);
    export const buildQuestStartCall=(landId,difficulty,slotIndex)=>({functionName:'questStart',args:[landId,difficulty,slotIndex]});
    export const getQuestSlotsBatch=async()=>[];export const toQuestSlotSnapshots=()=>[];`,
  wagmi: `export const useAccount=()=>({address:window.fixture.owner});export const useBlockNumber=()=>({data:window.fixture.block});`,
  quests: `export const useLandQuestSlots=()=>({slots:window.fixture.slots,loading:false,error:null,refresh:async()=>window.fixture.slots});`,
  rewards: `export const useQuestRewardsAvailability=()=>({isReady:true,isUnavailable:false,isRefreshing:false,refresh:async()=>{},requireReady:async()=>{}});`,
  configuration: `export const useQuestConfiguration=()=>({isReady:true,data:{difficulties:[{durationInBlocks:10n},{durationInBlocks:20n},{durationInBlocks:30n}]}});`,
  visibility: `export const useTabVisibility=()=>({isTabVisible:()=>true});`,
  env: `export const CLIENT_ENV={CASINO_ENABLED:false,BARRACKS_ENABLED:false,LAND_CONTRACT_ADDRESS:'0x1111111111111111111111111111111111111111'};`,
  utils: `export const BASE_SECONDS_PER_BLOCK=2;export const formatTokenAmount=x=>String(x/10n**18n);export const formatUpgradeDuration=x=>String(x);export const getBuildingName=()=> 'Farmer House';export const getBuildingIcon=()=>'/test.png';export const cn=(...x)=>x.filter(Boolean).join(' ');`,
  balance: `export const useBalances=()=>({pixotchiBalance:10000000000000000000000000n,pixotchiBalanceStatus:'ready'});`,
  smart: `export const useSmartWallet=()=>({isLoading:false,isSmartWallet:true});`,
  batch: `export const useBatchReconciliation=()=>({items:window.fixture.batchSlots,loading:false,ready:true,error:null,
    coordinator:{assertReady:()=>{},retire:()=>{},reconcile:async()=>({remaining:1})},refresh:async()=>{}});`,
  mission: `export const postMissionProgress=async()=>({status:200});`,
  toast: `export const toast=Object.assign(()=>{},{success:()=>{},error:()=>{}});`,
  image: `import React from 'react';export default function Image(){return null;}`,
  ui: `import React from 'react';
    const Box=({children})=><div>{children}</div>;
    export const Dialog=Box,DialogBody=Box,DialogContent=Box,DialogHeader=Box,DialogTitle=Box,DialogDescription=Box,DialogFooter=Box;
    export const Alert=Box,AlertDescription=Box,Card=Box,CardContent=Box,CardHeader=Box,CardTitle=Box,ResourceValue=Box;
    export const Button=({children,onClick,disabled,...p})=><button onClick={onClick} disabled={disabled} aria-label={p['aria-label']}>{children}</button>;
    export const AmountField=({label,value,onChange})=><label>{label}<input value={value} onChange={onChange}/></label>;
    export const ToggleGroup=({options,onValueChange})=><div>{options.map(o=><button key={o.value} onClick={()=>onValueChange(o.value)}>{o.label}</button>)}</div>;
    export const ResourceState=({title})=><div>{title}</div>;
    export const RefreshIcon=()=>null,ProgressBar=()=>null,TokenAmount=()=>null;`,
  other: `import React from 'react';export default function Other(){return null;}export const QuestDifficultySelector=Other,QuestDifficultySummary=Other;`,
  transaction: `import React from 'react';export default function Transaction(p){
    window.transactions[p.intentKey]=p;
    return <button data-intent={p.intentKey} disabled={p.disabled} onClick={async()=>{
      try{await p.onButtonClick?.();window.submissions.push(p.intentKey);}catch(e){window.lastError=e.message;}
    }}>{p.buttonText}</button>;
  }`,
};
const fixture = `
import React,{useState} from 'react';import {createRoot} from 'react-dom/client';
import BuildingDetailsPanel from '@/components/building-details-panel';
import StakingDialog from '@/components/staking/staking-dialog';
import BatchQuestStartCard from '@/components/transactions/batch-quest-start-card';
import {markBatchQuestRunPaid,isBatchQuestRunPaid,markBatchQuestRunPending,isBatchQuestRunPending} from '@/lib/quest-preferences';
window.transactions={};window.submissions=[];
const empty={difficulty:0,startBlock:0n,endBlock:0n,pseudoRndBlock:0n,coolDownBlock:0n};
window.fixture={owner:'0x1111111111111111111111111111111111111111',block:1000n,
 slots:[{...empty,startBlock:1n,endBlock:800n,pseudoRndBlock:900n},{...empty,startBlock:1n,endBlock:800n},empty],
 allowance:'1000000000000000000',freshAllowance:1000000000000000000n,failAllowance:false,construction:true,
 batchSlots:[{...empty,landId:1n,slotIndex:0,state:'available',readBlock:1000n}]};
const batchScope=window.fixture.owner+':1';markBatchQuestRunPaid(batchScope);
window.batchPaid=()=>isBatchQuestRunPaid(batchScope);window.batchPending=()=>isBatchQuestRunPending(batchScope);
window.reserveBatchFee=()=>markBatchQuestRunPending(batchScope,Date.now(),'pending-fee');
window.fetch=async url=>({ok:true,json:async()=>String(url).includes('/balance')?{success:true,balance:'100000000000000000000'}:
 {success:true,stake:{staked:'10000000000000000000',rewards:'1000000000000000000'},approved:true,allowance:window.fixture.allowance}});
function App(){const [upgrading,setUpgrading]=useState(true);const [batchKey,setBatchKey]=useState(0);const [,render]=useState(0);window.control={setUpgrading,remountBatch:()=>setBatchKey(x=>x+1),render:()=>render(x=>x+1)};
 const building={id:7,level:3,maxLevel:3,isUpgrading:upgrading,levelUpgradeCostLeaf:0n,levelUpgradeCostSeedInstant:0n,blockHeightUntilUpgradeDone:999999n};
 return <><section id='farmer'><BuildingDetailsPanel selectedBuilding={building} landId={1n} buildingType='town' onUpgradeSuccess={()=>{}} currentBlock={window.fixture.block}/></section>
 <section id='staking'><StakingDialog open onOpenChange={()=>{}}/></section>
 <section id='batch'><BatchQuestStartCard key={batchKey} lands={[{tokenId:1n}]} /></section></>;}
createRoot(document.getElementById('root')).render(<App/>);`;
const bundle = await build({
  stdin: { contents: fixture, sourcefile: 'gameplay-guards-fixture.jsx', resolveDir: process.cwd(), loader: 'jsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"', 'process.env': '{}' },
  plugins: [{ name: 'gameplay-boundaries', setup(plugin) {
    const boundaries = [
      [/(?:^|\/)contracts$/, 'contracts'], [/^wagmi$/, 'wagmi'], [/useLandQuestSlots$/, 'quests'],
      [/useQuestRewardsAvailability$/, 'rewards'], [/useQuestConfiguration$/, 'configuration'],
      [/tab-visibility-context$/, 'visibility'], [/^@\/lib\/env-config$/, 'env'], [/^@\/lib\/utils$/, 'utils'],
      [/mission-tracking$/, 'mission'], [/^react-hot-toast$/, 'toast'], [/^next\/image$/, 'image'],
      [/^@\/lib\/balance-context$/, 'balance'], [/^@\/lib\/smart-wallet-context$/, 'smart'], [/useBatchReconciliation$/, 'batch'],
      [/^@\/components\/ui\//, 'ui'], [/game-transaction$/, 'transaction'],
      [/(?:UpgradePanel|ProductionPanel|WarehousePanel|MarketplacePanel|StakeHousePanel|CasinoPanel|BarracksPanelV2|building-info-dialog|quest-difficulty-summary|quest-difficulty-selector)$/, 'other'],
    ];
    for (const [filter, key] of boundaries) plugin.onResolve({filter},()=>({path:key,namespace:'gameplay-mock'}));
    plugin.onLoad({filter:/.*/,namespace:'gameplay-mock'},args=>({contents:mocks[args.path],loader:'jsx',resolveDir:process.cwd()}));
  } }],
});
const server = createServer((request,response)=>{
  response.setHeader('Content-Type',request.url==='/app.js'?'text/javascript':'text/html');
  response.end(request.url==='/app.js'?bundle.outputFiles[0].text:'<div id="root"></div><script src="/app.js"></script>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
try {
  browser=await chromium.launch({headless:true});
  const page=await browser.newPage();
  page.on('pageerror',error=>console.error(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  const farmer=page.locator('#farmer');
  await farmer.getByRole('button',{name:'Open now',exact:true}).waitFor();
  assert.equal(await farmer.getByRole('button',{name:'Open now',exact:true}).isEnabled(),true);
  assert.equal(await farmer.getByRole('button',{name:'Return now',exact:true}).isEnabled(),true);
  assert.equal(await farmer.getByRole('button',{name:'Start',exact:true}).isDisabled(),true);
  await farmer.getByRole('button',{name:'Open now',exact:true}).click();
  await page.waitForFunction(()=>window.submissions.includes('quest:finalize:1:0'));
  await page.evaluate(()=>{window.fixture.block=1200n;window.control.render();});
  await farmer.getByRole('button',{name:'Reset expired quest'}).waitFor();
  assert.equal(await farmer.getByRole('button',{name:'Reset expired quest'}).isEnabled(),true);
  await page.evaluate(()=>window.control.setUpgrading(false));
  await page.waitForFunction(()=>!document.querySelector('[data-intent="quest:start:1:2"]').disabled);

  const batch=page.locator('#batch');
  await batch.getByText('Already paid this run').waitFor();
  await batch.locator('[data-intent^="batch-quest-start:"]').click();
  await page.waitForFunction(()=>window.lastError?.includes('is upgrading'));
  assert.equal(await page.evaluate(()=>window.submissions.some(x=>x.startsWith('batch-quest-start:'))),false);
  assert.equal(await page.evaluate(()=>window.batchPaid()),true,'construction must preserve the paid run');
  assert.equal(await page.evaluate(()=>window.transactions[document.querySelector('#batch [data-intent]').dataset.intent].calls.length),1,'paid run must not add another burn');
  await page.evaluate(()=>{window.fixture.construction=false;});
  await batch.locator('[data-intent^="batch-quest-start:"]').click();
  await page.waitForFunction(()=>window.submissions.some(x=>x.startsWith('batch-quest-start:')));
  assert.equal(await page.evaluate(()=>window.batchPaid()),true);
  // A reserved but unconfirmed fee still exposes its recovery transaction.
  await page.evaluate(()=>{window.fixture.construction=true;window.reserveBatchFee();window.control.remountBatch();});
  await batch.getByRole('button',{name:'Confirming fee…'}).waitFor();
  assert.equal(await page.evaluate(()=>window.batchPending()),true);
  assert.equal(await batch.getByRole('button',{name:'Confirming fee…'}).isDisabled(),true);

  const staking=page.locator('#staking');
  await staking.getByLabel('Amount to stake').fill('10');
  await staking.getByRole('button',{name:'Approve SEED for Staking'}).waitFor();
  // An approval receipt alone cannot fabricate sufficient allowance.
  await page.evaluate(async()=>{window.fixture.allowance='2000000000000000000';await window.transactions['staking:approve-seed'].onSuccess({});});
  assert.equal(await staking.getByRole('button',{name:'Approve SEED for Staking'}).isEnabled(),true);
  await page.evaluate(async()=>{window.fixture.allowance='10000000000000000000';await window.transactions['staking:approve-seed'].onSuccess({});});
  await page.waitForFunction(()=>!document.querySelector('[data-intent="staking:stake"]').disabled);
  // Revocation after snapshot is caught before a wallet submission.
  await staking.locator('[data-intent="staking:stake"]').click();
  await staking.getByRole('button',{name:'Approve SEED for Staking'}).waitFor();
  assert.equal(await page.evaluate(()=>window.submissions.includes('staking:stake')),false);
  // Unknown is retryable and never enables approval from the compatibility bool.
  await page.evaluate(async()=>{window.fixture.allowance=null;await window.transactions['staking:approve-seed'].onSuccess({});});
  await staking.getByRole('button',{name:'Retry staking allowance'}).waitFor();
  assert.equal(await staking.locator('[data-intent="staking:stake"]').isDisabled(),true);
  assert.equal(await staking.locator('[data-intent="staking:claim-rewards"]').isEnabled(),true);
  await page.evaluate(()=>{window.fixture.allowance='10000000000000000000';window.fixture.freshAllowance=10000000000000000000n;});
  await staking.getByRole('button',{name:'Retry staking allowance'}).click();
  await page.waitForFunction(()=>!document.querySelector('[data-intent="staking:stake"]').disabled);
  await staking.locator('[data-intent="staking:stake"]').click();
  await page.waitForFunction(()=>window.submissions.includes('staking:stake'));
  console.log('PASS production panels: upgrade quest recovery/start gating; batch construction pause preserves paid/reserved fees; partial/exact/unknown allowance; approval refresh; submission recheck and retry');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
