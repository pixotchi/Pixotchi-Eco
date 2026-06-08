import { isSolanaEnabled } from '@/lib/solana-constants';

export function getPrivySolanaConnectors(): UntypedValue | undefined {
  if (!isSolanaEnabled()) return undefined;

  try {
    const privySolana = require('@privy-io/react-auth/solana');
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

export function hasUsableSolanaConnectors(connectors: UntypedValue): boolean {
  if (!connectors) return false;
  const connectorList = typeof connectors.get === 'function'
    ? connectors.get()
    : connectors;

  if (!Array.isArray(connectorList) || connectorList.length === 0) {
    return false;
  }

  return connectorList.some((connector: UntypedValue) => {
    if (!connector || typeof connector !== 'object') return false;
    if (Array.isArray(connector.wallets)) {
      return connector.wallets.length > 0;
    }
    return Boolean(connector.walletClientType || connector.connectorType);
  });
}

export function isSolanaAuthAvailable(): boolean {
  return hasUsableSolanaConnectors(getPrivySolanaConnectors());
}

