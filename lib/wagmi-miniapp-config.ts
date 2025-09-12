"use client";

import { createConfig, http } from "wagmi";
import { base } from "viem/chains";
import { farcasterMiniApp as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";

// Wagmi config for Farcaster Mini App context using official Farcaster connector
export const wagmiMiniAppConfig = createConfig({
  chains: [base],
  connectors: [miniAppConnector()],
  transports: {
    [base.id]: http(),
  },
  ssr: true,
});


