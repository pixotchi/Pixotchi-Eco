import assert from 'node:assert/strict';
import { parseUnits } from 'viem';
import { getCasinoBetInputValue, formatCasinoLimitForToken, parseCasinoAmountInput } from '../lib/casino-amount-input';
import { BACCARAT_REVEAL_WINDOW_BLOCKS, getCasinoRevealWindow } from '../lib/casino-reveal-window';
import { baccaratPotentialReturn, baccaratReturnLabel, baccaratWorstCaseReturn, validBaccaratPayoutRules } from '../lib/baccarat-presentation';
import { BaccaratBetType } from '../public/abi/baccarat-abi';

for (const decimals of [0, 6, 18]) {
  for (const units of ['1', '1234', '1234567', '2999000', '123456789012345678']) {
    const exact = parseUnits(units, decimals) + (decimals ? BigInt(1) : BigInt(0));
    assert.equal(parseCasinoAmountInput(getCasinoBetInputValue(exact, decimals), decimals), exact);
    for (const kind of ['min', 'max'] as const) assert.equal(parseCasinoAmountInput(formatCasinoLimitForToken(exact, decimals, null, kind), decimals), exact, `A ${kind} constraint must be usable verbatim`);
  }
}
const leaf = '0xe78ee52349d7b031e2a6633e07c037c3147db116';
const leafMax = parseUnits('2999000', 18);
assert.equal(parseCasinoAmountInput(formatCasinoLimitForToken(leafMax, 18, leaf, 'max'), 18), leafMax);
const rules = { bankerCommissionBps: 1000, tiePayoutMultiplier: 12 };
assert.equal(baccaratPotentialReturn(BaccaratBetType.BANKER, BigInt(10000001), rules), BigInt(19000001), 'Commission rounds winnings down in exact base units');
assert.equal(baccaratPotentialReturn(BaccaratBetType.TIE, BigInt(1000000), rules), BigInt(13000000));
assert.equal(baccaratReturnLabel(BaccaratBetType.BANKER, rules), '1.9× total return');
assert.equal(baccaratWorstCaseReturn(rules), BigInt(13), 'Pool exposure uses the same configured odds');
assert.equal(validBaccaratPayoutRules({ bankerCommissionBps: 10001, tiePayoutMultiplier: 8 }), false);
assert.equal(validBaccaratPayoutRules({ bankerCommissionBps: 500, tiePayoutMultiplier: 21 }), false, 'Deployed contract caps the tie profit multiplier at 20');
const windowAt = (block: bigint | undefined) => getCasinoRevealWindow(BigInt(100), block, BACCARAT_REVEAL_WINDOW_BLOCKS);
assert.equal(windowAt(undefined).expired, null, 'No invented expiry when the current block is unavailable');
assert.equal(windowAt(BigInt(100)).blocksUntilOpen, BigInt(1));
assert.equal(windowAt(BigInt(101)).blocksUntilOpen, BigInt(0));
assert.equal(windowAt(BigInt(356)).expired, false, 'Deadline block remains valid');
assert.equal(windowAt(BigInt(356)).remainingRevealBlocks, BigInt(0));
assert.equal(windowAt(BigInt(357)).expired, true, 'Expiry begins strictly after the deadline');
console.log('PASS BB medium: exact limits, configured Banker/Tie returns and exposure, reveal-window boundaries');
