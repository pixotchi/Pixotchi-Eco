import assert from 'node:assert/strict';
import { encodeFunctionData } from 'viem';
import { getPlantsInfoExtended, type PixotchiReadClient } from '../lib/contracts';

async function main() {
  const ids = Array.from({ length: 1025 }, (_, index) => index + 1);
  let active = 0;
  let maximum = 0;
  let reads = 0;
  const client = {
    getBlockNumber: async () => BigInt(100),
    readContract: async (request: Parameters<PixotchiReadClient['readContract']>[0]) => {
      assert.equal(request.blockNumber, BigInt(100));
      const encoded = encodeFunctionData(request);
      assert.ok((encoded.length - 2) / 2 <= 4164, 'Each app-owned call is encoded within its bounded argument budget');
      const chunk = request.args![0] as bigint[];
      assert.ok(chunk.length <= 128);
      active++;
      maximum = Math.max(maximum, active);
      reads++;
      await new Promise(resolve => setTimeout(resolve, chunk[0] === BigInt(1) ? 8 : 1));
      active--;
      return chunk.map(id => ({ id, name: `Plant ${id}`, extensions: [] }));
    },
  } as unknown as PixotchiReadClient;
  const result = await getPlantsInfoExtended(ids, client);
  assert.deepEqual(result.map(plant => plant.id), ids);
  assert.equal(reads, 9);
  assert.equal(maximum, 4);
  assert.deepEqual(await getPlantsInfoExtended([], client), []);
  await assert.rejects(getPlantsInfoExtended(ids, { ...client, readContract: async () => { throw new Error('chunk unavailable'); } } as unknown as PixotchiReadClient), /chunk unavailable/);
  console.log('Plant bulk read encoding, pinned block, order, concurrency and failure regressions passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
