"use client";

import { createConfig, http } from "wagmi";
import { base } from "viem/chains";
import { SafeConnector } from "@safe-global/safe-apps-wagmi";
import { getRpcConfig } from "./env-config";

const rpcConfig = getRpcConfig();
const primaryRpcEndpoint = rpcConfig.endpoints[0] || "https://mainnet.base.org";

export const safeConnector = new SafeConnector({
  chains: [base],
  options: {
    debug: false,
  },
});

export const wagmiSafeConfig = createConfig({
  chains: [base],
  connectors: [safeConnector],
  transports: {
    [base.id]: http(primaryRpcEndpoint),
  },
  pollingInterval: 500,
  ssr: true,
});


