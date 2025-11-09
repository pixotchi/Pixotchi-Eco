"use client";

import { createConfig, http } from "wagmi";
import { coinbaseWallet } from "wagmi/connectors";
import { base } from "viem/chains";
import { getRpcConfig } from "./env-config";

const connectors = [
  // Follow OnchainKit guide: prefer Coinbase Wallet connector for ConnectWallet
  coinbaseWallet({ appName: "Pixotchi Mini" }),
];

const rpcConfig = getRpcConfig();
const primaryRpcEndpoint = rpcConfig.endpoints[0] || 'https://mainnet.base.org';

export const wagmiWebOnchainkitConfig = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(primaryRpcEndpoint),
  },
  connectors,
  pollingInterval: 500, // Faster polling to match Base block times (~2s)
  ssr: true,
});


