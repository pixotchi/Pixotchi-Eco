"use client";

import { clientMetaManager } from "../node_modules/@coinbase/onchainkit/dist/core/clientMeta/clientMetaManager.js";

type ClientMeta = {
  mode: "minikit" | "onchainkit";
  clientFid: number | null;
};

type PatchedClientMetaManager = {
  getClientMeta: () => Promise<ClientMeta>;
};

const CLIENT_META_TIMEOUT_MS = 250;

let didPatch = false;
let fallbackMeta: ClientMeta | null = null;
let didWarn = false;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]);
}

function warnFallbackOnce(reason: string) {
  if (didWarn) return;
  didWarn = true;
  console.warn(
    `[OnchainKit patch] Falling back to safe client metadata after ${reason}. ` +
    "This avoids swap quote hangs in webviews that expose Farcaster bridge APIs without returning context.",
  );
}

export function patchOnchainKitClientMetaTimeout() {
  if (didPatch || typeof window === "undefined") {
    return;
  }

  didPatch = true;

  const manager = clientMetaManager as unknown as PatchedClientMetaManager;
  const originalGetClientMeta = manager.getClientMeta.bind(manager);

  manager.getClientMeta = async () => {
    if (fallbackMeta) {
      return fallbackMeta;
    }

    try {
      const resolved = await withTimeout<ClientMeta | null>(
        Promise.resolve(originalGetClientMeta()).then((meta) => meta ?? null),
        CLIENT_META_TIMEOUT_MS,
        null,
      );

      if (resolved) {
        return resolved;
      }

      fallbackMeta = {
        mode: "onchainkit",
        clientFid: null,
      };
      warnFallbackOnce("a timed-out sdk.context lookup");
      return fallbackMeta;
    } catch (error) {
      fallbackMeta = {
        mode: "onchainkit",
        clientFid: null,
      };
      warnFallbackOnce(error instanceof Error ? error.message : "an unexpected client-meta error");
      return fallbackMeta;
    }
  };
}
