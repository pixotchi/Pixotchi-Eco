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
 * Uses Privy's Solana wallet hook first, then falls back to linkedAccounts
 * only when the hook has settled without a connected Solana wallet object.
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
  
  // Wait until Privy has settled the connected wallet set before falling back to linked accounts.
  const solanaWallet = useMemo(() => {
    if (!isPrivySolanaSurface || !authenticated || !solanaWalletsReady) return null;

    if (solanaWallets.length > 0) {
      return solanaWallets[0];
    }

    if (!user?.linkedAccounts) {
      return null;
    }
    
    for (const account of user.linkedAccounts) {
      if (
        account.type === 'wallet' &&
        'chainType' in account &&
        (account as UntypedValue).chainType === 'solana'
      ) {
        return account;
      }
    }
    
    return null;
  }, [authenticated, isPrivySolanaSurface, solanaWallets, solanaWalletsReady, user]);
  
  // Get Solana address from the wallet
  const solanaAddress = useMemo(() => {
    if (!solanaWallet) return null;
    // The address is stored in the account object
    return (solanaWallet as UntypedValue).address || null;
  }, [solanaWallet]);
  
  // Check if connected - requires authentication, address, and Solana to be enabled
  const isConnected = useMemo(() => {
    return (
      isPrivySolanaSurface &&
      authenticated &&
      solanaWalletsReady &&
      !!solanaAddress &&
      isSolanaEnabled()
    );
  }, [authenticated, isPrivySolanaSurface, solanaAddress, solanaWalletsReady]);
  
  return (
    <SolanaWalletContextProvider
      solanaAddress={solanaAddress}
      isConnected={isConnected}
    >
      {children}
    </SolanaWalletContextProvider>
  );
}
