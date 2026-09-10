import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, erc20Abi, parseAbiItem, type Hex, type TransactionReceipt } from 'viem';
import { entryPoint07Address } from 'viem/account-abstraction';
import { buildAirdropCalls, getAirdropReceiptProof, getAirdropRecovery, observeAirdrop, publicAirdropStatus, runAirdropClaim, type AirdropAdapter, type AirdropOperation, type AirdropSnapshot, type AirdropStore } from '../lib/airdrop-execution';
import type { AirdropEligibilityRecord } from '../lib/airdrop-claim-state';
import { broadcastPreparedAirdrop } from '../lib/airdrop-cdp';
import { planLegacyAirdropLink } from '../lib/airdrop-reconcile-plan';

const wallet = `0x${'1'.repeat(40)}` as Hex;
const agent = `0x${'2'.repeat(40)}` as Hex;
const signature = `0x${'a'.repeat(130)}` as Hex;
const txHash = `0x${'b'.repeat(64)}` as Hex;
const blockHash = `0x${'c'.repeat(64)}` as Hex;
const hash = (n: number) => `0x${n.toString(16).padStart(64, '0')}` as Hex;
const userOpEvent = parseAbiItem('event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)');
const beforeExecution = parseAbiItem('event BeforeExecution()');

function receiptFor(operation: AirdropOperation, success = true): TransactionReceipt {
  const base = { blockHash, blockNumber: BigInt(100), transactionHash: txHash, transactionIndex: 0, removed: false };
  const logs = [{ ...base, address: entryPoint07Address, logIndex: 0, topics: encodeEventTopics({ abi: [beforeExecution], eventName: 'BeforeExecution' }), data: '0x' as Hex },
    ...operation.calls.map((call, i) => ({ ...base, address: call.to, logIndex: i + 1, topics: encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer', args: { from: agent, to: wallet } }), data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(`0x${call.data.slice(-64)}`)]) })),
    { ...base, address: entryPoint07Address, logIndex: operation.calls.length + 1,
      topics: encodeEventTopics({ abi: [userOpEvent], eventName: 'UserOperationEvent', args: { userOpHash: operation.userOpHash, sender: agent, paymaster: agent } }),
      data: encodeAbiParameters([{ type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }], [BigInt(0), success, BigInt(1), BigInt(1)]) }];
  return { ...base, status: 'success', logs } as unknown as TransactionReceipt;
}

function fixture(initial: AirdropEligibilityRecord = { seed: '1', leaf: '0.25', pixotchi: '0', status: 'eligible' }) {
  let raw = JSON.stringify(initial);
  let time = 1_000_000;
  let sequence = 0;
  let casCount = 0;
  let failCas = 0;
  const events: string[] = [];
  const operations = new Map<Hex, AirdropOperation>();
  const store: AirdropStore = {
    read: async () => ({ raw, record: JSON.parse(raw) }),
    cas: async (expected, record) => { casCount++; if (casCount === failCas || expected !== raw) return false; raw = JSON.stringify(record); return true; },
    metric: async event => { events.push(`metric:${event}`); },
  };
  const adapter: AirdropAdapter = {
    address: async () => agent,
    prepare: async calls => { const op: AirdropOperation = { userOpHash: hash(++sequence), calls, network: 'base', status: 'pending', expiresAt: new Date(time + 120_000).toISOString() }; operations.set(op.userOpHash, op); events.push(`prepare:${op.userOpHash}`); return op; },
    sign: async op => { events.push(`sign:${op}`); assert.equal(JSON.parse(raw).execution.preparedUserOpHash, op); return signature; },
    broadcast: async (op, sig, key) => {
      const persisted = JSON.parse(raw).execution;
      assert.equal(persisted.phase, 'broadcasting'); assert.equal(persisted.signature, sig); assert.equal(persisted.preparedUserOpHash, op); assert.equal(persisted.broadcastKey, key); assert.equal(typeof persisted.firstBroadcastStartedAt, 'number');
      events.push(`send:${op}`); const result = { ...operations.get(op)!, status: 'complete', transactionHash: txHash }; operations.set(op, result); return result;
    },
    observe: async (_address, op) => { events.push(`observe:${op}`); return operations.get(op)!; },
    receipt: async () => receiptFor([...operations.values()].find(op => op.status === 'complete')!),
  };
  return { store, adapter, events, operations, state: () => JSON.parse(raw) as AirdropEligibilityRecord,
    failAt: (n: number) => { failCas = n; }, now: () => time, advance: (n: number) => { time += n; },
    run: () => runAirdropClaim(store, adapter, wallet, { now: () => time }),
    set: (record: AirdropEligibilityRecord) => { raw = JSON.stringify(record); } };
}
const count = (f: ReturnType<typeof fixture>, action: string) => f.events.filter(e => e.startsWith(`${action}:`)).length;

async function main() {
  const normal = fixture();
  const paid = await normal.run();
  assert.equal(paid.status, 'claimed'); assert.equal(paid.execution?.phase, 'claimed'); assert.equal(paid.confirmedProof?.userOpHash, hash(1));
  assert.equal(count(normal, 'prepare'), 1); assert.equal(count(normal, 'send'), 1);
  const publicJson = JSON.stringify(publicAirdropStatus(paid));
  assert.ok(!publicJson.includes(signature)); assert.ok(!publicJson.includes('execution')); assert.ok(!publicJson.includes('broadcastKey'));
  await normal.run(); assert.equal(count(normal, 'send'), 1);

  const unsafe = fixture(); const safeReceipt = unsafe.adapter.receipt;
  unsafe.adapter.receipt = async () => { throw new Error('Block has not reached safe head'); };
  await unsafe.run(); assert.equal(unsafe.state().execution?.phase, 'pending'); assert.equal(getAirdropRecovery(unsafe.state()).retryAllowed, false);
  unsafe.advance(180_000); await unsafe.run(); assert.equal(count(unsafe, 'send'), 1); assert.notEqual(unsafe.state().execution?.phase, 'manual_review');
  unsafe.adapter.receipt = safeReceipt; await unsafe.run(); assert.equal(unsafe.state().status, 'claimed');

  // Every persistence boundary before the side effect prevents further progression when CAS loses.
  for (const [boundary, maxSigns, maxSends] of [[1, 0, 0], [2, 0, 0], [3, 0, 0], [4, 1, 0], [5, 1, 0], [6, 1, 0]] as const) {
    const f = fixture(); f.failAt(boundary); await f.run(); assert.equal(count(f, 'send'), maxSends, `CAS ${boundary}`); assert.ok(count(f, 'sign') <= maxSigns);
  }
  const concurrent = fixture(); await Promise.all([concurrent.run(), concurrent.run()]);
  assert.equal(count(concurrent, 'prepare'), 1); assert.equal(count(concurrent, 'send'), 1);

  const stale = fixture(); const prepare = stale.adapter.prepare;
  let releasePrepare!: () => void; let preparedSignal!: () => void;
  const ready = new Promise<void>(resolve => { preparedSignal = resolve; });
  const release = new Promise<void>(resolve => { releasePrepare = resolve; });
  let preparationCount = 0;
  stale.adapter.prepare = async calls => {
    const op = await prepare(calls);
    if (++preparationCount === 1) { preparedSignal(); await release; }
    return op;
  };
  const oldWorker = stale.run(); await ready; stale.advance(61_000);
  await stale.run(); releasePrepare(); await oldWorker;
  assert.equal(count(stale, 'prepare'), 2); assert.equal(count(stale, 'sign'), 1); assert.equal(count(stale, 'send'), 1);
  assert.equal(stale.state().execution?.preparedUserOpHash, hash(2), 'expired preparation worker must lose its CAS before signing');

  const lost = fixture(); const send = lost.adapter.broadcast;
  lost.adapter.broadcast = async (...args) => { await send(...args); throw new Error(`SDK error with ${signature}`); };
  await lost.run(); const originalStartedAt = lost.state().execution?.firstBroadcastStartedAt;
  lost.advance(48 * 60 * 60_000); await lost.run();
  assert.equal(lost.state().status, 'claimed'); assert.equal(count(lost, 'prepare'), 1); assert.equal(count(lost, 'send'), 1); assert.equal(lost.state().execution?.firstBroadcastStartedAt, originalStartedAt);

  const unsigned = fixture(); const sign = unsigned.adapter.sign;
  unsigned.adapter.sign = async () => { throw new Error('signing unavailable'); };
  await unsigned.run(); assert.equal(unsigned.state().execution?.phase, 'prepared');
  const createdAt = unsigned.state().execution?.createdAt;
  unsigned.advance(180_000); unsigned.adapter.sign = sign; await unsigned.run();
  assert.equal(unsigned.state().status, 'claimed'); assert.equal(count(unsigned, 'prepare'), 2); assert.equal(count(unsigned, 'send'), 1); assert.equal(unsigned.state().execution?.createdAt, createdAt);

  const uncertain = fixture(); uncertain.adapter.broadcast = async () => { throw new Error('response lost'); };
  await uncertain.run(); uncertain.advance(180_000); await uncertain.run();
  assert.equal(getAirdropRecovery(uncertain.state(), uncertain.now()).recoveryState, 'manual_review'); assert.equal(count(uncertain, 'prepare'), 1);

  const resend = fixture(); let sends = 0;
  const realSend = resend.adapter.broadcast;
  resend.adapter.broadcast = async (...args) => { if (++sends === 1) throw new Error('network failed before acceptance'); return realSend(...args); };
  await resend.run(); const firstHash = resend.state().operationId; await resend.run();
  assert.equal(resend.state().status, 'claimed'); assert.equal(resend.state().operationId, firstHash); assert.equal(count(resend, 'prepare'), 1);

  const wrong = fixture(); const wrongSend = wrong.adapter.broadcast;
  wrong.adapter.broadcast = async (...args) => ({ ...await wrongSend(...args), userOpHash: hash(999) });
  await wrong.run(); assert.equal(getAirdropRecovery(wrong.state()).recoveryState, 'manual_review'); await wrong.run(); assert.equal(count(wrong, 'send'), 1);

  const failed = fixture(); failed.adapter.broadcast = async (op) => { const response = { ...failed.operations.get(op)!, status: 'failed' }; failed.operations.set(op, response); return response; };
  await failed.run(); assert.equal(getAirdropRecovery(failed.state()).recoveryState, 'manual_review');

  const canonicalFailure = fixture(); canonicalFailure.adapter.broadcast = async op => { const result = { ...canonicalFailure.operations.get(op)!, status: 'failed', transactionHash: txHash }; canonicalFailure.operations.set(op, result); return result; };
  canonicalFailure.adapter.receipt = async () => receiptFor(canonicalFailure.operations.get(hash(1))!, false);
  await canonicalFailure.run(); assert.equal(canonicalFailure.state().status, 'failed'); assert.equal(canonicalFailure.state().confirmedProof?.success, false); assert.equal(getAirdropRecovery(canonicalFailure.state()).retryAllowed, true);

  const legacy = fixture({ seed: '1', status: 'pending', attemptId: 'old', reservedAt: 1, reservationExpiresAt: 2 });
  legacy.advance(48 * 60 * 60_000); await legacy.run(); assert.equal(getAirdropRecovery(legacy.state()).recoveryState, 'manual_review'); assert.equal(count(legacy, 'prepare'), 0);
  await observeAirdrop((await legacy.store.read())!, legacy.store, legacy.adapter, legacy.now(), wallet); assert.equal(count(legacy, 'send'), 0);

  // Another op's transfer in the same bundle cannot prove our op paid.
  const calls = buildAirdropCalls({ seed: '1' }, wallet);
  const target = { userOpHash: hash(4), calls, network: 'base', status: 'complete', transactionHash: txHash };
  const other = { ...target, userOpHash: hash(5) };
  const targetReceipt = receiptFor(target);
  assert.ok(getAirdropReceiptProof(targetReceipt, target.userOpHash, txHash, calls, agent, wallet));
  assert.equal(getAirdropReceiptProof(targetReceipt, target.userOpHash, hash(99), calls, agent, wallet), null);
  const mixed = { ...targetReceipt, logs: [...receiptFor(other).logs, targetReceipt.logs.at(-1)!] };
  assert.equal(getAirdropReceiptProof(mixed, target.userOpHash, txHash, calls, agent, wallet), null);

  // Explicit reconciliation links only a supplied matching operation, and never pays.
  const review = fixture({ seed: '1', status: 'pending', attemptId: 'legacy' });
  review.operations.set(target.userOpHash, target);
  const reviewSnapshot = (await review.store.read())!;
  const plan = await planLegacyAirdropLink(reviewSnapshot, wallet, target.userOpHash, 'Support ticket #123', review.adapter, review.now());
  assert.equal(plan.record.status, 'claimed'); assert.equal(review.state().status, 'pending'); assert.equal(count(review, 'send'), 0);

  // Exercise the real public SDK broadcast wrapper without network or credentials.
  let path = ''; let body = ''; let idempotency = '';
  const client = { fetch: async (input: Request | string | URL, init?: RequestInit) => {
    path = String(input); body = String(init?.body); idempotency = new Headers(init?.headers).get('X-Idempotency-Key') ?? '';
    return new Response(JSON.stringify(target), { status: 200 });
  } };
  await broadcastPreparedAirdrop(client, agent, target.userOpHash, signature, 'key-1');
  assert.ok(path.endsWith(`/${target.userOpHash}/send`)); assert.deepEqual(JSON.parse(body), { signature }); assert.equal(idempotency, 'key-1');
  await assert.rejects(broadcastPreparedAirdrop({ fetch: async () => new Response(signature, { status: 500 }) }, agent, target.userOpHash, signature, 'key'), error => error instanceof Error && !error.message.includes(signature));

  console.log('Airdrop execution smoke passed: crash/CAS/concurrency, same-hash recovery, 48h ambiguity, expiry, exact operation receipt, redaction, reconciliation dry-run.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
