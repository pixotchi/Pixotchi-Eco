'use client';

import { useEffect, useMemo } from 'react';
import { usePrivy } from '@privy-io/react-auth';
import { useWallets as useSolanaWallets } from '@privy-io/react-auth/solana';
import { isSolanaEnabled } from '@/lib/solana-constants';

export type PrivySolanaWalletIdentity = {
  isConnected: boolean;
  solanaAddress: string | null;
};

const EMPTY_IDENTITY: PrivySolanaWalletIdentity = {
  isConnected: false,
  solanaAddress: null,
};

/**
 * Reads Privy's Solana-specific hooks only after the persisted auth surface
 * selects `privysolana`. Keeping this in its own client module prevents those
 * hooks and their wallet-standard dependencies from entering every shell.
 */
export default function PrivySolanaWalletIdentity({
  onIdentityChange,
}: {
  onIdentityChange: (identity: PrivySolanaWalletIdentity) => void;
}) {
  const { user, authenticated } = usePrivy();
  const { ready: solanaWalletsReady, wallets: solanaWallets } = useSolanaWallets();

  const connectedSolanaWallet = useMemo(() => {
    if (!authenticated || !solanaWalletsReady) return null;
    return solanaWallets[0] ?? null;
  }, [authenticated, solanaWallets, solanaWalletsReady]);

  // Keep the linked identity available while Privy restores (or has not
  // restored) the connected wallet object. A linked account is identity only;
  // it is not transaction-ready until the connected-wallet hook exposes one.
  const linkedSolanaWallet = useMemo(() => {
    if (!authenticated || !user?.linkedAccounts) return null;

    return user.linkedAccounts.find((account) =>
      account.type === 'wallet' &&
      'chainType' in account &&
      (account as UntypedValue).chainType === 'solana',
    ) ?? null;
  }, [authenticated, user]);

  const solanaWallet = connectedSolanaWallet ?? linkedSolanaWallet;
  const solanaAddress = useMemo(() => {
    const address = solanaWallet && typeof solanaWallet === 'object'
      ? (solanaWallet as { address?: unknown }).address
      : null;
    return typeof address === 'string' ? address : null;
  }, [solanaWallet]);
  const isConnected = Boolean(
    authenticated &&
    solanaWalletsReady &&
    connectedSolanaWallet &&
    solanaAddress &&
    isSolanaEnabled(),
  );

  useEffect(() => {
    onIdentityChange({ isConnected, solanaAddress });
    return () => onIdentityChange(EMPTY_IDENTITY);
  }, [isConnected, onIdentityChange, solanaAddress]);

  return null;
}
