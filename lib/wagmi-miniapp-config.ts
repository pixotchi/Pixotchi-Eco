"use client";

import { createConfig } from "wagmi";
import { base } from "viem/chains";
import { farcasterMiniApp as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";
import { createResilientTransport, getPrimaryRpcEndpoint } from "./rpc-transport";
import { getDataSuffix } from "./builder-code";

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
const dataSuffix = getDataSuffix() as `0x${string}` | undefined;

const miniAppBaseConfig = {
  chains: [baseWithRpc],
  connectors: [miniAppConnector()],
  transports: {
    [base.id]: baseTransport,
  },
  // Reduce wagmi polling frequency (5 minutes) - ranking handles health checks
  pollingInterval: 300_000,
  ssr: true,
} as const;

// Used for non-Base App Mini App clients
export const wagmiMiniAppConfig = createConfig({
  ...miniAppBaseConfig,
  ...(dataSuffix ? { dataSuffix } : {}),
});

// Used for Base App Mini App client (Base App auto-appends Builder attribution)
export const wagmiMiniAppBaseAppConfig = createConfig({
  ...miniAppBaseConfig,
});
