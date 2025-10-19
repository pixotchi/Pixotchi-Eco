
'use client';

import React, { useEffect, useRef, memo } from 'react';
import { useTheme } from 'next-themes';

interface TradingViewWidgetProps {
  symbol?: string;
}

function TradingViewWidget({ symbol = 'BASESWAP:SEEDWETH_AA6A81.USD' }: TradingViewWidgetProps) {
  const container = useRef<HTMLDivElement>(null);
  const { theme, systemTheme } = useTheme();
  const [mounted, setMounted] = React.useState(false);
  const prevIsDarkThemeRef = useRef<boolean | null>(null);

  // Determine if dark theme is active
  const isDarkTheme = theme === 'dark' || (theme === 'system' && systemTheme === 'dark');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted || !container.current) return;

    // Only update if the dark/light theme actually changed (not just switching between light colors)
    if (prevIsDarkThemeRef.current === isDarkTheme) {
      return;
    }

    prevIsDarkThemeRef.current = isDarkTheme;

    // Clear the entire container to remove old chart and script
    while (container.current.firstChild) {
      container.current.removeChild(container.current.firstChild);
    }

    const script = document.createElement('script');
    script.src = 'https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js';
    script.type = 'text/javascript';
    script.async = true;

    // Theme-aware configuration
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
      symbol: symbol,
      theme: isDarkTheme ? 'dark' : 'light',
      timezone: 'Etc/UTC',
      backgroundColor: isDarkTheme ? '#0F0F0F' : '#FFFFFF',
      gridColor: isDarkTheme ? 'rgba(242, 242, 242, 0.06)' : 'rgba(0, 0, 0, 0.06)',
      watchlist: [],
      withdateranges: false,
      compareSymbols: [],
      studies: [],
      autosize: true,
    };

    script.innerHTML = JSON.stringify(config);
    container.current.appendChild(script);
  }, [mounted, isDarkTheme, symbol]);

  if (!mounted) {
    return (
      <div className="w-full h-full bg-card border border-border rounded-lg flex items-center justify-center">
        <p className="text-muted-foreground text-sm">Loading chart...</p>
      </div>
    );
  }

  return (
    <div
      className="tradingview-widget-container bg-card rounded-lg overflow-hidden w-full h-full flex flex-col"
      ref={container}
    >
      <div
        className="tradingview-widget-container__widget flex-1"
      />
      <div className="tradingview-widget-copyright text-xs text-muted-foreground px-3 py-1 border-t border-border/50">
        <a
          href="https://www.tradingview.com/symbols/SEEDWETH_AA6A81.USD/?exchange=BASESWAP"
          rel="noopener nofollow"
          target="_blank"
          className="text-primary hover:underline"
        >
          <span>SEED/WETH price</span>
        </a>
        <span className="text-muted-foreground"> by TradingView</span>
      </div>
    </div>
  );
}

export default memo(TradingViewWidget);
