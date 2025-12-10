"use client";

/**
 * Development helper to surface which caller triggers RPC requests (e.g., net_listening).
 * It wraps fetch and logs method, URL, and a trimmed stack when the payload matches.
 * Only enable in development to avoid noisy logs in production.
 */
export function installRpcDebugLogger(options?: {
  filterMethods?: string[];
  enable?: boolean;
}) {
  if (typeof window === "undefined") return;
  const { filterMethods = ["net_listening"], enable = true } = options || {};
  if (!enable) return;

  // Prevent double-install
  const marker = "__pixotchi_rpc_debug_installed__";
  if ((window as any)[marker]) return;
  (window as any)[marker] = true;

  const originalFetch = window.fetch;

  window.fetch = async (...args: any[]) => {
    try {
      const [input, init] = args as [RequestInfo | URL, RequestInit | undefined];
      const url = typeof input === "string" ? input : (input as any)?.url ?? "unknown";
      const method = (init?.method || "GET").toUpperCase();

      // Only inspect POST bodies (RPC calls)
      if (method === "POST" && init?.body) {
        const clone = typeof init.body === "string" ? init.body : undefined;
        if (clone) {
          try {
            const parsed = JSON.parse(clone);
            const rpcMethod = Array.isArray(parsed)
              ? parsed.map((p) => p?.method).filter(Boolean)
              : parsed?.method;

            const matched =
              (Array.isArray(rpcMethod) && rpcMethod.some((m) => filterMethods.includes(m))) ||
              (typeof rpcMethod === "string" && filterMethods.includes(rpcMethod));

            if (matched) {
              const stack = new Error().stack
                ?.split("\n")
                .slice(2, 10) // trim noise
                .join("\n");
              console.warn(
                "[RPC DEBUG]",
                { url, method: rpcMethod, transport: "fetch" },
                "\nStack:\n",
                stack
              );
            }
          } catch {
            // ignore parse errors
          }
        }
      }
    } catch {
      // swallow debug errors to avoid breaking fetch
    }

    return originalFetch.apply(window, args as any);
  };
}

