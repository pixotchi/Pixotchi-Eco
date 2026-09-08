import React from 'react';
import { createRoot } from 'react-dom/client';
import { SpinLeafWheel } from '@/components/arcade/spin-leaf-wheel';
import { useSpinLeafWheel } from '@/hooks/useSpinLeafWheel';

function Fixture() {
  const motion = useSpinLeafWheel({ active: true, pending: false });
  return <main className="mx-auto max-w-md space-y-4 p-4 text-foreground">
    <h1 className="text-xl font-bold">SpinLeaf</h1>
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
