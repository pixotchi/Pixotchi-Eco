'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';

export interface AdminConfirmationState {
  open: boolean;
  title: string;
  description: string;
  confirmText: string;
  onConfirm: () => void;
  isDangerous?: boolean;
  requiresTextConfirmation?: boolean;
  textToMatch?: string;
}

export function AdminConfirmationDialog({ state, onClose }: { state: AdminConfirmationState; onClose: () => void }) {
  const [confirmation, setConfirmation] = useState('');
  useEffect(() => { setConfirmation(''); }, [state.open, state.title, state.textToMatch]);
  const requiresMatch = Boolean(state.requiresTextConfirmation && state.textToMatch);
  const matches = !requiresMatch || confirmation === state.textToMatch;
  return <Dialog open={state.open} onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent layout="form" adaptiveScroll size="md">
      <DialogHeader><DialogTitle className={state.isDangerous ? 'text-destructive' : undefined}>{state.title}</DialogTitle><DialogDescription>{state.description}</DialogDescription></DialogHeader>
      <DialogBody>{requiresMatch && <div className="space-y-2">
        <label htmlFor="admin-confirmation" className="text-sm font-medium">Type <strong>{state.textToMatch}</strong> to confirm</label>
        <Input id="admin-confirmation" value={confirmation} onChange={(event) => setConfirmation(event.target.value)} autoComplete="off" aria-describedby="admin-confirmation-help" />
        <p id="admin-confirmation-help" className="text-xs text-muted-foreground">The text must match exactly before this action is available.</p>
      </div>}</DialogBody>
      <DialogFooter>
        <Button variant="outline" className="h-auto min-h-11 whitespace-normal leading-snug" onClick={onClose}>Cancel</Button>
        <Button variant={state.isDangerous ? 'destructive' : 'default'} className="h-auto min-h-11 whitespace-normal leading-snug [overflow-wrap:anywhere]" disabled={!matches} onClick={() => { if (matches) { state.onConfirm(); onClose(); } }}>{state.confirmText}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
