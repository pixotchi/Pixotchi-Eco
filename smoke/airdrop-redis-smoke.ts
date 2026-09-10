import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { randomBytes, randomUUID } from 'node:crypto';
import { AIRDROP_ADMIN_CAS_SCRIPT, AIRDROP_CAS_SCRIPT, AIRDROP_RAW_PREFIX, AIRDROP_READ_RAW_SCRIPT } from '../lib/airdrop-store-cas';
import { runAirdropClaim, type AirdropAdapter, type AirdropOperation, type AirdropStore } from '../lib/airdrop-execution';
import { replaceUnattemptedAirdrops, type AirdropAdminStore } from '../lib/airdrop-admin';
import type { Hex } from 'viem';

const exec = promisify(execFile);
const suppliedContainer = process.argv[2];
const container = suppliedContainer ?? `pixotchi-airdrop-${randomUUID()}`;
if (!container.startsWith('pixotchi-airdrop-')) throw new Error('Only isolated pixotchi-airdrop-* Redis containers are supported');
const command = async (...args: string[]) => JSON.parse((await exec('docker', ['exec', container, 'redis-cli', '--json', ...args])).stdout);
const wallet = `0x${randomBytes(20).toString('hex')}` as Hex;
const key = `airdrop:eligible:${wallet}`;
const omittedKey = `airdrop:eligible:0x${randomBytes(20).toString('hex')}`;
const removableKey = `airdrop:eligible:0x${randomBytes(20).toString('hex')}`;
const agent = `0x${'2'.repeat(40)}` as Hex;
const hash = `0x${'a'.repeat(64)}` as Hex;
const store: AirdropStore = {
  read: async () => { const raw = await command('GET', key); return raw ? { raw, record: JSON.parse(raw) } : null; },
  cas: async (raw, next) => Number(await command('EVAL', AIRDROP_CAS_SCRIPT, '1', key, raw, JSON.stringify(next))) === 1,
};
const adminStore: AirdropAdminStore = {
  keys: async () => [key, omittedKey, removableKey],
  read: async key => command('GET', key),
  mutate: async (key, raw, next) => Number(await command('EVAL', AIRDROP_ADMIN_CAS_SCRIPT, '1', key, raw === null ? 'missing' : 'present', raw ?? '', next === null ? 'delete' : 'set', next ?? '')),
};
async function main() {
  let createdContainer = false;
  try {
    if (!suppliedContainer) {
      await exec('docker', ['run', '--detach', '--rm', '--name', container, 'redis:7-alpine']);
      createdContainer = true;
      for (let attempt = 0; attempt < 20; attempt++) {
        try { if (await command('PING') === 'PONG') break; } catch { /* Container may still be starting. */ }
        if (attempt === 19) throw new Error('Isolated Redis did not become ready');
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }
    const initial = JSON.stringify({ seed: '1', status: 'eligible' });
    await command('SET', key, initial);
    const candidates = await Promise.all(Array.from({ length: 8 }, (_, i) => store.cas(initial, { seed: String(i + 10), status: 'eligible' })));
    assert.equal(candidates.filter(Boolean).length, 1, 'Lua must allow only one exact-record winner');

    const formatted = ' { "seed": "1", "status": "eligible" } ';
    await command('SET', key, formatted);
    assert.equal(await command('EVAL', AIRDROP_READ_RAW_SCRIPT, '1', key), `${AIRDROP_RAW_PREFIX}${formatted}`, 'raw reads must preserve exact bytes across JSON clients');
    assert.equal(await adminStore.mutate(key, formatted, initial), 1);
    const adminSnapshot = await adminStore.read(key);
    const reservation = { seed: '1', status: 'pending' as const, attemptId: randomUUID() };
    assert.equal(await store.cas(initial, reservation), true);
    assert.equal(await adminStore.mutate(key, adminSnapshot, initial), 0, 'upload cannot overwrite a concurrent reservation');
    assert.equal(await adminStore.mutate(key, adminSnapshot, null), 0, 'clear cannot delete a concurrent reservation');

    const protectedRecords = [
      reservation, { seed: '1', claimed: true }, { seed: '1', status: 'pending' },
      { seed: '1', status: 'failed' }, { seed: '1', recoveryState: 'manual_review' },
      { seed: '1', execution: { signature: 'private-signature' } }, { seed: '1', operationId: hash },
      { seed: '1', reservedAt: 0 }, { seed: '1', status: 'eligible', unknownFutureField: true },
    ];
    for (const record of protectedRecords) {
      const raw = JSON.stringify(record);
      await command('SET', key, raw);
      assert.equal(await adminStore.mutate(key, raw, initial), -1);
      assert.equal(await adminStore.mutate(key, raw, null), -1);
      assert.equal(await command('GET', key), raw);
    }
    const protectedRaw = JSON.stringify(reservation);
    await command('SET', key, protectedRaw);
    await command('SET', omittedKey, JSON.stringify({ seed: '2', claimed: true }));
    await command('SET', removableKey, initial);
    const replacement = await replaceUnattemptedAirdrops(adminStore, [{ address: wallet, seed: '9', leaf: '0', pixotchi: '0' }]);
    assert.deepEqual(replacement, { updatedCount: 0, createdCount: 0, deletedCount: 1, protectedCount: 2, conflictCount: 0 });
    assert.equal(await command('GET', key), protectedRaw, 'CSV inclusion does not reset a pending claim');
    assert.equal((await replaceUnattemptedAirdrops(adminStore, [])).protectedCount, 2, 'clear preserves pending and claimed recipients');
    await command('SET', key, initial);
    let prepares = 0, signs = 0, sends = 0;
    let operation: AirdropOperation;
    const adapter: AirdropAdapter = {
      address: async () => agent,
      prepare: async calls => { prepares++; operation = { userOpHash: hash, network: 'base', status: 'pending', calls, expiresAt: new Date(Date.now() + 120_000).toISOString() }; return operation; },
      sign: async op => { signs++; assert.equal((await store.read())?.record.execution?.preparedUserOpHash, op); return `0x${'b'.repeat(130)}`; },
      broadcast: async (op, signature) => { sends++; const stored = (await store.read())!.record.execution!; assert.equal(stored.phase, 'broadcasting'); assert.equal(stored.preparedUserOpHash, op); assert.equal(stored.signature, signature); operation = { ...operation, status: 'broadcast' }; return operation; },
      observe: async () => operation,
      receipt: async () => { throw new Error('No real transaction'); },
    };
    await Promise.all([runAirdropClaim(store, adapter, wallet), runAirdropClaim(store, adapter, wallet)]);
    assert.equal(prepares, 1); assert.equal(signs, 1); assert.equal(sends, 1);
    const saved = (await store.read())!;
    assert.equal(saved.record.execution?.phase, 'pending');
    assert.equal(await store.cas(initial, { status: 'eligible' }), false, 'stale initial request cannot reset a broadcast');
    await runAirdropClaim(store, adapter, wallet, { now: () => Date.now() + 48 * 3_600_000 });
    assert.equal(prepares, 1); assert.equal(sends, 1);
    console.log('Isolated Redis airdrop smoke passed: atomic contention, admin-vs-claim races, protected history, concurrent workers, durable pre-send proof, 48h no-resend.');
  } finally {
    try { await command('DEL', key, omittedKey, removableKey); }
    finally { if (createdContainer) await exec('docker', ['stop', container]); }
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
