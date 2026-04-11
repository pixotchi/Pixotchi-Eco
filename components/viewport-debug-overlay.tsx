"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type ViewportDebugSnapshot = {
  activeElement: string;
  bodyScrollHeight: number;
  browserBottom: string;
  browserBottomPx: number | null;
  browserTop: string;
  browserTopPx: number | null;
  chromeState: "visible" | "hidden" | "keyboard";
  contentHeight: number | null;
  docClientHeight: number;
  docScrollHeight: number;
  headerHeight: number | null;
  headerPaddingTop: string;
  innerHeight: number;
  innerWidth: number;
  keyboardHeight: number | null;
  keyboardVisible: boolean;
  mainHeight: number | null;
  navHeight: number | null;
  navPaddingBottom: string;
  safeAreaBottom: string;
  safeAreaBottomPx: number | null;
  safeAreaTop: string;
  safeAreaTopPx: number | null;
  scrollY: number;
  shellInnerHeight: number | null;
  shellOuterHeight: number | null;
  timestamp: string;
  userAgent: string;
  vvHeight: number | null;
  vvOffsetTop: number | null;
  vvPageTop: number | null;
  vvScale: number | null;
  vvWidth: number | null;
};

type ViewportDebugEvent = {
  diff: string[];
  id: number;
  kind: string;
  snapshot: ViewportDebugSnapshot;
  source: string;
  summary: string;
  timestamp: string;
  unixMs: number;
};

const DEBUG_QUERY_PARAM = "viewportDebug";
const CHROME_VISIBILITY_THRESHOLD = 8;
const KEYBOARD_HEIGHT_THRESHOLD = 150;
const MAX_EVENTS = 200;
const CHURN_EVENT_THRESHOLD = 4;
const CHURN_WINDOW_MS = 1200;

function readCssVariable(styles: CSSStyleDeclaration, name: string) {
  return styles.getPropertyValue(name).trim() || "(empty)";
}

