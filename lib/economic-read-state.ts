export type EconomicReadState = 'loading' | 'error' | 'ready';

/** A retained value is presentational only until its complete, current read succeeds. */
export function getEconomicReadState({
  hasSnapshot,
  identityMatches,
  loading,
  error,
}: {
  hasSnapshot: boolean;
  identityMatches: boolean;
  loading: boolean;
  error: unknown;
}): EconomicReadState {
  if (error) return 'error';
  if (loading || !hasSnapshot || !identityMatches) return 'loading';
  return 'ready';
}
