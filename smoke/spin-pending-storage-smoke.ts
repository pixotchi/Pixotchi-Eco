import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import {
  getLegacySpinPendingStorageKey,
  getSpinPendingStorageKey,
  migrateLegacySpinPending,
  readStoredSpinPending,
  removeStoredSpinPending,
  SPIN_PENDING_STORAGE_VERSION,
  writeStoredSpinPending,
} from "../lib/spin-pending-storage";

class MemoryStorage implements Storage {
  private readonly values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return [...this.values.keys()][index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
}

const accountA = "0x00000000000000000000000000000000000000aa";
const accountB = "0x00000000000000000000000000000000000000bb";
const commitment = `0x${"11".repeat(32)}` as `0x${string}`;
const secretHex = `0x${"22".repeat(32)}` as `0x${string}`;
const storage = new MemoryStorage();
const record = {
  account: accountA,
  commitment,
  commitBlock: null,
  plantId: 42,
  secretHex,
  version: SPIN_PENDING_STORAGE_VERSION,
} as const;

assert.notEqual(
  getSpinPendingStorageKey(accountA, 42),
  getSpinPendingStorageKey(accountB, 42),
  "pending reveal keys must be wallet-scoped",
);
assert.equal(writeStoredSpinPending(storage, record), true);
assert.deepEqual(readStoredSpinPending(storage, accountA.toUpperCase(), 42), {
  ...record,
  account: accountA,
});
assert.equal(readStoredSpinPending(storage, accountB, 42), null);

const confirmed = { ...record, commitBlock: 12_345 };
assert.equal(writeStoredSpinPending(storage, confirmed), true);
assert.equal(readStoredSpinPending(storage, accountA, 42)?.commitBlock, 12_345);
assert.equal(removeStoredSpinPending(storage, accountA, 42), true);
assert.equal(readStoredSpinPending(storage, accountA, 42), null);

storage.setItem(getSpinPendingStorageKey(accountA, 42), JSON.stringify({
  ...record,
  secretHex: "0x1234",
}));
assert.equal(readStoredSpinPending(storage, accountA, 42), null);

storage.setItem(getLegacySpinPendingStorageKey(42), JSON.stringify({
  player: accountA,
  commitment,
  commitBlock: 900,
  secretHex,
}));
const migrated = migrateLegacySpinPending(storage, accountA, 42);
assert.equal(migrated?.version, 2);
assert.equal(migrated?.commitBlock, 900);
assert.equal(storage.getItem(getLegacySpinPendingStorageKey(42)), null);

const throwingStorage = {
  getItem() { throw new Error("disabled"); },
  removeItem() { throw new Error("disabled"); },
  setItem() { throw new Error("disabled"); },
} as unknown as Storage;
assert.equal(readStoredSpinPending(throwingStorage, accountA, 42), null);
assert.equal(writeStoredSpinPending(throwingStorage, record), false);
assert.equal(removeStoredSpinPending(throwingStorage, accountA, 42), false);

const projectFile = (relativePath: string) => fs.readFileSync(
  path.join(process.cwd(), relativePath),
  "utf8",
);
const arcade = projectFile("components/arcade/ArcadeDialog.tsx");
const spinTransaction = projectFile("components/transactions/spin-game-transaction.tsx");

assert.match(arcade, /persistPreparedSpin\(\)/);
assert.match(arcade, /spinStorageHydratedFor !== spinStorageIdentity/);
assert.match(arcade, /commitment=\{pending\.commitment\}/);
assert.doesNotMatch(arcade, /Stuck\? Reset and start new spin/);
assert.match(spinTransaction, /`spin:\$\{mode\}:\$\{plantId\}:\$\{commitment\.toLowerCase\(\)\}`/);
assert.doesNotMatch(spinTransaction, /intentKey[\s\S]{0,120}secret/);

console.log("Spin pending storage smoke checks passed.");
