// Render the production UpgradePanel and UI primitives. Only wallet reads,
// contract constants and transaction boundaries are replaced; no wallet or RPC.
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import { build } from 'esbuild';

const cwd = process.cwd();
const boundary = `
import React from 'react';
let balances;
export const setBalances = value => { balances = value; };
export const useBalances = () => balances;
export const useAccount = () => ({ address: LAND_CONTRACT_ADDRESS });
export const ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;
export const LAND_CONTRACT_ADDRESS = '0x1111111111111111111111111111111111111111';
export const CREATOR_TOKEN_ADDRESS = LAND_CONTRACT_ADDRESS;
export const CRYPTICPOET_TOKEN_ADDRESS = LAND_CONTRACT_ADDRESS;
export const JESSE_TOKEN_ADDRESS = LAND_CONTRACT_ADDRESS;
export const LEAF_CONTRACT_ADDRESS = LAND_CONTRACT_ADDRESS;
export const PIXOTCHI_TOKEN_ADDRESS = LAND_CONTRACT_ADDRESS;
export const dispatchPostTransactionRefresh = () => {};
export default function Transaction(props) {
  return <button data-transaction="true" disabled={props.disabled}>{props.buttonText}</button>;
}
`;
const fixture = `
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import UpgradePanel from '@/components/building-details/UpgradePanel';
import { setBalances } from 'upgrade-boundary';
export function render(balances, props) {
  setBalances(balances);
  return renderToStaticMarkup(<UpgradePanel {...props} />);
}
`;
const mocked = new Set([
  'lib/contracts', 'lib/balance-context', 'lib/transaction-refresh',
  'components/transactions/building-upgrade-transaction',
  'components/transactions/building-speedup-transaction',
  'components/transactions/leaf-approve-transaction',
  'components/transactions/approve-transaction',
]);
const result = await build({
  stdin: { contents: fixture, sourcefile: 'upgrade-fixture.jsx', resolveDir: cwd, loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', jsx: 'automatic', packages: 'external',
  plugins: [{ name: 'upgrade-affordability-boundaries', setup(builder) {
    builder.onResolve({ filter: /.*/ }, args => {
      if (args.path === 'wagmi') return { path: 'boundary', namespace: 'upgrade' };
      if (args.path === 'upgrade-boundary') return { path: 'boundary', namespace: 'upgrade' };
      if (args.path === 'next/image') return { path: 'image', namespace: 'upgrade' };
      const relative = args.path.startsWith('@/') ? args.path.slice(2)
        : args.path.startsWith('.') ? path.relative(cwd, path.resolve(args.resolveDir, args.path)).replaceAll('\\', '/') : '';
      if (mocked.has(relative.replace(/\.(tsx?|jsx?)$/, ''))) return { path: 'boundary', namespace: 'upgrade' };
    });
    builder.onLoad({ filter: /.*/, namespace: 'upgrade' }, args => ({
      contents: args.path === 'image' ? 'import React from "react"; export default props => <img {...props} />;' : boundary,
      loader: 'jsx', resolveDir: cwd,
    }));
  } }],
});
const entry = { exports: {} };
new Function('require', 'module', 'exports', result.outputFiles[0].text)(
  createRequire(path.join(cwd, 'package.json')), entry, entry.exports,
);
const { render } = entry.exports;
const unit = 10n ** 18n;
const building = {
  id: 0, level: 1, maxLevel: 10, isUpgrading: false,
  levelUpgradeCostLeaf: 50n * unit, levelUpgradeCostSeedInstant: 100n * unit,
  levelUpgradeBlockInterval: 100n, blockHeightUpgradeInitiated: 100n, blockHeightUntilUpgradeDone: 200n,
};
const baseProps = {
  building, landId: 1112n, buildingType: 'village', currentBlock: 150n,
  leafAllowance: 0n, seedAllowance: 0n,
  onUpgradeSuccess() {}, onLeafApprovalSuccess() {}, onSeedApprovalSuccess() {},
};
const baseBalances = {
  leafBalance: 50n * unit, pixotchiBalance: 100n * unit,
  leafBalanceStatus: 'ready', pixotchiBalanceStatus: 'ready',
  balanceError: null, refreshBalances: async () => {},
};
let assertions = 0;
for (const speedUp of [false, true]) {
  const token = speedUp ? 'PIXOTCHI' : 'LEAF';
  const balanceKey = speedUp ? 'pixotchiBalance' : 'leafBalance';
  const statusKey = `${balanceKey}Status`;
  const allowanceKey = speedUp ? 'seedAllowance' : 'leafAllowance';
  const props = { ...baseProps, building: { ...building, isUpgrading: speedUp } };
  const cost = baseBalances[balanceKey];

  // A known shortage must never mount an approval or purchase transaction,
  // whether permission was already granted or is still needed.
  for (const allowance of [0n, cost]) {
    const html = render({ ...baseBalances, [balanceKey]: cost - 10n * unit }, { ...props, [allowanceKey]: allowance });
    assert.match(html, new RegExp(`disabled="">Insufficient ${token} Balance`));
    assert.match(html, new RegExp(`Missing: 10 ${token}`));
    assert.doesNotMatch(html, /data-transaction=/);
    assertions++;
  }

  // Unknown and failed reads must retain the explicit read-state guard, even
  // when the provider's fallback value happens to be zero.
  for (const status of ['unknown', 'error']) {
    const html = render({ ...baseBalances, [statusKey]: status, [balanceKey]: 0n, balanceError: new Error('Balance read failed') }, props);
    assert.match(html, new RegExp(status === 'unknown' ? `Checking ${token} balance` : `${token} balance unavailable`));
    assert.doesNotMatch(html, /data-transaction=|Insufficient|Missing:/);
    if (status === 'error') assert.match(html, /Retry balance check/);
    else assert.doesNotMatch(html, /Retry balance check/);
    assertions++;
  }

  // Exact affordability permits approval, then the real action once allowance
  // is sufficient; no obsolete step number survives either branch.
  const approval = render(baseBalances, props);
  assert.match(approval, new RegExp(`data-transaction="true">Approve ${token}`));
  assert.doesNotMatch(approval, /Insufficient|Missing:|Step [12]/);
  const purchase = render(baseBalances, { ...props, [allowanceKey]: cost });
  assert.match(purchase, new RegExp(`data-transaction="true">${speedUp ? 'Speed Up' : 'Upgrade'} \\(`));
  assert.doesNotMatch(purchase, /Approve|Insufficient|Missing:|Step [12]/);
  assertions += 2;
  for (const allowance of [0n, cost]) {
    const unavailable = render(baseBalances, { ...props, [allowanceKey]: allowance, allowancesReady: false,
      allowancesError: 'Allowance read failed', onRetryAllowances() {} });
    assert.match(unavailable, /Approval status unavailable/);
    assert.match(unavailable, /Retry/);
    assert.match(unavailable, /data-transaction="true" disabled=""/);
    assert.doesNotMatch(unavailable, /data-transaction="true">/);
    assertions++;
  }
}

const maxLevel = render({ ...baseBalances, leafBalanceStatus: 'unknown' }, {
  ...baseProps, building: { ...building, level: building.maxLevel },
});
assert.match(maxLevel, /disabled="">Max Level Reached/);
assert.doesNotMatch(maxLevel, /data-transaction=|Checking LEAF/);
console.log(`Upgrade affordability component smoke passed: ${assertions + 1} scenarios.`);
