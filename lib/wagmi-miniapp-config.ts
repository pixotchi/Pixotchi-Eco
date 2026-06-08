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
  // Keep wallet-driven receipt waits responsive without aggressive polling.
  pollingInterval: 2_500,
  ssr: true,
} as const;

export const wagmiMiniAppConfig = createConfig({
  ...miniAppBaseConfig,
  ...(dataSuffix ? { dataSuffix } : {}),
});
