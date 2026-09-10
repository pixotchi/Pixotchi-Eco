import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { build } from 'esbuild';
import { chromium } from '@playwright/test';

// Production card, recovery card, polling helpers, owner scope, and controls.
// Only wallet hooks and HTTP fetch are fixtures; no payout/RPC service is used.
const fixture = `
import React from 'react';
import {createRoot} from 'react-dom/client';
import {AirdropClaimCard} from '@/components/airdrop-claim-card';
const scenario=new URLSearchParams(location.search).get('scenario')||'manual';
const allocation={eligible:true,seed:'12.5',leaf:'4',pixotchi:'2',claimed:false,attemptId:'attempt-reference',operationId:'operation-reference'};
const statuses={
 manual:{...allocation,status:'pending',recoveryState:'manual_review',retryAllowed:false},
 contradictory:{...allocation,status:'eligible',recoveryState:'manual_review',retryAllowed:true},
 pending:{...allocation,status:'pending',recoveryState:'processing',retryAllowed:false},
 retry:{...allocation,status:'pending',recoveryState:'retryable',retryAllowed:true},
 failedRetry:{...allocation,status:'failed',recoveryState:'retryable',retryAllowed:true},
};
window.airdropFixture={scenario,status:statuses[scenario],statusGets:0,messageGets:0,posts:0,signatures:0,requests:[],
 owner:'0x1111111111111111111111111111111111111111',postResult:{status:'pending',attemptId:'attempt-reference',operationId:'operation-reference',recoveryState:'manual_review',retryAllowed:false},statuses};
const realFetch=window.fetch;
window.fetch=async(input,init={})=>{
 const f=window.airdropFixture;const url=String(input);const method=init.method||'GET';
 f.requests.push({url,method});
 if(url.startsWith('/api/airdrop/status')){f.statusGets++;return Response.json(f.status);}
 if(url.startsWith('/api/airdrop/claim')&&method==='GET'){f.messageGets++;return Response.json({message:'Fixture airdrop authorization',timestamp:Math.floor(Date.now()/1000)});}
 if(url==='/api/airdrop/claim'&&method==='POST'){f.posts++;return Response.json(f.postResult,{status:202});}
 if(url.startsWith('/api/'))throw Error('Unexpected API boundary: '+url);
 return realFetch(input,init);
};
createRoot(document.getElementById('root')).render(<AirdropClaimCard/>);
`;
const bundle = await build({
  stdin: { contents: fixture, sourcefile: 'airdrop-recovery-fixture.jsx', resolveDir: process.cwd(), loader: 'jsx' },
  bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"test"', 'process.env.NEXT_PUBLIC_SHOW_AIRDROP': '"true"', 'process.env': '{}' },
  plugins: [{ name: 'airdrop-wallet-boundary', setup(plugin) {
    plugin.onResolve({filter:/^wagmi$/},()=>({path:'wallet',namespace:'airdrop-fixture'}));
    plugin.onLoad({filter:/.*/,namespace:'airdrop-fixture'},()=>({contents:`
      export const useAccount=()=>({address:window.airdropFixture.owner});
      export const useSignMessage=()=>({signMessageAsync:async()=>{window.airdropFixture.signatures++;return '0x'+'a'.repeat(130);}});
    `,loader:'js'}));
  } }],
});
const script = bundle.outputFiles.find(file => file.path.endsWith('.js')) ?? bundle.outputFiles[0];
const server = createServer((request,response)=>{
  if(request.url==='/app.js'){
    response.setHeader('Content-Type','text/javascript'); response.end(script.text); return;
  }
  if(request.url?.startsWith('/_next/image') || request.url?.endsWith('.png') || request.url?.endsWith('.svg')){
    response.setHeader('Content-Type','image/svg+xml'); response.end('<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14"/>'); return;
  }
  response.setHeader('Content-Type','text/html');
  response.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body><main id="root"></main><script src="/app.js"></script></body></html>');
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
let browser;
const errors=[];
try {
  browser=await chromium.launch({headless:true});
  const origin=`http://127.0.0.1:${server.address().port}`;
  const makePage=async scenario=>{
    const page=await browser.newPage();
    page.on('pageerror',error=>errors.push(error.message));
    // Deny external services even if a future dependency attempts a request.
    await page.route('**/*',route=>route.request().url().startsWith(origin)?route.continue():route.abort());
    await page.clock.install({time:new Date('2026-09-10T18:00:00Z')});
    await page.goto(`${origin}/?scenario=${scenario}`);
    await page.waitForFunction(()=>window.airdropFixture?.statusGets===1);
    return page;
  };
  const counts=page=>page.evaluate(()=>{
    const {statusGets,messageGets,posts,signatures}=window.airdropFixture;
    return {statusGets,messageGets,posts,signatures};
  });

  for(const scenario of ['manual','contradictory']){
    const page=await makePage(scenario);
    await page.getByRole('heading',{name:'Claim needs review',exact:true}).waitFor();
    assert.equal(await page.getByRole('button',{name:/Claim Airdrop|Retry claim safely/}).count(),0);
    await page.clock.runFor(3*60*60*1000);
    assert.deepEqual(await counts(page),{statusGets:1,messageGets:0,posts:0,signatures:0},'Manual review blocks automatic polling/signing/POST even if eligible/retryAllowed conflict');
    // An explicit status check remains observation-only and cannot restart automatic polling.
    await page.getByRole('button',{name:'Check status',exact:true}).click();
    await page.waitForFunction(()=>window.airdropFixture.statusGets===2);
    await page.getByRole('button',{name:'Check status',exact:true}).waitFor();
    await page.clock.runFor(60*60*1000);
    assert.deepEqual(await counts(page),{statusGets:2,messageGets:0,posts:0,signatures:0});
    await page.close();
  }

  const pending=await makePage('pending');
  await pending.getByRole('button',{name:'Confirming onchain...',exact:true}).waitFor();
  assert.equal(await pending.getByRole('button',{name:'Confirming onchain...',exact:true}).isDisabled(),true);
  await pending.clock.runFor(6_500);
  await pending.waitForFunction(()=>window.airdropFixture.statusGets===2);
  await pending.clock.runFor(13_000);
  await pending.waitForFunction(()=>window.airdropFixture.statusGets===3);
  assert.deepEqual(await counts(pending),{statusGets:3,messageGets:0,posts:0,signatures:0},'Normal pending claims keep observing without rebroadcast');
  // A poll discovering manual review cancels the next scheduled observation.
  await pending.evaluate(()=>{window.airdropFixture.status=window.airdropFixture.statuses.manual;});
  await pending.clock.runFor(25_000);
  await pending.getByRole('heading',{name:'Claim needs review',exact:true}).waitFor();
  const stopped=await counts(pending);
  await pending.clock.runFor(3*60*60*1000);
  assert.deepEqual(await counts(pending),stopped,'Transitioning to manual review stops a previously active poll loop');
  await pending.close();

  for(const scenario of ['retry','failedRetry']){
    const page=await makePage(scenario);
    const retry=page.getByRole('button',{name:'Retry claim safely',exact:true});
    await retry.waitFor();
    assert.equal(await retry.isEnabled(),true);
    await page.clock.runFor(3*60*60*1000);
    assert.deepEqual(await counts(page),{statusGets:1,messageGets:0,posts:0,signatures:0},'A retryable claim requires an explicit user click');
    await retry.click();
    await page.getByRole('heading',{name:'Claim needs review',exact:true}).waitFor();
    assert.deepEqual(await counts(page),{statusGets:1,messageGets:1,posts:1,signatures:1},'One click authorizes one signed claim submission');
    await page.clock.runFor(3*60*60*1000);
    assert.deepEqual(await counts(page),{statusGets:1,messageGets:1,posts:1,signatures:1},'Manual review returned by POST cannot trigger another POST or polling');
    await page.close();
  }
  assert.deepEqual(errors,[],'Real production recovery components have no browser runtime errors');
  console.log('Airdrop recovery Chromium smoke passed: manual review stops polling/retries, pending keeps observing, and safe retries require one explicit click.');
} finally {
  await browser?.close();
  await new Promise(resolve=>server.close(resolve));
}
