"use client";

import { createConfig } from "@privy-io/wagmi";
import { injected, coinbaseWallet } from "wagmi/connectors";
import { base } from "viem/chains";
import { createResilientTransport } from "./rpc-transport";

// Expose external EOAs and Coinbase Wallet popup under Privy wagmi so the blue button always sees a connector
const connectors = [
  coinbaseWallet({ appName: "Pixotchi Mini" }),
  injected(),
];

const transport = createResilientTransport();

export const wagmiPrivyConfig = createConfig({
  chains: [base],
  transports: {
    [base.id]: transport,
  },
  // Expose common external connectors so OnchainKit ConnectWallet can attach in web mode
  connectors,
  pollingInterval: 500, // Faster polling to match Base block times (~2s)
  ssr: true,
});


