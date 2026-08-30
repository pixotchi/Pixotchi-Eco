'use client';

/*
 * Shared engine behind usePrimaryName and useEnsAvatar — the two hooks were
 * ~160-line copy-pastes of each other, and both shared three real flaws this
 * factory fixes:
 *
 *  - failures were cached PERMANENTLY as null, so one 500 left users showing
 *    as raw hex for the whole session (failures now get a short retry TTL);
 *  - the flush debounce had no max-wait, so a surface mounting new addresses
 *    faster than every 50ms (a fast feed) could starve it indefinitely;
 *  - the cache never evicted (bounded LRU-ish cap now).
 */
type CacheEntry = {
  value: string | null;
  expiresAt: number;
};

export type BatchedAddressResolver = {
  getCached: (address: string) => { hit: boolean; value: string | null };
  enqueue: (address: string) => void;
  waitForResult: (address: string, callback: (value: string | null) => void) => () => void;
};

const SUCCESS_TTL_MS = 10 * 60 * 1000;
const FAILURE_RETRY_TTL_MS = 30 * 1000;
const FLUSH_DEBOUNCE_MS = 50;
const FLUSH_MAX_WAIT_MS = 250;
const CACHE_CAP = 2000;

export function createBatchedAddressResolver({
  endpoint,
  responseKey,
  logLabel,
}: {
  endpoint: string;
  responseKey: string;
  logLabel: string;
}): BatchedAddressResolver {
  const cache = new Map<string, CacheEntry>();
  const queue = new Set<string>();
  const subscribers = new Map<string, Set<(value: string | null) => void>>();
  let flushTimeout: ReturnType<typeof setTimeout> | null = null;
  let oldestQueuedAt: number | null = null;

  function store(address: string, value: string | null, ttl: number) {
    if (cache.size >= CACHE_CAP) {
      // Evict the oldest insertion (Map preserves insertion order).
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(address, { value, expiresAt: Date.now() + ttl });
  }

  function getCached(address: string): { hit: boolean; value: string | null } {
    const entry = cache.get(address);
    if (!entry) return { hit: false, value: null };
    if (Date.now() > entry.expiresAt) {
      cache.delete(address);
      return { hit: false, value: null };
    }
    return { hit: true, value: entry.value };
  }

  function notifySubscribers(address: string) {
    const callbacks = subscribers.get(address);
    if (!callbacks) return;
    const value = cache.get(address)?.value ?? null;
    callbacks.forEach((callback) => callback(value));
    subscribers.delete(address);
  }

  async function flushQueue() {
    if (queue.size === 0) return;

    const addresses = Array.from(queue);
    queue.clear();
    oldestQueuedAt = null;

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addresses }),
      });

      if (!response.ok) {
        addresses.forEach((addr) => {
          store(addr, null, FAILURE_RETRY_TTL_MS);
          notifySubscribers(addr);
        });
        console.warn(`[${logLabel}] Resolver returned ${response.status}`);
        return;
      }

      const data = await response.json();
      const values = data?.[responseKey] ?? {};

      addresses.forEach((addr) => {
        store(addr, values[addr] ?? null, SUCCESS_TTL_MS);
        notifySubscribers(addr);
      });
    } catch (error) {
      addresses.forEach((addr) => {
        store(addr, null, FAILURE_RETRY_TTL_MS);
        notifySubscribers(addr);
      });
      console.warn(`[${logLabel}] Failed to resolve`, error);
    }
  }

  function enqueue(address: string) {
    queue.add(address);
    const now = Date.now();
    oldestQueuedAt ??= now;

    // Debounce with a max-wait: keep coalescing bursts, but never let a stream
    // of new addresses postpone the flush past FLUSH_MAX_WAIT_MS.
    if (flushTimeout) {
      if (now - oldestQueuedAt < FLUSH_MAX_WAIT_MS) {
        clearTimeout(flushTimeout);
      } else {
        return;
      }
    }
    flushTimeout = setTimeout(() => {
      flushTimeout = null;
      void flushQueue();
    }, FLUSH_DEBOUNCE_MS);
  }

  function waitForResult(address: string, callback: (value: string | null) => void) {
    const cached = getCached(address);
    if (cached.hit) {
      callback(cached.value);
      return () => {};
    }

    let callbacks = subscribers.get(address);
    if (!callbacks) {
      callbacks = new Set();
      subscribers.set(address, callbacks);
    }
    callbacks.add(callback);

    return () => {
      callbacks?.delete(callback);
      if (callbacks?.size === 0) {
        subscribers.delete(address);
      }
    };
  }

  return { getCached, enqueue, waitForResult };
}
