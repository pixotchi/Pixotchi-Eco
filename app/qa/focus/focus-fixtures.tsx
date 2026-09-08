'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { AmountField } from '@/components/ui/amount-field';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ToggleGroup } from '@/components/ui/toggle-group';

export function FocusFixtures() {
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const [selection, setSelection] = useState('plants');
  const [amount, setAmount] = useState('');
  useEffect(() => setReady(true), []);

  return <main data-focus-ready={ready} className="mx-auto max-w-md space-y-4 p-6">
    <h1>Keyboard focus regression</h1>
    <div className="flex flex-wrap gap-4">
      <Button>Primary action</Button>
      <Button variant="outline">Outline action</Button>
      <Button variant="headerIcon" size="icon" aria-label="Refresh balances">↻</Button>
      <Button variant="navSliding" data-active="true">Selected tab</Button>
      <Button variant="navSliding">Unselected tab</Button>
      <Button className="profile-follow-button follow-button">Profile Follow</Button>
    </div>
    <ToggleGroup ariaLabel="Farm view" value={selection} onValueChange={value => setSelection(String(value))}
      options={[{ value: 'plants', label: 'Plants' }, { value: 'lands', label: 'Lands' }]} />
    <AmountField label="Stake amount" unit="SEED" value={amount} onChange={event => setAmount(event.target.value)} />
    <Button onClick={() => setOpen(true)}>Open focus dialog</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent><DialogHeader><DialogTitle>Focus dialog</DialogTitle><DialogDescription>Check keyboard focus inside the overlay.</DialogDescription></DialogHeader>
        <Button>Dialog action</Button>
      </DialogContent>
    </Dialog>
  </main>;
}
