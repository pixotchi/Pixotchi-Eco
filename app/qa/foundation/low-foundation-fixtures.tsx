'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardTitle } from '@/components/ui/card';
import { StandardContainer } from '@/components/ui/pixel-container';
import { DisabledReason, InlineBalanceNotice, RewardResultPanel, StatusChip } from '@/components/ui/premium';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ToggleGroup } from '@/components/ui/toggle-group';
import { WalletAvatar } from '@/components/ui/wallet-avatar';

export function LowFoundationFixtures() {
  const [activations, setActivations] = useState(0);
  const [disabled, setDisabled] = useState(true);
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState<string | number>('absent');
  const [long, setLong] = useState(false);
  const [vertical, setVertical] = useState(false);
  const countActivation = () => setActivations(count => count + 1);
  return <section aria-label="Low foundation contracts" className="space-y-4">
    <h2 id="guarded-destination" className="type-section-title">Shared contracts</h2>
    <div className="flex flex-wrap gap-3">
      <Button asChild disabled={disabled} onClick={countActivation} onClickCapture={countActivation}>
        <Link href="#guarded-destination" onClick={countActivation} onClickCapture={countActivation} aria-disabled={false}>Guarded child link</Link>
      </Button>
      <Button onClick={() => setDisabled(value => !value)}>Toggle link availability</Button>
      <output aria-label="Link activations">{activations}</output>
    </div>
    <StatusChip id="low-chip" data-testid="forwarded-chip" title="Status detail" aria-label="Readiness status" onClick={countActivation}>Ready</StatusChip>
    <InlineBalanceNotice id="low-balance" data-testid="forwarded-balance" aria-live="off">Insufficient balance</InlineBalanceNotice>
    <DisabledReason id="low-reason" data-testid="forwarded-reason" role="note" aria-live="off">Connect a wallet to continue.</DisabledReason>
    <input aria-label="Associated control" aria-describedby="low-reason" />
    <RewardResultPanel id="low-result" data-testid="forwarded-result" role="alert" aria-live="assertive" title={<span>Reward confirmed</span>}>12 LEAF</RewardResultPanel>
    <div className="grid gap-4 sm:grid-cols-2" data-testid="surface-comparison">
      <Card data-testid="card-panel"><CardTitle>A long section title that can wrap at larger text sizes</CardTitle><p>Task surface</p></Card>
      <StandardContainer data-testid="standard-panel">The same task surface</StandardContainer>
      <StandardContainer variant="muted" data-testid="quiet-inset">Supporting information</StandardContainer>
      <StandardContainer variant="transparent" data-testid="quiet-group">Spacing groups this content</StandardContainer>
    </div>
    <div className="max-w-full" data-testid="selection-contract">
      <ToggleGroup ariaLabel="Sample selection" value={choice} onValueChange={setChoice} orientation={vertical ? 'vertical' : 'horizontal'}
        options={[{ value: 'one', label: long ? 'First longer choice' : 'One' }, { value: 'two', label: 'Two' }]} />
      <Button onClick={() => setChoice('absent')}>Clear sample selection</Button>
      <Button onClick={() => setLong(value => !value)}>Resize sample labels</Button>
      <Button onClick={() => setVertical(value => !value)}>Rotate sample selection</Button>
    </div>
    <div data-testid="avatar-fallback" className="size-11"><WalletAvatar address="0x9999999999999999999999999999999999999999" className="size-11" /></div>
    <Button onClick={() => setOpen(true)}>Open shared form</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent layout="form" mobileMode="center" padding="compact" style={{ outlineOffset: 3 }} surfaceStyle={{ outlineOffset: 7 }}>
      <DialogHeader><DialogTitle>A longer title for a responsive player action</DialogTitle><DialogDescription>Review the information before continuing.</DialogDescription></DialogHeader>
      <DialogBody data-testid="low-form-body">{Array.from({ length: 35 }, (_, i) => <p key={i}>Review item {i + 1} with full details.</p>)}</DialogBody>
      <DialogFooter data-testid="low-form-footer"><Button onClick={() => setOpen(false)}>Finish shared form</Button></DialogFooter>
    </DialogContent></Dialog>
  </section>;
}
