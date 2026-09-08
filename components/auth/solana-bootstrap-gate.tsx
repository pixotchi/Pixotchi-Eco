'use client';

import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

export function SolanaBootstrapGate({ state, onRetry, onUseEthereum, children }: {
  state: 'loading' | 'ready' | 'unavailable';
  onRetry: () => void;
  onUseEthereum: () => void;
  children: ReactNode;
}) {
  if (state === 'ready') return children;
  return <main className="flex min-h-dvh items-center justify-center bg-background p-4 text-foreground">
    <section className="w-full max-w-md space-y-4 rounded-[var(--radius-panel)] border bg-card p-6" aria-busy={state === 'loading'}>
      <h1 className="text-xl font-semibold">Solana sign-in</h1>
      {state === 'loading'
        ? <p role="status">Preparing Solana wallets...</p>
        : <><p role="alert">Solana wallets could not be loaded. Check your connection and try again.</p>
          <Button className="w-full" onClick={onRetry}>Retry Solana</Button></>}
      <Button variant="outline" className="w-full" onClick={onUseEthereum}>Use an Ethereum wallet instead</Button>
    </section>
  </main>;
}
