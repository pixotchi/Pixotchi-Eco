import { isSolanaEnabled } from '@/lib/solana-constants';
import type { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';

export function getPrivySolanaConnectors(): ReturnType<typeof toSolanaWalletConnectors> | undefined {
  if (!isSolanaEnabled()) return undefined;

  try {
    const privySolana: typeof import('@privy-io/react-auth/solana') = require('@privy-io/react-auth/solana');
    if (privySolana?.toSolanaWalletConnectors) {
      return privySolana.toSolanaWalletConnectors({
        shouldAutoConnect: true,
      });
    }
  } catch (error) {
    console.warn('[SolanaAuth] Failed to load Solana connectors:', error);
  }

  return undefined;
}

export function hasUsableSolanaConnectors(connectors: unknown): boolean {
  if (!connectors) return false;
  const connectorList: unknown = typeof connectors === 'object' && 'get' in connectors && typeof connectors.get === 'function'
    ? connectors.get()
    : connectors;

  if (!Array.isArray(connectorList) || connectorList.length === 0) {
    return false;
  }

  return connectorList.some((connector: unknown) => {
    if (!connector || typeof connector !== 'object') return false;
    if ('wallets' in connector && Array.isArray(connector.wallets)) {
      return connector.wallets.length > 0;
    }
    return ('walletClientType' in connector && typeof connector.walletClientType === 'string')
      || ('connectorType' in connector && typeof connector.connectorType === 'string');
  });
}

export function isSolanaAuthAvailable(): boolean {
  return hasUsableSolanaConnectors(getPrivySolanaConnectors());
}

