import assert from 'node:assert/strict';
import { parseEther } from 'viem';
import { quoteSeedPurchase } from '../lib/swap/seed-purchase-quote';

// Independent constant-product pool model: large swaps must be priced together.
const ethReserve = parseEther('500');
const seedReserve = parseEther('5000000');
function amountsIn(output: bigint): readonly bigint[] {
  if (output >= seedReserve) throw new Error('Insufficient liquidity');
  return [ethReserve * output * BigInt(1000) / ((seedReserve - output) * BigInt(997)) + BigInt(1), output];
}
function netSeedOut(input: bigint): bigint {
  const withFee = input * BigInt(997);
  const gross = withFee * seedReserve / (ethReserve * BigInt(1000) + withFee);
  return gross - gross * BigInt(5) / BigInt(100);
}

async function main() {
  for (const unit of [parseEther('37500'), parseEther('20000')]) {
    for (const count of [1, 10, 15, 80]) {
      const cost = unit * BigInt(count);
      const requests: bigint[] = [];
      const quote = await quoteSeedPurchase(cost, async gross => {
        requests.push(gross);
        return amountsIn(gross);
      });
      assert.equal(requests.length, 1, 'one pool quote covers the entire purchase');
      assert.ok(requests[0] > cost, 'pool output accounts for the token buy tax');
      assert.equal(quote.seedAmount, cost);
      assert.ok(netSeedOut(quote.ethAmountWithBuffer) >= cost, `purchase of ${count} items must receive enough net SEED`);
    }
  }

  const oneCost = parseEther('37500');
  const oldOneQuote = amountsIn(oneCost)[0] * BigInt(106) / BigInt(100);
  assert.ok(netSeedOut(oldOneQuote * BigInt(10)) < oneCost * BigInt(10), 'regression: multiplying a one-item ETH quote underfunds ten items');

  const tiny = await quoteSeedPurchase(BigInt(1), async gross => amountsIn(gross));
  assert.ok(netSeedOut(tiny.ethAmountWithBuffer) >= BigInt(1), 'rounding up preserves even a one-wei net payment');
  for (const invalid of [BigInt(0), BigInt(-1)]) {
    await assert.rejects(quoteSeedPurchase(invalid, async () => { throw new Error('must not read'); }), /Invalid amount/);
  }
  await assert.rejects(quoteSeedPurchase(seedReserve, async gross => amountsIn(gross)), /Insufficient liquidity/);
  await assert.rejects(quoteSeedPurchase(oneCost, async () => [BigInt(0), oneCost]), /No liquidity/);
  await assert.rejects(quoteSeedPurchase(oneCost, async () => [BigInt(1), oneCost]), /No liquidity/);
  await assert.rejects(quoteSeedPurchase(oneCost, async () => []), /No liquidity/);
  console.log('SEED purchase quotes: OK (both new items × 1/10/15/80, net buy tax, pool impact, rounding and failures)');
}

main().catch(error => { console.error(error); process.exitCode = 1; });
