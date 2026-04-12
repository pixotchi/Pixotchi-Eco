"use client";

import { clientMetaManager } from "../node_modules/@coinbase/onchainkit/dist/core/clientMeta/clientMetaManager.js";
import {
  ensureHostEnvironmentResolved,
  getHostEnvironmentSnapshot,
} from "@/lib/host-environment";

type ClientMeta = {
  mode: "minikit" | "onchainkit";
  clientFid: number | null;
};

type PatchedClientMetaManager = {
  clientMeta: ClientMeta | null;
  initPromise: Promise<ClientMeta> | null;
  init: (args: { isMiniKit: boolean }) => Promise<void>;
  getClientMeta: () => Promise<ClientMeta>;
};

let didPatch = false;
let didLogBridge = false;

function logBridgeMetaOnce(meta: ClientMeta) {
  if (didLogBridge) {
    return;
  }

  didLogBridge = true;
  console.info("[OnchainKit bridge] resolved host-backed client meta", meta);
}

async function resolveClientMeta(): Promise<ClientMeta> {
  const snapshot = getHostEnvironmentSnapshot();
  const hostEnvironment = snapshot.initialized
    ? snapshot
    : await ensureHostEnvironmentResolved();

  const meta: ClientMeta = {
    mode: "onchainkit",
    clientFid: hostEnvironment.clientFid,
  };
  logBridgeMetaOnce(meta);
  return meta;
}

export function patchOnchainKitClientMetaBridge() {
  if (didPatch || typeof window === "undefined") {
    return;
  }

  didPatch = true;

  const manager = clientMetaManager as unknown as PatchedClientMetaManager;
  manager.init = async () => {
    if (manager.initPromise) {
      await manager.initPromise;
      return;
    }

    manager.initPromise = resolveClientMeta().then((meta) => {
      manager.clientMeta = meta;
      return meta;
    });

    await manager.initPromise;
  };

  manager.getClientMeta = async () => {
    if (!manager.initPromise) {
      manager.initPromise = resolveClientMeta().then((meta) => {
        manager.clientMeta = meta;
        return meta;
      });
    }

    if (!manager.clientMeta) {
      manager.clientMeta = await manager.initPromise;
    }

    return manager.clientMeta;
  };
}
