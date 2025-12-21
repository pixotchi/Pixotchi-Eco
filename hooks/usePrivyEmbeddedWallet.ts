"use client";

/**
 * Hook to detect if the current wallet is a Privy embedded wallet.
 * 
 * Privy embedded wallets communicate via iframe postMessage, which cannot
 * handle non-serializable data like functions. OnchainKit's Transaction
 * component passes chain objects with formatters/serializers that contain
 * functions, causing postMessage errors.
 * 
 * This hook allows components to detect embedded wallets and use alternative
 * transaction methods.
 */

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useMemo } from "react";
import { useAccount } from "wagmi";

export interface PrivyWalletInfo {
    /** Whether the user is using any Privy wallet */
    isPrivyWallet: boolean;
    /** Whether the wallet is a Privy embedded wallet (email/social login) */
    isEmbeddedWallet: boolean;
    /** Whether the wallet is an external wallet connected via Privy */
    isExternalWallet: boolean;
    /** The embedded wallet object if available */
    embeddedWallet: any | null;
    /** Whether Privy is ready and authenticated */
    isReady: boolean;
}

export function usePrivyEmbeddedWallet(): PrivyWalletInfo {
    const { ready, authenticated, user } = usePrivy();
    const { wallets } = useWallets();
    const { address: wagmiAddress, connector } = useAccount();

    return useMemo(() => {
        // Not ready yet
        if (!ready) {
            return {
                isPrivyWallet: false,
                isEmbeddedWallet: false,
                isExternalWallet: false,
                embeddedWallet: null,
                isReady: false,
            };
        }

        // Not authenticated via Privy
        if (!authenticated || !user) {
            return {
                isPrivyWallet: false,
                isEmbeddedWallet: false,
                isExternalWallet: false,
                embeddedWallet: null,
                isReady: true,
            };
        }

        // Find embedded wallet from Privy wallets list
        const embeddedWallet = wallets.find(
            (w) => w.walletClientType === 'privy'
        );

        // Check if current wagmi address matches an embedded wallet
        const isCurrentWalletEmbedded = embeddedWallet &&
            wagmiAddress?.toLowerCase() === embeddedWallet.address?.toLowerCase();

        // Check if connected via Privy connector (includes external wallets)
        const isPrivyConnector = connector?.id?.includes('privy') ||
            connector?.name?.toLowerCase().includes('privy');

        return {
            isPrivyWallet: isPrivyConnector || !!embeddedWallet,
            isEmbeddedWallet: !!isCurrentWalletEmbedded,
            isExternalWallet: isPrivyConnector && !isCurrentWalletEmbedded,
            embeddedWallet: isCurrentWalletEmbedded ? embeddedWallet : null,
            isReady: true,
        };
    }, [ready, authenticated, user, wallets, wagmiAddress, connector]);
}
