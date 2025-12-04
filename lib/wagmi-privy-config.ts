"use client";

import { createConfig } from "@privy-io/wagmi";
import { injected } from "wagmi/connectors";
import { base } from "viem/chains";
import { createResilientTransport } from "./rpc-transport";
import { baseAccountConnector } from "./base-account-connector";

// Expose external EOAs and Base Account under Privy wagmi so the blue button always sees a connector
const connectors = [
  baseAccountConnector({ displayName: "Sign in with Base" }),
  injected(),
];

// Base chain transport with fallbacks from env config
const baseTransport = createResilientTransport();

export const wagmiPrivyConfig = createConfig({
  chains: [base],
  transports: {
    [base.id]: baseTransport,
  },
  // Expose common external connectors so OnchainKit ConnectWallet can attach in web mode
  connectors,
  pollingInterval: 500, // Faster polling to match Base block times (~2s)
  ssr: true,
});


