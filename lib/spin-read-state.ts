/** Unknown configuration must never advertise a price or a ready action. */
export function getSpinReadState({ hasMetadata, loading, failed }: { hasMetadata: boolean; loading: boolean; failed: boolean }) {
  const state = failed ? 'error' : loading || !hasMetadata ? 'loading' : 'ready';
  return {
    state,
    canStart: state === 'ready',
    title: state === 'error' ? 'Spin status unavailable' : state === 'loading' ? 'Loading spin status' : 'Ready to Spin',
    description: state === 'error' ? 'Try loading the spin configuration again. Any saved spin is retained.' : 'Checking the cost and cooldown…',
  } as const;
}
