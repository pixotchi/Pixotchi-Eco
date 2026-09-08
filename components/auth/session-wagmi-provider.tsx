'use client';

import { type ComponentType, type PropsWithChildren, useEffect, useRef } from 'react';
import { WagmiProvider, type WagmiProviderProps, useConnections, useDisconnect } from 'wagmi';
import { beginAuthCleanup, isWalletReconnectAllowed, useAuthCleanupPending, useWalletReconnectAllowed } from '@/lib/auth-cleanup';

/** An SDK connect that was already pending may settle after sign-out. */
function SignedOutWalletGuard() {
  const connections = useConnections();
  const { disconnectAsync } = useDisconnect();
  const cleanupPending = useAuthCleanupPending();
  const reconnectAllowed = useWalletReconnectAllowed();
  const attemptedConnections = useRef(new WeakSet<object>());
  useEffect(() => {
    if (reconnectAllowed) {
      attemptedConnections.current = new WeakSet();
      return;
    }
    if (cleanupPending) return;
    // Wagmi reconnect can populate this inventory after its visible account
    // status has already become disconnected. Retire those hidden connections
    // too, otherwise the next explicit connect may report Already Connected.
    const connection = connections.find(candidate => !attemptedConnections.current.has(candidate));
    if (!connection) return;
    const finish = beginAuthCleanup();
    if (!finish) return;
    attemptedConnections.current.add(connection);
    // Capture this connector so a late SDK completion is retired by its owner.
    // A rejected connector is attempted once; the next explicit sign-in can
    // retry cleanup instead of entering an automatic disconnect loop.
    void disconnectAsync({ connector: connection.connector })
      .catch(error => console.warn('Failed to retire a wallet connection that completed after sign-out:', error))
      .finally(finish);
  }, [cleanupPending, connections, disconnectAsync, reconnectAllowed]);
  return null;
}

/** Both wallet providers share the same explicit sign-out/remount policy. */
export function SessionWagmiProvider({ provider: Provider = WagmiProvider, children, ...props }: PropsWithChildren<Omit<WagmiProviderProps, 'reconnectOnMount'> & {
  provider?: ComponentType<PropsWithChildren<WagmiProviderProps>>;
}>) {
  const reconnectAllowed = useWalletReconnectAllowed();
  // The synchronous snapshot also honors a recovery URL on the first client
  // hydration render, before useSyncExternalStore leaves its server snapshot.
  return <Provider {...props} reconnectOnMount={reconnectAllowed && isWalletReconnectAllowed()}>
    <SignedOutWalletGuard />
    {children}
  </Provider>;
}
