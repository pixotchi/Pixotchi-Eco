import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const projectFile = (relativePath: string) => fs.readFileSync(
  path.join(process.cwd(), relativePath),
  "utf8",
);

const itemDetailsPanel = projectFile("components/item-details-panel.tsx");
const upgradePanel = projectFile("components/building-details/UpgradePanel.tsx");
const warehouseApply = projectFile("components/transactions/warehouse-apply-transaction.tsx");
const plantsView = projectFile("components/tabs/plants-view.tsx");
const reviveReadiness = projectFile("hooks/useReviveReadiness.ts");
const editPlantName = projectFile("components/edit-plant-name.tsx");

assert.match(itemDetailsPanel, /const fenceQuoteQuery = useQuery/);
assert.match(itemDetailsPanel, /enabled: canQuoteFence/);
assert.match(itemDetailsPanel, /quote <= BigInt\(0\)\) throw new Error\('Fence quote unavailable'\)/,
  'zero and negative quotes must fail the query');
assert.match(itemDetailsPanel, /canQuoteFence && !fenceQuoteQuery.isError \? fenceQuoteQuery.data \?\? null : null/,
  'disabled or failed queries cannot reuse stale quote data');
assert.match(itemDetailsPanel, /fenceV2QuoteLoading = canQuoteFence && fenceQuoteQuery.isPending/);
assert.doesNotMatch(
  itemDetailsPanel,
  /setFenceV2Quote\(BigInt\(0\)\)/,
  "a failed Fence quote must not be represented as zero",
);
assert.match(
  itemDetailsPanel,
  /fenceV2Quote === null[\s\S]*title="Fence quote unavailable"/,
  "an unavailable quote must render an unknown state",
);
assert.match(
  itemDetailsPanel,
  /fenceV2QuoteReady[\s\S]*disabled=/,
  "purchase paths must require a ready Fence quote",
);

const upgradeBranch = upgradePanel.indexOf("building.isUpgrading ? (");
const maxLevelBranch = upgradePanel.indexOf(") : isMaxLevel ? (");
assert.ok(upgradeBranch >= 0 && maxLevelBranch > upgradeBranch, "active upgrades must precede max-level rendering");

assert.match(
  warehouseApply,
  /domains: \["buildings", "lands", "balances", "plants"\]/,
  "warehouse application must invalidate plant state",
);

for (const source of [plantsView, editPlantName]) {
  assert.match(source, /ApprovalActionTransaction/);
}
for (const source of [reviveReadiness, editPlantName]) assert.match(source, /checkTokenApproval/);
assert.match(reviveReadiness, /queryKey: \['revive-read', identity, 'allowance'\]/);
assert.match(reviveReadiness, /query.data !== undefined && !query.isError/);
assert.match(reviveReadiness, /currentIdentity.current !== identity/);
assert.match(plantsView, /disabled=\{!reviveReads.ready \|\| seedBalance < revivePrice\}/);
for (const state of ['loading', 'known', 'error']) assert.ok(editPlantName.includes(`status: '${state}'`));
assert.match(editPlantName, /!seedAllowanceKnown[\s\S]*SEED permission unavailable/);
assert.match(plantsView, /needsApproval=\{reviveNeedsApproval\}/);
assert.match(editPlantName, /needsApproval=\{seedNeedsApproval\}/);
assert.match(plantsView, /reviveAllowance\.owner === address\?\.toLowerCase\(\)/);
assert.match(editPlantName, /seedAllowance\.owner === address\?\.toLowerCase\(\)/);
assert.match(editPlantName, /disabled=\{!isNameValid[\s\S]*!seedActionReady\}/);

console.log("Purchase state smoke checks passed.");
