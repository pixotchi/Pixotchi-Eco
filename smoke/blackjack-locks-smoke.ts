import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { promisify } from 'node:util';
import { privateKeyToAccount } from 'viem/accounts';
import type { Hex } from 'viem';
import {
  BLACKJACK_INVENTORY_KEY, BLACKJACK_UINT256_MAX, blackjackActionLockKey,
  blackjackMessageHash, blackjackQuarantineKey, parseCanonicalBlackjackLandId,
  parseBlackjackAliasKey, type BlackjackLock,
} from '../lib/blackjack-locks';
import { createBlackjackRedisStore, requireBlackjackInventory, type BlackjackLockStore } from '../lib/blackjack-lock-store';
import { beginBlackjackReconciliation, newBlackjackScan, reconcileBlackjackAliases, scanBlackjackAliasPage } from '../lib/blackjack-alias-reconciliation';
import { getBlackjackLockCounters } from '../lib/blackjack-lock-metrics';

const exec = promisify(execFile);
const signer = privateKeyToAccount(`0x${'1'.repeat(64)}`);
const token = `0x${'2'.repeat(40)}`;
const player = `0x${'3'.repeat(40)}`;

function parseResp(buffer: Buffer, offset = 0): { value: unknown; end: number } | null {
  const eol = buffer.indexOf('\r\n', offset);
  if (eol === -1) return null;
  const type = String.fromCharCode(buffer[offset]);
  const head = buffer.toString('utf8', offset + 1, eol);
  const start = eol + 2;
  if (type === '-') throw new Error(head);
  if (type === '+') return { value: head, end: start };
  if (type === ':') return { value: Number(head), end: start };
  if (type === '$') {
    const length = Number(head);
    if (length === -1) return { value: null, end: start };
    if (buffer.length < start + length + 2) return null;
    return { value: buffer.toString('utf8', start, start + length), end: start + length + 2 };
  }
  if (type === '*') {
    const values: unknown[] = [];
    let end = start;
    for (let index = 0; index < Number(head); index++) {
      const child = parseResp(buffer, end);
      if (!child) return null;
      values.push(child.value); end = child.end;
    }
    return { value: values, end };
  }
  throw new Error('Unknown isolated Redis response');
}

function command(port: number, args: Array<string | number>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    let buffer = Buffer.alloc(0);
    socket.setTimeout(10_000, () => socket.destroy(new Error('Isolated Redis timed out')));
    socket.on('error', reject);
    socket.on('connect', () => socket.write(`*${args.length}\r\n${args.map(arg => `$${Buffer.byteLength(String(arg))}\r\n${arg}\r\n`).join('')}`));
    socket.on('data', chunk => {
      buffer = Buffer.concat([buffer, chunk]);
      try {
        const parsed = parseResp(buffer);
        if (parsed) { socket.end(); resolve(parsed.value); }
      } catch (error) { socket.destroy(); reject(error); }
    });
  });
}

async function signedLock(landId = BigInt(1), nonce = BigInt(7), seed = 'a'): Promise<BlackjackLock> {
  const fields = { randomSeed: `0x${seed.repeat(64)}` as Hex, actionNum: 0, handIndex: 0, bettingToken: token };
  return { ...fields, timestamp: 1, signerAddress: signer.address, playerAddress: player, betAmountWei: null,
    signature: await signer.signMessage({ message: { raw: blackjackMessageHash(landId, nonce, fields) } }) };
}

