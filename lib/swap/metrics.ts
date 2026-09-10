/** Fixed cardinality, process-local diagnostics. Never label by wallet, pair, or quote. */
const counters = { quoteRejected: 0, reviewRequired: 0, buildRejected: 0 };
export type SwapSafetyCounter = keyof typeof counters;

export function incrementSwapSafetyCounter(counter: SwapSafetyCounter): void {
  counters[counter] = Math.min(Number.MAX_SAFE_INTEGER, counters[counter] + 1);
}

export function getSwapSafetyCounters(): Readonly<typeof counters> {
  return { ...counters };
}
