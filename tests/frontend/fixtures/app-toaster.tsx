import * as React from 'react';
import { createRoot } from 'react-dom/client';
import toast from 'react-hot-toast';
import { AppToaster } from '../../../components/ui/app-toaster';
import { Button } from '../../../components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '../../../components/ui/dialog';

function Fixture() {
  const [parentOpen, setParentOpen] = React.useState(false);
  const [nestedOpen, setNestedOpen] = React.useState(false);
  const resolvePending = React.useRef<(() => void) | null>(null);
  React.useEffect(() => {
    const finish = () => toast.success('Quote refreshed', { id: 'pending' });
    const notify = () => toast.success('Fresh result', { id: 'fresh' });
    const dismiss = () => toast.dismiss('custom');
    const finishPromise = () => resolvePending.current?.();
    window.addEventListener('fixture:finish', finish);
    window.addEventListener('fixture:notify', notify);
    window.addEventListener('fixture:dismiss-custom', dismiss);
    window.addEventListener('fixture:finish-promise', finishPromise);
    return () => {
      window.removeEventListener('fixture:finish', finish);
      window.removeEventListener('fixture:notify', notify);
      window.removeEventListener('fixture:dismiss-custom', dismiss);
      window.removeEventListener('fixture:finish-promise', finishPromise);
    };
  }, []);
  return (
    <>
      <AppToaster />
      <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-4">
        <Button onClick={() => setParentOpen(true)}>Open parent</Button>
        <Button onClick={() => toast.loading('Refreshing quote', { id: 'pending' })}>Start pending quote</Button>
        <Button onClick={() => toast.success('Visible result', { id: 'result' })}>Show result</Button>
        <Button onClick={() => toast.promise(new Promise<void>(resolve => { resolvePending.current = resolve; }),
          { loading: 'Saving selection', success: 'Selection saved', error: 'Selection failed' }, { id: 'promise' })}>Start promised action</Button>
        <Button onClick={() => { toast('Default position', { id: 'default-position' }); toast('Bottom right position', { id: 'override-position', position: 'bottom-right' }); }}>Show positioned notices</Button>
        <Button onClick={() => toast.custom(<div role="status" aria-live="polite" className="bg-card p-4">Persistent notice</div>, { id: 'custom', duration: Infinity, removeDelay: 300 })}>Show persistent custom</Button>
      </main>
      <Dialog open={parentOpen} onOpenChange={setParentOpen}>
        <DialogContent>
          <DialogTitle>Parent dialog</DialogTitle>
          <DialogDescription>Notification scope fixture</DialogDescription>
          <Button onClick={() => toast.success('Parent action complete', { id: 'parent' })}>Show parent feedback</Button>
          <Button onClick={() => setNestedOpen(true)}>Open nested</Button>
          <Dialog open={nestedOpen} onOpenChange={setNestedOpen}>
            <DialogContent layer="nested">
              <DialogTitle>Nested dialog</DialogTitle>
              <DialogDescription>Nested notification scope fixture</DialogDescription>
              <Button onClick={() => toast.success('Nested action complete', { id: 'nested' })}>Show nested feedback</Button>
            </DialogContent>
          </Dialog>
        </DialogContent>
      </Dialog>
    </>
  );
}

createRoot(document.getElementById('root')!).render(<Fixture />);
