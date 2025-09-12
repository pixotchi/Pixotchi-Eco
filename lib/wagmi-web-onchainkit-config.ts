"use client";

import { createConfig, http } from "wagmi";
import { coinbaseWallet } from "wagmi/connectors";
import { base } from "viem/chains";

const connectors = [
  // Follow OnchainKit guide: prefer Coinbase Wallet connector for ConnectWallet
  coinbaseWallet({ appName: "Pixotchi Mini" }),
];

export const wagmiWebOnchainkitConfig = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(),
  },
  connectors,
  ssr: true,
});


