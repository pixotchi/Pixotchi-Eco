"use client";

import { createConfig } from "@privy-io/wagmi";
import { injected } from "wagmi/connectors";
import { base } from "viem/chains";
import { createPublicHealthTransport, getPublicHealthRpc } from "./rpc-transport";
import { getRpcConfig } from "./env-config";
import { baseAccountConnector } from "./base-account-connector";

// Expose external EOAs and Base Account under Privy wagmi so the blue button always sees a connector
const connectors = [
  baseAccountConnector({ displayName: "Sign in with Base" }),
  injected(),
];

const healthRpc = getPublicHealthRpc();
const baseWithHealth = {
  ...base,
  rpcUrls: {
    default: { http: [healthRpc] },
    public: { http: [healthRpc] },
  },
};

// Public-only transport so WalletConnect/health checks never hit custom RPCs
const baseTransport = createPublicHealthTransport();

export const wagmiPrivyConfig = createConfig({
  chains: [baseWithHealth],
  transports: {
    [base.id]: baseTransport,
  },
  // Expose common external connectors so OnchainKit ConnectWallet can attach in web mode
  connectors,
  // Match production behavior: rely on viem defaults for chain RPC list and keep modest polling
  // Standard polling interval (5 minutes) to reduce background health probes
  // Note: Transaction components now use independent, aggressive polling (via useTransactionLifecycle) for active txs
  pollingInterval: 300_000,
  ssr: true,
});


