"use client";

import { useRef, useState } from 'react';
import { LandActionSummary } from '@/components/land-action-summary';
import { FirstCareGuide } from '@/components/first-care-guide';
import { completeFirstCareStep } from '@/lib/first-care-progress';
import type { BuildingData } from '@/lib/types';
import { Button } from '@/components/ui/button';
import { AmountField } from '@/components/ui/amount-field';
import { ReviewActionBar } from '@/components/ui/review-action-bar';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

const building = (id: number, patch: Partial<BuildingData> = {}): BuildingData => ({
  id, level: 1, maxLevel: 10, productionRatePlantPointsPerDay: BigInt(0), productionRatePlantLifetimePerDay: BigInt(0),
  accumulatedPoints: BigInt(0), accumulatedLifetime: BigInt(0), levelUpgradeCostLeaf: BigInt(0), levelUpgradeCostSeedInstant: BigInt(0),
  levelUpgradeBlockInterval: BigInt(0), isUpgrading: false, blockHeightUpgradeInitiated: BigInt(0), blockHeightUntilUpgradeDone: BigInt(0), ...patch,
});
const village = [building(0, { accumulatedPoints: BigInt('12000000000000') }), building(3, { isUpgrading: true, blockHeightUntilUpgradeDone: BigInt(100) })];
const town = [building(3), building(7)];

export function ActionFixtures() {
  const [landError, setLandError] = useState(true);
  const [selection, setSelection] = useState('');
  const [owner, setOwner] = useState('fixture-wallet-a');
  const [urgent, setUrgent] = useState(false);
  const [bet, setBet] = useState('');
  const [submits, setSubmits] = useState(0);
  const [padding, setPadding] = useState<'default' | 'compact' | 'none'>('default');
  const [dialogOpen, setDialogOpen] = useState(false);
  const review = useRef<HTMLDivElement>(null);
  return <>
    <section aria-label="Land overview fixture" className="max-w-lg space-y-2">
      <LandActionSummary land={{ accumulatedPlantPoints: BigInt('2500000000000'), accumulatedPlantLifetime: BigInt(3600) }} village={village} town={town}
        block={BigInt(100)} loading={false} error={landError ? 'The network read failed.' : undefined} onRetry={() => setLandError(false)} onSelect={(type, selected) => setSelection(`${type}:${selected.id}`)} />
      <output aria-label="Selected building">{selection}</output>
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
    <form aria-label="Review navigation fixture" className="max-w-lg space-y-4" onSubmit={event => { event.preventDefault(); setSubmits(value => value + 1); }}>
      <ReviewActionBar title="Zest" detail="24h starting lifetime · 1 SEED" onReview={() => { review.current?.scrollIntoView({ block: 'start', behavior: 'instant' }); review.current?.focus({ preventScroll: true }); }} />
      <div className="h-32" aria-hidden="true" />
      <div ref={review} tabIndex={-1} aria-label="Mint confirmation fixture" className="scroll-mt-24 rounded border p-4 focus-visible:ring-2 focus-visible:ring-ring">Review your selection before minting.<Button type="submit">Confirm fixture mint</Button></div>
      <output aria-label="Fixture submit count">{submits}</output>
    </form>
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
