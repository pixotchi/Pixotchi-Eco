'use client';

import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardHeader } from '@/components/ui/card';

export function AdminAccessGate({ adminKey, setAdminKey, onAuthenticated }: {
  adminKey: string;
  setAdminKey: (value: string) => void;
  onAuthenticated: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  async function authenticate() {
    if (inFlight.current || !adminKey.trim()) return;
    inFlight.current = true;
    setPending(true);
    setError(null);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch('/api/admin/auth', { headers: { Authorization: `Bearer ${adminKey}` }, signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 429
        ? 'Too many attempts. Please try again in 15 minutes.'
        : response.status === 401 ? 'The admin key was not accepted. Please check it and retry.' : 'Authentication failed. Please retry.');
      onAuthenticated();
    } catch (cause) {
      setError(controller.signal.aborted ? 'The request timed out. Please retry.' : cause instanceof Error ? cause.message : 'Could not sign in. Please retry.');
    } finally { window.clearTimeout(timer); inFlight.current = false; setPending(false); }
  }
  return <main className="flex min-h-dvh items-center justify-center bg-background p-4">
    <Card className="my-auto w-full max-w-md">
      <CardHeader><h1 className="text-xl font-semibold">Admin Access Required</h1><p className="text-sm text-muted-foreground">Enter your admin key to access the dashboard.</p></CardHeader>
      <CardContent><form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void authenticate(); }} aria-busy={pending}>
        <div className="space-y-2"><label htmlFor="admin-key" className="text-sm font-medium">Admin key</label>
          <Input id="admin-key" type={showKey ? 'text' : 'password'} value={adminKey} onChange={(event) => setAdminKey(event.target.value)} required disabled={pending} autoComplete="off" aria-invalid={Boolean(error)} aria-describedby={error ? 'admin-auth-error' : undefined} />
          <Button type="button" variant="ghost" aria-pressed={showKey} onClick={() => setShowKey((value) => !value)}>{showKey ? 'Hide admin key' : 'Show admin key'}</Button>
        </div>
        {error && <p id="admin-auth-error" className="text-sm text-destructive" role="alert">{error}</p>}
        <Button type="submit" className="w-full" disabled={pending || !adminKey.trim()}>{pending ? 'Authenticating...' : 'Access Dashboard'}</Button>
      </form></CardContent>
    </Card>
  </main>;
}
