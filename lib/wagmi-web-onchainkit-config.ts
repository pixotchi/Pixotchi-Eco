"use client";

import { createConfig } from "wagmi";
import { base } from "viem/chains";
import { createResilientTransport } from "./rpc-transport";
import { baseAccountConnector } from "./base-account-connector";

const connectors = [
  // Prefer Base Account SDK for dedicated Base sign-in flows
  baseAccountConnector({ displayName: "Sign in with Base" }),
];

// Base chain transport with fallbacks from env config
const baseTransport = createResilientTransport();

export const wagmiWebOnchainkitConfig = createConfig({
  chains: [base],
  transports: {
    [base.id]: baseTransport,
  },
  connectors,
  pollingInterval: 500, // Faster polling to match Base block times (~2s)
  ssr: true,
});


