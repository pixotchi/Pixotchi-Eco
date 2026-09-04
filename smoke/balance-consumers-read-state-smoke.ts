import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '..');

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8');
}

function expectIncludes(relativePath: string, fragment: string): void {
  if (!source(relativePath).includes(fragment)) {
    throw new Error(`${relativePath} is missing expected read-state guard: ${fragment}`);
  }
}

// A failed read may still leave a bigint default in the provider. These
// assertions keep every user-facing/payment consumer tied to explicit status.
expectIncludes('components/edit-plant-name.tsx', "seedBalanceStatus === 'ready'");
expectIncludes('components/edit-plant-name.tsx', 'ethBalanceKnown');
expectIncludes('components/edit-plant-name.tsx', 'Retry balance check');

expectIncludes('components/balance-card.tsx', 'formatReadValue');
expectIncludes('components/balance-card.tsx', "seedBalanceStatus === 'error'");
expectIncludes('components/balance-card.tsx', 'Some balances are unavailable');

expectIncludes('components/status-bar.tsx', 'balanceReadError');
expectIncludes('components/status-bar.tsx', 'Retry balance reads');
expectIncludes('components/status-bar.tsx', "pixotchiBalanceStatus === 'ready'");

expectIncludes('components/transactions/batch-claim-card.tsx', 'pixotchiBalanceKnown && pixotchiBalance');
expectIncludes('components/transactions/batch-claim-card.tsx', '!pixotchiBalanceKnown');
expectIncludes('components/transactions/batch-claim-card.tsx', 'Retry balance check');

expectIncludes('components/building-details/UpgradePanel.tsx', '!pixotchiBalanceReady');
expectIncludes('components/building-details/UpgradePanel.tsx', '!leafBalanceReady');
expectIncludes('components/building-details/UpgradePanel.tsx', 'Retry balance check');

console.log('balance consumer read-state smoke passed');
