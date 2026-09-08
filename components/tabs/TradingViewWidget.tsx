'use client';

import React, { useEffect, useRef, memo } from 'react';
import { useTheme } from 'next-themes';
import { Button } from '@/components/ui/button';
import { usePerformanceMode } from '@/components/ui/performance-mode';

interface TradingViewWidgetProps {
  symbol?: string;
}

function TradingViewWidget({ symbol = 'BASESWAP:SEEDWETH_AA6A81.USD' }: TradingViewWidgetProps) {
  const container = useRef<HTMLDivElement>(null);
  const { theme } = useTheme();
  const { enabled: performanceModeEnabled } = usePerformanceMode();
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
    // Performance Mode must not even create the third-party widget host. This
    // keeps the iframe and its network/script work out of the page entirely.
    if (!mounted || performanceModeEnabled || !node) return;
    setLoadState('loading');

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

    // Give the vendor an owned browsing context. Removing a pending script's
    // host does not cancel its execution: TradingView can then create an iframe
    // in a detached tree (without contentWindow). Removing this frame instead
    // disposes its document, pending script and vendor event listeners together.
    // This also covers React Activity deactivation and theme/symbol changes.
    const widgetFrame = document.createElement('iframe');
    widgetFrame.title = 'Price chart by TradingView';
    widgetFrame.className = 'h-full w-full border-0';

    let disposed = false;
    const loadTimeout = window.setTimeout(() => {
      if (!disposed) setLoadState('error');
    }, 30_000);

    const handleLoad = () => {
      const document = widgetFrame.contentDocument;
      if (disposed || document?.URL !== 'about:srcdoc') return;
      window.clearTimeout(loadTimeout);
      // The outer document's load waits for the vendor-created iframe to load.
      // Script download alone is not chart readiness. Cross-origin chart data
      // and support-service failures remain TradingView's responsibility.
      setLoadState(document.querySelector('iframe') ? 'ready' : 'error');
    };
    const handleError = () => {
      window.clearTimeout(loadTimeout);
      if (!disposed) setLoadState('error');
    };
    widgetFrame.addEventListener('load', handleLoad);
    widgetFrame.addEventListener('error', handleError);
    // Escape markup delimiters because symbol is a prop, even though the
    // configuration is JSON inside a non-inline vendor script element.
    const settings = JSON.stringify(config).replace(/</g, '\\u003c');
    widgetFrame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><style>
      html,body,.tradingview-widget-container{height:100%;width:100%;margin:0;overflow:hidden}
      .tradingview-widget-container__widget{height:100%;width:100%}
      </style></head><body><div class="tradingview-widget-container">
      <div class="tradingview-widget-container__widget"></div>
      <script async src="https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js">${settings}</script>
      </div></body></html>`;
    node.replaceChildren(widgetFrame);

    return () => {
      disposed = true;
      window.clearTimeout(loadTimeout);
      widgetFrame.removeEventListener('load', handleLoad);
      widgetFrame.removeEventListener('error', handleError);
      widgetFrame.remove();
    };
  }, [mounted, isDarkTheme, performanceModeEnabled, retryKey, symbol]);

  if (performanceModeEnabled) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-[var(--radius-panel)] border border-border bg-card p-5 text-center">
        <div>
          <p className="text-sm font-semibold text-foreground">Chart paused</p>
          <p className="mt-1 text-xs text-muted-foreground">Disable Performance Mode to load the live chart.</p>
        </div>
      </div>
    );
  }

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
