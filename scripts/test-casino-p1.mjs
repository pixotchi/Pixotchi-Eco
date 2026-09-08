import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

// Real dialogs, transaction preparation and receipt parser; only host/wallet/RPC
// adapters are replaced. Dialogs, fields, cards and CSS are production components.
// No RPC or wallet is contacted; screenshots are evidence, not golden baselines.
const common = `import React from 'react'; const w = () => window.casinoTest;`;
const mocks = {
  '@/lib/contracts': `${common}
    export {BlackjackAction,BlackjackPhase,BlackjackResult} from '@/public/abi/blackjack-abi';
    export {BaccaratBetType,BaccaratOutcome} from '@/public/abi/baccarat-abi';
    export const LAND_CONTRACT_ADDRESS='0x3333333333333333333333333333333333333333';
    export const blackjackGetGameSnapshot=async()=> { if(w().snapshotFailure) throw Error('RPC unavailable'); return w().snapshot; };
    export const blackjackGetGameToken=async()=>w().token;
    export const blackjackGetTokenConfig=async()=> { if(w().configFailure) throw Error('RPC unavailable'); return {supported:true,enabled:true,minBet:w().minBet??1000000n,maxBet:1000000000n}; };
    export const checkCasinoApproval=async()=>{ if(w().allowanceFailure) throw Error('Allowance unavailable'); return w().allowance; };
    export const blackjackFetchRandomness=async(_land,mode,_owner,_hand,_token,amount)=>{ w().preparations++; return new Promise(resolve=>w().resolveRandomness=()=>resolve({randomSeed:1n,nonce:1n,signature:'0x',lockedBetAmountWei:amount,expiresAt:Math.floor(Date.now()/1000)+60})); };
    export const buildBlackjackActionWithRandomCall=()=>({to:LAND_CONTRACT_ADDRESS,data:'0x',value:0n});
    export const buildBlackjackDealWithRandomCall=buildBlackjackActionWithRandomCall;
    export const buildBlackjackDealWithRandomForTokenCall=buildBlackjackActionWithRandomCall;
    export const baccaratGetActiveGame=async()=>{if(w().activeFailure)throw Error('active read unavailable');return w().active;};
    export const baccaratGetConfig=async()=>{if(w().configFailure)throw Error('config unavailable');return{enabled:true,bankerCommissionBps:w().commission??500,tiePayoutMultiplier:w().tieMultiplier??8}};
    export const baccaratGetTokenConfig=async()=>({supported:!w().unsupported,enabled:true,minBet:w().minBet??1000000n,maxBet:1000000000n,rewardPool:LAND_CONTRACT_ADDRESS});
    export const buildBaccaratPlaceBetCall=buildBlackjackActionWithRandomCall;
    export const buildBaccaratPlaceBetWithTokenCall=buildBlackjackActionWithRandomCall;
    export const buildBaccaratRevealCall=buildBlackjackActionWithRandomCall;`,
  'wagmi': `${common}
    export const useAccount=()=>({address:w().owner});
    const refetch=async()=>{if(w().balanceFailure) throw Error('balance unavailable'); return {data:{value:10000000000000000000000n}}};
    export const useBalance=({token,address}={})=>({data:{value:10000000000000000000000n,decimals:token===w().token?6:18},error:(address==='0x3333333333333333333333333333333333333333'?w().poolFailure:w().balanceFailure)?Error('read unavailable'):undefined,isLoading:false,refetch});
    export const useBlockNumber=()=>({data:w().block??10n});`,
  '@/hooks/useTokenMetadata': `${common}
    const refetch=async()=>{};
    export const useTokenMetadata=(token)=>({symbol:token===w().token?'BETA':'ALPHA',decimals:w().metadataFailure?undefined:token===w().token?6:18,isReady:!!token&&!w().metadataFailure,isError:!!w().metadataFailure,refetch});`,
  '@/lib/casino-client': `export const getClientCasinoPolicy=()=>({playable:true,blackjackEnabled:true});`,
  '@/lib/utils': `import{clsx}from'clsx';import{twMerge}from'tailwind-merge';export const cn=(...args)=>twMerge(clsx(args));export const getCasinoTokenImage=()=>'/icons/leaf.png';export const formatTokenAmount=(amount,decimals)=>String(Number(amount)/10**decimals);`,
  '@/lib/paymaster-context': `export const usePaymaster=()=>({isSponsored:false});`,
  '@/lib/builder-code': `export const getBuilderCapabilities=()=>({});export const transformCallsWithBuilderCode=calls=>calls;`,
  '@/lib/farcaster-miniapp-auth-client': `export const getMiniAppQuickAuthHeaders=async()=>({});`,
  '@/lib/mission-tracking': `export const postMissionProgress=async(payload)=>{window.casinoTest.missionProofs.push(payload)};`,
  '@/lib/transaction-refresh': `export const dispatchPostTransactionRefresh=()=>{};export const POST_TRANSACTION_REFRESH_DELAYS_MS=[];`,
  '@/lib/base-rpc': `${common} export const getBaseTransactionReceipt=async()=>{w().receiptReads++;if(w().receiptMode==='missing')throw Error('receipt unavailable');return w().receipt(w().receiptMode);};`,
  'next/image': `${common} export default function Image({fill,priority,...props}){return <img {...props}/>}`,
  'react-hot-toast': `export const toast=Object.assign(()=>{}, {success:()=>{},error:()=>{}});`,
  './global-transaction-toast': `export default function Toast(){return null}`,
  './approve-transaction': `${common} export default function Approve({onSuccess,buttonText,disabled,buttonClassName}){return <button className={buttonClassName} disabled={disabled} onClick={()=>{w().allowance=1000000000000n;onSuccess?.({})}}>{buttonText}</button>}`,
  './transaction-kit': `${common} const C=React.createContext(null);export const Transaction=({children,...props})=><C.Provider value={props}>{children}</C.Provider>;export const TransactionButton=({text,disabled,ariaLabel,className})=>{const c=React.useContext(C);return <button aria-label={ariaLabel} className={className} disabled={disabled||!c.canSubmit} onClick={()=>{w().emitBlackjackStatus=c.onStatus;const receipts=[...(w().prependReceipt?[{transactionHash:'0x'+'b'.repeat(64),logs:[]}]:[]),w().blackjackReceipt()];w().blackjackStatus={statusName:'success',statusData:{transactionReceipts:receipts}};c.onStatus?.(w().blackjackStatus)}}>{text}</button>};`,
  './game-transaction': `${common} export default function GameTransaction(p){return <button className={p.buttonClassName} disabled={p.disabled} onClick={async()=>{p.onButtonClick?.();p.onStatusUpdate?.({statusName:'transactionPending'});await p.onStatusUpdate?.({statusName:'success',statusData:{transactionHash:w().hash,transactionReceipts:[{transactionHash:w().hash,logs:[]}]}})}}>{p.buttonText}</button>}`,
};
const entry = `
  import React from 'react';import{createRoot}from'react-dom/client';
  import BlackjackDialog from '@/components/transactions/BlackjackDialog';
  import BaccaratDialog from '@/components/transactions/BaccaratDialog';
  import{encodeEventTopics,encodeAbiParameters}from'viem';import{baccaratAbi}from'@/public/abi/baccarat-abi';import{blackjackAbi}from'@/public/abi/blackjack-abi';
  const owner='0x1111111111111111111111111111111111111111';const token='0x2222222222222222222222222222222222222222';
  window.casinoTest={owner,token,selectedToken:'0x4444444444444444444444444444444444444444',landId:1n,allowance:1000000000000n,missionProofs:[],preparations:0,receiptReads:0,receiptMode:'missing',hash:'0x'+'a'.repeat(64),
    snapshot:{isActive:true,player:owner,phase:2,betAmount:10000000n,activeHandCount:1,hasSplit:false,actionHandIndex:0,hand1Cards:[7,20],hand1Value:16,hand2Cards:[],hand2Value:0,dealerCards:[8],dealerValue:9,canHit:true,canStand:true,canDouble:true,canSplit:true,canSurrender:true},
    active:{isActive:true,player:owner,betType:1,betAmount:10000000n,revealBlock:1n,canReveal:true,isExpired:false,bettingToken:token}};
  const w=window.casinoTest;
  w.receipt=(mode)=>{const make=(name,args)=>{const abi=baccaratAbi.find(x=>x.type==='event'&&x.name===name);return{address:'0x3333333333333333333333333333333333333333',topics:encodeEventTopics({abi:baccaratAbi,eventName:name,args}),data:encodeAbiParameters(abi.inputs.filter(x=>!x.indexed),abi.inputs.filter(x=>!x.indexed).map(x=>args[x.name]))}};
    const logs=[make('BaccaratRoundResult',{landId:1n,player:owner,betType:1,outcome:1,won:true,playerTotal:3,bankerTotal:8,payout:19500000n,bettingToken:token})];
    if(mode==='complete')logs.push(make('BaccaratRoundCards',{landId:1n,player:owner,playerCard1:1,playerCard2:0,playerCard3:w.longCards?10:255,playerCardCount:w.longCards?3:2,bankerCard1:3,bankerCard2:3,bankerCard3:w.longCards?10:255,bankerCardCount:w.longCards?3:2}));
    return{transactionHash:w.hash,logs};};
  w.blackjackReceipt=()=>{const eventName=w.naturalDeal?'BlackjackGameComplete':'BlackjackResult';const event=blackjackAbi.find(x=>x.type==='event'&&x.name===eventName);const values={landId:1n,player:w.owner,bettingToken:w.token,result:w.naturalDeal?2:1,playerCards:[0,12],splitCards:[],dealerCards:[8,21],playerFinalValue:w.naturalDeal?21:20,splitFinalValue:0,dealerFinalValue:18,payout:w.blackjackPayout??20000000n};const inputs=event.inputs.filter(x=>!x.indexed);return{transactionHash:w.hash,logs:w.blackjackNoSettlement?[]:[{address:'0x3333333333333333333333333333333333333333',topics:encodeEventTopics({abi:blackjackAbi,eventName,args:values}),data:encodeAbiParameters(inputs,inputs.map(x=>values[x.name]))}]}};
  const root=createRoot(document.getElementById('root'));let version=0;
  w.render=()=>root.render(w.game==='baccarat'?<BaccaratDialog key={version} open landId={w.landId} selectedToken={w.selectedToken} onOpenChange={()=>{}}/>:<BlackjackDialog key={version} open landId={w.landId} selectedToken={w.token} onOpenChange={()=>{}}/>);
  w.reset=(game)=>{w.game=game;version++;w.render();};w.reset(new URLSearchParams(location.search).get('game')||'blackjack');
`;

