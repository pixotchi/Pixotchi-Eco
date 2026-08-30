import {
  ListRecordContracts,
  formatListOpsTransaction,
  listOpAddListRecord,
  listOpRemoveListRecord,
  listOpRemoveTag,
  prepareMintTransaction,
  type FollowingState,
  type TransactionType,
} from "ethereum-identity-kit";
import { bytesToHex, getAddress, isAddress, type Address, type Hex } from "viem";

const EFP_WORKFLOW_VERSION = 1 as const;
const EFP_WORKFLOW_STORAGE_PREFIX = "pixotchi:efp-workflow:v1";
const EFP_WORKFLOW_CHANGE_EVENT = "pixotchi:efp-workflow-change";
const EFP_WORKFLOW_MAX_BYTES = 1_000_000;
const BIGINT_TAG = "__pixotchiEfpBigInt";

export type EfpRelationshipAction = Extract<
  FollowingState,
  "Blocked" | "Follow" | "Following" | "Muted"
>;

export type EfpWorkflowSnapshot = {
  accountAddress: Address;
  currentTxIndex: number;
  pendingTxs: TransactionType[];
  proofs: EfpWorkflowProof[];
  revision: number;
  selectedList?: string;
  updatedAt: number;
  version: typeof EFP_WORKFLOW_VERSION;
  workflowId: string;
};

export type EfpWorkflowProof = {
  method?: "batch" | "direct";
  status: "failed" | "prepared" | "submitted" | "success";
  transactionHash?: Hex;
  transactionId?: string;
};

export type EfpWorkflowStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

type BuildEfpRelationshipTransactionsInput = {
  action: EfpRelationshipAction;
  connectedAddress: Address;
  defaultChainId?: number;
  nonce?: bigint;
  primaryList?: string | null;
  selectedChainId?: number;
  selectedList?: string;
  slotFactory?: () => bigint;
  targetAddress: Address;
};

function normalizeAccountAddress(address: string): Address {
  if (!isAddress(address)) {
    throw new Error("A valid connected wallet is required for this EFP action.");
  }
  return getAddress(address);
}

function createEfpSlot(): bigint {
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Secure randomness is unavailable. Reload in a secure browser and try again.");
  }

  const bytes = new Uint8Array(32);
  globalThis.crypto.getRandomValues(bytes);
  // EFP slots are uint256 values with the high bit reserved. Clearing it keeps
  // the generated slot in the same range as Identity Kit's own generator.
  bytes[0] &= 0x7f;
  return BigInt(bytesToHex(bytes));
}

function createWorkflowId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  if (typeof globalThis.crypto?.getRandomValues !== "function") {
    throw new Error("Secure randomness is unavailable. Reload in a secure browser and try again.");
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytesToHex(bytes);
}

function getRelationshipListOps(action: EfpRelationshipAction, targetAddress: Address) {
  switch (action) {
    case "Follow":
      return [listOpAddListRecord(targetAddress)];
    case "Following":
      return [listOpRemoveListRecord(targetAddress)];
    case "Blocked":
      return [
        listOpRemoveListRecord(targetAddress),
        listOpRemoveTag(targetAddress, "block"),
      ];
    case "Muted":
      return [
        listOpRemoveListRecord(targetAddress),
        listOpRemoveTag(targetAddress, "mute"),
      ];
  }
}

/**
 * Reproduces Identity Kit's relationship transaction construction without
 * handing submission ownership to its unsafe receipt-error retry path.
 */
export function buildEfpRelationshipTransactions({
  action,
  connectedAddress,
  defaultChainId = 8453,
  nonce,
  primaryList,
  selectedChainId,
  selectedList,
  slotFactory = createEfpSlot,
  targetAddress,
}: BuildEfpRelationshipTransactionsInput): TransactionType[] {
  const account = normalizeAccountAddress(connectedAddress);
  const target = normalizeAccountAddress(targetAddress);
  const wantsNewList = selectedList === "new list";
  const selectedExistingList = selectedList && selectedList !== "new list"
    ? selectedList
    : undefined;
  const hasExistingList = !wantsNewList && Boolean(selectedExistingList || primaryList);
  const listOps = getRelationshipListOps(action, target);

  if (hasExistingList) {
    if (nonce === undefined || !selectedChainId) {
      throw new Error("EFP list details are still loading. Please try again in a moment.");
    }
    if (selectedChainId !== defaultChainId) {
      throw new Error("This app can currently update EFP lists on Base only.");
    }

    return [
      formatListOpsTransaction({
        chainId: selectedChainId,
        connectedAddress: account,
        isMintingNewList: false,
        listOps,
        nonce,
      }) as TransactionType,
    ];
  }

  // An explicit "new list" selection must never reuse the nonce belonging to
  // the user's current primary list while Identity Kit is changing selection.
  const slot = wantsNewList ? slotFactory() : nonce ?? slotFactory();
  const recordsAddress = ListRecordContracts[defaultChainId];
  if (!recordsAddress) {
    throw new Error(`EFP does not support list creation on chain ${defaultChainId}.`);
  }

  const updateTransaction = formatListOpsTransaction({
    chainId: defaultChainId,
    connectedAddress: account,
    isMintingNewList: true,
    listOps,
    nonce: slot,
  }) as TransactionType;

  return [
    {
      ...updateTransaction,
      address: recordsAddress,
      chainId: defaultChainId,
    },
    prepareMintTransaction(slot, defaultChainId) as TransactionType,
  ];
}

