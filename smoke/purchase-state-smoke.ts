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
const editPlantName = projectFile("components/edit-plant-name.tsx");

assert.match(itemDetailsPanel, /type FenceV2QuoteState =/);
assert.match(itemDetailsPanel, /status: 'loading'/);
assert.match(itemDetailsPanel, /status: 'known'/);
assert.match(itemDetailsPanel, /status: 'error'/);
assert.match(
  itemDetailsPanel,
  /quote > BigInt\(0\)[\s\S]*status: 'known'/,
  "only a positive Fence quote may enter the known state",
);
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

const upgradeBranch = upgradePanel.indexOf("{building.isUpgrading ? (");
const maxLevelBranch = upgradePanel.indexOf(") : isMaxLevel ? (");
assert.ok(upgradeBranch >= 0 && maxLevelBranch > upgradeBranch, "active upgrades must precede max-level rendering");

assert.match(
  warehouseApply,
  /domains: \["buildings", "lands", "balances", "plants"\]/,
  "warehouse application must invalidate plant state",
);

for (const source of [plantsView, editPlantName]) {
  assert.match(source, /status: ['"]loading['"]/);
  assert.match(source, /status: ['"]known['"]/);
  assert.match(source, /status: ['"]error['"]/);
  assert.match(source, /ApprovalActionTransaction/);
  assert.match(source, /checkTokenApproval/);
}
assert.match(plantsView, /!reviveAllowanceKnown[\s\S]*SEED allowance unavailable/);
assert.match(editPlantName, /!seedAllowanceKnown[\s\S]*SEED allowance unavailable/);
assert.match(plantsView, /needsApproval=\{reviveNeedsApproval\}/);
assert.match(editPlantName, /needsApproval=\{seedNeedsApproval\}/);
assert.match(plantsView, /reviveAllowance\.owner === address\?\.toLowerCase\(\)/);
assert.match(editPlantName, /seedAllowance\.owner === address\?\.toLowerCase\(\)/);
assert.match(editPlantName, /disabled=\{!isNameValid[\s\S]*!seedActionReady\}/);

console.log("Purchase state smoke checks passed.");