function parsePixelValue(value: string): number | null {
  if (!value || value === "(empty)") {
    return null;
  }

  const match = value.match(/-?\d+(\.\d+)?/);
  if (!match) {
    return null;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : null;
}

function describeActiveElement() {
  const activeElement = document.activeElement as HTMLElement | null;
  if (!activeElement) {
    return "none";
  }

  const id = activeElement.id ? `#${activeElement.id}` : "";
  const dataViewportShell = activeElement.dataset.viewportShell
    ? `[data-viewport-shell="${activeElement.dataset.viewportShell}"]`
    : "";
  const role = activeElement.getAttribute("role");
  const roleText = role ? `[role="${role}"]` : "";

  return `${activeElement.tagName.toLowerCase()}${id}${dataViewportShell}${roleText}`;
}

function readElementHeight(selector: string) {
  const element = document.querySelector(selector) as HTMLElement | null;
  if (!element) {
    return null;
  }

  return Math.round(element.getBoundingClientRect().height);
}

function getChromeState(snapshot: Pick<ViewportDebugSnapshot, "browserBottomPx" | "browserTopPx" | "keyboardVisible">) {
  if (snapshot.keyboardVisible) {
    return "keyboard" as const;
  }

  const topVisible = (snapshot.browserTopPx ?? 0) >= CHROME_VISIBILITY_THRESHOLD;
  const bottomVisible = (snapshot.browserBottomPx ?? 0) >= CHROME_VISIBILITY_THRESHOLD;

  return topVisible || bottomVisible ? "visible" as const : "hidden" as const;
}

function readSnapshot(): ViewportDebugSnapshot {
  const root = document.documentElement;
  const rootStyles = getComputedStyle(root);
  const viewport = window.visualViewport;
  const browserTop = readCssVariable(rootStyles, "--browser-safe-area-top");
  const browserBottom = readCssVariable(rootStyles, "--browser-safe-area-bottom");
  const safeAreaTop = readCssVariable(rootStyles, "--safe-area-inset-top");
  const safeAreaBottom = readCssVariable(rootStyles, "--safe-area-inset-bottom");
  const keyboardHeight = viewport
    ? Math.max(0, Math.round(window.innerHeight - viewport.height))
    : null;
  const keyboardVisible = keyboardHeight !== null && keyboardHeight > KEYBOARD_HEIGHT_THRESHOLD;

  const snapshot: ViewportDebugSnapshot = {
    activeElement: describeActiveElement(),
    bodyScrollHeight: document.body.scrollHeight,
    browserBottom,
    browserBottomPx: parsePixelValue(browserBottom),
    browserTop,
    browserTopPx: parsePixelValue(browserTop),
    chromeState: "hidden",
    contentHeight: readElementHeight('[data-viewport-shell="content"]'),
    docClientHeight: root.clientHeight,
    docScrollHeight: root.scrollHeight,
    headerHeight: readElementHeight('[data-viewport-shell="header"]'),
    headerPaddingTop: (() => {
      const header = document.querySelector('[data-viewport-shell="header"]');
      return header ? getComputedStyle(header).paddingTop : "(missing)";
    })(),
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    keyboardHeight,
    keyboardVisible,
    mainHeight: readElementHeight('[data-viewport-shell="main"]'),
    navHeight: readElementHeight('[data-viewport-shell="nav"]'),
    navPaddingBottom: (() => {
      const nav = document.querySelector('[data-viewport-shell="nav"]');
      return nav ? getComputedStyle(nav).paddingBottom : "(missing)";
    })(),
    safeAreaBottom,
    safeAreaBottomPx: parsePixelValue(safeAreaBottom),
    safeAreaTop,
    safeAreaTopPx: parsePixelValue(safeAreaTop),
    scrollY: window.scrollY,
    shellInnerHeight: readElementHeight('[data-viewport-shell="inner"]'),
    shellOuterHeight: readElementHeight('[data-viewport-shell="outer"]'),
    timestamp: new Date().toLocaleTimeString(),
    userAgent: navigator.userAgent,
    vvHeight: viewport ? Math.round(viewport.height) : null,
    vvOffsetTop: viewport ? Math.round(viewport.offsetTop) : null,
    vvPageTop: viewport ? Math.round(viewport.pageTop) : null,
    vvScale: viewport ? Number(viewport.scale.toFixed(2)) : null,
    vvWidth: viewport ? Math.round(viewport.width) : null,
  };

  snapshot.chromeState = getChromeState(snapshot);
  return snapshot;
}

function createFingerprint(snapshot: ViewportDebugSnapshot) {
  return JSON.stringify({
    activeElement: snapshot.activeElement,
    bodyScrollHeight: snapshot.bodyScrollHeight,
    browserBottomPx: snapshot.browserBottomPx,
    browserTopPx: snapshot.browserTopPx,
    chromeState: snapshot.chromeState,
    contentHeight: snapshot.contentHeight,
    docClientHeight: snapshot.docClientHeight,
    docScrollHeight: snapshot.docScrollHeight,
    headerHeight: snapshot.headerHeight,
    headerPaddingTop: snapshot.headerPaddingTop,
    innerHeight: snapshot.innerHeight,
    innerWidth: snapshot.innerWidth,
    keyboardHeight: snapshot.keyboardHeight,
    keyboardVisible: snapshot.keyboardVisible,
    mainHeight: snapshot.mainHeight,
    navHeight: snapshot.navHeight,
    navPaddingBottom: snapshot.navPaddingBottom,
    safeAreaBottomPx: snapshot.safeAreaBottomPx,
    safeAreaTopPx: snapshot.safeAreaTopPx,
    scrollY: snapshot.scrollY,
    shellInnerHeight: snapshot.shellInnerHeight,
    shellOuterHeight: snapshot.shellOuterHeight,
    vvHeight: snapshot.vvHeight,
    vvOffsetTop: snapshot.vvOffsetTop,
    vvPageTop: snapshot.vvPageTop,
    vvScale: snapshot.vvScale,
    vvWidth: snapshot.vvWidth,
  });
}

function pushChange(changes: string[], label: string, previous: unknown, next: unknown) {
  if (previous === next) {
    return;
  }

  changes.push(`${label}: ${String(previous)} -> ${String(next)}`);
}

function buildDiff(previous: ViewportDebugSnapshot, next: ViewportDebugSnapshot) {
  const changes: string[] = [];

  pushChange(changes, "vv.height", previous.vvHeight, next.vvHeight);
  pushChange(changes, "vv.width", previous.vvWidth, next.vvWidth);
  pushChange(changes, "vv.offsetTop", previous.vvOffsetTop, next.vvOffsetTop);
  pushChange(changes, "vv.pageTop", previous.vvPageTop, next.vvPageTop);
  pushChange(changes, "innerHeight", previous.innerHeight, next.innerHeight);
  pushChange(changes, "browserBottom", previous.browserBottomPx, next.browserBottomPx);
  pushChange(changes, "browserTop", previous.browserTopPx, next.browserTopPx);
  pushChange(changes, "safeAreaBottom", previous.safeAreaBottomPx, next.safeAreaBottomPx);
  pushChange(changes, "safeAreaTop", previous.safeAreaTopPx, next.safeAreaTopPx);
  pushChange(changes, "headerPaddingTop", previous.headerPaddingTop, next.headerPaddingTop);
  pushChange(changes, "navPaddingBottom", previous.navPaddingBottom, next.navPaddingBottom);
  pushChange(changes, "shellInnerHeight", previous.shellInnerHeight, next.shellInnerHeight);
  pushChange(changes, "shellOuterHeight", previous.shellOuterHeight, next.shellOuterHeight);
  pushChange(changes, "mainHeight", previous.mainHeight, next.mainHeight);
  pushChange(changes, "contentHeight", previous.contentHeight, next.contentHeight);
  pushChange(changes, "scrollY", previous.scrollY, next.scrollY);
  pushChange(changes, "keyboardVisible", previous.keyboardVisible, next.keyboardVisible);
  pushChange(changes, "activeElement", previous.activeElement, next.activeElement);

  return changes;
}

function buildSummary(previous: ViewportDebugSnapshot | null, next: ViewportDebugSnapshot, diff: string[], source: string) {
  if (!previous) {
    return `Debugger started from ${source}`;
  }

  const notes: string[] = [];
  const previousChromeVisible = previous.chromeState === "visible";
  const nextChromeVisible = next.chromeState === "visible";

  if (!previous.keyboardVisible && !next.keyboardVisible) {
    if (!previousChromeVisible && nextChromeVisible) {
      notes.push("browser chrome appeared");
    } else if (previousChromeVisible && !nextChromeVisible) {
      notes.push("browser chrome hidden");
    }

    if ((previous.browserBottomPx ?? 0) <= 2 && (next.browserBottomPx ?? 0) >= CHROME_VISIBILITY_THRESHOLD) {
      notes.push("bottom nav appeared");
    } else if ((previous.browserBottomPx ?? 0) >= CHROME_VISIBILITY_THRESHOLD && (next.browserBottomPx ?? 0) <= 2) {
      notes.push("bottom nav hidden");
    }

    if ((previous.browserTopPx ?? 0) <= 2 && (next.browserTopPx ?? 0) >= CHROME_VISIBILITY_THRESHOLD) {
      notes.push("top chrome appeared");
    } else if ((previous.browserTopPx ?? 0) >= CHROME_VISIBILITY_THRESHOLD && (next.browserTopPx ?? 0) <= 2) {
      notes.push("top chrome hidden");
    }
  }

  if (!previous.keyboardVisible && next.keyboardVisible) {
    notes.push(`keyboard appeared (${next.keyboardHeight ?? 0}px)`);
  } else if (previous.keyboardVisible && !next.keyboardVisible) {
    notes.push("keyboard hidden");
  }

  if (previous.vvScale !== next.vvScale) {
    notes.push(`scale ${previous.vvScale} -> ${next.vvScale}`);
  }

  if (previous.vvHeight !== next.vvHeight) {
    notes.push(`vv.height ${previous.vvHeight} -> ${next.vvHeight}`);
  }

  if (previous.shellInnerHeight !== next.shellInnerHeight) {
    notes.push(`shell ${previous.shellInnerHeight} -> ${next.shellInnerHeight}`);
  }

  if (notes.length === 0) {
    notes.push(diff.slice(0, 3).join(", "));
  }

  return notes.filter(Boolean).join("; ");
}

function formatUnixMs(unixMs: number) {
  return new Date(unixMs).toLocaleTimeString([], {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    fractionalSecondDigits: 3,
  });
}

export function ViewportDebugOverlay() {
  const [enabled, setEnabled] = useState(false);
  const [exportText, setExportText] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<ViewportDebugSnapshot | null>(null);
  const [events, setEvents] = useState<ViewportDebugEvent[]>([]);
  const eventIdRef = useRef(0);
  const fingerprintRef = useRef<string | null>(null);
  const lastSnapshotRef = useRef<ViewportDebugSnapshot | null>(null);
  const pendingSourcesRef = useRef<string[]>([]);
  const rafIdRef = useRef<number | null>(null);
  const recentChangeTimesRef = useRef<number[]>([]);
  const lastChurnEventAtRef = useRef(0);

  const appendEvent = useCallback(
    (kind: string, source: string, summary: string, nextSnapshot: ViewportDebugSnapshot, diff: string[] = []) => {
      const unixMs = Date.now();
      const event: ViewportDebugEvent = {
        diff,
        id: ++eventIdRef.current,
        kind,
        snapshot: nextSnapshot,
        source,
        summary,
        timestamp: formatUnixMs(unixMs),
        unixMs,
      };

      setEvents((previous) => [event, ...previous].slice(0, MAX_EVENTS));
      console.info("[ViewportDebug]", event);
    },
    [],
  );

  const captureSnapshot = useCallback(
    (source: string, kind = "layout-change", forcedSummary?: string) => {
      const nextSnapshot = readSnapshot();
      const nextFingerprint = createFingerprint(nextSnapshot);
      const previousSnapshot = lastSnapshotRef.current;

      setSnapshot(nextSnapshot);

      if (forcedSummary) {
        appendEvent(kind, source, forcedSummary, nextSnapshot);
        lastSnapshotRef.current = nextSnapshot;
        fingerprintRef.current = nextFingerprint;
        return;
      }

      if (!previousSnapshot || fingerprintRef.current === null) {
        appendEvent("init", source, buildSummary(null, nextSnapshot, [], source), nextSnapshot);
        lastSnapshotRef.current = nextSnapshot;
        fingerprintRef.current = nextFingerprint;
        return;
      }

      if (fingerprintRef.current === nextFingerprint) {
        return;
      }

      const diff = buildDiff(previousSnapshot, nextSnapshot);
      appendEvent(kind, source, buildSummary(previousSnapshot, nextSnapshot, diff, source), nextSnapshot, diff);

      const now = Date.now();
      const recent = [...recentChangeTimesRef.current.filter((time) => now - time <= CHURN_WINDOW_MS), now];
      recentChangeTimesRef.current = recent;

      if (
        recent.length >= CHURN_EVENT_THRESHOLD &&
        now - lastChurnEventAtRef.current > CHURN_WINDOW_MS
      ) {
        lastChurnEventAtRef.current = now;
        appendEvent(
          "rapid-churn",
          source,
          `Rapid layout churn detected (${recent.length} changes in ${CHURN_WINDOW_MS}ms)`,
          nextSnapshot,
          diff,
        );
      }

      lastSnapshotRef.current = nextSnapshot;
      fingerprintRef.current = nextFingerprint;
    },
    [appendEvent],
  );

  const scheduleCapture = useCallback(
    (source: string, kind = "layout-change", forcedSummary?: string) => {
      if (!enabled) {
        return;
      }

      if (forcedSummary) {
        captureSnapshot(source, kind, forcedSummary);
        return;
      }

      pendingSourcesRef.current.push(source);
      if (rafIdRef.current !== null) {
        return;
      }

      rafIdRef.current = window.requestAnimationFrame(() => {
        const sources = Array.from(new Set(pendingSourcesRef.current));
        pendingSourcesRef.current = [];
        rafIdRef.current = null;
        captureSnapshot(sources.join(", "));
      });
    },
    [captureSnapshot, enabled],
  );

  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const debugValue = searchParams.get(DEBUG_QUERY_PARAM);
    const isEnabled = debugValue === "1" || debugValue === "true";
    setEnabled(isEnabled);
  }, []);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    captureSnapshot("init");

    const onWindowResize = () => scheduleCapture("window.resize");
    const onWindowScroll = () => scheduleCapture("window.scroll");
    const onOrientationChange = () => scheduleCapture("orientationchange");
    const onViewportResize = () => scheduleCapture("visualViewport.resize");
    const onViewportScroll = () => scheduleCapture("visualViewport.scroll");

    window.addEventListener("resize", onWindowResize);
    window.addEventListener("scroll", onWindowScroll, { passive: true });
    window.addEventListener("orientationchange", onOrientationChange);
    window.visualViewport?.addEventListener("resize", onViewportResize);
    window.visualViewport?.addEventListener("scroll", onViewportScroll);

    const pollId = window.setInterval(() => {
      scheduleCapture("poll");
    }, 1000);

    const mutationObserver = new MutationObserver((records) => {
      const interestingMutations = records
        .filter((record) => record.type === "attributes")
        .map((record) => {
          const target = record.target as HTMLElement;
          const shellKey = target.dataset.viewportShell;
          const targetLabel = shellKey ? `shell:${shellKey}` : target.tagName.toLowerCase();
          return `${targetLabel}.${record.attributeName ?? "unknown"}`;
        });

      if (interestingMutations.length > 0) {
        scheduleCapture(`mutation:${Array.from(new Set(interestingMutations)).join(",")}`);
      }
    });

    mutationObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "style"],
    });

    document
      .querySelectorAll("[data-viewport-shell]")
      .forEach((element) =>
        mutationObserver.observe(element, {
          attributes: true,
          attributeFilter: ["class", "style"],
        }),
      );

    return () => {
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("scroll", onWindowScroll);
      window.removeEventListener("orientationchange", onOrientationChange);
      window.visualViewport?.removeEventListener("resize", onViewportResize);
      window.visualViewport?.removeEventListener("scroll", onViewportScroll);
      window.clearInterval(pollId);
      mutationObserver.disconnect();

      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [captureSnapshot, enabled, scheduleCapture]);

  const copySnapshot = useCallback(async () => {
    if (!snapshot) {
      return;
    }

    const payload = JSON.stringify(snapshot, null, 2);

    try {
      await navigator.clipboard.writeText(payload);
      setExportText(null);
    } catch {
      setExportText(payload);
    }
  }, [snapshot]);

  const copyLog = useCallback(async () => {
    const payload = {
      copiedAt: new Date().toISOString(),
      currentSnapshot: snapshot,
      events: [...events].reverse(),
    };

    const serialized = JSON.stringify(payload, null, 2);

    try {
      await navigator.clipboard.writeText(serialized);
      setExportText(null);
    } catch {
      setExportText(serialized);
    }
  }, [events, snapshot]);

  const toggleExportText = useCallback(() => {
    if (exportText) {
      setExportText(null);
      return;
    }

    setExportText(JSON.stringify({
      copiedAt: new Date().toISOString(),
      currentSnapshot: snapshot,
      events: [...events].reverse(),
    }, null, 2));
  }, [events, exportText, snapshot]);

  const clearLog = useCallback(() => {
    setEvents([]);
    recentChangeTimesRef.current = [];
    lastChurnEventAtRef.current = 0;
    scheduleCapture("manual.clear", "manual", "Log cleared");
  }, [scheduleCapture]);

  const markGlitch = useCallback(() => {
    scheduleCapture("manual.glitch", "manual-glitch", "Manual glitch marker");
  }, [scheduleCapture]);

  if (!enabled || !snapshot) {
    return null;
  }

  const rows: Array<[string, string | number | boolean | null]> = [
    ["chrome", snapshot.chromeState],
    ["keyboard", snapshot.keyboardVisible],
    ["keyboard px", snapshot.keyboardHeight],
    ["inner", `${snapshot.innerWidth}x${snapshot.innerHeight}`],
    ["vv", snapshot.vvWidth && snapshot.vvHeight ? `${snapshot.vvWidth}x${snapshot.vvHeight}` : "null"],
    ["vv.offsetTop", snapshot.vvOffsetTop],
    ["vv.pageTop", snapshot.vvPageTop],
    ["vv.scale", snapshot.vvScale],
    ["scrollY", snapshot.scrollY],
    ["shell", snapshot.shellInnerHeight],
    ["main", snapshot.mainHeight],
    ["content", snapshot.contentHeight],
    ["header", snapshot.headerHeight],
    ["nav", snapshot.navHeight],
    ["docH", `${snapshot.docClientHeight}/${snapshot.docScrollHeight}`],
    ["bodyH", snapshot.bodyScrollHeight],
    ["--browser top", snapshot.browserTop],
    ["--browser bottom", snapshot.browserBottom],
    ["--safe top", snapshot.safeAreaTop],
    ["--safe bottom", snapshot.safeAreaBottom],
    ["header pt", snapshot.headerPaddingTop],
    ["nav pb", snapshot.navPaddingBottom],
    ["active", snapshot.activeElement],
  ];

  return (
    <div className="fixed left-2 top-2 z-[4000] flex max-h-[calc(100dvh-1rem)] w-[min(26rem,calc(100vw-1rem))] flex-col overflow-hidden rounded-lg border border-black/20 bg-black/85 p-2 text-[11px] leading-tight text-white shadow-lg">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="font-semibold">Viewport debug</span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={markGlitch}
            className="min-h-0 min-w-0 rounded border border-amber-400/60 px-2 py-0.5 text-[10px] text-amber-200"
          >
            Mark glitch
          </button>
          <button
            type="button"
            onClick={copySnapshot}
            className="min-h-0 min-w-0 rounded border border-white/30 px-2 py-0.5 text-[10px]"
          >
            Copy snapshot
          </button>
          <button
            type="button"
            onClick={copyLog}
            className="min-h-0 min-w-0 rounded border border-white/30 px-2 py-0.5 text-[10px]"
          >
            Copy log
          </button>
          <button
            type="button"
            onClick={toggleExportText}
            className="min-h-0 min-w-0 rounded border border-white/30 px-2 py-0.5 text-[10px]"
          >
            {exportText ? "Hide JSON" : "Show JSON"}
          </button>
          <button
            type="button"
            onClick={clearLog}
            className="min-h-0 min-w-0 rounded border border-white/30 px-2 py-0.5 text-[10px]"
          >
            Clear
          </button>
        </div>
      </div>

      <div className="grid grid-cols-[7.5rem_1fr] gap-x-2 gap-y-0.5 font-mono">
        {rows.map(([label, value]) => (
          <div key={label} className="contents">
            <span className="text-white/60">{label}</span>
            <span className="break-all">{String(value)}</span>
          </div>
        ))}
      </div>

      <div className="mt-2 rounded border border-white/10 bg-white/5 p-2 text-[10px] text-white/75">
        Reproduce the issue, swipe to show and hide the Base nav bar, and tap `Mark glitch` while the flicker is visible.
      </div>

      {exportText ? (
        <div className="mt-2 rounded border border-white/10 bg-white/5 p-2">
          <div className="mb-1 text-[10px] text-white/70">
            JSON fallback. Use this if clipboard copy is blocked in the in-app browser.
          </div>
          <textarea
            readOnly
            value={exportText}
            className="h-32 w-full resize-none rounded border border-white/10 bg-black/40 p-2 font-mono text-[10px] text-white"
          />
        </div>
      ) : null}

      <div className="mt-2 flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-white/10 bg-white/5">
        <div className="flex items-center justify-between border-b border-white/10 px-2 py-1">
          <span className="font-semibold">Recent events</span>
          <span className="text-[10px] text-white/60">{events.length} stored</span>
        </div>
        <div className="min-h-0 overflow-y-auto px-2 py-1 font-mono">
          {events.length === 0 ? (
            <div className="py-2 text-[10px] text-white/60">No events captured yet.</div>
          ) : (
            events.map((event) => (
              <div key={event.id} className="border-b border-white/5 py-1 last:border-b-0">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-[10px] text-cyan-200">{event.timestamp}</span>
                  <span className="shrink-0 text-[10px] text-white/50">{event.kind}</span>
                </div>
                <div className="mt-0.5 text-[10px] text-white">{event.summary}</div>
                <div className="mt-0.5 break-all text-[10px] text-white/55">{event.source}</div>
                {event.diff.length > 0 ? (
                  <div className="mt-0.5 break-all text-[10px] text-white/45">
                    {event.diff.slice(0, 4).join(" | ")}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      </div>

      <div className="mt-1 truncate text-[10px] text-white/60">
        {snapshot.timestamp} {snapshot.userAgent}
      </div>
    </div>
  );
}
