import { Activity, StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ThemeProvider, useTheme } from 'next-themes';
import TradingViewWidget from '@/components/tabs/TradingViewWidget';
import { usePerformanceMode } from '@/components/ui/performance-mode';

function Fixture() {
  const [visible, setVisible] = useState(true);
  const [mounted, setMounted] = useState(true);
  const [symbol, setSymbol] = useState('BASESWAP:SEEDWETH_AA6A81.USD');
  const { theme, setTheme } = useTheme();
  const { enabled, setEnabled } = usePerformanceMode();
  return <main>
    <button onClick={() => setVisible(value => !value)}>Toggle chart activity</button>
    <button onClick={() => setMounted(value => !value)}>Toggle chart mount</button>
    <button onClick={() => setEnabled(!enabled)}>Toggle performance mode</button>
    <button onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>Toggle theme</button>
    <button onClick={() => setSymbol('COINBASE:ETHUSD')}>Change chart symbol</button>
    <section aria-label="Chart" style={{ position: 'relative', height: 420, width: '100%' }}>
      {mounted && <Activity mode={visible ? 'visible' : 'hidden'}><TradingViewWidget symbol={symbol} /></Activity>}
    </section>
  </main>;
}

createRoot(document.getElementById('root')!).render(
  <StrictMode><ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}><Fixture /></ThemeProvider></StrictMode>,
);
