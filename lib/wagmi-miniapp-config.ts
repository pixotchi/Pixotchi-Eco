"use client";

import { createConfig, http } from "wagmi";
import { base } from "viem/chains";
import { farcasterMiniApp as miniAppConnector } from "@farcaster/miniapp-wagmi-connector";
import { getRpcConfig } from "./env-config";

// Wagmi config for Farcaster Mini App context using official Farcaster connector
const rpcConfig = getRpcConfig();
const primaryRpcEndpoint = rpcConfig.endpoints[0] || 'https://mainnet.base.org';

export const wagmiMiniAppConfig = createConfig({
  chains: [base],
  connectors: [miniAppConnector()],
  transports: {
    [base.id]: http(primaryRpcEndpoint),
  },
  pollingInterval: 500, // Faster polling to match Base block times (~2s)
  ssr: true,
});