const built = await build({ stdin: { contents: entry, resolveDir: process.cwd(), loader: 'tsx' }, bundle: true, write: false, outdir: 'output/.casino-p1-bundle', platform: 'browser', format: 'iife', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"development"' }, plugins: [{ name: 'casino-adapters', setup(b) {
  b.onResolve({ filter: /.*/ }, args => args.path in mocks ? { path: args.path, namespace: 'casino-adapter' } : undefined);
  b.onLoad({ filter: /.*/, namespace: 'casino-adapter' }, args => ({ contents: mocks[args.path], loader: 'tsx', resolveDir: process.cwd() }));
} }] });
const css = (await postcss([tailwindcss({base:process.cwd()})]).process(await readFile('app/globals.css','utf8'), {from:path.resolve('app/globals.css')})).css;
const server = createServer(async (req, res) => {
  if(req.url==='/app.js'){res.setHeader('Content-Type','text/javascript');res.end(built.outputFiles.find(file=>file.path.endsWith('.js')).text);return;}
  if(req.url==='/app.css'){res.setHeader('Content-Type','text/css');res.end(css+'\n'+built.outputFiles.filter(file=>file.path.endsWith('.css')).map(file=>file.text).join('\n'));return;}
  const assets={'/icons/casinobj-bg.webp':'image/webp','/icons/cardbj.png':'image/png','/icons/cardbjfront.png':'image/png','/icons/leaf.png':'image/png'};
  if(req.url in assets){res.setHeader('Content-Type',assets[req.url]);res.end(await readFile(path.join('public',req.url)));return;}
  res.setHeader('Content-Type','text/html');res.end('<!doctype html><html class="dark"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/app.css"><body style="font-family:Arial,sans-serif"><div id="root"></div><script src="/app.js"></script></body></html>');
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({reducedMotion:'reduce'});
const failures = [];
page.on('pageerror', e => failures.push(e.message));
const url = `http://127.0.0.1:${server.address().port}`;
const visible = async (name) => { await page.getByRole('button', { name, exact: true }).waitFor({state:'visible',timeout:10000}); };
try {
  for (const action of ['Hit', 'Stand', 'Double', 'Split', 'Surrender']) {
    await page.goto(url);
    const actionLabel = `${action}${action==='Stand'?' on':''} current Blackjack hand`;
    const button = page.getByRole('button', { name: actionLabel, exact:true });
    await button.click();
    await page.waitForFunction(() => window.casinoTest.preparations === 1);
    await page.evaluate(() => window.casinoTest.resolveRandomness());
    await visible(`${actionLabel}. Confirm this action`);
    assert.equal(await page.evaluate(() => window.casinoTest.preparations), 1, `${action} prepares once`);
    console.log(`PASS BB-01: ${action} survives deferred preparation without remount`);
  }
  await page.goto(url);
  await page.evaluate(() => { const w=window.casinoTest;w.configFailure=true;w.reset('blackjack'); });
  await visible('Retry game data');
  await page.evaluate(() => {window.casinoTest.configFailure=false});
  await page.getByRole('button',{name:'Retry game data',exact:true}).click();
  await visible('Split current Blackjack hand');
  console.log('PASS BB-04: failed config retries in place with current hand');
  await page.evaluate(() => { const w=window.casinoTest;w.allowance=0n;w.reset('blackjack'); });
  await visible('Approve additional wager');
  assert.equal(await page.getByRole('button',{name:'Split current Blackjack hand',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Approve additional wager',exact:true}).click();
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Split current Blackjack hand')?.disabled);
  console.log('PASS BB-04: additional approval restores Split without discarding hand');
  await page.evaluate(() => { const w=window.casinoTest;w.allowance=0n;w.allowanceFailure=false;w.reset('blackjack'); });
  await visible('Approve additional wager');
  await page.evaluate(() => {window.casinoTest.allowanceFailure=true});
  await page.getByRole('button',{name:'Approve additional wager',exact:true}).click();
  await page.getByText('Approval confirmed, but the updated allowance is not available yet. Retry allowance verification.',{exact:true}).waitFor({timeout:10000});
  assert.equal(await page.getByRole('button',{name:'Split current Blackjack hand',exact:true}).isDisabled(),true,'Never invent allowance after approval');
  await page.evaluate(() => {window.casinoTest.allowanceFailure=false});
  await page.getByRole('button',{name:'Retry allowance verification',exact:true}).click();
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(b=>b.getAttribute('aria-label')==='Split current Blackjack hand')?.disabled);
  console.log('PASS BB-04: delayed allowance stays disabled and explicit verification recovers');
  await page.evaluate(()=>{const w=window.casinoTest;w.metadataFailure=true;w.reset('blackjack')});
  await visible('Retry game data');
  assert.equal(await page.getByRole('button',{name:'Split current Blackjack hand',exact:true}).isDisabled(),true,'Unknown token precision cannot prepare an additional wager');
  assert.equal(await page.getByRole('button',{name:'Double current Blackjack hand',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Stand on current Blackjack hand',exact:true}).click();
  await page.waitForFunction(()=>window.casinoTest.resolveRandomness!==undefined);
  await page.evaluate(()=>window.casinoTest.resolveRandomness());
  await visible('Stand on current Blackjack hand. Confirm this action');
  assert.equal(await page.getByRole('button',{name:'Stand on current Blackjack hand. Confirm this action',exact:true}).isDisabled(),false,'Paid hand can finish without spending more');
  await page.evaluate(()=>{window.casinoTest.metadataFailure=false;window.casinoTest.render()});
  console.log('PASS BB-04: unknown token details block Double/Split while preserving Stand');
  await page.goto(url);
  await page.evaluate(()=>{const w=window.casinoTest;w.snapshot={...w.snapshot,isActive:false,phase:0,player:'0x'+'0'.repeat(40),hand1Cards:[],dealerCards:[],canHit:false,canStand:false,canSplit:false,canDouble:false,canSurrender:false};w.reset('blackjack')});
  await page.getByRole('button',{name:'Deal Blackjack hand',exact:true}).click();
  await page.waitForFunction(()=>window.casinoTest.preparations===1);
  await page.evaluate(()=>window.casinoTest.resolveRandomness());
  await visible('Deal Blackjack hand. Confirm this action');
  assert.equal(await page.getByRole('button',{name:'Deal Blackjack hand. Confirm this action',exact:true}).isDisabled(),false,'Parent in-progress marker must not disable its own ready deal');
  console.log('PASS transaction readiness: prepared Deal remains confirmable');

  await page.goto(`${url}?game=baccarat`);
  await page.getByRole('button',{name:'Reveal result',exact:true}).click();
  await page.getByText('Reveal confirmed. Result is still loading.',{exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Play Again',exact:true}).count(),0);
  assert.equal(await page.getByText(/Total returned: 0/).count(),0);
  assert.equal(await page.getByRole('link',{name:'View confirmed transaction'}).getAttribute('href'),`https://basescan.org/tx/0x${'a'.repeat(64)}`);
  await page.evaluate(()=>{window.casinoTest.receiptMode='partial'});
  await page.getByRole('button',{name:'Retry result retrieval',exact:true}).click();
  await page.waitForFunction(()=>window.casinoTest.receiptReads>=3);
  assert.equal(await page.getByRole('button',{name:'Play Again',exact:true}).count(),0,'Result-only receipt without cards remains incomplete');
  await page.evaluate(()=>{window.casinoTest.receiptMode='complete'});
  await page.getByRole('button',{name:'Retry result retrieval',exact:true}).click();
  await visible('Play Again');
  await page.getByText('Bet: Banker • Total returned: 19.5 BETA',{exact:true}).waitFor();
  console.log('PASS BB-02/03: missing and partial receipts recover; active token B payout retains 6-decimal BETA while A selected');
  await page.evaluate(()=>{const w=window.casinoTest;w.landId=2n;w.render();});
  await visible('Reveal result');
  assert.equal(await page.getByRole('button',{name:'Play Again',exact:true}).count(),0);
  assert.equal(await page.getByText(/Total returned: 19.5/).count(),0);
  console.log('PASS BB-03: mounted dialog land switch drops prior result and reads current active round');
  await page.evaluate(()=>{const w=window.casinoTest;w.landId=1n;w.render();});
  await page.getByRole('button',{name:'Reveal result',exact:true}).click();
  await visible('Play Again');
  await page.evaluate(()=>{const w=window.casinoTest;w.owner='0x5555555555555555555555555555555555555555';w.active={...w.active,player:w.owner};w.render();});
  await visible('Reveal result');
  assert.equal(await page.getByRole('button',{name:'Play Again',exact:true}).count(),0);
  assert.equal(await page.getByText(/Total returned: 19.5/).count(),0);
  console.log('PASS BB-03: wallet switch drops previous result and reads new active round');
  await page.goto(`${url}?game=baccarat`);
  await page.evaluate(()=>{const w=window.casinoTest;w.metadataFailure=true;w.receiptMode='complete';w.landId=2n;w.render();w.landId=1n;w.render();});
  await page.getByRole('button',{name:'Reveal result',exact:true}).click();
  await visible('Play Again');
  await page.getByText('Bet: Banker • Total returned: Amount unavailable until token details are verified',{exact:true}).waitFor();
  assert.equal(await page.getByText(/Total returned: 0/).count(),0);
  await page.evaluate(()=>{window.casinoTest.metadataFailure=false;window.casinoTest.render()});
  await page.getByText('Bet: Banker • Total returned: 19.5 BETA',{exact:true}).waitFor();
  console.log('PASS paid-round recovery: Baccarat reveals with unknown metadata, stores raw payout, then formats verified token precision');
  await runMediumChecks(page, url);
  await runLowChecks(page, url);
  assert.deepEqual(failures, [], 'No unhandled browser errors');
} finally { await browser.close(); await new Promise(resolve=>server.close(resolve)); }

async function runMediumChecks(page,url) {
  await mkdir('output/p2-blackjack-baccarat',{recursive:true});
  await page.setViewportSize({width:320,height:740});
  await page.goto(url+'?game=baccarat');
  await page.getByRole('region',{name:'Committed Baccarat round'}).getByText('10 BETA committed · Banker',{exact:true}).waitFor();
  await page.getByText('Reveal window: blocks 2–257 (inclusive).',{exact:true}).waitFor();
  const deadlineBounds=await page.getByText('Reveal window: blocks 2–257 (inclusive).',{exact:true}).boundingBox();
  const pendingFooter=await page.locator('[data-baccarat-action-footer]').boundingBox();
  assert.ok(deadlineBounds.y+deadlineBounds.height<=pendingFooter.y,'Committed stake and deadline lead the narrow pending view, without placeholder cards hiding them');
  await page.screenshot({path:'output/p2-blackjack-baccarat/baccarat-pending-320.png'});

  await page.evaluate(()=>{window.casinoTest.block=257n;window.casinoTest.render()});
  await page.getByText('Reveal now: this is the last valid block.',{exact:true}).waitFor();
  await page.evaluate(()=>{window.casinoTest.block=258n;window.casinoTest.render()});
  await page.getByRole('button',{name:'Close expired round',exact:true}).waitFor();
  assert.equal(await page.getByText(/Reveal now/).count(),0);
  console.log('PASS BB-05: committed stake/side, exact reveal deadline visible at 320px, final valid block and expiry agree');
  await page.setViewportSize({width:1280,height:720});
  await page.goto(url+'?game=baccarat');
  await page.evaluate(()=>{const w=window.casinoTest;w.active={...w.active,isActive:false};w.selectedToken=w.token;w.configFailure=true;w.reset('baccarat')});
  await page.getByRole('button',{name:'Retry game data',exact:true}).waitFor();
  assert.equal(await page.getByText('The selected token is not supported for Baccarat.',{exact:true}).count(),0);
  await page.evaluate(()=>{const w=window.casinoTest;w.configFailure=false;w.commission=1000;w.tieMultiplier=12});
  await page.getByRole('button',{name:'Retry game data',exact:true}).click();
  await page.getByText('1.9× total return',{exact:true}).waitFor();
  await page.getByRole('radio',{name:'Bet on Tie',exact:true}).click();
  await page.getByText('13× total return',{exact:true}).waitFor();
  await page.getByLabel('Baccarat bet amount',{exact:true}).fill('10');
  await page.getByText('130 BETA',{exact:true}).waitFor();
  await page.getByText('How to play Baccarat',{exact:true}).click();
  await page.getByText(/Banker deducts 10% commission/).waitFor();
  await page.getByText(/second transaction to reveal/).waitFor();
  console.log('PASS BB-08/13/14: retry distinguishes failed read, config drives Banker/Tie preview and rules');
  await page.evaluate(()=>{window.casinoTest.poolFailure=true;window.casinoTest.render()});
  await page.getByRole('button',{name:'Retry reward pool read',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Deal Tie',exact:true}).isDisabled(),true,'A cached pool value cannot authorize new spending after refresh fails');
  await page.evaluate(()=>{const w=window.casinoTest;w.poolFailure=false;w.balanceFailure=true;w.render()});
  await page.getByRole('button',{name:'Retry balance read',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Deal Tie',exact:true}).isDisabled(),true,'A retained balance cannot authorize new spending after refresh fails');
  await page.evaluate(()=>{window.casinoTest.balanceFailure=false});
  await page.getByRole('button',{name:'Retry balance read',exact:true}).click();
  await page.waitForFunction(()=>!Array.from(document.querySelectorAll('button')).find(button=>button.textContent==='Deal Tie')?.disabled);
  console.log('PASS BB-13: failed refresh pauses spending despite cached pool/balance, and explicit retry restores it');

  for(const game of ['baccarat','blackjack']) {
    await page.goto(url+'?game='+game);
    await page.evaluate(game=>{const w=window.casinoTest;w.minBet=123400001n;w.selectedToken=w.token;w.active={...w.active,isActive:false};w.snapshot={...w.snapshot,isActive:false,phase:0,player:'0x'+'0'.repeat(40),hand1Cards:[],dealerCards:[],canHit:false,canStand:false,canDouble:false,canSplit:false,canSurrender:false};w.reset(game)},game);
    const field=page.getByRole('textbox');
    await page.waitForFunction(()=>document.querySelector('input')?.value==='123.400001');
    await field.fill('123.4');
    assert.equal(await field.getAttribute('aria-invalid'),'true');
    const description=await field.getAttribute('aria-describedby');
    assert.match(await page.locator('[id="'+description+'"]').textContent(),/Minimum 123.400001 BETA/);
    assert.match(await page.getByRole('button',{name:game==='baccarat'?'Deal Banker':'Deal',exact:true}).textContent(),/Deal/);
    await field.fill('123.400001');
    assert.notEqual(await field.getAttribute('aria-invalid'),'true');
    console.log('PASS BB-09/12: '+game+' exact non-round minimum, associated validation and stable Deal label');
  }
  await page.goto(url);
  await page.getByRole('button',{name:'Stand on current Blackjack hand',exact:true}).click();
  await page.getByText('Preparing Stand…',{exact:true}).waitFor();
  await page.evaluate(()=>window.casinoTest.resolveRandomness());
  const confirm=page.getByRole('button',{name:'Stand on current Blackjack hand. Confirm this action',exact:true});
  await confirm.waitFor();assert.equal(await confirm.textContent(),'Confirm Stand');
  await confirm.click();
  await page.getByRole('button',{name:'Play Again',exact:true}).waitFor();
  assert.equal(await page.getByRole('img',{name:'Ace of spades',exact:true}).count(),0);
  await page.getByRole('img',{name:'Dealer card unavailable',exact:true}).waitFor();
  await page.getByText('You won 10 BETA',{exact:true}).waitFor();
  console.log('PASS BB-07/10/11/14: real result-only receipt retains unknown dealer card, explicit confirmation and exact net outcome');
  await page.goto(url);
  await page.evaluate(()=>{window.casinoTest.blackjackPayout=40000000n});
  await page.getByRole('button',{name:'Double current Blackjack hand',exact:true}).click();
  await page.evaluate(()=>window.casinoTest.resolveRandomness());
  await page.getByRole('button',{name:'Double current Blackjack hand. Confirm this action',exact:true}).click();
  await page.getByText('You won 20 BETA',{exact:true}).waitFor();
  console.log('PASS BB-11: confirmed Double counts its additional stake before showing net winnings');
  await page.goto(url+'?game=baccarat');
  await page.evaluate(()=>{const w=window.casinoTest;w.configFailure=true;w.reset('baccarat')});
  await page.getByRole('button',{name:'Retry game data',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Reveal result',exact:true}).isDisabled(),false,'Config outage does not block a verified paid round');
  console.log('PASS recovery: failed payout/config read preserves paid Baccarat reveal');
  await page.goto(url+'?game=baccarat');
  await page.evaluate(()=>{const w=window.casinoTest;w.selectedToken=w.token;w.receiptMode='complete';w.reset('baccarat')});
  await page.getByRole('button',{name:'Reveal result',exact:true}).click();
  await page.getByRole('button',{name:'Play Again',exact:true}).click();
  await page.getByRole('button',{name:'Deal Banker',exact:true}).waitFor();
  assert.equal(await page.getByRole('button',{name:'Approve BETA',exact:true}).count(),0,'Verified round allowance remains usable when replaying with the same token');
  console.log('PASS replay: Baccarat Play Again retains the verified token allowance');

  for(const width of [320,390,768,1440]) {
    await page.setViewportSize({width,height:width===320?740:900});
    await page.goto(url);
    await page.evaluate(()=>{const w=window.casinoTest;w.snapshot={...w.snapshot,hasSplit:true,activeHandCount:2,actionHandIndex:1,hand1Cards:[0,1,2,3,4,5,6],hand1Value:28,hand2Cards:[9,22],hand2Value:20,canSplit:false,canSurrender:false};w.reset('blackjack')});
    await page.getByRole('group',{name:'Hand 2',exact:true}).waitFor();
    assert.equal(await page.getByRole('group',{name:'Hand 2',exact:true}).getAttribute('data-active-hand'),'true');
    await assertHandBounds(page);
    await page.getByRole('group',{name:'Hand 2',exact:true}).evaluate(el=>el.scrollIntoView({block:'center'}));
    await page.screenshot({path:'output/p2-blackjack-baccarat/blackjack-'+width+'.png'});
    await page.goto(url+'?game=baccarat');
    await page.evaluate(()=>{const w=window.casinoTest;w.receiptMode='complete';w.longCards=true;});
    await page.getByRole('button',{name:'Reveal result',exact:true}).click();
    await page.getByRole('button',{name:'Play Again',exact:true}).waitFor();
    await assertHandBounds(page);
    await page.screenshot({path:'output/p2-blackjack-baccarat/baccarat-'+width+'.png'});
    await page.getByText('How to play Baccarat',{exact:true}).scrollIntoViewIfNeeded();
    assert.equal(await page.getByRole('button',{name:'Play Again',exact:true}).isVisible(),true,'Footer remains reachable after scrolling the result');
    console.log('PASS BB-06/11: actual cards stay inside hand panels at '+width+'px; active split hand has visible emphasis');
  }
  await page.setViewportSize({width:768,height:900});
  await page.goto(url);
  await page.evaluate(()=>{document.documentElement.style.fontSize='32px'});
  await page.getByRole('group',{name:'Your Hand',exact:true}).waitFor();
  await assertHandBounds(page);
  await page.getByRole('group',{name:'Your Hand',exact:true}).getByRole('img').first().evaluate(el=>{
    el.scrollIntoView({block:'start'});
    let parent=el.parentElement;
    while(parent&&!(parent.scrollHeight>parent.clientHeight&&['auto','scroll'].includes(getComputedStyle(parent).overflowY)))parent=parent.parentElement;
    const heading=document.querySelector('[role="dialog"] h2')?.parentElement;
    if(parent&&heading)parent.scrollTop+=el.getBoundingClientRect().top-heading.getBoundingClientRect().bottom-16;
  });
  await page.screenshot({path:'output/p2-blackjack-baccarat/blackjack-text-200.png'});
  console.log('PASS BB-06: cards retain readable proportions and wrap at 200% text size');
}
async function assertHandBounds(page) {
  const issues=await page.locator('[role="list"]').evaluateAll(lists=>lists.flatMap(list=>{
    const panel=list.getBoundingClientRect();return [...list.querySelectorAll('[role="img"]')].filter(card=>{const bounds=card.getBoundingClientRect();return bounds.left<panel.left-1||bounds.right>panel.right+1}).map(card=>card.getAttribute('aria-label'));
  }));
  assert.deepEqual(issues,[],'Every card fits its hand without relying on overlap/hover');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false,'No page horizontal overflow');
}

async function runLowChecks(page, url) {
  await page.setViewportSize({width:390,height:844});
  await mkdir('output/p3-blackjack-baccarat',{recursive:true});
  for (const game of ['blackjack','baccarat']) {
    await page.goto(url+'?game='+game);
    await page.evaluate(game=>{const w=window.casinoTest;w.selectedToken=w.token;w.snapshot={...w.snapshot,isActive:false,phase:0,betAmount:0n};w.active={...w.active,isActive:false};w.reset(game)},game);
    const input=page.getByRole('textbox',{name:new RegExp(game==='blackjack'?'Blackjack bet amount':'Baccarat bet amount','i')});
    await input.fill('12.');
    await page.evaluate(()=>{const w=window.casinoTest;w.minBet=20000000n;w.balanceFailure=true;w.render()});
    await page.getByRole('button',{name:game==='blackjack'?'Retry game data':'Retry balance read',exact:true}).waitFor();
    await page.evaluate(()=>{window.casinoTest.balanceFailure=false});
    await page.getByRole('button',{name:game==='blackjack'?'Retry game data':'Retry balance read',exact:true}).click();
    await page.getByText(/Minimum.*20 BETA|Min.*20 BETA/).first().waitFor();
    assert.equal(await input.inputValue(),'12.','A live limits refresh preserves unfinished input');
    await input.fill('12.345678');
    await page.getByText(game==='blackjack'?'How to play Blackjack':'How to play Baccarat',{exact:true}).click();
    const scrollers=await page.locator('[data-viewport-debug-dialog-surface]').evaluate(surface=>[surface,...surface.querySelectorAll('*')].filter(el=>el.scrollHeight>el.clientHeight+1&&['auto','scroll'].includes(getComputedStyle(el).overflowY)).length);
    assert.equal(scrollers,1,'One shared scroll owner in expanded rules');
    await page.screenshot({path:'output/p3-blackjack-baccarat/'+game+'-390.png'});
    console.log('PASS BB-15: '+game+' preserves edited drafts and has one scroll owner');
  }
  await page.goto(url);
  await page.evaluate(()=>{const w=window.casinoTest;w.naturalDeal=true;w.prependReceipt=true;w.blackjackPayout=2500000n;localStorage.clear();w.snapshot={...w.snapshot,isActive:false,phase:0,betAmount:0n};w.reset('blackjack')});
  await page.getByRole('button',{name:'Deal Blackjack hand',exact:true}).click();
  await page.waitForFunction(()=>window.casinoTest.preparations===1);
  await page.evaluate(()=>window.casinoTest.resolveRandomness());
  await page.getByRole('button',{name:'Deal Blackjack hand. Confirm this action',exact:true}).click();
  await page.getByRole('button',{name:'Play Again',exact:true}).waitFor();
  await page.evaluate(()=>{const w=window.casinoTest;w.emitBlackjackStatus(w.blackjackStatus);w.emitBlackjackStatus(w.blackjackStatus)});
  assert.deepEqual(await page.evaluate(()=>window.casinoTest.missionProofs),[{address:'0x1111111111111111111111111111111111111111',taskId:'s3_play_casino_game',proof:{txHash:'0x'+'a'.repeat(64)}}],'Natural credits the settlement receipt exactly once, even after an earlier approval receipt');
  await page.screenshot({path:'output/p3-blackjack-baccarat/natural-390.png'});
  console.log('PASS BB-16: natural Deal settlement submits the matching receipt once');
  for (const settled of [true,false]) {
    await page.goto(url);
    await page.evaluate(settled=>{const w=window.casinoTest;w.blackjackNoSettlement=!settled;w.metadataFailure=true;w.reset('blackjack')},settled);
    await page.getByRole('button',{name:'Stand on current Blackjack hand',exact:true}).click();
    await page.waitForFunction(()=>window.casinoTest.preparations===1);
    await page.evaluate(()=>window.casinoTest.resolveRandomness());
    await page.getByRole('button',{name:'Stand on current Blackjack hand. Confirm this action',exact:true}).click();
    await page.evaluate(()=>{const w=window.casinoTest;w.emitBlackjackStatus(w.blackjackStatus)});
    assert.equal(await page.evaluate(()=>window.casinoTest.missionProofs.length),settled?1:0,'Only a proven settlement credits progress, independent of token metadata');
  }
  console.log('PASS BB-16: ordinary paid settlement credits once during metadata outage; nonsettlement never credits');
}
