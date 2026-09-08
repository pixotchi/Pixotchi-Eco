/** Share successful/in-flight loads, but release rejected imports for Retry. */
export function createRetryableResource<T>(loader: () => Promise<T>) {
  let pending: Promise<T> | null = null;
  return () => {
    pending ??= Promise.resolve().then(loader).catch((error: unknown) => {
      pending = null;
      throw error;
    });
    return pending;
  };
}
