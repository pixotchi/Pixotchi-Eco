import assert from 'node:assert/strict';
import { parseUnits } from 'viem';
import { getBalanceShortfallMessage } from '../lib/balance-shortfall';

assert.equal(getBalanceShortfallMessage(BigInt(0), parseUnits('500', 18), '$JESSE'), 'You need 500 $JESSE.');
assert.equal(getBalanceShortfallMessage(parseUnits('300', 18), parseUnits('500', 18), '$JESSE'), 'Not enough $JESSE. You need 200 more.');
assert.equal(getBalanceShortfallMessage(parseUnits('499.999999999999999999', 18), parseUnits('500', 18), 'SEED'), 'Not enough SEED. You need 0.000000000000000001 more.');
assert.equal(getBalanceShortfallMessage(BigInt(0), BigInt(1), 'ETH'), 'You need 0.000000000000000001 ETH.');
assert.equal(getBalanceShortfallMessage(BigInt(1_234_567), BigInt(2_000_000), 'usdc', 6), 'Not enough USDC. You need 0.765433 more.');
assert.equal(getBalanceShortfallMessage(BigInt(0), BigInt(85_000), 'PIXOTCHI', 0), 'You need 85,000 PIXOTCHI.');
assert.equal(getBalanceShortfallMessage(BigInt(3), BigInt(5), 'Stars', 0), 'Not enough Stars. You need 2 more.');
assert.equal(getBalanceShortfallMessage(BigInt(0), parseUnits('9007199254740993.1', 18), 'SEED'), 'You need 9,007,199,254,740,993.1 SEED.');
assert.equal(getBalanceShortfallMessage(BigInt(500), BigInt(500), 'SEED'), null);
assert.equal(getBalanceShortfallMessage(BigInt(501), BigInt(500), 'SEED'), null);
assert.equal(getBalanceShortfallMessage(BigInt(0), BigInt(0), 'SEED'), null);
console.log('Balance shortfall checks passed (zero, partial, fractional, large, and sufficient balances).');
