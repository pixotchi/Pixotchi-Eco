'use client';

import React, { useEffect, useRef, memo } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';

interface TradingViewWidgetProps {
  symbol?: string;
}

function TradingViewWidget({ symbol = 'BASESWAP:SEEDWETH_AA6A81.USD' }: TradingViewWidgetProps) {
  const container = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const [loadState, setLoadState] = React.useState<'loading' | 'ready' | 'error'>('loading');
  const [retryKey, setRetryKey] = React.useState(0);

  // enableSystem is false on ServerThemeProvider, so `theme` is always one of the
  // eight explicit palettes — there is no 'system' value to resolve.
  const isDarkTheme = theme === 'dark';

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    const node = container.current;
    if (!mounted || !node) return;
    setLoadState('loading');

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
    // TradingView discovers its mount point through `document.currentScript`.
    // Keep that script parented to a dedicated host even if React deactivates
    // this Activity while the network request is still in flight. Removing the
    // script itself early makes TradingView dereference a null parent.
    const widgetHost = document.createElement('div');
    widgetHost.className = 'tradingview-widget-container__widget h-full w-full';

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

    let disposed = false;
    let settled = false;
    const handleLoad = () => {
      settled = true;
      if (!disposed) setLoadState('ready');
      if (disposed) {
        widgetHost.replaceChildren();
      }
    };
    const handleError = () => {
      settled = true;
      if (!disposed) setLoadState('error');
      if (disposed) {
        widgetHost.replaceChildren();
      }
    };
    script.addEventListener('load', handleLoad, { once: true });
    script.addEventListener('error', handleError, { once: true });
    script.innerHTML = JSON.stringify(config);
    widgetHost.appendChild(script);
    node.replaceChildren(widgetHost);

    return () => {
      disposed = true;
      // Detach the host from visible UI, but retain the script-parent relation
      // until the async script has either executed or failed.
      if (widgetHost.parentNode === node) {
        widgetHost.remove();
      }
      if (settled) {
        widgetHost.replaceChildren();
      }
    };
  }, [mounted, isDarkTheme, retryKey, symbol]);

  if (!mounted) {
    return (
      <div className="w-full h-full bg-card border border-border rounded-[var(--radius-panel)] flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading chart...</p>
      </div>
    );
  }

  return (
    <div
      className="tradingview-widget-container relative h-full w-full overflow-hidden rounded-[var(--radius-panel)] border border-border/70 bg-card shadow-[var(--shadow-hairline)]"
    >
      <div
        ref={container}
        aria-hidden={loadState !== 'ready'}
        className={loadState === 'ready' ? 'absolute inset-0' : 'invisible absolute inset-0'}
      />
      {loadState === 'loading' && (
        <div role="status" className="absolute inset-0 flex items-center justify-center gap-3 text-sm text-muted-foreground">
          <span aria-hidden="true" className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" />
          Loading chart…
        </div>
      )}
      {loadState === 'error' && (
        <div role="alert" className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-5 text-center">
          <div>
            <p className="text-sm font-semibold text-foreground">Chart unavailable</p>
            <p className="mt-1 text-xs text-muted-foreground">TradingView could not be loaded. Check your connection and try again.</p>
          </div>
          <Button variant="outline" size="touchCompact" onClick={() => setRetryKey((key) => key + 1)}>
            Retry chart
          </Button>
        </div>
      )}
    </div>
  );
}

export default memo(TradingViewWidget);
