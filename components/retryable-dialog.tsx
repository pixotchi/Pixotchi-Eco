'use client';

import { useEffect, useRef, useState, type ComponentType } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { createRetryableResource } from '@/lib/retryable-resource';
import { getDialogOpener, setDialogOpener } from '@/lib/dialog-focus';

type DialogStateProps = { open: boolean; onOpenChange: (open: boolean) => void };

/** Load on first open, retain the loaded dialog's state, and recover a failed
 * import locally. The temporary shell owns focus until the real dialog mounts. */
export function createRetryableDialog<P extends DialogStateProps>(
  importModule: () => Promise<{ default: ComponentType<P> }>,
  name: string,
) {
  const load = createRetryableResource(importModule);
  function RetryableDialog(props: P) {
    const { open, onOpenChange } = props;
    const [Component, setComponent] = useState<ComponentType<P> | null>(null);
    const [failed, setFailed] = useState(false);
    const [attempt, setAttempt] = useState(0);
    const opener = useRef<HTMLElement | null>(null);

    useEffect(() => {
      if (!open || Component) return;
      let current = true;
      setFailed(false);
      void load().then(module => {
        if (!current) return;
        // The focused loading/retry control is about to disappear. The real
        // dialog must restore to the original trigger when it later closes.
        if (opener.current?.isConnected) setDialogOpener(opener.current);
        setComponent(() => module.default);
      }).catch(() => { if (current) setFailed(true); });
      return () => { current = false; };
    }, [open, Component, attempt]);

    if (Component) return <Component {...props} />;
    return <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent layout="detail" adaptiveScroll
        onOpenAutoFocus={() => { opener.current = getDialogOpener(); }}
        onCloseAutoFocus={event => { if (open) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>{name}</DialogTitle>
          <DialogDescription role={failed ? 'alert' : undefined}>{failed ? `Could not load ${name}. Check your connection and try again.` : `Loading ${name}…`}</DialogDescription>
        </DialogHeader>
        <DialogBody aria-busy={!failed}>
          {failed
            ? <Button variant="outline" className="h-auto min-h-11 max-w-full whitespace-normal leading-snug [overflow-wrap:anywhere]" onClick={() => setAttempt(value => value + 1)}>Retry loading {name}</Button>
            : <p role="status" className="text-sm text-muted-foreground">Loading…</p>}
        </DialogBody>
      </DialogContent>
    </Dialog>;
  }
  RetryableDialog.displayName = `RetryableDialog(${name})`;
  return RetryableDialog;
}
