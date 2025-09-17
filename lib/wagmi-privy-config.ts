"use client";

import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { injected, coinbaseWallet } from "wagmi/connectors";
import { base } from "viem/chains";

// Expose external EOAs and Coinbase Wallet popup under Privy wagmi so the blue button always sees a connector
const connectors = [
  coinbaseWallet({ appName: "Pixotchi Mini" }),
  injected(),
];

export const wagmiPrivyConfig = createConfig({
  chains: [base],
  transports: {
    [base.id]: http(),
  },
  // Expose common external connectors so OnchainKit ConnectWallet can attach in web mode
  connectors,
  ssr: true,
});


