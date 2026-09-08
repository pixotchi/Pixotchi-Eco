export type SpinRevealState = {
  status: 'unknown' | 'waiting' | 'ready' | 'expired';
  blocksUntilReveal: number | null;
  blocksUntilExpiry: number | null;
};

// Verified SpinGameV2 deployed-bytecode conditions: current > commit + 1,
// and current <= (commit + 1) + 256. The final valid block is commit + 257.
export function getSpinRevealState(commitBlock: number | null | undefined, currentBlock: number | null | undefined): SpinRevealState {
  if (!Number.isSafeInteger(commitBlock) || !commitBlock || commitBlock < 1
    || !Number.isSafeInteger(currentBlock) || currentBlock == null || currentBlock < commitBlock) {
    return { status: 'unknown', blocksUntilReveal: null, blocksUntilExpiry: null };
  }
  const blocksUntilReveal = Math.max(0, commitBlock + 2 - currentBlock);
  const blocksUntilExpiry = Math.max(0, commitBlock + 258 - currentBlock);
  return {
    status: blocksUntilExpiry === 0 ? 'expired' : blocksUntilReveal > 0 ? 'waiting' : 'ready',
    blocksUntilReveal,
    blocksUntilExpiry,
  };
}

/** Called immediately before sending; only a current successful simulation permits reveal. */
export async function verifySpinReveal({ commitBlock, readBlock, simulate }: {
  commitBlock: number | undefined;
  readBlock: () => Promise<bigint>;
  simulate: () => Promise<unknown>;
}): Promise<void> {
  const currentBlock = Number(await readBlock());
  if (getSpinRevealState(commitBlock, currentBlock).status !== 'ready') {
    throw new Error('The reveal block is not available or its window has ended. Recheck the spin.');
  }
  await simulate();
}
