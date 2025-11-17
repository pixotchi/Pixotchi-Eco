"use client";

import { createConfig } from "wagmi";
import { base } from "viem/chains";
import { farcasterMiniApp as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";
import { createResilientTransport } from "./rpc-transport";

// Wagmi config for Farcaster Mini App context using official Farcaster connector
const transport = createResilientTransport();

export const wagmiMiniAppConfig = createConfig({
  chains: [base],
  connectors: [miniAppConnector()],
  transports: {
    [base.id]: transport,
  },
  pollingInterval: 500, // Faster polling to match Base block times (~2s)
  ssr: true,
});


