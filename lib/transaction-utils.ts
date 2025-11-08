// Utility function to extract transaction hash from various receipt structures
// Handles differences between EOA, smart wallet, and batched transaction receipts

export function extractTransactionHash(receipt: any): string | undefined {
  if (!receipt) return undefined;
  
  // Try multiple possible locations for the hash
  // Standard EOA receipts: receipt.transactionHash
  // Smart wallet receipts: receipt.transaction?.hash
  // Batched receipts: receipt.hash or nested structure
  return receipt.transactionHash 
    ?? receipt.transaction?.hash
    ?? receipt.hash
    ?? receipt.txHash
    ?? (Array.isArray(receipt) && receipt[0]?.transactionHash)
    ?? undefined;
}

// Normalize a transaction receipt to ensure transactionHash is always accessible
export function normalizeTransactionReceipt(receipt: any): any {
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

