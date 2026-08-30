"use client";

// Utilities to clear app-related caches and persisted wallet state

type ClearOptions = {
  unregisterServiceWorkers?: boolean;
  reloadAfter?: boolean;
  // LocalStorage keys to keep intact during clearing (exact key matches)
  preserveLocalStorageKeys?: string[];
  // If provided, only keys whose prefix matches one of these will be deleted.
  // This lets us avoid touching third-party SDK state on migrations.
  onlyPrefixes?: string[];
};

const LOCALSTORAGE_KEY_PREFIXES = [
  // wagmi and connectors
  "wagmi.",
  "_wagmi.",
  "wagmi", // fallback
  "walletconnect",
  "wc@",
  // Privy
  "privy",
  "@privy",
  // Legacy wallet / Coinbase
  "ock",
  "coinbase",
  // App specific
  "pixotchi",
  "pixotchi:",
];

// A cache/auth reset must never erase evidence for an in-flight onchain action.
// These records are wallet/account scoped, so preserving them across disconnect
// is both safe and necessary for canonical recovery without a duplicate send.
const DURABLE_TRANSACTION_STORAGE_PREFIXES = [
  "pixotchi:pending-evm:v2:",
  "pixotchi:transfer-assets:v1:",
  "pixotchi:efp-workflow:v1:",
  "pixotchi:solana-bridge:pending:v2:",
  "pixotchi:spinleaf:pending:",
];

function isDurableTransactionKey(lowerKey: string) {
  return DURABLE_TRANSACTION_STORAGE_PREFIXES.some((prefix) => lowerKey.startsWith(prefix));
}

export async function clearAppCaches(options: ClearOptions = {}) {
  try {
    // 1) LocalStorage keys (targeted by prefixes)
    try {
      const toDelete: string[] = [];
      const preserveSet = new Set(
        (options.preserveLocalStorageKeys || []).map((k) => k.toLowerCase())
      );
      const targetPrefixes = (options.onlyPrefixes && options.onlyPrefixes.length > 0)
        ? options.onlyPrefixes.map((p) => p.toLowerCase())
        : LOCALSTORAGE_KEY_PREFIXES;
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i);
        if (!key) continue;
        const lower = key.toLowerCase();
        if (preserveSet.has(lower)) {
          continue;
        }
        if (isDurableTransactionKey(lower)) {
          continue;
        }
        if (targetPrefixes.some((p) => lower.startsWith(p))) {
          toDelete.push(key);
        }
      }
      toDelete.forEach((k) => localStorage.removeItem(k));
    } catch {}

    // 2) SessionStorage (only app-related keys if any)
    try {
      const toDelete: string[] = [];
      const targetPrefixes = (options.onlyPrefixes && options.onlyPrefixes.length > 0)
        ? options.onlyPrefixes.map((p) => p.toLowerCase())
        : LOCALSTORAGE_KEY_PREFIXES;
      for (let i = 0; i < sessionStorage.length; i++) {
        const key = sessionStorage.key(i);
        if (!key) continue;
        const lower = key.toLowerCase();
        if (isDurableTransactionKey(lower)) {
          continue;
        }
        if (targetPrefixes.some((p) => lower.startsWith(p))) {
          toDelete.push(key);
        }
      }
      toDelete.forEach((k) => sessionStorage.removeItem(k));
    } catch {}

    // 3) Caches API
    try {
      if (typeof caches !== "undefined" && caches.keys) {
        const keys = await caches.keys();
        await Promise.all(keys.map((k) => caches.delete(k)));
      }
    } catch {}

    // 4) Service workers (optional)
    try {
      if (options.unregisterServiceWorkers && "serviceWorker" in navigator) {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.allSettled(regs.map((r) => r.unregister()));
      }
    } catch {}

    if (options.reloadAfter) {
      // Use hard reload semantics when possible
      try { window.location.replace(window.location.href); } catch { window.location.reload(); }
    }
  } catch {}
}

