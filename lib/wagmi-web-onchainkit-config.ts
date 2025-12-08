"use client";

import { createConfig } from "wagmi";
import { base } from "viem/chains";
import { createPublicHealthTransport, getPublicHealthRpc } from "./rpc-transport";
import { baseAccountConnector } from "./base-account-connector";

const connectors = [
  // Prefer Base Account SDK for dedicated Base sign-in flows
  baseAccountConnector({ displayName: "Sign in with Base" }),
];

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

export const wagmiWebOnchainkitConfig = createConfig({
  chains: [baseWithHealth],
  transports: {
    [base.id]: baseTransport,
  },
  connectors,
  // Reduce health/polling frequency (5 minutes)
  pollingInterval: 300_000,
  ssr: true,
});


