"use client";

import { useTokenMetadata } from './useTokenMetadata';

/** Compatibility selector; never substitute a different token on read failure. */
export function useTokenSymbol(tokenAddress: string | undefined | null) {
  return useTokenMetadata(tokenAddress).symbol;
}
