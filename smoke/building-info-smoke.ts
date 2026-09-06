import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const projectFile = (relativePath: string) => readFileSync(
  new URL(`../${relativePath}`, import.meta.url),
  'utf8',
);

const infoDialog = projectFile('components/building-info-dialog.tsx');
const detailsPanel = projectFile('components/building-details-panel.tsx');
const upgradePanel = projectFile('components/building-details/UpgradePanel.tsx');

assert.match(
  infoDialog,
  /building: BuildingData/,
  'building info must receive the selected live building snapshot',
);
assert.match(
  detailsPanel,
  /<BuildingInfoDialog[\s\S]*building=\{selectedBuilding\}/,
  'the info dialog must use the same selected building passed to UpgradePanel',
);
assert.match(
  infoDialog,
  /building\.levelUpgradeCostLeaf[\s\S]*building\.levelUpgradeCostSeedInstant/,
  'info upgrade requirements must come from the live BuildingData costs',
);
assert.match(
  infoDialog,
  /getVillageProductionRates\(building\)/,
  'info production must convert the live BuildingData rate using the contract accrual rule',
);
assert.match(
  infoDialog,
  /formatLifetimeProduction\(production\.lifetimePerDaySecondsWhenReady\)/,
  'info TOD production must come from the live BuildingData rate',
);
assert.doesNotMatch(
  infoDialog,
  /upgradeCosts\s*:/,
  'the dialog must not publish a hardcoded per-level upgrade cost table',
);
assert.doesNotMatch(
  infoDialog,
  /production\s*:\s*\{/,
  'the dialog must not publish a hardcoded per-level production table',
);
assert.match(
  upgradePanel,
  /building\.levelUpgradeCostLeaf[\s\S]*building\.levelUpgradeCostSeedInstant/,
  'UpgradePanel must continue to consume the same live cost fields',
);

console.log('Building info smoke passed');
