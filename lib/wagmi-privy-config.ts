"use client";

import { createConfig } from "@privy-io/wagmi";
import { injected } from "wagmi/connectors";
import { base, mainnet } from "viem/chains";
import { createResilientTransport, createMainnetResilientTransport } from "./rpc-transport";
import { baseAccountConnector } from "./base-account-connector";

// Expose external EOAs and Base Account under Privy wagmi so the blue button always sees a connector
const connectors = [
  baseAccountConnector({ displayName: "Sign in with Base" }),
  injected(),
];

// Base chain transport with fallbacks from env config
const baseTransport = createResilientTransport();

// Mainnet transport for ENS/Basename resolution (CCIP-Read requires mainnet calls)
// Uses the same resilient fallback system as Base RPC
const mainnetTransport = createMainnetResilientTransport();

export const wagmiPrivyConfig = createConfig({
  chains: [base, mainnet],
  transports: {
    [base.id]: baseTransport,
    [mainnet.id]: mainnetTransport,
  },
  // Expose common external connectors so OnchainKit ConnectWallet can attach in web mode
  connectors,
  pollingInterval: 500, // Faster polling to match Base block times (~2s)
  ssr: true,
});


