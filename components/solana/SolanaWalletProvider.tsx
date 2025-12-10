'use client';

/**
 * Solana Wallet Provider Component
 * Wraps children with Solana wallet context integrated with Privy
 * Uses proper Privy Solana hooks for wallet detection
 */

import React, { useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { SolanaWalletProvider as SolanaWalletContextProvider } from '@/lib/solana-wallet-context';
import { isSolanaEnabled } from '@/lib/solana-constants';

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
 * Uses Privy's user.linkedAccounts to find Solana wallets since
 * the useWallets hook from @privy-io/react-auth returns EVM wallets only.
 * For Solana wallets, we check the user's linked accounts.
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
  
  // Find Solana wallet from user's linked accounts
  // Privy stores Solana wallets in linkedAccounts with chainType: 'solana'
  const solanaWallet = useMemo(() => {
    if (!authenticated || !user) return null;
    
    // Check user's linked accounts for Solana wallet
    // This is the correct way to find Solana wallets in Privy
    if (user.linkedAccounts) {
      for (const account of user.linkedAccounts) {
        // Check if this is a Solana wallet account
        if (
          account.type === 'wallet' && 
          'chainType' in account && 
          (account as any).chainType === 'solana'
        ) {
          return account;
        }
      }
    }
    
    return null;
  }, [authenticated, user]);
  
  // Get Solana address from the wallet
  const solanaAddress = useMemo(() => {
    if (!solanaWallet) return null;
    // The address is stored in the account object
    return (solanaWallet as any).address || null;
  }, [solanaWallet]);
  
  // Check if connected - requires authentication, address, and Solana to be enabled
  const isConnected = useMemo(() => {
    return authenticated && !!solanaAddress && isSolanaEnabled();
  }, [authenticated, solanaAddress]);
  
  return (
    <SolanaWalletContextProvider
      solanaAddress={solanaAddress}
      isConnected={isConnected}
    >
      {children}
    </SolanaWalletContextProvider>
  );
}

/**
 * HOC to wrap a component with Solana wallet provider
 */
export function withSolanaWallet<P extends object>(
  Component: React.ComponentType<P>
): React.FC<P> {
  return function WithSolanaWalletWrapper(props: P) {
    return (
      <SolanaWalletProvider>
        <Component {...props} />
      </SolanaWalletProvider>
    );
  };
}

export default SolanaWalletProvider;
