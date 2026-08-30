import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  advanceEfpWorkflowAfterSuccess,
  buildEfpRelationshipTransactions,
  createEfpWorkflowSnapshot,
  getEfpWorkflowStorageKey,
  readEfpWorkflow,
  updateEfpWorkflowProof,
  writeEfpWorkflow,
  type EfpWorkflowStorage,
} from "../lib/efp-transaction-workflow";

const ACCOUNT = "0x1111111111111111111111111111111111111111" as const;
const TARGET = "0x2222222222222222222222222222222222222222" as const;
const HASH = `0x${"ab".repeat(32)}` as const;

class MemoryStorage implements EfpWorkflowStorage {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const existingListTransactions = buildEfpRelationshipTransactions({
  action: "Follow",
  connectedAddress: ACCOUNT,
  defaultChainId: 8453,
  nonce: BigInt(42),
  primaryList: "1",
  selectedChainId: 8453,
  targetAddress: TARGET,
});
assert.equal(existingListTransactions.length, 1, "an existing list should need one update");
assert.equal(existingListTransactions[0]?.id, "UpdateEFPList");
assert.equal(existingListTransactions[0]?.chainId, 8453);

const deterministicSlot = BigInt(123456789);
const newListTransactions = buildEfpRelationshipTransactions({
  action: "Follow",
  connectedAddress: ACCOUNT,
  defaultChainId: 8453,
  nonce: BigInt(999),
  primaryList: "1",
  selectedList: "new list",
  slotFactory: () => deterministicSlot,
  targetAddress: TARGET,
});
assert.deepEqual(
  newListTransactions.map((transaction) => transaction.id),
  ["UpdateEFPList", "CreateEFPList"],
  "an explicit new-list selection must override an existing primary list",
);
assert.deepEqual(newListTransactions.map((transaction) => transaction.chainId), [8453, 8453]);
assert.equal(
  newListTransactions[0]?.args[0],
  deterministicSlot,
  "an explicit new list must not reuse the primary list nonce",
);

assert.throws(
  () => buildEfpRelationshipTransactions({
    action: "Following",
    connectedAddress: ACCOUNT,
    defaultChainId: 8453,
    nonce: BigInt(42),
    primaryList: "1",
    selectedChainId: 10,
    targetAddress: TARGET,
  }),
  /Base only/,
  "a Base-only wallet must reject an EFP list it cannot canonically confirm",
);

const storage = new MemoryStorage();
const firstWorkflow = createEfpWorkflowSnapshot({
  accountAddress: ACCOUNT,
  pendingTxs: newListTransactions,
  selectedList: "new list",
});
assert.equal(writeEfpWorkflow(storage, firstWorkflow), true);
assert.deepEqual(readEfpWorkflow(storage, ACCOUNT), firstWorkflow, "BigInt arguments must round-trip");

const competingWorkflow = createEfpWorkflowSnapshot({
  accountAddress: ACCOUNT,
  pendingTxs: existingListTransactions,
});
assert.equal(
  writeEfpWorkflow(storage, competingWorkflow),
  false,
  "a second tab must not overwrite an active wallet workflow",
);

const submitted = updateEfpWorkflowProof(
  firstWorkflow,
  0,
  { method: "direct", status: "submitted", transactionHash: HASH },
  1_000,
);
assert.equal(writeEfpWorkflow(storage, submitted), true);
assert.equal(readEfpWorkflow(storage, ACCOUNT)?.proofs[0]?.transactionHash, HASH);

const firstSuccess = advanceEfpWorkflowAfterSuccess(
  submitted,
  0,
  { method: "direct", transactionHash: HASH },
  2_000,
);
assert.equal(firstSuccess.complete, false);
assert.equal(firstSuccess.snapshot.currentTxIndex, 1);
assert.equal(firstSuccess.snapshot.proofs[0]?.status, "success");
assert.equal(firstSuccess.snapshot.proofs[1]?.status, "prepared");
assert.equal(writeEfpWorkflow(storage, firstSuccess.snapshot), true);

const finalSuccess = advanceEfpWorkflowAfterSuccess(
  firstSuccess.snapshot,
  1,
  { method: "batch", transactionId: "wallet-calls-id" },
  3_000,
);
assert.equal(finalSuccess.complete, true);
assert.equal(finalSuccess.snapshot.proofs[1]?.status, "success");

const corruptStorage = new MemoryStorage();
const workflowKey = getEfpWorkflowStorageKey(ACCOUNT);
corruptStorage.setItem(workflowKey, "{not-json");
assert.equal(readEfpWorkflow(corruptStorage, ACCOUNT), null);
assert.equal(corruptStorage.getItem(workflowKey), null, "corrupt workflows must be pruned");

const boundarySource = readFileSync(
  resolve(process.cwd(), "components/efp-transaction-boundary.tsx"),
  "utf8",
);
const profileSource = readFileSync(
  resolve(process.cwd(), "components/plant-profile-dialog.tsx"),
  "utf8",
);
assert.doesNotMatch(boundarySource, /TransactionModalWrapper|<TransactionModal\b/);
assert.match(boundarySource, /intentKey=\{intentKey\}/);
assert.match(boundarySource, /readPendingEvmRecord/);
assert.match(boundarySource, /waitForBaseReceipt/);
assert.match(profileSource, /customOnClick=\{handleSafeEfpAction\}/);
assert.doesNotMatch(
  `${boundarySource}\n${profileSource}`,
  /\.(?:writeContract|sendTransaction|sendCalls)\s*\(/,
  "EFP UI code must delegate wallet submission to the hardened transaction lifecycle",
);

console.log("EFP transaction hardening smoke checks passed.");
