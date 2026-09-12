'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { handleExternalAnchorClick } from '@/lib/open-external';

export function ClaimRecoveryCard({ title, description, address, reference, txHash, updatedAt, checking, error, onCheckStatus }: {
  title: string; description: string; address?: string; reference?: string | null; txHash?: string | null;
  updatedAt?: number | null; checking?: boolean; error?: string | null; onCheckStatus: () => void;
}) {
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');
  const details = `${title}\nWallet: ${address ?? 'Unavailable'}\nReference: ${reference ?? 'Not yet available'}${txHash ? `\nTransaction: ${txHash}` : ''}`;
  const transactionUrl = txHash && /^0x[0-9a-f]{64}$/i.test(txHash) ? `https://basescan.org/tx/${txHash}` : null;
  const supportUrl = 'https://t.me/pixotchi';
  return <Card>
    <CardContent className="space-y-3">
      <div><h3 className="font-semibold">{title}</h3><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>
      <dl className="space-y-1 text-xs [overflow-wrap:anywhere]">
        {address && <div><dt className="inline font-medium">Wallet: </dt><dd className="inline font-mono">{address}</dd></div>}
        {reference && <div><dt className="inline font-medium">Claim reference: </dt><dd className="inline font-mono">{reference}</dd></div>}
        {updatedAt && <div><dt className="inline font-medium">Last checked: </dt><dd className="inline"><time dateTime={new Date(updatedAt).toISOString()}>{new Date(updatedAt).toLocaleString()}</time></dd></div>}
      </dl>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" size="touchCompact" disabled={checking} aria-busy={checking} onClick={onCheckStatus}>{checking ? 'Checking status…' : 'Check status'}</Button>
        <Button variant="outline" size="touchCompact" onClick={async () => { try { await navigator.clipboard.writeText(details); setCopyState('copied'); } catch { setCopyState('failed'); } }}>Copy claim details</Button>
        {transactionUrl && <Button variant="outline" size="touchCompact" asChild><a href={transactionUrl} target="_blank" rel="noopener noreferrer" onClick={event => handleExternalAnchorClick(event, transactionUrl)}>View transaction</a></Button>}
      </div>
      <p className="text-xs text-muted-foreground" role="status">{copyState === 'copied' ? 'Claim details copied. Paste them when contacting support.' : copyState === 'failed' ? 'Copy was unavailable. Select the wallet and claim reference above to share them with support.' : 'Copy your claim details before contacting support.'}</p>
      <a className="inline-flex min-h-11 items-center text-sm font-medium text-info-strong underline underline-offset-4" href={supportUrl} target="_blank" rel="noopener noreferrer" onClick={event => handleExternalAnchorClick(event, supportUrl)}>Open community support</a>
    </CardContent>
  </Card>;
}
