import type { Hex } from 'viem';
import { createPendingEvmCallsDigest, type PendingEvmRecord } from '@/lib/pending-evm-transaction';

export class TransactionSupersededError extends Error {
  constructor() {
    super('This action was replaced by a different transaction in your wallet.');
    this.name = 'TransactionSupersededError';
  }
}

export class TransactionCancelledError extends Error {
  constructor() {
    super('Transaction cancelled by wallet replacement.');
    this.name = 'TransactionCancelledError';
  }
}

export class TransactionVerificationUnavailableError extends Error {
  constructor() {
    super('The transaction is confirmed, but its connection to this action is not verified yet.');
    this.name = 'TransactionVerificationUnavailableError';
  }
}

export type TransactionBinding = {
  hash: Hex;
  from: string;
  to: string | null;
  input: Hex;
  value: bigint;
  chainId?: number;
};

export function throwIfTransactionSuperseded(record: PendingEvmRecord) {
  if (record.replacement?.disposition === 'superseded') throw new TransactionSupersededError();
  if (record.replacement?.disposition === 'cancelled') throw new TransactionCancelledError();
}

const sameHash = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/** Preserve every batch receipt while following the replacement we actually observed. */
export function getPendingEvmReceiptTargets(record: PendingEvmRecord, walletTransactionHashes: readonly Hex[]): Hex[] {
  if (record.proof.kind !== 'calls' || !record.proof.hash) return [...walletTransactionHashes];
  const currentHash = record.proof.hash;
  if (walletTransactionHashes.length === 1) return [currentHash];
  if (walletTransactionHashes.some(hash => sameHash(hash, currentHash))) return [...walletTransactionHashes];
  const previousHash = record.replacement?.previousHash;
  if (!previousHash || !record.replacement || !sameHash(record.replacement.transactionHash, currentHash)
    || !walletTransactionHashes.some(hash => sameHash(hash, previousHash))) {
    throw new TransactionVerificationUnavailableError();
  }
  return [...new Set(walletTransactionHashes.map(hash => sameHash(hash, previousHash) ? currentHash : hash))];
}

function matchesStoredDirectCall(record: PendingEvmRecord, transaction: TransactionBinding) {
  if (!transaction.to) return false;
  const call = { to: transaction.to as Hex, value: transaction.value, data: transaction.input };
  if (createPendingEvmCallsDigest([call]) === record.callsDigest) return true;
  // v2 stored an absent data field as null, while RPC serializes it as 0x.
  return transaction.input === '0x'
    && createPendingEvmCallsDigest([{ ...call, data: undefined }]) === record.callsDigest;
}

/** Receipt success alone cannot establish that an old replacement executed the submitted intent. */
export async function verifyPendingEvmReceiptBinding({
  record,
  transactionHash,
  getTransaction,
  walletTransactionHashes = [],
}: {
  record: PendingEvmRecord;
  transactionHash: Hex;
  getTransaction: (hash: Hex) => Promise<TransactionBinding>;
  walletTransactionHashes?: readonly Hex[];
}): Promise<void> {
  throwIfTransactionSuperseded(record);
  if (record.method === 'direct') {
    if (record.initialTransactionHash && (
      sameHash(record.initialTransactionHash, transactionHash)
      || (record.replacement?.disposition === 'repriced'
        && sameHash(record.replacement.transactionHash, transactionHash))
    )) return;

    const transaction = await getTransaction(transactionHash);
    if (!sameHash(transaction.hash, transactionHash)
      || (transaction.chainId !== undefined && transaction.chainId !== record.chainId)
      || !sameHash(transaction.from, record.accountAddress)) {
      // Smart-account envelopes can be sent by a bundler. Their outer calldata
      // does not identify the stored inner action, so do not infer cancellation.
      throw new TransactionVerificationUnavailableError();
    }
    if (!matchesStoredDirectCall(record, transaction)) throw new TransactionSupersededError();
    return;
  }

  if (record.proof.kind !== 'calls' || !record.proof.hash) return;
  if (record.replacement?.disposition === 'repriced' && record.replacement.verified) return;

  // A legacy calls proof only gained `hash` when the old replacement path ran.
  // An immutable calls id remains useful, but that overwritten hash has no
  // disposition. Compare outer envelopes only when wallet status supplies one
  // distinct original transaction; never compare an outer batch to inner calls.
  if (walletTransactionHashes.length !== 1
    || sameHash(walletTransactionHashes[0], record.proof.hash)) {
    throw new TransactionVerificationUnavailableError();
  }
  const [original, replacement] = await Promise.all([
    getTransaction(walletTransactionHashes[0]),
    getTransaction(record.proof.hash),
  ]);
  if (!sameHash(original.hash, walletTransactionHashes[0])
    || !sameHash(replacement.hash, record.proof.hash)
    || !sameHash(original.from, replacement.from)
    || (original.chainId !== undefined && original.chainId !== record.chainId)
    || (replacement.chainId !== undefined && replacement.chainId !== record.chainId)) {
    throw new TransactionVerificationUnavailableError();
  }
  if (original.to?.toLowerCase() !== replacement.to?.toLowerCase()
    || original.input.toLowerCase() !== replacement.input.toLowerCase()
    || original.value !== replacement.value) {
    throw new TransactionSupersededError();
  }
}
