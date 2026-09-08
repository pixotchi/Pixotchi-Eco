import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const projectFile = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const balanceContext = projectFile('lib/balance-context.tsx');
const mintTab = projectFile('components/tabs/mint-tab.tsx');

// Balance reads must preserve the last known snapshot and expose read state;
// a failed result must never be normalized directly to zero.
assert.match(balanceContext, /export type BalanceReadStatus = 'unknown' \| 'ready' \| 'error'/);
assert.match(balanceContext, /lastKnownByAddressRef/);
assert.match(balanceContext, /balanceReadSettled/);
assert.match(balanceContext, /getBalanceReadStatus/);
assert.match(balanceContext, /seedBalanceStatus/);
assert.match(balanceContext, /balanceError/);
assert.doesNotMatch(balanceContext, /data\?\.\[0\]\?\.result as bigint \?\? BigInt\(0\)/);

// Mint reads must retain payment snapshots, surface failed strain reads, and
// keep economic actions gated until balance and allowance are known.
assert.match(mintTab, /allowanceStatus: 'loading' \| 'ready' \| 'error'/);
assert.match(mintTab, /paymentTokenSnapshotsRef/);
assert.match(mintTab, /ethBalanceSnapshotsRef/);
assert.match(mintTab, /ethBalanceStatus !== 'ready'/);
assert.match(mintTab, /refetchEthBalance/);
assert.match(mintTab, /disabled=\{ethBalanceStatus !== 'ready' \|\| ethBalance < \(ethQuote\?\.ethAmountWithBuffer/);
assert.match(mintTab, /setStrainsError\('Strain data is unavailable/);
assert.match(mintTab, /plantPaymentDataUnknown/);
assert.match(mintTab, /strainsError !== null \|\| plantPaymentBalanceStatus/);
assert.match(mintTab, /plantUsesEth && plantMintAvailable/);
assert.match(mintTab, /!plantPaymentDataUnknown && !hasInsufficientPlantBalance/);
assert.match(mintTab, /Retry strain catalog/);
assert.match(mintTab, /Retry balance check/);

console.log('Balance/mint read-state smoke passed');