export function getEfpWorkflowStorageKey(accountAddress: string): string {
  return `${EFP_WORKFLOW_STORAGE_PREFIX}:${normalizeAccountAddress(accountAddress).toLowerCase()}`;
}

function serializeWorkflow(snapshot: EfpWorkflowSnapshot): string {
  return JSON.stringify(snapshot, (_key, value) => (
    typeof value === "bigint" ? { [BIGINT_TAG]: value.toString() } : value
  ));
}

function deserializeWorkflow(raw: string): unknown {
  return JSON.parse(raw, (_key, value) => {
    if (
      value
      && typeof value === "object"
      && Object.keys(value).length === 1
      && typeof value[BIGINT_TAG] === "string"
      && /^\d{1,78}$/.test(value[BIGINT_TAG])
    ) {
      return BigInt(value[BIGINT_TAG]);
    }
    return value;
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isTransaction(value: unknown): value is TransactionType {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || value.id.length === 0) return false;
  if (typeof value.address !== "string" || !isAddress(value.address)) return false;
  if (!Array.isArray(value.abi) || !Array.isArray(value.args)) return false;
  if (typeof value.functionName !== "string" || value.functionName.length === 0) return false;
  if (
    value.chainId !== undefined
    && (!Number.isSafeInteger(value.chainId) || Number(value.chainId) <= 0)
  ) {
    return false;
  }
  if (
    value.hash !== undefined
    && (typeof value.hash !== "string" || !/^0x[0-9a-f]{64}$/i.test(value.hash))
  ) {
    return false;
  }
  return true;
}

function parseWorkflow(raw: string, expectedAddress: string): EfpWorkflowSnapshot | null {
  if (!raw || raw.length > EFP_WORKFLOW_MAX_BYTES) return null;

  let value: unknown;
  try {
    value = deserializeWorkflow(raw);
  } catch {
    return null;
  }

  if (!isRecord(value) || value.version !== EFP_WORKFLOW_VERSION) return null;
  if (typeof value.accountAddress !== "string" || !isAddress(value.accountAddress)) return null;
  if (value.accountAddress.toLowerCase() !== expectedAddress.toLowerCase()) return null;
  if (!Array.isArray(value.pendingTxs) || value.pendingTxs.length === 0) return null;
  if (value.pendingTxs.length > 8 || !value.pendingTxs.every(isTransaction)) return null;
  if (!Array.isArray(value.proofs) || value.proofs.length !== value.pendingTxs.length) return null;
  if (!value.proofs.every((proof) => {
    if (!isRecord(proof)) return false;
    if (!["failed", "prepared", "submitted", "success"].includes(String(proof.status))) {
      return false;
    }
    if (proof.method !== undefined && proof.method !== "batch" && proof.method !== "direct") {
      return false;
    }
    if (
      proof.transactionHash !== undefined
      && (typeof proof.transactionHash !== "string" || !/^0x[0-9a-f]{64}$/i.test(proof.transactionHash))
    ) {
      return false;
    }
    return proof.transactionId === undefined || (
      typeof proof.transactionId === "string"
      && proof.transactionId.length > 0
      && proof.transactionId.length <= 512
    );
  })) return null;
  if (
    !Number.isSafeInteger(value.currentTxIndex)
    || Number(value.currentTxIndex) < 0
    || Number(value.currentTxIndex) >= value.pendingTxs.length
  ) {
    return null;
  }
  if (value.selectedList !== undefined && typeof value.selectedList !== "string") return null;
  if (typeof value.updatedAt !== "number" || !Number.isFinite(value.updatedAt)) return null;
  if (!Number.isSafeInteger(value.revision) || Number(value.revision) < 0) return null;
  if (
    typeof value.workflowId !== "string"
    || value.workflowId.length < 8
    || value.workflowId.length > 128
  ) {
    return null;
  }

  return value as EfpWorkflowSnapshot;
}

function emitWorkflowChange(key: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(EFP_WORKFLOW_CHANGE_EVENT, { detail: { key } }));
}

export function createEfpWorkflowSnapshot({
  accountAddress,
  currentTxIndex = 0,
  pendingTxs,
  selectedList,
}: {
  accountAddress: string;
  currentTxIndex?: number;
  pendingTxs: TransactionType[];
  selectedList?: string;
}): EfpWorkflowSnapshot {
  if (pendingTxs.length === 0 || currentTxIndex < 0 || currentTxIndex >= pendingTxs.length) {
    throw new Error("Cannot persist an empty or invalid EFP transaction workflow.");
  }
  return {
    accountAddress: normalizeAccountAddress(accountAddress),
    currentTxIndex,
    pendingTxs,
    proofs: pendingTxs.map((transaction) => ({
      ...(getEfpWorkflowTransactionHash(transaction)
        ? {
            method: "direct" as const,
            status: "submitted" as const,
            transactionHash: getEfpWorkflowTransactionHash(transaction),
          }
        : { status: "prepared" as const }),
    })),
    revision: 0,
    ...(selectedList ? { selectedList } : {}),
    updatedAt: Date.now(),
    version: EFP_WORKFLOW_VERSION,
    workflowId: createWorkflowId(),
  };
}

export function readEfpWorkflow(
  storage: EfpWorkflowStorage | null,
  accountAddress: string,
): EfpWorkflowSnapshot | null {
  if (!storage) return null;
  const key = getEfpWorkflowStorageKey(accountAddress);
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    const parsed = parseWorkflow(raw, accountAddress);
    if (!parsed) storage.removeItem(key);
    return parsed;
  } catch {
    return null;
  }
}

