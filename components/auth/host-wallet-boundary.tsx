'use client';

import { type ComponentProps, useEffect, useRef } from 'react';
import { HostEnvironmentProvider, type HostEnvironmentState, useHostEnvironment } from '@/lib/host-environment';
import { SolanaBootstrapGate } from './solana-bootstrap-gate';

// Ready is sent outside the lazy wallet-config boundary, so a failed wallet
// chunk cannot leave a Mini App host's splash screen up indefinitely. The SDK
// action is fire-and-forget from the host's perspective; this only bounds how
// long we retain the local attempt before reporting an unavailable bridge.
const MINI_APP_READY_TIMEOUT_MS = 2_500;
function useMiniAppReadySignal(hostEnvironment: HostEnvironmentState) {
  const readyStateRef = useRef<'idle' | 'pending' | 'settled'>('idle');

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      !hostEnvironment.initialized ||
      !hostEnvironment.isMiniApp ||
      readyStateRef.current !== 'idle'
    ) {
      return;
    }

    // Mark pending synchronously: React Strict Mode can re-run this effect
    // before an asynchronous SDK action settles.
    readyStateRef.current = 'pending';

    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    const readyAttempt = import('@farcaster/miniapp-sdk').then(({ sdk }) => sdk.actions.ready());
    const readinessDeadline = new Promise<'timed_out'>((resolve) => {
      timeoutId = setTimeout(() => resolve('timed_out'), MINI_APP_READY_TIMEOUT_MS);
    });

    void Promise.race([readyAttempt, readinessDeadline])
      .then((outcome) => {
        if (outcome === 'timed_out') {
          console.warn(
            `[Providers] sdk.actions.ready() did not settle within ${MINI_APP_READY_TIMEOUT_MS}ms; continuing without another ready attempt.`,
          );
        }
      })
      .catch((error) => {
        console.warn('[Providers] Failed to signal sdk.actions.ready():', error);
      })
      .finally(() => {
        if (timeoutId !== undefined) clearTimeout(timeoutId);
        readyStateRef.current = 'settled';
      });
  }, [
    hostEnvironment.initialized,
    hostEnvironment.isMiniApp,
  ]);
}

function MiniAppReadySignal() {
  useMiniAppReadySignal(useHostEnvironment());
  return null;
}

type HostWalletBoundaryProps = ComponentProps<typeof SolanaBootstrapGate>;

function HostAwareWalletGate(props: HostWalletBoundaryProps) {
  const host = useHostEnvironment();
  // A persisted web-wallet choice must not replace the host's Mini App connector.
  return <SolanaBootstrapGate {...props} state={host.isMiniApp ? 'ready' : props.state} />;
}

/** Host discovery and splash dismissal must survive every wallet capability failure. */
export function HostWalletBoundary(props: HostWalletBoundaryProps) {
  return <HostEnvironmentProvider>
    <MiniAppReadySignal />
    <HostAwareWalletGate {...props} />
  </HostEnvironmentProvider>;
}
