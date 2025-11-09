"use client";

import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { injected, coinbaseWallet } from "wagmi/connectors";
import { base } from "viem/chains";
import { getRpcConfig } from "./env-config";

// Expose external EOAs and Coinbase Wallet popup under Privy wagmi so the blue button always sees a connector
const connectors = [
  coinbaseWallet({ appName: "Pixotchi Mini" }),
  injected(),
];

const rpcConfig = getRpcConfig();
const primaryRpcEndpoint = rpcConfig.endpoints[0] || 'https://mainnet.base.org';

export const wagmiPrivyConfig = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(primaryRpcEndpoint, {
      pollingInterval: 500, // Poll every 500ms for Base's ~2s block times (much faster than default 4s)
    }),
  },
  // Expose common external connectors so OnchainKit ConnectWallet can attach in web mode
  connectors,
  ssr: true,
});


