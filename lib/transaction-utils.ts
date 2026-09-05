import type { Hex } from 'viem';

export type TransactionReceiptLike = {
  transactionHash?: Hex;
  blockNumber?: bigint | number | string;
  status?: string | number | bigint;
  logs?: readonly { address: string; topics: readonly Hex[]; data: Hex; [key: string]: unknown }[];
  [key: string]: unknown;
};

export function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

export function parseTransactionHash(value: unknown): Hex | undefined {
  return typeof value === 'string' && /^0x[\da-f]{64}$/i.test(value) ? value as Hex : undefined;
}

/** Wallet metadata must not round unsafe integers or coerce booleans into blocks. */
export function parseReceiptBlock(value: unknown): bigint | undefined {
  if (typeof value === 'number' && (!Number.isSafeInteger(value) || value < 0)) return undefined;
  if (typeof value !== 'bigint' && typeof value !== 'number' && !(typeof value === 'string' && /^(?:\d+|0x[\da-f]+)$/i.test(value))) return undefined;
  try {
    const block = BigInt(value);
    return block >= BigInt(0) ? block : undefined;
  } catch { return undefined; }
}

/** Direct, EOA, smart-wallet and batch receipt envelopes share one validated hash reader. */
export function extractTransactionHash(value: unknown): Hex | undefined {
  const receipt = asRecord(value);
  const transaction = asRecord(receipt?.transaction);
  const firstReceipt = asRecord(Array.isArray(receipt?.receipts) ? receipt.receipts[0] : undefined);
  const firstTransaction = asRecord(Array.isArray(receipt?.transactions) ? receipt.transactions[0] : undefined);
  const firstArrayItem = asRecord(Array.isArray(value) ? value[0] : undefined);
  const candidates = [receipt?.transactionHash, transaction?.hash, transaction?.transactionHash,
    receipt?.hash, receipt?.txHash, firstReceipt?.transactionHash, firstReceipt?.hash,
    firstTransaction?.hash, firstTransaction?.transactionHash, firstArrayItem?.transactionHash, firstArrayItem?.hash];
  return candidates.map(parseTransactionHash).find(Boolean);
}

/** Preserve wallet extensions as unknown while validating fields consumed by the UI. */
export function normalizeTransactionReceipt(value: unknown): TransactionReceiptLike {
  const receipt = asRecord(value) ?? {};
  const normalized: TransactionReceiptLike = { ...receipt };
  delete normalized.transactionHash;
  delete normalized.blockNumber;
  delete normalized.status;
  delete normalized.logs;
  const hash = extractTransactionHash(value);
  if (hash) normalized.transactionHash = hash;
  const block = parseReceiptBlock(receipt.blockNumber);
  if (block !== undefined) normalized.blockNumber = block;
  const { status, logs } = receipt;
  if (typeof status === 'string' || typeof status === 'bigint' || (typeof status === 'number' && Number.isFinite(status))) normalized.status = status;
  if (Array.isArray(logs)) {
    normalized.logs = logs.flatMap(value => {
      const log = asRecord(value);
      if (!log || typeof log.address !== 'string' || !/^0x[\da-f]{40}$/i.test(log.address)
        || !Array.isArray(log.topics) || !log.topics.every(topic => parseTransactionHash(topic))
        || typeof log.data !== 'string' || !/^0x(?:[\da-f]{2})*$/i.test(log.data)) return [];
      return [{ ...log, address: log.address, topics: log.topics as Hex[], data: log.data as Hex }];
    });
  }
  return normalized;
}

/** Highest sealed block represented by a direct or EIP-5792 proof. */
export function getHighestTransactionReceiptBlock(receipts: readonly unknown[]): bigint | undefined {
  let highest: bigint | undefined;
  for (const receipt of receipts) {
    const block = parseReceiptBlock(asRecord(receipt)?.blockNumber);
    if (block !== undefined && (highest === undefined || block > highest)) highest = block;
  }
  return highest;
}
