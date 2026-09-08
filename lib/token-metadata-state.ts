export type TokenMetadataRead = { status: string; result?: unknown; error?: unknown };

/** A denomination is usable only after both ERC-20 reads succeeded. */
export function resolveTokenMetadata(reads: readonly TokenMetadataRead[] | undefined, failed = false) {
  const symbol = reads?.[0];
  const decimals = reads?.[1];
  const valid = !failed
    && symbol?.status === 'success' && typeof symbol.result === 'string' && symbol.result.trim().length > 0
    && decimals?.status === 'success' && typeof decimals.result === 'number'
    && Number.isInteger(decimals.result) && decimals.result >= 0 && decimals.result <= 255;
  return valid
    ? { symbol: symbol.result as string, decimals: decimals.result as number, isReady: true as const }
    : { symbol: undefined, decimals: undefined, isReady: false as const };
}
