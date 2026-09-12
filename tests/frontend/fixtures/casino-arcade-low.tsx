import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { SpinLeafWheel } from '@/components/arcade/spin-leaf-wheel';
import { useSpinLeafWheel } from '@/hooks/useSpinLeafWheel';
import BoxGameTransaction from '@/components/transactions/box-game-transaction';
import { AppToaster } from '@/components/ui/app-toaster';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { ScrollArea } from '@/components/ui/scroll-area';
import { RewardResultPanel } from '@/components/ui/premium';
import type { BoxResult } from '@/lib/box-result';

function BoxFixture() {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<BoxResult | null>(null);
  const [completions, setCompletions] = useState(0);
  return <>
    <AppToaster />
    <Button onClick={() => setOpen(true)}>Open Box Game</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent surface="soft" className="max-w-md w-[min(94vw,28rem)]">
        <DialogHeader><DialogTitle>Arcade result fixture</DialogTitle><DialogDescription>Box Game result visibility</DialogDescription></DialogHeader>
        <ScrollArea aria-label="Arcade content" className="flex-1 overflow-y-auto py-3 pr-1">
          <div className="h-[1200px]">Choose a box. Game details fill this scroll area.</div>
          {result && <RewardResultPanel title="Box result"><span>PTS: {result.pointsDelta}; Lifetime: {result.timeAdded}</span></RewardResultPanel>}
        </ScrollArea>
        <DialogFooter sticky className="block">
          <BoxGameTransaction plantId={7} seed={1} withStar={false} buttonText="Play box" buttonClassName="w-full" feedbackMode="toast"
            onResult={result => { setResult(result); setCompletions(count => count + 1); }} />
          <output hidden aria-label="Result callbacks">{completions}</output>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

function Fixture() {
  const motion = useSpinLeafWheel({ active: true, pending: false });
  return <main className="mx-auto max-w-md space-y-4 p-4 text-foreground">
    <h1 className="text-xl font-bold">SpinLeaf</h1>
    <BoxFixture />
    <SpinLeafWheel motion={motion} pending={false} rewards={[
      { index: 0, pointsDelta: 120e12, timeExtension: 0, leafAmount: BigInt(0) },
      { index: 1, pointsDelta: -120e12, timeExtension: 0, leafAmount: BigInt(0) },
      { index: 2, pointsDelta: 0, timeExtension: 3600, leafAmount: BigInt(0) },
      { index: 3, pointsDelta: 0, timeExtension: 0, leafAmount: BigInt('3000000000000000000') },
      { index: 4, pointsDelta: 4e12, timeExtension: 60, leafAmount: BigInt('7000000000000000000') },
      { index: 5, pointsDelta: 0, timeExtension: 0, leafAmount: BigInt(0) },
    ]} />
    <div className="grid grid-cols-2 gap-2">
      <button className="min-h-11 rounded-md border" onClick={motion.start}>Start animation</button>
      <button className="min-h-11 rounded-md border" onClick={motion.reveal}>Prepare reveal</button>
      <button className="min-h-11 rounded-md border" onClick={() => motion.finish(null)}>Result unavailable</button>
      <button className="min-h-11 rounded-md border" onClick={() => motion.finish(0)}>Resolve outcome 1</button>
      <button className="min-h-11 rounded-md border" onClick={() => motion.finish(5)}>Resolve outcome 6</button>
    </div>
  </main>;
}

createRoot(document.getElementById('root')!).render(<Fixture />);
