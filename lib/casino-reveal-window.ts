/** Verified Baccarat LibBaccarat.MAX_REVEAL_DELAY (Base facet on 2026-09-08):
 * https://basescan.org/address/0xdaf996ef01dc1a387187d85b23d9dfc8c9a7c97c#code
 * Reveal is valid after revealBlock and through revealBlock + 256, inclusive.
 * Other games must supply their verified window when it differs. */
export const BACCARAT_REVEAL_WINDOW_BLOCKS = BigInt(256);

export function getCasinoRevealWindow(revealBlock: bigint, currentBlock: bigint | undefined, windowBlocks: bigint) {
  const firstRevealBlock = revealBlock + BigInt(1);
  const lastRevealBlock = revealBlock + windowBlocks;
  return {
    firstRevealBlock,
    lastRevealBlock,
    expired: currentBlock === undefined ? null : currentBlock > lastRevealBlock,
    blocksUntilOpen: currentBlock === undefined ? null : currentBlock < firstRevealBlock ? firstRevealBlock - currentBlock : BigInt(0),
    remainingRevealBlocks: currentBlock === undefined ? null : currentBlock > lastRevealBlock ? BigInt(0) : lastRevealBlock - currentBlock,
  };
}
