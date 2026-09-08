'use client';

import { useState } from 'react';
import { useAuthCleanupStalled } from '@/lib/auth-cleanup';
import { reloadWalletSession } from '@/lib/auth-session-reload';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';

export function AuthCleanupRecovery() {
  const stalled = useAuthCleanupStalled();
  const [reloading, setReloading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!stalled) return null;
  return <Alert role="alert">
    <AlertDescription className="space-y-3">
      <p>Your wallet is taking longer to sign out. Reload the app to finish safely. Your preferences and pending transaction recovery will be kept.</p>
      {error && <p>{error}</p>}
      <Button variant="outline" disabled={reloading} onClick={() => {
        setReloading(true);
        setError(null);
        void reloadWalletSession(false).catch(() => {
          setReloading(false);
          setError('Could not reload the app. Please try again.');
        });
      }}>{reloading ? 'Reloading…' : 'Reload app safely'}</Button>
    </AlertDescription>
  </Alert>;
}
