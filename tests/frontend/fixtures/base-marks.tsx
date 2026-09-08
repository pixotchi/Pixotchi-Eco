import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BaseAnimatedLogo } from '@/components/ui/BaseAnimatedLogo';
import { BaseExpandedLoadingPageLoader } from '@/components/ui/BaseExpandedLoadingLogo';
import { usePerformanceMode } from '@/components/ui/performance-mode';

function Fixture() {
  const [mounted, setMounted] = useState(true);
  const { enabled, setEnabled } = usePerformanceMode();
  return <main>
    <button onClick={() => setEnabled(!enabled)}>Toggle performance mode</button>
    <button onClick={() => setMounted(false)}>Unmount marks</button>
    {mounted && <>
      <section aria-label="About mark"><BaseAnimatedLogo /></section>
      <section aria-label="Loading mark"><BaseExpandedLoadingPageLoader text="Connecting to Base" /></section>
    </>}
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
