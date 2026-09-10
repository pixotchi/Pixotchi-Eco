import assert from 'node:assert/strict';
import { maxUint256 } from 'viem';
import { getStakeComposite, type PixotchiReadClient } from '../lib/contracts';
import { getStakingAllowanceReadiness, parseStakingAllowance, requireStakingAllowance } from '../lib/staking-allowance';

async function main() {
  const amount = BigInt('10000000000000000000');
  for (const malformed of [null, undefined, true, 1, '-1', '1.5', '0x10', '', String(maxUint256 + BigInt(1))]) {
    assert.equal(parseStakingAllowance(malformed), null);
  }
  assert.equal(parseStakingAllowance('0'), BigInt(0));
  assert.equal(parseStakingAllowance(String(maxUint256)), maxUint256);
  assert.equal(getStakingAllowanceReadiness(null, amount), 'unknown');
  assert.equal(getStakingAllowanceReadiness(BigInt(0), amount), 'needs_approval');
  assert.equal(getStakingAllowanceReadiness(amount - BigInt(1), amount), 'needs_approval');
  assert.equal(getStakingAllowanceReadiness(amount, amount), 'ready');
  assert.equal(getStakingAllowanceReadiness(maxUint256, amount), 'ready');
  assert.equal(getStakingAllowanceReadiness(amount, BigInt(0)), 'invalid_amount');

  let exactAllowance: bigint | null = amount;
  const onRead = (value: bigint | null) => { exactAllowance = value; };
  // Cached approval cannot authorize a larger amount or a later allowance reduction.
  await assert.rejects(requireStakingAllowance({ amount, read: async () => amount - BigInt(1), isCurrent: () => true, onRead }), /Approve enough/);
  assert.equal(exactAllowance, amount - BigInt(1));
  await assert.rejects(requireStakingAllowance({ amount, read: async () => { throw Error('RPC unavailable'); }, isCurrent: () => true, onRead }), /Retry/);
  assert.equal(exactAllowance, null);
  await requireStakingAllowance({ amount, read: async () => amount, isCurrent: () => true, onRead });
  assert.equal(exactAllowance, amount);

  // A late read cannot update or submit for an earlier wallet / amount.
  let current = true;
  let resolveRead!: (value: bigint) => void;
  const pending = requireStakingAllowance({ amount, read: () => new Promise(resolve => { resolveRead = resolve; }), isCurrent: () => current, onRead });
  current = false;
  resolveRead(maxUint256);
  await assert.rejects(pending, /changed/);
  assert.equal(exactAllowance, amount);

  // Exercise the actual composite reader: allowance failures stay null, without
  // hiding the valid balances needed for withdrawing or claiming rewards.
  const success = (result: unknown) => ({ status: 'success', result });
  for (const allowanceEntry of [success(BigInt(0)), success(amount), { status: 'failure' }, success('bad')]) {
    const client = { multicall: async () => [success([amount, BigInt(1)]), allowanceEntry, success([BigInt(1), BigInt(2)]), success(BigInt(86400)), success(amount)] } as unknown as PixotchiReadClient;
    const result = await getStakeComposite('0x1111111111111111111111111111111111111111', client);
    const expected = allowanceEntry.status === 'success' && typeof (allowanceEntry as { result?: unknown }).result === 'bigint'
      ? (allowanceEntry as { result: bigint }).result : null;
    assert.equal(result.allowance, expected);
    assert.deepEqual(result.stake, { staked: amount, rewards: BigInt(1) });
    const apiRoundTrip = JSON.parse(JSON.stringify({ allowance: result.allowance?.toString() ?? null }));
    assert.equal(parseStakingAllowance(apiRoundTrip.allowance), expected);
  }
  console.log('PASS staking allowance: exact bounds, unknown/retry, preflight revocation, stale-owner rejection, composite/API precision');
}

void main();
