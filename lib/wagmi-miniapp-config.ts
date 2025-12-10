"use client";

import { createConfig } from "wagmi";
import { base } from "viem/chains";
import { farcasterMiniApp as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";
import { createPublicHealthTransport, getPublicHealthRpc } from "./rpc-transport";

// Wagmi config for Farcaster Mini App context using official Farcaster connector

const healthRpc = getPublicHealthRpc();
const baseWithHealth = {
  ...base,
  rpcUrls: {
    default: { http: [healthRpc] },
    public: { http: [healthRpc] },
  },
};

// Public-only transport so health checks stay off custom RPCs
const baseTransport = createPublicHealthTransport();

export const wagmiMiniAppConfig = createConfig({
  chains: [baseWithHealth],
  connectors: [miniAppConnector()],
  transports: {
    [base.id]: baseTransport,
  },
  // Reduce health/polling frequency (5 minutes)
  pollingInterval: 300_000,
  ssr: true,
});


