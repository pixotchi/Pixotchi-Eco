"use client";

import { createConfig } from "wagmi";
import { base, mainnet } from "viem/chains";
import { farcasterMiniApp as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";
import { createResilientTransport, createMainnetResilientTransport } from "./rpc-transport";

// Wagmi config for Farcaster Mini App context using official Farcaster connector

// Base chain transport with fallbacks from env config
const baseTransport = createResilientTransport();

// Mainnet transport for ENS/Basename resolution (CCIP-Read requires mainnet calls)
// Uses the same resilient fallback system as Base RPC
const mainnetTransport = createMainnetResilientTransport();

export const wagmiMiniAppConfig = createConfig({
  chains: [base, mainnet],
  connectors: [miniAppConnector()],
  transports: {
    [base.id]: baseTransport,
    [mainnet.id]: mainnetTransport,
  },
  pollingInterval: 500, // Faster polling to match Base block times (~2s)
  ssr: true,
});


