"use client";

import { createConfig } from "wagmi";
import { base } from "viem/chains";
import { farcasterMiniApp as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";
import { createResilientTransport, getPrimaryRpcEndpoint } from "./rpc-transport";

// Wagmi config for Farcaster Mini App context using official Farcaster connector

const primaryRpc = getPrimaryRpcEndpoint();
const baseWithRpc = {
  ...base,
  rpcUrls: {
    default: { http: [primaryRpc] },
    public: { http: [primaryRpc] },
  },
};

// Use resilient fallback transport for full failover support
const baseTransport = createResilientTransport();

export const wagmiMiniAppConfig = createConfig({
  chains: [baseWithRpc],
  connectors: [miniAppConnector()],
  transports: {
    [base.id]: baseTransport,
  },
  // Reduce wagmi polling frequency (5 minutes) - ranking handles health checks
  pollingInterval: 300_000,
  ssr: true,
});
