"use client";

import { createConfig } from "wagmi";
import { base } from "viem/chains";
import { createResilientTransport, getPrimaryRpcEndpoint } from "./rpc-transport";
import { baseAccountConnector } from "./base-account-connector";
import { getDataSuffix } from "./builder-code";

const connectors = [
  // Prefer Base Account SDK for dedicated Base sign-in flows
  baseAccountConnector({ displayName: "Sign in with Base" }),
];

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

export const wagmiWebOnchainkitConfig = createConfig({
  chains: [baseWithRpc],
  transports: {
    [base.id]: baseTransport,
  },
  ...(dataSuffix ? { dataSuffix } : {}),
  connectors,
  // Reduce wagmi polling frequency (5 minutes) - ranking handles health checks
  pollingInterval: 300_000,
  ssr: true,
});
