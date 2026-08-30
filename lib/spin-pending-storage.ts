import type { Hex } from "viem";

export const SPIN_PENDING_STORAGE_VERSION = 2 as const;

const STORAGE_NAMESPACE = "pixotchi:spinleaf:pending";
const LEGACY_STORAGE_NAMESPACE = "spinleaf:pending";
const BYTES32_PATTERN = /^0x[0-9a-fA-F]{64}$/;

export type StoredSpinPending = {
  account: string;
  commitment: Hex;
  commitBlock: number | null;
  plantId: number;
  secretHex: Hex;
  version: typeof SPIN_PENDING_STORAGE_VERSION;
};

type StorageLike = Pick<Storage, "getItem" | "removeItem" | "setItem">;

function normalizeAccount(account: string) {
  return account.trim().toLowerCase();
}

function isBytes32(value: unknown): value is Hex {
  return typeof value === "string" && BYTES32_PATTERN.test(value);
}

function isCommitBlock(value: unknown): value is number | null {
  return value === null || (
    typeof value === "number"
    && Number.isSafeInteger(value)
    && value >= 0
  );
}

function parseStoredSpinPending(
  value: string,
  account: string,
  plantId: number,
): StoredSpinPending | null {
  try {
    const parsed = JSON.parse(value) as Partial<StoredSpinPending>;
    const normalizedAccount = normalizeAccount(account);

    if (
      parsed.version !== SPIN_PENDING_STORAGE_VERSION
      || normalizeAccount(parsed.account ?? "") !== normalizedAccount
      || parsed.plantId !== plantId
      || !isBytes32(parsed.commitment)
      || !isBytes32(parsed.secretHex)
      || !isCommitBlock(parsed.commitBlock)
    ) {
      return null;
    }

    return {
      account: normalizedAccount,
      commitment: parsed.commitment,
      commitBlock: parsed.commitBlock,
      plantId,
      secretHex: parsed.secretHex,
      version: SPIN_PENDING_STORAGE_VERSION,
    };
  } catch {
    return null;
  }
}

export function getSpinPendingStorageKey(account: string, plantId: number) {
  return `${STORAGE_NAMESPACE}:v${SPIN_PENDING_STORAGE_VERSION}:${normalizeAccount(account)}:${plantId}`;
}

export function getLegacySpinPendingStorageKey(plantId: number) {
  return `${LEGACY_STORAGE_NAMESPACE}:${plantId}`;
}

export function readStoredSpinPending(
  storage: StorageLike | null,
  account: string,
  plantId: number,
) {
  if (!storage || !account || !Number.isSafeInteger(plantId) || plantId < 0) return null;

  try {
    const value = storage.getItem(getSpinPendingStorageKey(account, plantId));
    return value ? parseStoredSpinPending(value, account, plantId) : null;
  } catch {
    return null;
  }
}

export function writeStoredSpinPending(
  storage: StorageLike | null,
  record: StoredSpinPending,
) {
  if (!storage) return false;

  const normalized: StoredSpinPending = {
    ...record,
    account: normalizeAccount(record.account),
    version: SPIN_PENDING_STORAGE_VERSION,
  };
  if (!parseStoredSpinPending(JSON.stringify(normalized), normalized.account, normalized.plantId)) {
    return false;
  }

  try {
    storage.setItem(
      getSpinPendingStorageKey(normalized.account, normalized.plantId),
      JSON.stringify(normalized),
    );
    return true;
  } catch {
    return false;
  }
}

export function removeStoredSpinPending(
  storage: StorageLike | null,
  account: string,
  plantId: number,
) {
  if (!storage || !account) return false;

  try {
    storage.removeItem(getSpinPendingStorageKey(account, plantId));
    return true;
  } catch {
    return false;
  }
}

export function migrateLegacySpinPending(
  storage: StorageLike | null,
  account: string,
  plantId: number,
) {
  if (!storage || !account) return null;

  try {
    const legacyKey = getLegacySpinPendingStorageKey(plantId);
    const legacyValue = storage.getItem(legacyKey);
    if (!legacyValue) return null;

    const legacy = JSON.parse(legacyValue) as {
      player?: unknown;
      commitment?: unknown;
      commitBlock?: unknown;
      secretHex?: unknown;
    };
    if (
      typeof legacy.player !== "string"
      || normalizeAccount(legacy.player) !== normalizeAccount(account)
      || !isBytes32(legacy.commitment)
      || !isBytes32(legacy.secretHex)
    ) {
      return null;
    }

    const commitBlock = typeof legacy.commitBlock === "number"
      && Number.isSafeInteger(legacy.commitBlock)
      && legacy.commitBlock > 0
      ? legacy.commitBlock
      : null;
    const migrated: StoredSpinPending = {
      account: normalizeAccount(account),
      commitment: legacy.commitment,
      commitBlock,
      plantId,
      secretHex: legacy.secretHex,
      version: SPIN_PENDING_STORAGE_VERSION,
    };

    if (!writeStoredSpinPending(storage, migrated)) return null;
    storage.removeItem(legacyKey);
    return migrated;
  } catch {
    return null;
  }
}
