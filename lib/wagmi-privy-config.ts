"use client";

import { createConfig } from "@privy-io/wagmi";
import { injected } from "wagmi/connectors";
import { base } from "viem/chains";
import { createResilientTransport, getPrimaryRpcEndpoint } from "./rpc-transport";
import { getRpcConfig } from "./env-config";
import { baseAccountConnector } from "./base-account-connector";
import { getDataSuffix } from "./builder-code";

// Expose external EOAs and Base Account under Privy wagmi so the blue button always sees a connector
const connectors = [
  baseAccountConnector({ displayName: "Sign in with Base" }),
  injected(),
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

export const wagmiPrivyConfig = createConfig({
  chains: [baseWithRpc],
  transports: {
    [base.id]: baseTransport,
  },
  ...(dataSuffix ? { dataSuffix } : {}),
  // Expose common external connectors so OnchainKit ConnectWallet can attach in web mode
  connectors,
  // Match production behavior: rely on viem defaults for chain RPC list and keep modest polling
  // Reduce wagmi polling frequency (5 minutes) - ranking handles health checks
  pollingInterval: 300_000,
  ssr: true,
});
