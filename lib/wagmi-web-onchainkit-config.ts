"use client";

import { createConfig } from "wagmi";
import { base } from "viem/chains";
import { createResilientTransport, getPrimaryRpcEndpoint } from "./rpc-transport";
import { baseAccountConnector } from "./base-account-connector";

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

export const wagmiWebOnchainkitConfig = createConfig({
  chains: [baseWithRpc],
  transports: {
    [base.id]: baseTransport,
  },
  connectors,
  // Reduce wagmi polling frequency (5 minutes) - ranking handles health checks
  pollingInterval: 300_000,
  ssr: true,
});
