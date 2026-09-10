import assert from 'node:assert/strict';
import { readKillCooldownForWallet } from '../lib/ai-read-tools';
import type { PixotchiReadClient } from '../lib/contracts';

async function main() {
  const address = `0x${'1'.repeat(40)}` as const;
  const client = {
    multicall: async ({ contracts }: { contracts: { functionName: string }[] }) => {
      assert.deepEqual(contracts.map(call => call.functionName), ['canKill', 'getKillCooldownRemaining']);
      return [{ status: 'success', result: false }, { status: 'success', result: BigInt(123) }];
    },
  } as unknown as PixotchiReadClient;
  const cooldown = await readKillCooldownForWallet(address, client);
  assert.equal(cooldown.canKill, false);
  assert.equal(cooldown.remainingSeconds, 123);
  assert.equal(cooldown.cooldownSeconds, null);
  assert.ok(cooldown.availableAt && cooldown.availableAt > Date.now() / 1000);
  const unknown = await readKillCooldownForWallet(address, { multicall: async () => [{ status: 'failure' }, { status: 'failure' }] } as unknown as PixotchiReadClient);
  assert.equal(unknown.remainingSeconds, null);
  assert.equal(unknown.canKill, null);
  assert.equal(unknown.cooldownSeconds, null);
  console.log('AI supported kill reads and unknown duration regressions passed.');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