export function writeEfpWorkflow(
  storage: EfpWorkflowStorage | null,
  snapshot: EfpWorkflowSnapshot,
): boolean {
  if (!storage) return false;
  const key = getEfpWorkflowStorageKey(snapshot.accountAddress);
  const serialized = serializeWorkflow(snapshot);
  try {
    const existingRaw = storage.getItem(key);
    if (existingRaw) {
      const existing = parseWorkflow(existingRaw, snapshot.accountAddress);
      if (
        !existing
        || existing.workflowId !== snapshot.workflowId
        || existing.revision >= snapshot.revision
      ) {
        return false;
      }
    } else if (snapshot.revision !== 0) {
      return false;
    }
    storage.setItem(key, serialized);
    if (storage.getItem(key) !== serialized) return false;
    emitWorkflowChange(key);
    return true;
  } catch {
    return false;
  }
}

export function removeEfpWorkflow(
  storage: EfpWorkflowStorage | null,
  accountAddress: string,
  workflowId?: string,
): boolean {
  if (!storage) return false;
  const key = getEfpWorkflowStorageKey(accountAddress);
  try {
    if (workflowId) {
      const existingRaw = storage.getItem(key);
      if (!existingRaw) return true;
      const existing = parseWorkflow(existingRaw, accountAddress);
      if (!existing || existing.workflowId !== workflowId) return false;
    }
    storage.removeItem(key);
    if (storage.getItem(key) !== null) return false;
    emitWorkflowChange(key);
    return true;
  } catch {
    return false;
  }
}

export function getBrowserEfpWorkflowStorage(): EfpWorkflowStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function subscribeEfpWorkflowChanges(
  accountAddress: string,
  listener: () => void,
): () => void {
  if (typeof window === "undefined") return () => {};
  const key = getEfpWorkflowStorageKey(accountAddress);
  const handleStorage = (event: StorageEvent) => {
    if (event.key === key) listener();
  };
  const handleLocalChange = (event: Event) => {
    const detail = (event as CustomEvent<{ key?: unknown }>).detail;
    if (detail?.key === key) listener();
  };
  window.addEventListener("storage", handleStorage);
  window.addEventListener(EFP_WORKFLOW_CHANGE_EVENT, handleLocalChange);
  return () => {
    window.removeEventListener("storage", handleStorage);
    window.removeEventListener(EFP_WORKFLOW_CHANGE_EVENT, handleLocalChange);
  };
}

export function getEfpWorkflowTransactionHash(
  transaction: TransactionType,
): Hex | undefined {
  return typeof transaction.hash === "string" && /^0x[0-9a-f]{64}$/i.test(transaction.hash)
    ? transaction.hash as Hex
    : undefined;
}

export function updateEfpWorkflowProof(
  snapshot: EfpWorkflowSnapshot,
  transactionIndex: number,
  proof: EfpWorkflowProof,
  now = Date.now(),
): EfpWorkflowSnapshot {
  if (
    transactionIndex !== snapshot.currentTxIndex
    || transactionIndex < 0
    || transactionIndex >= snapshot.pendingTxs.length
  ) {
    throw new Error("The EFP workflow changed before its transaction result was recorded.");
  }

  const proofs = snapshot.proofs.map((existingProof, index) => (
    index === transactionIndex ? { ...existingProof, ...proof } : existingProof
  ));
  return {
    ...snapshot,
    proofs,
    revision: snapshot.revision + 1,
    updatedAt: now,
  };
}

export function advanceEfpWorkflowAfterSuccess(
  snapshot: EfpWorkflowSnapshot,
  transactionIndex: number,
  proof: Omit<EfpWorkflowProof, "status">,
  now = Date.now(),
): { complete: boolean; snapshot: EfpWorkflowSnapshot } {
  const withSuccess = updateEfpWorkflowProof(
    snapshot,
    transactionIndex,
    { ...proof, status: "success" },
    now,
  );
  const complete = transactionIndex === snapshot.pendingTxs.length - 1;
  if (complete) return { complete, snapshot: withSuccess };

  return {
    complete,
    snapshot: {
      ...withSuccess,
      currentTxIndex: transactionIndex + 1,
    },
  };
}
