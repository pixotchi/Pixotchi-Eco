import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  BACCARAT_WORST_CASE_RETURN_FACTOR,
  getPoolBoundedAdditionalBet,
  getPoolBoundedMaxBet,
  ROULETTE_WORST_CASE_RETURN_FACTOR,
} from '../lib/casino-pool-solvency';

const source = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const roulette = source('components/transactions/CasinoDialog.tsx');
const baccarat = source('components/transactions/BaccaratDialog.tsx');

assert.equal(getPoolBoundedMaxBet(BigInt(1000), BigInt(360), ROULETTE_WORST_CASE_RETURN_FACTOR), BigInt(10));
assert.equal(getPoolBoundedMaxBet(BigInt(1000), null, ROULETTE_WORST_CASE_RETURN_FACTOR), null);
assert.equal(getPoolBoundedMaxBet(BigInt(1000), BigInt(95), BACCARAT_WORST_CASE_RETURN_FACTOR), BigInt(9));
assert.equal(getPoolBoundedAdditionalBet(BigInt(1000), BigInt(640), BigInt(36)), BigInt(10));
assert.equal(getPoolBoundedAdditionalBet(null, BigInt(0), BigInt(36)), null);

for (const dialog of [roulette, baccarat]) {
  assert.match(dialog, /rewardPool/);
  assert.match(dialog, /payoutPoolData/);
  assert.match(dialog, /payoutPoolReadStatus/);
  assert.match(dialog, /Reward pool liquidity could not be verified/);
  assert.match(dialog, /Retry reward pool read/);
}
assert.match(roulette, /getPoolBoundedAdditionalBet/);
assert.match(roulette, /selectedBetsExceedPool/);
assert.match(roulette, /bettingInputDisabled = bettingLocked \|\| payoutPoolReadStatus !== 'ready'/);
assert.match(baccarat, /BACCARAT_WORST_CASE_RETURN_FACTOR/);
assert.match(baccarat, /payoutPoolUnknown/);
assert.match(baccarat, /betWei <= offeredMaxBet/);

console.log('Casino pool solvency smoke passed');
