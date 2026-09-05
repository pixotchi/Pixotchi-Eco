import { asRecord, extractTransactionHash, normalizeTransactionReceipt, type TransactionReceiptLike } from '@/lib/transaction-utils';

export class WalletStatusUnavailableError extends Error {
  constructor() {
    super('Wallet confirmation data is incomplete or inconsistent; continuing to check the submitted transaction.');
    this.name = 'WalletStatusUnavailableError';
  }
}

export type WalletBatchStatus = {
  status: 'pending' | 'success' | 'failure';
  statusCode?: number;
  atomic?: boolean;
  receipts: TransactionReceiptLike[];
};

export function parseWalletCallsId(value: unknown): string | undefined {
  const id = asRecord(value)?.id;
  return typeof id === 'string' && id.trim() !== '' && id.length <= 512 ? id : undefined;
}

/** Consume viem's decoded result; unknown or cross-chain data is never terminal evidence. */
export function parseWalletBatchStatus(value: unknown, chainId: number): WalletBatchStatus {
  const result = asRecord(value);
  const status = result?.status;
  if (!result || (status !== 'pending' && status !== 'success' && status !== 'failure')) throw new WalletStatusUnavailableError();
  if (result.chainId !== undefined && result.chainId !== chainId) throw new WalletStatusUnavailableError();
  const code = result.statusCode;
  if (code !== undefined && (typeof code !== 'number' || !Number.isSafeInteger(code)
    || (status === 'pending' ? code < 100 || code >= 200 : status === 'success' ? code < 200 || code >= 300 : code < 300 || code >= 700))) throw new WalletStatusUnavailableError();
  if (result.atomic !== undefined && typeof result.atomic !== 'boolean') throw new WalletStatusUnavailableError();
  if (result.receipts !== undefined && !Array.isArray(result.receipts)) throw new WalletStatusUnavailableError();
  const rawReceipts: unknown[] = Array.isArray(result.receipts) ? result.receipts : [];
  if (rawReceipts.some(receipt => !asRecord(receipt) || !extractTransactionHash(receipt))) throw new WalletStatusUnavailableError();
  return {
    status,
    ...(typeof code === 'number' ? { statusCode: code } : {}),
    ...(typeof result.atomic === 'boolean' ? { atomic: result.atomic } : {}),
    receipts: rawReceipts.map(normalizeTransactionReceipt),
  };
}

export function getBatchTransactionHashes(result: WalletBatchStatus) {
  return [...new Set(result.receipts.flatMap(receipt => {
    const hash = extractTransactionHash(receipt);
    return hash ? [hash] : [];
  }))];
}

export function hasWalletBatchResolution(result: WalletBatchStatus) {
  return result.status === 'failure' || (result.status === 'success' && getBatchTransactionHashes(result).length > 0);
}