async function main() {
  assert.equal(parseCanonicalBlackjackLandId('0'), BigInt(0));
  assert.equal(parseCanonicalBlackjackLandId('1'), BigInt(1));
  assert.equal(parseCanonicalBlackjackLandId(BLACKJACK_UINT256_MAX.toString()), BLACKJACK_UINT256_MAX);
  for (const value of ['00', '01', '-1', '+1', ' 1', '1 ', '1.0', '1e2', '', '0'.repeat(79), (BLACKJACK_UINT256_MAX + BigInt(1)).toString(), 1]) {
    assert.equal(parseCanonicalBlackjackLandId(value), null, `Reject ${String(value)}`);
  }
  assert.equal(blackjackActionLockKey(BigInt(1), BigInt(7)), 'blackjack:action-lock:1:7');
  assert.equal(parseBlackjackAliasKey('blackjack:action-lock:0001:007')?.canonicalKey, 'blackjack:action-lock:1:7');
  assert.equal(parseBlackjackAliasKey('blackjack:action-lock:1:7:extra'), null);

  const container = `pixotchi-blackjack-smoke-${randomUUID()}`;
  await exec('docker', ['run', '--rm', '--detach', '--name', container, '--publish', '127.0.0.1::6379', 'redis:7-alpine'], { timeout: 60_000 });
  try {
    const port = Number((await exec('docker', ['port', container, '6379/tcp'])).stdout.trim().split(':').at(-1));
    const adapter = {
      eval: (script: string, keys: string[], values: string[]) => command(port, ['EVAL', script, keys.length, ...keys, ...values]),
      scan: (cursor: string, options: { match: string; count: number }) => command(port, ['SCAN', cursor, 'MATCH', options.match, 'COUNT', options.count]),
    } as unknown as NonNullable<Parameters<typeof createBlackjackRedisStore>[0]>;
    const prefix = `isolated:${randomUUID()}:`;
    const store = createBlackjackRedisStore(adapter, key => `${prefix}${key}`);
    const raw = JSON.stringify(await signedLock(), null, 2);
    const key = blackjackActionLockKey(BigInt(1), BigInt(7));
    await assert.rejects(requireBlackjackInventory(store, signer.address, 'test-rollout'));
    const initial = newBlackjackScan('test-rollout', signer.address, 1);
    await beginBlackjackReconciliation(store, initial);
    const concurrent = await Promise.all(Array.from({ length: 20 }, () => store.compareAndSet(key, null, raw)));
    assert.equal(concurrent.filter(Boolean).length, 1, 'Actual Redis Lua permits exactly one winner');
    assert.equal(await store.read(key), raw, 'Stored JSON bytes survive read/CAS without decoding');
    assert.equal(await command(port, ['TTL', `${prefix}${key}`]), -1, 'Signed decisions have no TTL');
    await store.compareAndSet('blackjack:action-lock:01:7', null, raw);
    await scanBlackjackAliasPage(store, initial);
    while (!initial.complete) await scanBlackjackAliasPage(store, initial);
    const dry = await reconcileBlackjackAliases(store, initial);
    assert.equal(dry.status, 'reviewed');
    assert.equal(dry.copied, 0);
    assert.equal((await reconcileBlackjackAliases(store, initial, { apply: true, allSignersUpgraded: true, now: 2 })).status, 'stable');
    const inventory = await requireBlackjackInventory(store, signer.address, 'test-rollout');
    await assert.rejects(requireBlackjackInventory(store, signer.address, 'other-rollout'));

    const nextKey = blackjackActionLockKey(BigInt(1), BigInt(8));
    const nextRaw = JSON.stringify(await signedLock(BigInt(1), BigInt(8)));
    const guards: Array<[string, string | null]> = [[BLACKJACK_INVENTORY_KEY, inventory], [blackjackQuarantineKey(BigInt(1), BigInt(8)), null]];
    assert.equal(await store.guardedWrite(nextKey, null, nextRaw, guards), true, 'Nonce advancement permits an independent decision');
    assert.equal(await store.read(key), raw, 'Old decisions are retained by issuance and reconciliation');

    // A fresh full scan sees two genuinely different, valid signed decisions.
    await store.compareAndSet('blackjack:action-lock:001:7', null, JSON.stringify(await signedLock(BigInt(1), BigInt(7), 'b')));
    const conflict = newBlackjackScan('test-rollout', signer.address, 3);
    await beginBlackjackReconciliation(store, conflict);
    await assert.rejects(requireBlackjackInventory(store, signer.address, 'test-rollout'));
    while (!conflict.complete) await scanBlackjackAliasPage(store, conflict);
    const report = await reconcileBlackjackAliases(store, conflict, { apply: true, allSignersUpgraded: true, now: 4 });
    assert.equal(report.status, 'stable', 'Known conflicts may be stable only when quarantined');
    assert.equal(report.quarantined, 1);
    assert.ok(await store.read(blackjackQuarantineKey(BigInt(1), BigInt(7))));
    const stable = await requireBlackjackInventory(store, signer.address, 'test-rollout');
    assert.equal(await store.guardedWrite(key, raw, nextRaw, [[BLACKJACK_INVENTORY_KEY, stable], [blackjackQuarantineKey(BigInt(1), BigInt(7)), null]]), false, 'Quarantine atomically blocks issuance');
    assert.equal(getBlackjackLockCounters().quarantined_nonces, 1);
    assert.ok(!JSON.stringify(report).includes('signature'));
    assert.ok(!JSON.stringify(report).includes('randomSeed'));

    const broken = newBlackjackScan('test-rollout', signer.address, 5);
    const failing: BlackjackLockStore = { ...store, scan: async () => { throw new Error('Redis failure'); } };
    await assert.rejects(scanBlackjackAliasPage(failing, broken));
    assert.equal((await reconcileBlackjackAliases(store, broken)).status, 'unknown', 'Incomplete scans cannot prove absence');
    const malformed: BlackjackLockStore = { ...store, scan: async () => ({ cursor: 'bad', keys: [] }) };
    await assert.rejects(scanBlackjackAliasPage(malformed, broken));
    assert.equal(broken.complete, false);

    // A corrupt record quarantines the identifiable nonce but prevents global readiness.
    await store.compareAndSet('blackjack:action-lock:9:1', null, '{"signature":"invalid"}');
    const corrupt = newBlackjackScan('test-rollout', signer.address, 6);
    await beginBlackjackReconciliation(store, corrupt);
    while (!corrupt.complete) await scanBlackjackAliasPage(store, corrupt);
    const unknown = await reconcileBlackjackAliases(store, corrupt, { apply: true, allSignersUpgraded: true });
    assert.equal(unknown.status, 'unknown');
    assert.ok(await store.read(blackjackQuarantineKey(BigInt(9), BigInt(1))));
    await assert.rejects(requireBlackjackInventory(store, signer.address, 'test-rollout'));

    // A worker losing its inventory marker cannot install decisions or mark the scan stable.
    const lost = newBlackjackScan('test-rollout', signer.address, 7);
    await beginBlackjackReconciliation(store, lost);
    while (!lost.complete) await scanBlackjackAliasPage(store, lost);
    const newer = newBlackjackScan('newer-rollout', signer.address, 8);
    await beginBlackjackReconciliation(store, newer);
    assert.equal((await reconcileBlackjackAliases(store, lost, { apply: true, allSignersUpgraded: true })).status, 'unknown');
    assert.equal(await store.read(BLACKJACK_INVENTORY_KEY), newer.inventoryRaw);

    // A key changing between verification and the guarded copy cannot overwrite a decision.
    const contestKey = blackjackActionLockKey(BigInt(15), BigInt(0));
    const contest = JSON.stringify(await signedLock(BigInt(15), BigInt(0)));
    assert.equal(await store.guardedWrite(contestKey, null, contest, [[BLACKJACK_INVENTORY_KEY, 'stale']]), false);
    assert.equal(await store.read(contestKey), null);
    console.log('Blackjack lock regressions passed with isolated Redis: canonical IDs, exact Lua CAS, persistence, nonce identities, SCAN recovery, conflicts and inventory ownership.');
  } finally {
    await exec('docker', ['stop', container], { timeout: 30_000 });
  }
}

void main().catch(error => { console.error(error); process.exitCode = 1; });
