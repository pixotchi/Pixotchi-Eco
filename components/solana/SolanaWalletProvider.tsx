'use client';

/**
 * Solana Wallet Provider Component
 * Wraps children with Solana wallet context integrated with Privy
 * Uses proper Privy Solana hooks for wallet detection
 */

import React, { useCallback, useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { SolanaWalletProvider as SolanaWalletContextProvider } from '@/lib/solana-wallet-context';
import { useAuthSurface } from '@/hooks/useAuthSurface';
import type { PrivySolanaWalletIdentity } from './PrivySolanaWalletIdentity';

// ============ Types ============

interface SolanaProviderProps {
  children: React.ReactNode;
}

const PrivySolanaWalletIdentity = dynamic(
  () => import('./PrivySolanaWalletIdentity'),
  { ssr: false },
);

const EMPTY_IDENTITY: PrivySolanaWalletIdentity = {
  isConnected: false,
  solanaAddress: null,
};

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
  const { resolved, surface } = useAuthSurface();
  const [identity, setIdentity] = useState<PrivySolanaWalletIdentity>(EMPTY_IDENTITY);
  const isPrivySolanaSurface = resolved && surface === 'privysolana';
  const setPrivyIdentity = useCallback((nextIdentity: PrivySolanaWalletIdentity) => {
    setIdentity((previousIdentity) => (
      previousIdentity.isConnected === nextIdentity.isConnected &&
      previousIdentity.solanaAddress === nextIdentity.solanaAddress
        ? previousIdentity
        : nextIdentity
    ));
  }, []);

  useEffect(() => {
    if (!isPrivySolanaSurface) setPrivyIdentity(EMPTY_IDENTITY);
  }, [isPrivySolanaSurface, setPrivyIdentity]);

  return (
    <SolanaWalletContextProvider
      solanaAddress={identity.solanaAddress}
      isConnected={identity.isConnected}
    >
      {isPrivySolanaSurface ? (
        <PrivySolanaWalletIdentity onIdentityChange={setPrivyIdentity} />
      ) : null}
      {children}
    </SolanaWalletContextProvider>
  );
}
