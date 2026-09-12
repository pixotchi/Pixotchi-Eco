'use client';

import { useState } from 'react';
import { BroadcastMessageModal } from '@/components/broadcast-message-modal';
import { createRetryableDialog } from '@/components/retryable-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import type { BroadcastMessage } from '@/lib/broadcast-service';

function LoadedDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [draft, setDraft] = useState('');
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent layout="form" adaptiveScroll>
      <DialogHeader><DialogTitle>Loaded audit dialog</DialogTitle><DialogDescription>The draft survives closing and reopening.</DialogDescription></DialogHeader>
      <DialogBody><Input aria-label="Retained dialog draft" value={draft} onChange={event => setDraft(event.target.value)} /></DialogBody>
      <DialogFooter><Button onClick={() => onOpenChange(false)}>Finish audit dialog</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

let attempts = 0;
const RetryableAuditDialog = createRetryableDialog(async () => {
  await new Promise(resolve => setTimeout(resolve, 600));
  if (++attempts === 1) throw new Error('Intentional first-load fixture failure');
  return { default: LoadedDialog };
}, 'Audit dialog');

const announcement: BroadcastMessage = {
  id: 'long-announcement-fixture', title: 'Long announcement',
  content: Array.from({ length: 30 }, (_, index) => `Update ${index + 1}: Your plants and lands remain available while you review this message.`).join('\n\n'),
  createdAt: 1, createdBy: 'fixture', priority: 'normal', type: 'info', dismissible: true,
  stats: { impressions: 0, dismissals: 0 },
};

export function AuditDialogFixtures() {
  const [open, setOpen] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  return <section aria-label="Audit dialog recovery" className="flex flex-wrap gap-3">
    <Button onClick={() => setOpen(true)}>Open retryable audit dialog</Button>
    <RetryableAuditDialog open={open} onOpenChange={setOpen} />
    <Button onClick={() => setBroadcastOpen(true)}>Open long announcement</Button>
    <BroadcastMessageModal message={broadcastOpen ? announcement : null} onDismiss={() => setBroadcastOpen(false)} />
  </section>;
}
