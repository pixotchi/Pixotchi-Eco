'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { BaseAccountSurfaceButton, SolanaSurfaceButton } from '@/components/auth/surface-switch-buttons';
import type { AuthControllerState, AuthSurface } from '@/lib/auth-surface';
import { isSolanaAuthAvailable } from '@/lib/solana-auth-availability';
import { isAuthCleanupPending, useAuthCleanupPending } from '@/lib/auth-cleanup';
import { AuthCleanupRecovery } from '@/components/auth/auth-cleanup-recovery';

export function LoginAuthActions({ className, handleMiniAppReconnect, isInMiniApp, state, isWalletPending,
  isRestoringBaseSession, localTestAuthAvailable, privyReady, switchAuthSurface }: {
  className: string;
  handleMiniAppReconnect: () => Promise<void>;
  isInMiniApp: boolean;
  state: AuthControllerState;
  isWalletPending: boolean;
  isRestoringBaseSession: boolean;
  localTestAuthAvailable: boolean;
  privyReady: boolean;
  switchAuthSurface: (surface: AuthSurface) => Promise<void>;
}) {
  const [switching, setSwitching] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const cleanupPending = useAuthCleanupPending();
  const error = localError ?? state.errorState;
  const busy = cleanupPending || switching || state.isMiniConnectRetrying || isWalletPending || isRestoringBaseSession
    || state.baseAuthStatus !== 'idle' || state.secureSessionState === 'booting';
  const message = cleanupPending ? 'Finishing sign-out...' : isRestoringBaseSession ? 'Restoring your Base session...'
    : state.secureSessionState === 'booting' || state.baseAuthStatus === 'authenticating' ? 'Confirm sign-in in your wallet...'
      : busy ? 'Connecting your wallet...' : isInMiniApp ? 'Connect your wallet to play.' : 'Choose how to sign in.';
  const switchSurface = async (surface: AuthSurface) => {
    if (inFlight.current || isAuthCleanupPending()) return;
    inFlight.current = true;
    setSwitching(true);
    setLocalError(null);
    try { await switchAuthSurface(surface); }
    catch (cause) { setLocalError(cause instanceof Error ? cause.message : 'Sign-in failed. Please try again.'); }
    finally { inFlight.current = false; setSwitching(false); }
  };

  return <div className={className} aria-busy={busy}>
    {error && <Alert variant="destructive" role="alert"><AlertDescription>{error}</AlertDescription></Alert>}
    <p className="text-center text-sm text-muted-foreground" role="status">{message}</p>
    <AuthCleanupRecovery />
    <fieldset disabled={busy} className="min-w-0 space-y-3">
      <legend className="sr-only">Sign-in options</legend>
      {isInMiniApp ? <Button variant="outline" className="w-full" onClick={() => { if (!isAuthCleanupPending()) void handleMiniAppReconnect(); }}>
        {busy ? 'Connecting...' : error ? 'Retry connection' : 'Connect wallet'}
      </Button> : <>
        <Button className="w-full text-base" variant="special" disabled={!privyReady} onClick={() => void switchSurface('privy')}>
          {privyReady ? error ? 'Try wallet or email again' : 'Continue with wallet or email' : 'Preparing sign-in...'}
        </Button>
        <p className="text-center text-xs text-muted-foreground">Wallet and email sign-in provided by Privy.</p>
        <BaseAccountSurfaceButton onSwitchSurface={switchSurface} />
        {isSolanaAuthAvailable() && <SolanaSurfaceButton onSwitchSurface={switchSurface} />}
        {localTestAuthAvailable && <Button className="w-full" variant="outline" onClick={() => void switchSurface('test')}>Local Test Wallet</Button>}
      </>}
    </fieldset>
  </div>;
}
