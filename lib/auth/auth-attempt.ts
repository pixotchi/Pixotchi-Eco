import { getAuthGeneration, isWalletReconnectAllowed, subscribeToAuthCleanup } from '@/lib/auth-cleanup';

export type AuthAttemptScope = { address: string | null; surface: string | null };

export function createAuthAttempt(readScope?: () => AuthAttemptScope) {
  const generation = getAuthGeneration();
  const initial = readScope?.();
  let boundAddress = initial?.address?.toLowerCase() ?? null;
  let observedConnection = Boolean(boundAddress);
  const controller = new AbortController();
  const isCurrent = () => {
    const current = readScope?.();
    if (controller.signal.aborted || generation !== getAuthGeneration() || !isWalletReconnectAllowed()) return false;
    if (!current) return true;
    if (current.surface !== initial?.surface) return false;
    const address = current.address?.toLowerCase() ?? null;
    if (!boundAddress && address) boundAddress = address;
    if (boundAddress && address && address !== boundAddress) return false;
    if (address) observedConnection = true;
    return !(observedConnection && !address);
  };
  const abort = () => controller.abort();
  const assertCurrent = () => {
    if (!isCurrent()) { abort(); throw new DOMException('This sign-in attempt is no longer current.', 'AbortError'); }
  };
  const unsubscribe = subscribeToAuthCleanup(() => { if (!isCurrent()) abort(); });
  return {
    signal: controller.signal, isCurrent, assertCurrent, abort,
    async run<T>(task: () => Promise<T>): Promise<T> {
      assertCurrent();
      try { const value = await task(); assertCurrent(); return value; }
      catch (error) { assertCurrent(); throw error; }
    },
    bindAddress(address: string) { boundAddress = address.toLowerCase(); assertCurrent(); },
    checkScope() { if (!isCurrent()) abort(); },
    dispose: unsubscribe,
  };
}
export type AuthAttempt = ReturnType<typeof createAuthAttempt>;
