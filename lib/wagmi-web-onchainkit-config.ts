"use client";

import { createConfig } from "wagmi";
import { coinbaseWallet } from "wagmi/connectors";
import { base } from "viem/chains";
import { createResilientTransport } from "./rpc-transport";

const connectors = [
  // Follow OnchainKit guide: prefer Coinbase Wallet connector for ConnectWallet
  coinbaseWallet({ appName: "Pixotchi Mini" }),
];

const transport = createResilientTransport();

export const wagmiWebOnchainkitConfig = createConfig({
  chains: [base],
  transports: {
    [base.id]: transport,
  },
  connectors,
  pollingInterval: 500, // Faster polling to match Base block times (~2s)
  ssr: true,
});


