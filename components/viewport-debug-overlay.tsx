"use client";

import { useCallback, useEffect, useState } from "react";

type ViewportDebugSnapshot = {
  bodyScrollHeight: number;
  browserBottom: string;
  browserTop: string;
  docClientHeight: number;
  docScrollHeight: number;
  headerPaddingTop: string;
  innerHeight: number;
  innerWidth: number;
  navPaddingBottom: string;
  safeAreaBottom: string;
  safeAreaTop: string;
  scrollY: number;
  timestamp: string;
  userAgent: string;
  vvHeight: number | null;
  vvOffsetTop: number | null;
  vvPageTop: number | null;
  vvScale: number | null;
  vvWidth: number | null;
};

const DEBUG_QUERY_PARAM = "viewportDebug";

function readCssVariable(styles: CSSStyleDeclaration, name: string) {
  return styles.getPropertyValue(name).trim() || "(empty)";
}

function readSnapshot(): ViewportDebugSnapshot {
  const root = document.documentElement;
  const rootStyles = getComputedStyle(root);
  const header = document.querySelector("header");
  const nav = document.querySelector("nav");
  const viewport = window.visualViewport;

  return {
    bodyScrollHeight: document.body.scrollHeight,
    browserBottom: readCssVariable(rootStyles, "--browser-safe-area-bottom"),
    browserTop: readCssVariable(rootStyles, "--browser-safe-area-top"),
    docClientHeight: root.clientHeight,
    docScrollHeight: root.scrollHeight,
    headerPaddingTop: header ? getComputedStyle(header).paddingTop : "(missing)",
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    navPaddingBottom: nav ? getComputedStyle(nav).paddingBottom : "(missing)",
    safeAreaBottom: readCssVariable(rootStyles, "--safe-area-inset-bottom"),
    safeAreaTop: readCssVariable(rootStyles, "--safe-area-inset-top"),
    scrollY: window.scrollY,
    timestamp: new Date().toLocaleTimeString(),
    userAgent: navigator.userAgent,
    vvHeight: viewport ? Math.round(viewport.height) : null,
    vvOffsetTop: viewport ? Math.round(viewport.offsetTop) : null,
    vvPageTop: viewport ? Math.round(viewport.pageTop) : null,
    vvScale: viewport ? Number(viewport.scale.toFixed(2)) : null,
    vvWidth: viewport ? Math.round(viewport.width) : null,
  };
}

export function ViewportDebugOverlay() {
  const [enabled, setEnabled] = useState(false);
  const [snapshot, setSnapshot] = useState<ViewportDebugSnapshot | null>(null);

  const refreshSnapshot = useCallback(() => {
    setSnapshot(readSnapshot());
  }, []);

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const isEnabled = searchParams.get(DEBUG_QUERY_PARAM) === "1";
    setEnabled(isEnabled);

    if (!isEnabled) {
      return;
    }

    const refresh = () => {
      requestAnimationFrame(refreshSnapshot);
    };

    refreshSnapshot();
    window.addEventListener("resize", refresh);
    window.addEventListener("scroll", refresh, { passive: true });
    window.visualViewport?.addEventListener("resize", refresh);
    window.visualViewport?.addEventListener("scroll", refresh);

    const intervalId = window.setInterval(refreshSnapshot, 1000);

    return () => {
      window.removeEventListener("resize", refresh);
      window.removeEventListener("scroll", refresh);
      window.visualViewport?.removeEventListener("resize", refresh);
      window.visualViewport?.removeEventListener("scroll", refresh);
      window.clearInterval(intervalId);
    };
  }, [refreshSnapshot]);

  const copySnapshot = useCallback(async () => {
    if (!snapshot) {
      return;
    }

    try {
      await navigator.clipboard.writeText(JSON.stringify(snapshot, null, 2));
    } catch {
      // Ignore copy failures; the visible overlay still contains the same data.
    }
  }, [snapshot]);

  if (!enabled || !snapshot) {
    return null;
  }

  const rows: Array<[string, string | number | null]> = [
    ["inner", `${snapshot.innerWidth}x${snapshot.innerHeight}`],
    ["vv", snapshot.vvWidth && snapshot.vvHeight ? `${snapshot.vvWidth}x${snapshot.vvHeight}` : "null"],
    ["vv.offsetTop", snapshot.vvOffsetTop],
    ["vv.pageTop", snapshot.vvPageTop],
    ["vv.scale", snapshot.vvScale],
    ["scrollY", snapshot.scrollY],
    ["docH", `${snapshot.docClientHeight}/${snapshot.docScrollHeight}`],
    ["bodyH", snapshot.bodyScrollHeight],
    ["--browser top", snapshot.browserTop],
    ["--browser bottom", snapshot.browserBottom],
    ["--safe top", snapshot.safeAreaTop],
    ["--safe bottom", snapshot.safeAreaBottom],
    ["header pt", snapshot.headerPaddingTop],
    ["nav pb", snapshot.navPaddingBottom],
  ];

  return (
    <div className="fixed left-2 top-2 z-[var(--z-tooltip)] max-w-[min(22rem,calc(100vw-1rem))] rounded-lg border border-black/20 bg-black/85 p-2 text-[11px] leading-tight text-white shadow-lg">
      <div className="mb-1 flex items-center justify-between gap-2">
        <span className="font-semibold">Viewport debug</span>
        <button
          type="button"
          onClick={copySnapshot}
          className="min-h-0 min-w-0 rounded border border-white/30 px-2 py-0.5 text-[10px]"
        >
          Copy
        </button>
      </div>
      <div className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-0.5 font-mono">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <span className="text-white/60">{label}</span>
            <span className="break-all">{String(value)}</span>
          </div>
        ))}
      </div>
      <div className="mt-1 truncate text-[10px] text-white/60">
        {snapshot.timestamp} {snapshot.userAgent}
      </div>
    </div>
  );
}
