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
import { useMemo, useEffect } from "react";
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

// Debug flag - set window.__PRIVY_DEBUG__ = true in console to enable
const DEBUG = typeof window !== 'undefined' && (window as any).__PRIVY_DEBUG__;

export function usePrivyEmbeddedWallet(): PrivyWalletInfo {
    const { ready, authenticated, user } = usePrivy();
    const { wallets } = useWallets();
    const { address: wagmiAddress, connector } = useAccount();

    // Debug logging
    useEffect(() => {
        if (!DEBUG && process.env.NODE_ENV !== 'development') return;

        console.log('[usePrivyEmbeddedWallet] State:', {
            ready,
            authenticated,
            hasUser: !!user,
            walletsCount: wallets?.length || 0,
            wallets: wallets?.map(w => ({
                address: w.address,
                walletClientType: w.walletClientType,
                connectorType: w.connectorType,
            })),
            wagmiAddress,
            connectorId: connector?.id,
            connectorName: connector?.name,
        });
    }, [ready, authenticated, user, wallets, wagmiAddress, connector]);

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
        // Privy uses 'privy' as walletClientType for embedded wallets
        // Also check for 'embedded' in case of different versions
        const embeddedWallet = wallets.find(
            (w) => w.walletClientType === 'privy' ||
                w.walletClientType === 'embedded' ||
                // Cross-app wallets might also have this issue
                w.connectorType === 'embedded'
        );

        // Check if current wagmi address matches an embedded wallet
        const isCurrentWalletEmbedded = embeddedWallet &&
            wagmiAddress?.toLowerCase() === embeddedWallet.address?.toLowerCase();

        // Check if connected via Privy connector (includes external wallets)
        const isPrivyConnector = connector?.id?.includes('privy') ||
            connector?.name?.toLowerCase().includes('privy');

        // Also check if the user logged in with email/social (which means embedded wallet)
        const hasEmailLogin = user?.email?.address;
        const hasSocialLogin = user?.google || user?.twitter || user?.discord || user?.farcaster || user?.apple;
        const isLikelyEmbedded = !!(hasEmailLogin || hasSocialLogin);

        // Final check: if we have an embedded wallet OR user logged in via email/social,
        // and the wagmi address matches any Privy wallet, treat as embedded
        const matchingPrivyWallet = wallets.find(
            (w) => wagmiAddress?.toLowerCase() === w.address?.toLowerCase()
        );

        const isEmbedded = !!(isCurrentWalletEmbedded ||
            (isLikelyEmbedded && matchingPrivyWallet));

        if (DEBUG || process.env.NODE_ENV === 'development') {
            console.log('[usePrivyEmbeddedWallet] Detection result:', {
                embeddedWallet: embeddedWallet?.address,
                isCurrentWalletEmbedded,
                isPrivyConnector,
                hasEmailLogin: !!hasEmailLogin,
                hasSocialLogin: !!hasSocialLogin,
                isLikelyEmbedded,
                matchingPrivyWallet: matchingPrivyWallet?.address,
                finalIsEmbedded: isEmbedded,
            });
        }

        return {
            isPrivyWallet: !!(isPrivyConnector || embeddedWallet || matchingPrivyWallet),
            isEmbeddedWallet: isEmbedded,
            isExternalWallet: !!(isPrivyConnector && !isEmbedded),
            embeddedWallet: isEmbedded ? (embeddedWallet || matchingPrivyWallet) : null,
            isReady: true,
        };
    }, [ready, authenticated, user, wallets, wagmiAddress, connector]);
}
