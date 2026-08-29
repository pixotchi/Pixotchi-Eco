'use client';

import React, { useEffect, useRef, memo } from 'react';
import { useTheme } from 'next-themes';

interface TradingViewWidgetProps {
  symbol?: string;
}

function TradingViewWidget({ symbol = 'BASESWAP:SEEDWETH_AA6A81.USD' }: TradingViewWidgetProps) {
  const container = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [mounted, setMounted] = React.useState(false);

  // enableSystem is false on ServerThemeProvider, so `theme` is always one of the
  // eight explicit palettes — there is no 'system' value to resolve.
  const isDarkTheme = theme === 'dark';

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const node = container.current;
    if (!mounted || !node) return;

    /*
     * The host div is rendered with no children on purpose: this effect owns every
     * node inside it. The previous version rendered a `__widget` child from JSX and
     * then tore it out with a removeChild loop on the first run (the dark/light guard
     * it was supposed to be gated behind started at null, so it never short-circuited),
     * which is a React-owned node being deleted behind React's back.
     *
     * The guard is gone as well: it compared only the dark/light boolean, so a `symbol`
     * change — which is in the dependency list — silently did nothing, and the six
     * colour themes never re-tinted.
     */
    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;

    const config = {
      allow_symbol_change: false,
      calendar: false,
      details: false,
      hide_side_toolbar: true,
      hide_top_toolbar: false,
      hide_legend: true,
      hide_volume: true,
      hotlist: false,
      interval: '120',
      locale: 'en',
      save_image: false,
      style: isDarkTheme ? '1' : '2', // 1 = dark, 2 = light
      symbol,
      theme: isDarkTheme ? 'dark' : 'light',
      timezone: 'Etc/UTC',
      backgroundColor: isDarkTheme ? '#1f2d42' : '#f6fbff',
      gridColor: isDarkTheme ? 'rgba(246, 251, 255, 0.08)' : 'rgba(31, 45, 66, 0.08)',
      watchlist: [],
      withdateranges: false,
      compareSymbols: [],
      studies: [],
      autosize: true,
    };

    script.innerHTML = JSON.stringify(config);
    node.replaceChildren(script);

    return () => {
      // Same node, still uncontrolled by React — safe to empty on the way out.
      node.replaceChildren();
    };
  }, [mounted, isDarkTheme, symbol]);

  if (!mounted) {
    return (
      <div className="w-full h-full bg-card border border-border rounded-[var(--radius-panel)] flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading chart...</p>
      </div>
    );
  }

  return (
    <div
      className="tradingview-widget-container bg-card rounded-[var(--radius-panel)] overflow-hidden w-full h-full flex flex-col border border-border/70 shadow-[var(--shadow-hairline)]"
      ref={container}
    />
  );
}

export default memo(TradingViewWidget);
