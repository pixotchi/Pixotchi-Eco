import assert from 'node:assert/strict';
import type { PixotchiReadClient } from '../lib/contracts';
import { requireFarmerHouseStartsReady } from '../lib/farmer-house-start-readiness';

async function main() {
  let calls = 0;
  let readFailure = false;
  let upgrading = false;
  let current = true;
  const seen: bigint[] = [];
  const client = {
    getBlockNumber: async () => BigInt(123),
    multicall: async ({ blockNumber, contracts }: { blockNumber: bigint; contracts: { args: bigint[] }[] }) => {
      calls += 1;
      assert.equal(blockNumber, BigInt(123));
      assert.ok(contracts.length <= 40);
      seen.push(...contracts.map(call => call.args[0]));
      return contracts.map(() => readFailure ? { status: 'failure' } : {
        status: 'success', result: [{ id: 7, level: 2, isUpgrading: upgrading }],
      });
    },
  } as unknown as Pick<PixotchiReadClient, 'getBlockNumber' | 'multicall'>;
  const lands = Array.from({ length: 61 }, (_, index) => BigInt(index + 1));
  await requireFarmerHouseStartsReady([...lands, ...lands], () => current, client);
  assert.equal(calls, 2, 'one town read per land, in bounded chunks at one block');
  assert.deepEqual(seen, lands);
  upgrading = true;
  await assert.rejects(requireFarmerHouseStartsReady([BigInt(1)], () => current, client), /upgrading.*batch run is unchanged/);
  upgrading = false;
  readFailure = true;
  await assert.rejects(requireFarmerHouseStartsReady([BigInt(1)], () => current, client), /Could not verify/);
  readFailure = false;
  await requireFarmerHouseStartsReady([BigInt(1)], () => current, client);
  current = false;
  const priorCalls = calls;
  await assert.rejects(requireFarmerHouseStartsReady([BigInt(1)], () => current, client), /changed/);
  assert.equal(calls, priorCalls, 'stale owner cannot begin a new construction read');
  console.log('PASS Farmer House start readiness: current construction, failed reads, retry, identity guard, bounded fixed-block batch reads');
}

void main();
