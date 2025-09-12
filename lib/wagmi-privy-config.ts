"use client";

import { createConfig } from "@privy-io/wagmi";
import { http } from "wagmi";
import { injected, coinbaseWallet } from "wagmi/connectors";
import { base } from "viem/chains";

// We keep transports simple to avoid large diffs. Your app already uses
// robust viem fallback transports for onchain calls where it matters.
// Here, wagmi is primarily for account state and basic RPCs.
const connectors = [
  // Enable external EOAs and Coinbase Wallet popup under a single wagmi context (used by OnchainKit)
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


