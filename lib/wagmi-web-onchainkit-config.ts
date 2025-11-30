"use client";

import { createConfig } from "wagmi";
import { base, mainnet } from "viem/chains";
import { createResilientTransport, createMainnetResilientTransport } from "./rpc-transport";
import { baseAccountConnector } from "./base-account-connector";

const connectors = [
  // Prefer Base Account SDK for dedicated Base sign-in flows
  baseAccountConnector({ displayName: "Sign in with Base" }),
];

// Base chain transport with fallbacks from env config
const baseTransport = createResilientTransport();

// Mainnet transport for ENS/Basename resolution (CCIP-Read requires mainnet calls)
// Uses the same resilient fallback system as Base RPC
const mainnetTransport = createMainnetResilientTransport();

export const wagmiWebOnchainkitConfig = createConfig({
  chains: [base, mainnet],
  transports: {
    [base.id]: baseTransport,
    [mainnet.id]: mainnetTransport,
  },
  connectors,
  pollingInterval: 500, // Faster polling to match Base block times (~2s)
  ssr: true,
});


