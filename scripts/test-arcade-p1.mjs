import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from 'viem';

const shared = `import React from 'react'; const S=()=>globalThis.auditState;`;
const mocks = {
  'wagmi': `${shared}
const refetch=async()=>({});
const client={getBlockNumber:async()=>{globalThis.publicBlockReads=(globalThis.publicBlockReads||0)+1;if(S().blockFail)throw Error('block RPC failed');return BigInt(S().block??1000);},readContract:async({functionName,args})=>{if(functionName.startsWith('boxGame')){if(S().boxHold)return new Promise(resolve=>globalThis.boxReads.push(resolve));if(S().boxFail)throw Error('cooldown RPC failed');return BigInt(S().boxCooldown??0);} if(functionName==='spinGameV2GetCoolDownTimePerNFT')return BigInt(S().spinCooldown??0);if(functionName==='getStarCost')return BigInt(S().starCost??1);if(functionName==='getReward'){if(S().rewardFail)throw Error('rewards unavailable');return S().rewards?.[Number(args[0])]??[0n,0n,0n];}return 0n;},simulateContract:async()=>({})};
export const useAccount=()=>({address:S().address});export const usePublicClient=()=>client;export const useSignMessage=()=>({signMessageAsync:async()=>''});
export const useReadContracts=({query,contracts})=>({data:!query.enabled?undefined:contracts?.[0]?.functionName==='casinoGetPayoutMultiplier'?S().payoutFail?[{status:'failure'}]:[35n,17n,11n,8n,5n,2n,2n,1n,1n,1n,1n,1n,1n].map(result=>({status:'success',result})):S().metaFail?[{status:'failure'},{status:'failure'}]:[{status:'success',result:'USDC'},{status:'success',result:6}],isLoading:false,isError:false,refetch});
export const useBalance=({query,address})=>({data:query.enabled?{value:address==='0x0000000000000000000000000000000000000004'&&S().poolBalance!==undefined?BigInt(S().poolBalance):1000000000000000000000000000000n,decimals:6}:undefined,isLoading:false,error:null,refetch});
export const useBlockNumber=()=>({data:1000n,isError:false,refetch});`,
  'next/image': `${shared} export default function Image({alt,...props}){return <img alt={alt} {...props}/>}`,
  'react-hot-toast': `const toast=(message)=>{(globalThis.auditToasts??=[]).push(message)};toast.error=toast;toast.success=toast;export {toast};export default toast;`,
  '@/components/solana': `export const useIsSolanaWallet=()=>false;export const SolanaNotSupported=()=>null;`,
  '@/components/ui/button': `${shared} export function Button({children,variant,size,asChild,...props}){return <button {...props}>{children}</button>}`,
  '@/components/ui/dialog': `${shared} export const Dialog=({children,open})=>open?<div>{children}</div>:null;export const DialogContent=({children})=><section>{children}</section>;export const DialogDescription=({children})=><p>{children}</p>;export const DialogFooter=({children})=><footer>{children}</footer>;export const DialogHeader=({children})=><header>{children}</header>;export const DialogTitle=({children})=><h1>{children}</h1>;`,
  '@/components/ui/premium': `${shared} export const DisabledReason=({children})=><p>{children}</p>;export const InlineBalanceNotice=DisabledReason;export const RewardResultPanel=({children,title})=><section><h2>{title}</h2>{children}</section>;`,
  '@/components/ui/resource-state': `${shared} export const ResourceState=({title,description,onRetry})=><section>{title}{description}<button onClick={onRetry}>Retry</button></section>;`,
  '@/components/ui/resource-value': `${shared} export const ResourceValue=({children})=><span>{children}</span>;`,
  '@/components/ui/performance-mode': `export const usePerformanceMode=()=>({enabled:true});`,
  '@/components/ui/amount-field': `${shared} export const AmountField=({label,unit,containerClassName,surface,...props})=><label>{label}<input {...props}/>{unit}</label>;`,
  '@/components/ui/EuropeanRouletteWheel': `${shared} export default ({onSpinComplete})=><button onClick={onSpinComplete}>Finish wheel animation</button>;`,
  '@/lib/base-rpc': `export const getBaseTransactionReceipt=async()=>{globalThis.receiptReads=(globalThis.receiptReads||0)+1;if(!globalThis.auditState.canonicalLogs)throw Error('receipt unavailable');return {logs:globalThis.auditState.canonicalLogs}};const client={getBlockNumber:async()=>1000n,getLogs:async()=>[]};export const getBaseLogClient=()=>client;`,
  '@/lib/owner-resource-invalidation': `export const invalidateOwnerResources=()=>{};export const isAbortError=e=>e?.name==='AbortError';export const retryOwnerRead=fn=>fn();`,
  '@/lib/transaction-refresh': `export const dispatchPostTransactionRefresh=()=>{};export const POST_TRANSACTION_REFRESH_DELAYS_MS=[];`,
  '@/lib/casino-client': `export const getClientCasinoPolicy=()=>({playable:true});`,
  '@/lib/contracts': `${shared} export const PIXOTCHI_NFT_ADDRESS='0x0000000000000000000000000000000000000004';export const LAND_CONTRACT_ADDRESS=PIXOTCHI_NFT_ADDRESS;export const BOX_GAME_ABI=[];export const SPIN_GAME_ABI=[];
export const casinoGetActiveBetV2=async()=>{if(S().configFail)throw Error('config RPC failed');return {isActive:S().activeBet,player:S().address,bettingToken:S().token,numBets:0n,totalBetAmount:1000000n,canReveal:true,isExpired:false,revealBlock:1n};};
export const casinoGetTokenConfig=async token=>{if(S().tokenConfigFail)throw Error('token config failed');return {supported:true,enabled:true,bettingToken:token,rewardPool:PIXOTCHI_NFT_ADDRESS,minBet:1000000n,maxBet:1000000000n,maxBetsPerGame:2n};};export const casinoGetBetDetails=async()=>null;export const checkCasinoApproval=async()=>1000000000000000000000000000000n;`,
  '@/lib/utils': `export const cn=(...x)=>x.filter(Boolean).join(' ');export const formatDuration=String;export const formatScore=String;export const formatTokenAmount=String;export const getCasinoTokenImage=()=>'/token.png';`,
  '@/components/transactions/box-game-transaction': `${shared} export default ({buttonText,disabled,onStatusUpdate,onResult})=><button disabled={disabled} onClick={()=>{if(S().boxPending){onStatusUpdate?.({statusName:'buildingTransaction'});globalThis.finishBox=()=>{onStatusUpdate?.({statusName:'success'});onResult?.({pointsDelta:12,timeAdded:0});};}else onResult?.({pointsDelta:12,timeAdded:0});}}>{buttonText}</button>;`,
  '@/components/transactions/spin-game-transaction': `${shared} export default ({buttonText,disabled,onButtonClick,mode,onStatusUpdate,onComplete})=><button disabled={disabled} onClick={async()=>{if(await onButtonClick?.()===false)return;globalThis.spinSubmissions=(globalThis.spinSubmissions||0)+1;if(S().spinDeferred){if(mode==='reveal'){globalThis.finishOldSpin=onComplete;onStatusUpdate?.({statusName:'success',statusData:{transactionHash:'0x'+'72'.repeat(32)}});}else onStatusUpdate?.({statusName:'buildingTransaction'});}}}>{buttonText}</button>;`,
  './approve-transaction': `${shared} export default ({buttonText})=><button>{buttonText}</button>;`,
  '@/components/transactions/transaction-kit': `export const getTransactionPhase=status=>status.statusName==='buildingTransaction'||(status.statusName==='transactionPending'&&!status.statusData?.transactionHash)?'awaiting-wallet':status.statusName==='transactionPending'?'submitted':status.statusName==='success'?'succeeded':'idle';`,
  './game-transaction': `${shared} export default ({buttonText,onStatusUpdate})=><button onClick={()=>onStatusUpdate(S().spinStatus)}>{buttonText}</button>;`,
  './casino-transaction': `${shared} export default ({buttonText,disabled,mode,onButtonClick,onComplete,onStatusUpdate})=><button disabled={disabled} onClick={()=>{onButtonClick?.();if(S().casinoPending){onStatusUpdate?.({statusName:'buildingTransaction'});globalThis.casinoStatus=onStatusUpdate;return;}S().activeBet=false;onComplete?.({winningNumber:17,won:true,payoutWei:1234567n,bettingToken:S().token,transactionHash:'0x'+'22'.repeat(32)});}}>{buttonText}</button>;`,
};
const entry = `import React from 'react';import{createRoot}from'react-dom/client';import Arcade from './components/arcade/ArcadeDialog';import Casino from './components/transactions/CasinoDialog';import SpinTransaction from './components/transactions/spin-game-transaction';
globalThis.auditState={surface:'box',address:'0x0000000000000000000000000000000000000001',token:'0x0000000000000000000000000000000000000003',plantId:7,boxHold:true,boxFail:false,configFail:false,metaFail:false,activeBet:false};globalThis.boxReads=[];const root=createRoot(document.getElementById('root'));globalThis.mountAudit=patch=>{Object.assign(globalThis.auditState,patch);const s=globalThis.auditState;root.render(s.surface==='spin-transaction'?<SpinTransaction mode='reveal' plantId={s.plantId} secret={'0x'+'11'.repeat(32)} onComplete={result=>globalThis.spinCompletion=result}/>:s.surface==='box'?<Arcade open onOpenChange={()=>{}} plant={{id:s.plantId,stars:s.stars??10}}/>:<Casino open onOpenChange={()=>{}} landId={7n} selectedToken={s.token}/>);};globalThis.mountAudit({});`;
const built = await build({ stdin:{contents:entry,resolveDir:process.cwd(),loader:'tsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"test"'},plugins:[{name:'isolated-read-adapters',setup(builder){builder.onResolve({filter:/.*/},args=>mocks[args.path]?{path:args.path,namespace:'audit-mock'}:undefined);builder.onLoad({filter:/.*/,namespace:'audit-mock'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:process.cwd()}));}}]});
const browser=await chromium.launch({headless:true});
try {
 for (const width of [320,390,1440]) {
 const page=await browser.newPage({viewport:{width,height:844}});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('http://arcade-audit.test/**',route=>route.fulfill({contentType:'text/html',body:'<div id="root"></div>'}));
 await page.goto('http://arcade-audit.test/');await page.addScriptTag({content:built.outputFiles[0].text});
 const play=page.getByRole('button',{name:'Play box',exact:true});
 await play.waitFor();assert.equal(await play.isDisabled(),true,'Box must not enable during initial cooldown read');
 await page.evaluate(()=>{window.auditState.boxHold=false;window.boxReads.splice(0).forEach(resolve=>resolve(0n));});
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Play box'&&!b.disabled));
 await page.evaluate(()=>window.mountAudit({plantId:8,boxFail:true}));
 await page.getByRole('button',{name:'Retry Box cooldown'}).waitFor();assert.equal(await play.isDisabled(),true);
 await page.evaluate(()=>{window.auditState.boxFail=false;});await page.getByRole('button',{name:'Retry Box cooldown'}).click();
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Play box'&&!b.disabled));
 await play.click();await page.getByRole('heading',{name:'Box result',exact:true}).waitFor();
 await page.evaluate(()=>window.mountAudit({plantId:9}));await page.getByRole('heading',{name:'Box result',exact:true}).waitFor({state:'hidden'});assert.equal(await page.getByRole('heading',{name:'Box result',exact:true}).count(),0,'changing plant must discard old reward presentation');
 await page.evaluate(()=>window.mountAudit({surface:'roulette',configFail:true}));
 await page.getByRole('button',{name:'Retry game details'}).waitFor();assert.equal(await page.getByRole('button',{name:'Game details unavailable',exact:true}).isDisabled(),true);
 await page.evaluate(()=>{window.auditState.configFail=false;});await page.getByRole('button',{name:'Retry game details'}).click();
 await page.getByRole('button',{name:'Select bets',exact:true}).waitFor();
 await page.evaluate(()=>window.mountAudit({token:'0x0000000000000000000000000000000000000005',activeBet:true,metaFail:true,tokenConfigFail:true,payoutFail:true}));
 const reveal=page.getByRole('button',{name:'Reveal Result',exact:true});await reveal.waitFor();assert.equal(await reveal.isEnabled(),true,'already paid recovery must survive token config and metadata outage');
 await reveal.click();await page.getByRole('button',{name:'Finish wheel animation'}).click();
 await page.getByText('Amount unavailable TOKEN',{exact:true}).waitFor();
 await page.evaluate(()=>window.mountAudit({metaFail:false,tokenConfigFail:false,payoutFail:false}));await page.getByText('1.234567 USDC',{exact:true}).first().waitFor();await page.getByText('+0.234567 USDC',{exact:true}).waitFor();
 await page.evaluate(()=>window.mountAudit({token:'0x0000000000000000000000000000000000000006'}));
 await page.getByText('1.234567 USDC',{exact:true}).first().waitFor({state:'hidden'});assert.equal(await page.getByText('1.234567 USDC',{exact:true}).first().count(),0,'token selection cannot relabel the previous payout');
 await page.evaluate(()=>{const s=window.auditState;localStorage.setItem(`pixotchi:spinleaf:pending:v2:${s.address}:42`,JSON.stringify({version:2,account:s.address,plantId:42,commitBlock:999,commitment:'0x'+'11'.repeat(32),secretHex:'0x'+'22'.repeat(32)}));window.publicBlockReads=0;window.mountAudit({surface:'box',plantId:42,block:1000,boxHold:false});});
 const spinReveal=page.getByRole('button',{name:'Reveal result',exact:true});await spinReveal.waitFor();
 assert.equal(await spinReveal.isDisabled(),true,'restored spin must wait for chain eligibility');
 await page.waitForFunction(()=>window.publicBlockReads>=2);
 assert.equal(await spinReveal.isDisabled(),true,'three elapsed seconds cannot advance a stalled chain');
 await page.evaluate(()=>{window.auditState.block=1001;});
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Reveal result'&&!b.disabled));
 await page.getByRole('radio',{name:'Box Game',exact:true}).click();
 await page.evaluate(()=>{window.auditState.block=1257;});
 await page.getByRole('heading',{name:'Previous SpinLeaf round expired',exact:true}).waitFor();
 const saved=await page.evaluate(()=>localStorage.getItem(`pixotchi:spinleaf:expired:${window.auditState.address}:42`));assert.ok(saved,'expiry survives closing and reloading');

 // A delayed older receipt cannot clear a newly prepared/submitted SpinLeaf key.
 await page.evaluate(()=>{const s=window.auditState;localStorage.setItem(`pixotchi:spinleaf:pending:v2:${s.address}:72`,JSON.stringify({version:2,account:s.address,plantId:72,commitBlock:999,commitment:'0x'+'71'.repeat(32),secretHex:'0x'+'73'.repeat(32)}));window.mountAudit({surface:'box',plantId:72,block:1001,spinDeferred:true});});
 const oldReveal=page.getByRole('button',{name:'Reveal result',exact:true});await oldReveal.waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Reveal result'&&!b.disabled));
 await oldReveal.click();const nextSpin=page.getByRole('button',{name:'Start SpinLeaf (1 star)',exact:true});await nextSpin.waitFor();await nextSpin.click();
 const preparedKey=await page.evaluate(()=>localStorage.getItem(`pixotchi:spinleaf:pending:v2:${window.auditState.address}:72`));assert.ok(preparedKey);
 await page.evaluate(()=>window.finishOldSpin({state:'resolved',reward:{rewardIndex:2,pointsDelta:9,timeAdded:0,leafAmount:0n},transactionHash:'0x'+'72'.repeat(32)}));
 assert.equal(await page.evaluate(()=>localStorage.getItem(`pixotchi:spinleaf:pending:v2:${window.auditState.address}:72`)),preparedKey);
 assert.equal(await page.getByRole('heading',{name:'Spin Reward',exact:true}).count(),0,'older receipt cannot animate or label the new round');
 await page.evaluate(()=>{window.auditState.spinDeferred=false;});
 // Medium: Box locks both choices during wallet preparation, then names the actual paid selection.
 await page.evaluate(()=>window.mountAudit({surface:'box',plantId:52,boxPending:true,boxCooldown:0}));
 await page.getByRole('button',{name:'Select box 3',exact:true}).click();
 const star=page.getByRole('radio',{name:'No star',exact:true});await star.focus();await page.keyboard.press('ArrowRight');
 assert.equal(await page.getByRole('radio',{name:'Use star',exact:true}).getAttribute('aria-checked'),'true');
 await page.getByRole('button',{name:'Play with star',exact:true}).click();
 assert.equal(await page.getByRole('button',{name:'Select box 8',exact:true}).isDisabled(),true);
 await page.evaluate(()=>window.finishBox());await page.getByText('Box 3 · 1 star spent',{exact:true}).waitFor();
 // Medium: a suspended clock uses elapsed time rather than number of interval callbacks.
 await page.evaluate(()=>window.mountAudit({plantId:53,boxPending:false,boxCooldown:60}));
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Play box'&&b.disabled));
 await page.evaluate(()=>{const original=Date.now;Date.now=()=>original()+120000;window.auditOriginalNow=original;window.dispatchEvent(new Event('focus'));});
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Play box'&&!b.disabled));
 await page.evaluate(()=>{Date.now=window.auditOriginalNow;});
 await page.evaluate(()=>window.mountAudit({plantId:70,boxCooldown:0,stars:0}));
 await page.getByRole('radio',{name:'SpinLeaf',exact:true}).click();
 const noStars=page.getByRole('button',{name:'Not enough stars',exact:true});await noStars.waitFor();assert.equal(await noStars.isDisabled(),true);
 await page.evaluate(()=>window.mountAudit({plantId:71,stars:10,spinCooldown:60}));await page.getByRole('radio',{name:'SpinLeaf',exact:true}).click();
 const cooling=page.getByRole('button',{name:/^\d+ cooldown$/});await cooling.waitFor();assert.equal(await cooling.isDisabled(),true);
 await page.evaluate(()=>{window.auditState.spinCooldown=0;});
 // Low CA14/15: current key durability, accessible real outcomes, and configured plural cost.
 await page.evaluate(()=>window.mountAudit({surface:'box',plantId:80,starCost:2,stars:10,spinCooldown:0,rewards:[[120n,0n,0n],[-120n,0n,0n],[0n,3600n,0n],[0n,0n,3000n],[4n,60n,7n],[0n,0n,0n]]}));
 await page.getByRole('radio',{name:'SpinLeaf',exact:true}).click();
 const startSpin=page.getByRole('button',{name:'Start SpinLeaf (2 stars)',exact:true});
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Start SpinLeaf (2 stars)'&&!b.disabled));
 const outcomes=page.getByRole('list',{name:'Possible SpinLeaf outcomes'});assert.equal(await outcomes.getByRole('listitem').count(),6);
 for(const text of ['+120 PTS','−120 PTS','+3600 lifetime','+3000 LEAF','+4 PTS · +60 lifetime · +7 LEAF','No reward'])assert.ok((await outcomes.innerText()).includes(text),text);
 await page.getByText('Start a spin with 2 stars',{exact:true}).waitFor();
 await page.getByText('The animation is for fun. The contract determines the outcome; reveal timing does not improve your reward.').waitFor();
 // Storage was valid when the action became enabled, then disappears immediately before click.
 await page.evaluate(()=>{window.spinSubmissions=0;localStorage.clear();window.auditStorageSet=Storage.prototype.setItem;Storage.prototype.setItem=function(){throw Error('storage disappeared');};});
 await startSpin.click();await page.getByRole('button',{name:'Retry reveal key storage',exact:true}).waitFor();
 assert.equal(await page.evaluate(()=>window.spinSubmissions),0,'false preflight must veto the wrapper submission');
 assert.equal(await page.getByRole('button',{name:'Reveal key storage unavailable',exact:true}).isDisabled(),true);
 await page.evaluate(()=>{Storage.prototype.setItem=window.auditStorageSet;});
 await page.getByRole('button',{name:'Retry reveal key storage',exact:true}).click();await startSpin.waitFor();assert.equal(await startSpin.isEnabled(),true);
 await startSpin.click();assert.equal(await page.evaluate(()=>window.spinSubmissions),1,'restored durable storage permits retry');
 await page.evaluate(()=>window.mountAudit({plantId:81,rewardFail:true}));await page.getByRole('radio',{name:'SpinLeaf',exact:true}).click();
 await page.getByText('Reward previews are unavailable until game details load.').waitFor();assert.equal(await page.getByRole('list',{name:'Possible SpinLeaf outcomes'}).count(),0);
 await page.evaluate(()=>{window.auditState.rewardFail=false;window.auditState.starCost=1;});
 // Medium: mobile type-first choice and board semantics, verified odds, and one board Tab stop.
 await page.evaluate(()=>window.mountAudit({surface:'roulette',token:'0x0000000000000000000000000000000000000055',activeBet:false,boxPending:false,poolBalance:36000000000}));
 const amount=page.getByRole('textbox',{name:'Bet per selection'});await amount.waitFor();
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Select bets'));
 const table=page.getByRole('group',{name:'Roulette betting table',exact:true});
 assert.equal(await table.locator('button[tabindex="0"]').count(),1);
 await table.getByRole('button',{name:'Bet straight on 0',exact:true}).focus();await page.keyboard.press('ArrowRight');
 assert.notEqual(await page.evaluate(()=>document.activeElement?.getAttribute('aria-label')),'Bet straight on 0');
 await page.keyboard.press('Home');await page.keyboard.press('Enter');
 assert.equal(await table.getByRole('button',{name:'Bet straight on 0',exact:true}).getAttribute('aria-pressed'),'true');
 await page.getByRole('combobox',{name:'Bet type'}).first().selectOption('split');
 const split=page.getByRole('button',{name:'Add Split 1–2 bet',exact:true}).first();await split.click();
 assert.equal(await split.getAttribute('aria-pressed'),'true');
 assert.ok((await page.locator('body').innerText()).includes('Pays 17:1 + stake'));
 await amount.fill('.');await page.evaluate(()=>window.mountAudit({poolBalance:72000000}));assert.equal(await amount.inputValue(),'.','pool updates preserve an incomplete draft');
 await amount.fill('3');await page.evaluate(()=>window.mountAudit({poolBalance:36000000}));
 await page.getByText('Adding this amount would exceed the current maximum total stake. Your amount has been kept so you can adjust it.').waitFor();assert.equal(await amount.inputValue(),'3');await page.getByRole('button',{name:'Adjust selected bets',exact:true}).waitFor();assert.equal(await page.getByRole('button',{name:'Adjust selected bets',exact:true}).isDisabled(),true);
 // Medium: pre-submission copy must not claim a known transaction hash.
 await page.evaluate(()=>window.mountAudit({token:'0x0000000000000000000000000000000000000056',poolBalance:36000000000,casinoPending:true}));
 await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(b=>b.textContent==='Select bets'));
 await page.getByRole('button',{name:'Bet straight on 0',exact:true}).click();
 await page.getByRole('button',{name:/^Spin \(/}).click();
 await page.getByText('Confirm or reject in your wallet',{exact:true}).waitFor();
 await page.getByRole('button',{name:'Close Roulette dialog',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.auditToasts.at(-1)),'Confirm or reject the request in your wallet before closing.');
 await page.evaluate(()=>window.casinoStatus({statusName:'transactionPending',statusData:{transactionHash:'0x'+'55'.repeat(32)}}));
 await page.getByRole('button',{name:'Close Roulette dialog',exact:true}).click();
 assert.equal(await page.evaluate(()=>window.auditToasts.at(-1)),'Transaction submitted. Waiting for confirmation.');
 // Medium: the actual Spin transaction decodes only matching receipts and preserves negative signs.
 const event=parseAbiItem('event SpinGameV2Played(uint256 indexed nftId,address indexed player,uint256 indexed rewardIndex,int256 pointsDelta,uint256 timeAdded,uint256 leafAmount)');
 const spinLog={address:'0x0000000000000000000000000000000000000004',topics:encodeEventTopics({abi:[event],eventName:'SpinGameV2Played',args:{nftId:54n,player:'0x0000000000000000000000000000000000000001',rewardIndex:2n}}),data:encodeAbiParameters([{type:'int256'},{type:'uint256'},{type:'uint256'}],[-120n,0n,0n])};
 await page.evaluate(()=>{window.spinCompletion=null;window.mountAudit({surface:'spin-transaction',plantId:54,spinStatus:{statusName:'success',statusData:{transactionReceipts:[{transactionHash:'0x'+'61'.repeat(32),logs:[]}]}}});});
 await page.getByRole('button',{name:'Reveal result',exact:true}).click();
 await page.waitForFunction(()=>window.spinCompletion?.state==='unavailable');assert.ok(await page.evaluate(()=>window.receiptReads>0));
 await page.evaluate(()=>window.mountAudit({surface:'box',plantId:54,boxCooldown:0}));
 await page.getByRole('heading',{name:'Spin confirmed · result unavailable',exact:true}).waitFor();
 await page.getByRole('button',{name:'Retry SpinLeaf result',exact:true}).click();
 await page.getByText('The reward is still unavailable. Your receipt is saved; try again later.').waitFor();
 await page.evaluate(log=>{window.auditState.canonicalLogs=[log]},spinLog);
 await page.getByRole('button',{name:'Retry SpinLeaf result',exact:true}).click();
 await page.getByRole('heading',{name:'Spin confirmed · result unavailable',exact:true}).waitFor({state:'hidden'});
 assert.equal(await page.evaluate(()=>localStorage.getItem('pixotchi:spinleaf:result:0x0000000000000000000000000000000000000001:54')),null);
 await page.evaluate(log=>{window.spinCompletion=null;window.mountAudit({surface:'spin-transaction',spinStatus:{statusName:'success',statusData:{transactionReceipts:[{transactionHash:'0x'+'62'.repeat(32),logs:[log]}]}}});},spinLog);
 await page.getByRole('button',{name:'Reveal result',exact:true}).click();await page.waitForFunction(()=>window.spinCompletion?.state==='resolved');
 assert.equal(await page.evaluate(()=>window.auditToasts.at(-1)),'Spin result: −120 PTS');
 assert.deepEqual(errors,[]);
 await page.close();
 console.log(`Arcade P1 + medium + low actual-component checks passed at ${width}px: Box read/retry, subject isolation, Roulette config retry, outage-safe reveal/results, stalled-chain reveal, off-tab expiry persistence; medium choice semantics, pending snapshots, elapsed cooldown, preserved draft, wallet stage, Spin result recovery; low current-storage veto/retry, six signed configured outcomes and plural cost.`);
 }
} finally { await browser.close(); }
