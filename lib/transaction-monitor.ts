/** Monitoring can be handed off without cancelling or resubmitting the wallet operation. */
export function createMonitoringAbortError() {
  const error = new Error('Transaction monitoring transferred.');
  error.name = 'AbortError';
  return error;
}

export function throwIfMonitoringAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createMonitoringAbortError();
}

export function withMonitoringAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(createMonitoringAbortError());
    if (signal.aborted) abort();
    else signal.addEventListener('abort', abort, { once: true });
    // Always observe the original promise, including when the signal was already aborted.
    void promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export function waitForMonitorDelay(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(createMonitoringAbortError());
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(createMonitoringAbortError()); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, delayMs);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

/** A UI timeout keeps observing the original wallet promise; only settled/unusable reads are retried. */
export async function monitorSubmittedBatch<T>({ request, initialWait, wait, resolved, retryable, onUnresolved, delay, signal }: {
  request: () => Promise<T>;
  initialWait: (pending: Promise<T>) => Promise<T>;
  wait: (pending: Promise<T>) => Promise<T>;
  resolved: (value: T) => boolean;
  retryable: (error: unknown) => boolean;
  onUnresolved: (error: unknown) => void;
  delay: (attempt: number) => Promise<void>;
  signal?: AbortSignal;
}): Promise<T> {
  throwIfMonitoringAborted(signal);
  let pending = request();
  let rejected = false;
  let needsFreshStatus = false;
  void pending.catch(() => { rejected = true; });
  try {
    const value = await initialWait(pending);
    if (resolved(value)) return value;
    needsFreshStatus = true;
  } catch (error) {
    if (!retryable(error)) throw error;
    onUnresolved(error);
  }
  let attempt = 0;
  const refresh = async () => {
    await delay(attempt++);
    throwIfMonitoringAborted(signal);
    pending = request();
  };
  if (rejected || needsFreshStatus) await refresh();
  while (true) {
    try {
      const value = await wait(pending);
      if (resolved(value)) return value;
    } catch (error) {
      if (!retryable(error)) throw error;
      onUnresolved(error);
    }
    await refresh();
  }
}
