'use client';

/**
 * Solana Wallet Provider Component
 * Wraps children with Solana wallet context integrated with Privy
 * Uses proper Privy Solana hooks for wallet detection
 */

import React, { useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { SolanaWalletProvider as SolanaWalletContextProvider } from '@/lib/solana-wallet-context';
import { isSolanaEnabled } from '@/lib/solana-constants';
import { useAuthSurface } from '@/hooks/useAuthSurface';

// ============ Types ============

interface SolanaProviderProps {
  children: React.ReactNode;
}

// ============ Component ============

/**
 * Solana Wallet Provider
 * 
 * Wraps your app with Solana wallet context, automatically detecting
 * Solana wallets from Privy and resolving Twin addresses.
 * 
 * Uses Privy's Solana wallet hook first, then falls back to linkedAccounts for
 * the persisted identity used by profile/resource reads. A linked account is
 * not transaction-ready until Privy's connected-wallet hook exposes a wallet.
 * 
 * @example
 * ```tsx
 * // In your layout or _app.tsx
 * export default function App({ children }) {
 *   return (
 *     <PrivyProvider>
 *       <SolanaWalletProvider>
 *         {children}
 *       </SolanaWalletProvider>
 *     </PrivyProvider>
 *   );
 * }
 * ```
 */
export function SolanaWalletProvider({ children }: SolanaProviderProps) {
  const { user, authenticated } = usePrivy();
  const { ready: solanaWalletsReady, wallets: solanaWallets } = useSolanaWallets();
  const { surface: authSurface } = useAuthSurface();
  const isPrivySolanaSurface = authSurface === 'privysolana';
  
  const connectedSolanaWallet = useMemo(() => {
    if (!isPrivySolanaSurface || !authenticated || !solanaWalletsReady) return null;
    return solanaWallets[0] ?? null;
  }, [authenticated, isPrivySolanaSurface, solanaWallets, solanaWalletsReady]);

  // Keep the linked identity available while Privy restores (or has not
  // restored) the connected wallet object. This lets Twin/profile reads load
  // without treating the linked account as a signer.
  const linkedSolanaWallet = useMemo(() => {
    if (!isPrivySolanaSurface || !authenticated || !user?.linkedAccounts) return null;

    return user.linkedAccounts.find((account) =>
      account.type === 'wallet' &&
      'chainType' in account &&
      (account as UntypedValue).chainType === 'solana'
    ) ?? null;
  }, [authenticated, isPrivySolanaSurface, user]);

  const solanaWallet = connectedSolanaWallet ?? linkedSolanaWallet;
  
  // Get Solana address from the wallet
  const solanaAddress = useMemo(() => {
    if (!solanaWallet) return null;
    // The address is stored in the account object
    return (solanaWallet as UntypedValue).address || null;
  }, [solanaWallet]);
  
  // A linked account supplies identity only. Signatures require a wallet from
  // Privy's connected-wallet hook as well.
  const isConnected = useMemo(() => {
    return (
      isPrivySolanaSurface &&
      authenticated &&
      solanaWalletsReady &&
      !!connectedSolanaWallet &&
      !!solanaAddress &&
      isSolanaEnabled()
    );
  }, [authenticated, connectedSolanaWallet, isPrivySolanaSurface, solanaAddress, solanaWalletsReady]);
  
  return (
    <SolanaWalletContextProvider
      solanaAddress={solanaAddress}
      isConnected={isConnected}
    >
      {children}
    </SolanaWalletContextProvider>
  );
}
