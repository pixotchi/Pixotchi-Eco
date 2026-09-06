"use client";

import { useState } from 'react';
import { LandResourceBadges } from '@/components/land-resource-badges';
import { FirstCareGuide } from '@/components/first-care-guide';
import { completeFirstCareStep } from '@/lib/first-care-progress';
import { Button } from '@/components/ui/button';
import { AmountField } from '@/components/ui/amount-field';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export function ActionFixtures() {
  const [largeLandTotals, setLargeLandTotals] = useState(false);
  const [owner, setOwner] = useState('fixture-wallet-a');
  const [urgent, setUrgent] = useState(false);
  const [bet, setBet] = useState('');
  const [padding, setPadding] = useState<'default' | 'compact' | 'none'>('default');
  const [dialogOpen, setDialogOpen] = useState(false);
  return <>
    <section aria-label="Land resource fixture" className="max-w-[420px] space-y-2 rounded border bg-card p-4">
      <div aria-label="Land illustration fixture" className="relative aspect-square w-full rounded border bg-muted/30">
        <Button className="absolute bottom-3 left-3 h-11 px-3 text-xs" aria-label="Open fixture map">MAP</Button>
        <LandResourceBadges land={{ accumulatedPlantPoints: BigInt(largeLandTotals ? '1234567890123456789012' : '2500000000000'), accumulatedPlantLifetime: BigInt(largeLandTotals ? 34563723 : 3600) }} />
      </div>
      <Button onClick={() => setLargeLandTotals(true)}>Use large land totals</Button>
    </section>
    <section aria-label="First-care fixture" className="max-w-lg space-y-3">
      <FirstCareGuide owner={owner} hasPlant urgent={urgent} />
      <Button onClick={() => completeFirstCareStep(owner, 'care')}>Confirm fixture care</Button>
      <Button onClick={() => setOwner(value => value === 'fixture-wallet-a' ? 'fixture-wallet-b' : 'fixture-wallet-a')}>Switch fixture wallet</Button>
      <Button onClick={() => setUrgent(value => !value)}>Toggle urgent care</Button>
      <output aria-label="Fixture owner">{owner}</output>
    </section>
    <section aria-label="Game field fixture" className="max-w-lg rounded-lg bg-slate-950 p-4">
      <AmountField surface="game" label="Bet amount" unit="SEED" value={bet} onChange={event => setBet(event.target.value)} error={Number(bet) > 1 ? 'Your balance is 1 SEED.' : undefined} hint="Review your stake before playing." />
    </section>
    <section aria-label="Dialog spacing fixture" className="space-y-3">
      <label htmlFor="fixture-dialog-spacing">Dialog spacing</label><select id="fixture-dialog-spacing" className="ml-3 min-h-11 rounded border bg-card px-3" value={padding} onChange={event => setPadding(event.target.value as typeof padding)}>
        <option>default</option><option>compact</option><option>none</option>
      </select>
      <Button onClick={() => setDialogOpen(true)}>Open spacing dialog</Button>
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent padding={padding} mobileMode="sheet">
          <DialogHeader><DialogTitle>Spacing and viewport</DialogTitle><DialogDescription>A long form keeps its action reachable.</DialogDescription></DialogHeader>
          <DialogBody data-testid="spacing-dialog-body"><AmountField label="Keyboard amount" unit="PTS" value={bet} onChange={event => setBet(event.target.value)} /><div className="h-96" aria-hidden="true" /></DialogBody>
          <DialogFooter sticky><Button onClick={() => setDialogOpen(false)}>Finish spacing check</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  </>;
}
