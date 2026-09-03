// Utility function to extract transaction hash from various receipt structures
// Handles differences between EOA, smart wallet, and batched transaction receipts

export function extractTransactionHash(receipt: UntypedValue): string | undefined {
  if (!receipt) return undefined;
  
  // Try multiple possible locations for the hash
  // Standard EOA receipts: receipt.transactionHash
  // Smart wallet receipts: receipt.transaction?.hash
  // Batched receipts: receipt.hash or nested structure
  return receipt.transactionHash 
    ?? receipt.transaction?.hash
    ?? receipt.transaction?.transactionHash
    ?? receipt.hash
    ?? receipt.txHash
    ?? receipt.receipts?.[0]?.transactionHash
    ?? receipt.receipts?.[0]?.hash
    ?? receipt.transactions?.[0]?.hash
    ?? receipt.transactions?.[0]?.transactionHash
    ?? (Array.isArray(receipt) && receipt[0]?.transactionHash)
    ?? (Array.isArray(receipt) && receipt[0]?.hash)
    ?? undefined;
}

// Normalize a transaction receipt to ensure transactionHash is always accessible
export function normalizeTransactionReceipt(receipt: UntypedValue): UntypedValue {
  if (!receipt) return receipt;
  
  const hash = extractTransactionHash(receipt);
  if (hash && !receipt.transactionHash) {
    // Ensure transactionHash is at the top level for consistency
    return {
      ...receipt,
      transactionHash: hash,
    };
  }
  
  return receipt;
}

/** Highest sealed block represented by a direct or EIP-5792 proof. */
export function getHighestTransactionReceiptBlock(receipts: readonly UntypedValue[]): bigint | undefined {
  let highest: bigint | undefined;
  for (const receipt of receipts) {
    const candidate = receipt?.blockNumber;
    if (candidate === undefined || candidate === null) continue;
    try {
      const blockNumber = BigInt(candidate);
      if (highest === undefined || blockNumber > highest) highest = blockNumber;
    } catch {
      // Invalid receipt metadata is rejected by the canonical monitor. Ignore it
      // here instead of allowing an untrusted wallet shape to break refresh.
    }
  }
  return highest;
}
