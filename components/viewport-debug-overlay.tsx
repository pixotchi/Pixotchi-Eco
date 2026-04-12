"use client";

import { useCallback, useEffect, useRef, useState } from "react";

import { type HostEnvironmentState, useHostEnvironment } from "@/lib/host-environment";

type ViewportDebugSnapshot = {
  activeElement: string;
  backdropFilterActiveCount: number;
  bodyScrollHeight: number;
  blurClassElementCount: number;
  browserBottom: string;
  browserBottomPx: number | null;
  browserBottomResolvedPx: number | null;
  browserTop: string;
  browserTopPx: number | null;
  browserTopResolvedPx: number | null;
  chromeState: "visible" | "hidden" | "keyboard";
  contentHeight: number | null;
  dialogOverlayBackdropActiveCount: number;
  dialogOverlayCount: number;
  dialogOverlayRectSummary: string;
  dialogSurfaceBackdropActiveCount: number;
  dialogSurfaceCount: number;
  dialogSurfaceRectSummary: string;
  docClientHeight: number;
  docScrollHeight: number;
  headerHeight: number | null;
  headerPaddingTop: string;
  hostClientFid: number | null;
  hostClientName: string | null;
  hostResolutionSource: string;
  hostSafeAreaBottomPx: number | null;
  hostSafeAreaTopPx: number | null;
  innerHeight: number;
  innerWidth: number;
  keyboardHeight: number | null;
  keyboardVisible: boolean;
  mainHeight: number | null;
  navHeight: number | null;
  navPaddingBottom: string;
  navPaddingBottomPx: number | null;
  navVisibleLikely: boolean;
  navVisibleReason: string;
  safeAreaBottom: string;
  safeAreaBottomPx: number | null;
  safeAreaBottomResolvedPx: number | null;
  safeAreaTop: string;
  safeAreaTopPx: number | null;
  safeAreaTopResolvedPx: number | null;
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

type NavVisibleSessionState = {
  active: boolean;
  durationMs: number;
  endedAt: number | null;
  glitchCount: number;
  id: number | null;
  lastReason: string;
  layoutChangeCount: number;
  startedAt: number | null;
};

type TrackedElementSummary = {
  backdropActiveCount: number;
  count: number;
  rectSummary: string;
};

const DEBUG_QUERY_PARAM = "viewportDebug";
const CHROME_VISIBILITY_THRESHOLD = 8;
const NAV_VISIBLE_THRESHOLD = 12;
const KEYBOARD_HEIGHT_THRESHOLD = 150;
const MAX_EVENTS = 200;
const CHURN_EVENT_THRESHOLD = 4;
const CHURN_WINDOW_MS = 1200;
const TRACKED_DIALOG_SELECTOR = "[data-viewport-debug-dialog-overlay], [data-viewport-debug-dialog-frame], [data-viewport-debug-dialog-surface]";
const TRACKED_BLUR_SELECTOR = '[class*="backdrop-blur"]';
const DEFAULT_NAV_SESSION: NavVisibleSessionState = {
  active: false,
  durationMs: 0,
  endedAt: null,
  glitchCount: 0,
  id: null,
  lastReason: "none",
  layoutChangeCount: 0,
  startedAt: null,
};

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

function resolveCssLengthValue(
  value: string,
  property: "paddingBottom" | "paddingTop",
): number | null {
  if (!value || value === "(empty)") {
    return null;
  }

  if (typeof document === "undefined" || !document.body) {
    return parsePixelValue(value);
  }

  const probe = document.createElement("div");
  probe.style.position = "fixed";
  probe.style.visibility = "hidden";
  probe.style.pointerEvents = "none";
  probe.style.inset = "0 auto auto 0";
  probe.style[property] = value;
  document.body.appendChild(probe);

  const resolved = parsePixelValue(getComputedStyle(probe)[property]);
  probe.remove();
  return resolved;
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

function readElementProperty(selector: string, property: keyof CSSStyleDeclaration) {
  const element = document.querySelector(selector) as HTMLElement | null;
  if (!element) {
    return "(missing)";
  }

  const styles = getComputedStyle(element);
  const value = styles[property];
  return typeof value === "string" && value.trim() ? value.trim() : "(empty)";
}

function getBackdropValue(styles: CSSStyleDeclaration) {
  return (styles.backdropFilter || (styles as CSSStyleDeclaration & { webkitBackdropFilter?: string }).webkitBackdropFilter || "none").trim();
}

function hasBackdropFilter(styles: CSSStyleDeclaration) {
  const value = getBackdropValue(styles);
  return value !== "" && value !== "none";
}

function formatRect(rect: DOMRect) {
  return `t${Math.round(rect.top)} l${Math.round(rect.left)} w${Math.round(rect.width)} h${Math.round(rect.height)}`;
}

function readTrackedElements(selector: string): TrackedElementSummary {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(selector));
  const rectSummary = elements
    .slice(0, 3)
    .map((element, index) => `#${index + 1} ${formatRect(element.getBoundingClientRect())}`)
    .join(" ; ") || "(none)";

  const backdropActiveCount = elements.reduce((count, element) => {
    const styles = getComputedStyle(element);
    return count + (hasBackdropFilter(styles) ? 1 : 0);
  }, 0);

  return {
    backdropActiveCount,
    count: elements.length,
    rectSummary,
  };
}

function readBackdropMetrics() {
  const elements = Array.from(document.querySelectorAll<HTMLElement>(TRACKED_BLUR_SELECTOR));
  const activeCount = elements.reduce((count, element) => {
    const styles = getComputedStyle(element);
    return count + (hasBackdropFilter(styles) ? 1 : 0);
  }, 0);

  return {
    activeCount,
    blurClassElementCount: elements.length,
  };
}

function readHostClient(context: HostEnvironmentState["context"]) {
  if (!context || typeof context !== "object") {
    return {
      hostClientFid: null,
      hostClientName: null,
      hostSafeAreaBottomPx: null,
      hostSafeAreaTopPx: null,
    };
  }

  const client = (context as {
    client?: {
      clientFid?: number;
      name?: string;
      safeAreaInsets?: {
        bottom?: number;
        top?: number;
      };
    };
  }).client;

  return {
    hostClientFid: typeof client?.clientFid === "number" ? client.clientFid : null,
    hostClientName: typeof client?.name === "string" ? client.name : null,
    hostSafeAreaBottomPx: typeof client?.safeAreaInsets?.bottom === "number" ? client.safeAreaInsets.bottom : null,
    hostSafeAreaTopPx: typeof client?.safeAreaInsets?.top === "number" ? client.safeAreaInsets.top : null,
  };
}

function getNavVisibility(snapshot: Pick<
  ViewportDebugSnapshot,
  | "browserBottomResolvedPx"
  | "hostSafeAreaBottomPx"
  | "navPaddingBottomPx"
  | "safeAreaBottomResolvedPx"
>) {
  const reasons: string[] = [];

  if ((snapshot.hostSafeAreaBottomPx ?? 0) >= NAV_VISIBLE_THRESHOLD) {
    reasons.push(`host ${snapshot.hostSafeAreaBottomPx}px`);
  }
  if ((snapshot.safeAreaBottomResolvedPx ?? 0) >= NAV_VISIBLE_THRESHOLD) {
    reasons.push(`safe ${snapshot.safeAreaBottomResolvedPx}px`);
  }
  if ((snapshot.browserBottomResolvedPx ?? 0) >= NAV_VISIBLE_THRESHOLD) {
    reasons.push(`browser ${snapshot.browserBottomResolvedPx}px`);
  }
  if ((snapshot.navPaddingBottomPx ?? 0) >= NAV_VISIBLE_THRESHOLD) {
    reasons.push(`nav ${snapshot.navPaddingBottomPx}px`);
  }

  return {
    navVisibleLikely: reasons.length > 0,
    navVisibleReason: reasons.join(", ") || "none",
  };
}

function getChromeState(snapshot: Pick<
  ViewportDebugSnapshot,
  "browserTopResolvedPx" | "keyboardVisible" | "navVisibleLikely"
>) {
  if (snapshot.keyboardVisible) {
    return "keyboard" as const;
  }

  const topVisible = (snapshot.browserTopResolvedPx ?? 0) >= CHROME_VISIBILITY_THRESHOLD;
  return topVisible || snapshot.navVisibleLikely ? "visible" as const : "hidden" as const;
}

function readSnapshot(hostEnvironment: HostEnvironmentState): ViewportDebugSnapshot {
  const root = document.documentElement;
  const rootStyles = getComputedStyle(root);
  const viewport = window.visualViewport;
  const browserTop = readCssVariable(rootStyles, "--browser-safe-area-top");
  const browserBottom = readCssVariable(rootStyles, "--browser-safe-area-bottom");
  const safeAreaTop = readCssVariable(rootStyles, "--safe-area-inset-top");
  const safeAreaBottom = readCssVariable(rootStyles, "--safe-area-inset-bottom");
  const browserTopResolvedPx = resolveCssLengthValue(browserTop, "paddingTop");
  const browserBottomResolvedPx = resolveCssLengthValue(browserBottom, "paddingBottom");
  const safeAreaTopResolvedPx = resolveCssLengthValue(safeAreaTop, "paddingTop");
  const safeAreaBottomResolvedPx = resolveCssLengthValue(safeAreaBottom, "paddingBottom");
  const keyboardHeight = viewport
    ? Math.max(0, Math.round(window.innerHeight - viewport.height))
    : null;
  const keyboardVisible = keyboardHeight !== null && keyboardHeight > KEYBOARD_HEIGHT_THRESHOLD;
  const navPaddingBottom = readElementProperty('[data-viewport-shell="nav"]', "paddingBottom");
  const navPaddingBottomPx = parsePixelValue(navPaddingBottom);
  const dialogOverlayMetrics = readTrackedElements("[data-viewport-debug-dialog-overlay]");
  const dialogSurfaceMetrics = readTrackedElements("[data-viewport-debug-dialog-surface]");
  const backdropMetrics = readBackdropMetrics();
  const hostClient = readHostClient(hostEnvironment.context);

  const snapshot: ViewportDebugSnapshot = {
    activeElement: describeActiveElement(),
    backdropFilterActiveCount: backdropMetrics.activeCount,
    bodyScrollHeight: document.body.scrollHeight,
    blurClassElementCount: backdropMetrics.blurClassElementCount,
    browserBottom,
    browserBottomPx: parsePixelValue(browserBottom),
    browserBottomResolvedPx,
    browserTop,
    browserTopPx: parsePixelValue(browserTop),
    browserTopResolvedPx,
    chromeState: "hidden",
    contentHeight: readElementHeight('[data-viewport-shell="content"]'),
    dialogOverlayBackdropActiveCount: dialogOverlayMetrics.backdropActiveCount,
    dialogOverlayCount: dialogOverlayMetrics.count,
    dialogOverlayRectSummary: dialogOverlayMetrics.rectSummary,
    dialogSurfaceBackdropActiveCount: dialogSurfaceMetrics.backdropActiveCount,
    dialogSurfaceCount: dialogSurfaceMetrics.count,
    dialogSurfaceRectSummary: dialogSurfaceMetrics.rectSummary,
    docClientHeight: root.clientHeight,
    docScrollHeight: root.scrollHeight,
    headerHeight: readElementHeight('[data-viewport-shell="header"]'),
    headerPaddingTop: readElementProperty('[data-viewport-shell="header"]', "paddingTop"),
    hostClientFid: hostClient.hostClientFid,
    hostClientName: hostClient.hostClientName,
    hostResolutionSource: hostEnvironment.resolutionSource,
    hostSafeAreaBottomPx: hostClient.hostSafeAreaBottomPx,
    hostSafeAreaTopPx: hostClient.hostSafeAreaTopPx,
    innerHeight: window.innerHeight,
    innerWidth: window.innerWidth,
    keyboardHeight,
    keyboardVisible,
    mainHeight: readElementHeight('[data-viewport-shell="main"]'),
    navHeight: readElementHeight('[data-viewport-shell="nav"]'),
    navPaddingBottom,
    navPaddingBottomPx,
    navVisibleLikely: false,
    navVisibleReason: "none",
    safeAreaBottom,
    safeAreaBottomPx: parsePixelValue(safeAreaBottom),
    safeAreaBottomResolvedPx,
    safeAreaTop,
    safeAreaTopPx: parsePixelValue(safeAreaTop),
    safeAreaTopResolvedPx,
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

  const navVisibility = getNavVisibility(snapshot);
  snapshot.navVisibleLikely = navVisibility.navVisibleLikely;
  snapshot.navVisibleReason = navVisibility.navVisibleReason;
  snapshot.chromeState = getChromeState(snapshot);
  return snapshot;
}

function createFingerprint(snapshot: ViewportDebugSnapshot) {
  return JSON.stringify({
    activeElement: snapshot.activeElement,
    backdropFilterActiveCount: snapshot.backdropFilterActiveCount,
    blurClassElementCount: snapshot.blurClassElementCount,
    browserBottomResolvedPx: snapshot.browserBottomResolvedPx,
    browserTopResolvedPx: snapshot.browserTopResolvedPx,
    chromeState: snapshot.chromeState,
    contentHeight: snapshot.contentHeight,
    dialogOverlayBackdropActiveCount: snapshot.dialogOverlayBackdropActiveCount,
    dialogOverlayCount: snapshot.dialogOverlayCount,
    dialogOverlayRectSummary: snapshot.dialogOverlayRectSummary,
    dialogSurfaceBackdropActiveCount: snapshot.dialogSurfaceBackdropActiveCount,
    dialogSurfaceCount: snapshot.dialogSurfaceCount,
    dialogSurfaceRectSummary: snapshot.dialogSurfaceRectSummary,
    docClientHeight: snapshot.docClientHeight,
    docScrollHeight: snapshot.docScrollHeight,
    headerHeight: snapshot.headerHeight,
    headerPaddingTop: snapshot.headerPaddingTop,
    hostSafeAreaBottomPx: snapshot.hostSafeAreaBottomPx,
    hostSafeAreaTopPx: snapshot.hostSafeAreaTopPx,
    innerHeight: snapshot.innerHeight,
    innerWidth: snapshot.innerWidth,
    keyboardHeight: snapshot.keyboardHeight,
    keyboardVisible: snapshot.keyboardVisible,
    mainHeight: snapshot.mainHeight,
    navHeight: snapshot.navHeight,
    navPaddingBottom: snapshot.navPaddingBottom,
    navVisibleLikely: snapshot.navVisibleLikely,
    navVisibleReason: snapshot.navVisibleReason,
    safeAreaBottomResolvedPx: snapshot.safeAreaBottomResolvedPx,
    safeAreaTopResolvedPx: snapshot.safeAreaTopResolvedPx,
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
  pushChange(changes, "browserBottomResolved", previous.browserBottomResolvedPx, next.browserBottomResolvedPx);
  pushChange(changes, "browserTopResolved", previous.browserTopResolvedPx, next.browserTopResolvedPx);
  pushChange(changes, "safeAreaBottomResolved", previous.safeAreaBottomResolvedPx, next.safeAreaBottomResolvedPx);
  pushChange(changes, "hostSafeAreaBottom", previous.hostSafeAreaBottomPx, next.hostSafeAreaBottomPx);
  pushChange(changes, "navVisible", previous.navVisibleLikely, next.navVisibleLikely);
  pushChange(changes, "navVisibleReason", previous.navVisibleReason, next.navVisibleReason);
  pushChange(changes, "headerPaddingTop", previous.headerPaddingTop, next.headerPaddingTop);
  pushChange(changes, "navPaddingBottom", previous.navPaddingBottom, next.navPaddingBottom);
  pushChange(changes, "shellInnerHeight", previous.shellInnerHeight, next.shellInnerHeight);
  pushChange(changes, "shellOuterHeight", previous.shellOuterHeight, next.shellOuterHeight);
  pushChange(changes, "mainHeight", previous.mainHeight, next.mainHeight);
  pushChange(changes, "contentHeight", previous.contentHeight, next.contentHeight);
  pushChange(changes, "dialogOverlayCount", previous.dialogOverlayCount, next.dialogOverlayCount);
  pushChange(changes, "dialogOverlayRects", previous.dialogOverlayRectSummary, next.dialogOverlayRectSummary);
  pushChange(changes, "dialogSurfaceCount", previous.dialogSurfaceCount, next.dialogSurfaceCount);
  pushChange(changes, "dialogSurfaceRects", previous.dialogSurfaceRectSummary, next.dialogSurfaceRectSummary);
  pushChange(changes, "blurClassCount", previous.blurClassElementCount, next.blurClassElementCount);
  pushChange(changes, "backdropFilterActiveCount", previous.backdropFilterActiveCount, next.backdropFilterActiveCount);
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

  if (!previous.keyboardVisible && !next.keyboardVisible) {
    if (!previous.navVisibleLikely && next.navVisibleLikely) {
      notes.push(`nav visible (${next.navVisibleReason})`);
    } else if (previous.navVisibleLikely && !next.navVisibleLikely) {
      notes.push("nav hidden");
    }

    if ((previous.browserTopResolvedPx ?? 0) <= 2 && (next.browserTopResolvedPx ?? 0) >= CHROME_VISIBILITY_THRESHOLD) {
      notes.push("top chrome appeared");
    } else if ((previous.browserTopResolvedPx ?? 0) >= CHROME_VISIBILITY_THRESHOLD && (next.browserTopResolvedPx ?? 0) <= 2) {
      notes.push("top chrome hidden");
    }
  }

  if (!previous.keyboardVisible && next.keyboardVisible) {
    notes.push(`keyboard appeared (${next.keyboardHeight ?? 0}px)`);
  } else if (previous.keyboardVisible && !next.keyboardVisible) {
    notes.push("keyboard hidden");
  }

  if (previous.dialogSurfaceCount !== next.dialogSurfaceCount) {
    notes.push(`dialog surfaces ${previous.dialogSurfaceCount} -> ${next.dialogSurfaceCount}`);
  } else if (
    next.dialogSurfaceCount > 0 &&
    previous.dialogSurfaceRectSummary !== next.dialogSurfaceRectSummary
  ) {
    notes.push("dialog surface moved/resized");
  }

  if (previous.dialogOverlayCount !== next.dialogOverlayCount) {
    notes.push(`dialog overlays ${previous.dialogOverlayCount} -> ${next.dialogOverlayCount}`);
  } else if (
    next.dialogOverlayCount > 0 &&
    previous.dialogOverlayRectSummary !== next.dialogOverlayRectSummary
  ) {
    notes.push("dialog overlay rect changed");
  }

  if (previous.blurClassElementCount !== next.blurClassElementCount) {
    notes.push(`blur layers ${previous.blurClassElementCount} -> ${next.blurClassElementCount}`);
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
    fractionalSecondDigits: 3,
    hour: "2-digit",
    hour12: false,
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(durationMs: number) {
  return `${(durationMs / 1000).toFixed(1)}s`;
}

function isTrackedDebugElement(element: Element) {
  if (!(element instanceof HTMLElement)) {
    return false;
  }

  return element.matches(TRACKED_DIALOG_SELECTOR) || element.matches(TRACKED_BLUR_SELECTOR);
}

function nodeContainsTrackedDebugElement(node: Node) {
  if (!(node instanceof HTMLElement)) {
    return false;
  }

  return isTrackedDebugElement(node) || !!node.querySelector(TRACKED_DIALOG_SELECTOR) || !!node.querySelector(TRACKED_BLUR_SELECTOR);
}

function buildExportPayload(
  snapshot: ViewportDebugSnapshot | null,
  navSession: NavVisibleSessionState,
  events: ViewportDebugEvent[],
) {
  return {
    copiedAt: new Date().toISOString(),
    currentSnapshot: snapshot,
    navVisibleSession: navSession,
    events: [...events].reverse(),
  };
}

export function ViewportDebugOverlay() {
  const hostEnvironment = useHostEnvironment();
  const [expanded, setExpanded] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const [exportText, setExportText] = useState<string | null>(null);
  const [navSession, setNavSession] = useState<NavVisibleSessionState>(DEFAULT_NAV_SESSION);
  const [panelOpen, setPanelOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<ViewportDebugSnapshot | null>(null);
  const [events, setEvents] = useState<ViewportDebugEvent[]>([]);
  const eventIdRef = useRef(0);
  const fingerprintRef = useRef<string | null>(null);
  const lastSnapshotRef = useRef<ViewportDebugSnapshot | null>(null);
  const navSessionIdRef = useRef(0);
  const navSessionRef = useRef<NavVisibleSessionState>(DEFAULT_NAV_SESSION);
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

  const syncNavSession = useCallback(
    (
      nextSnapshot: ViewportDebugSnapshot,
      kind: string,
      hasLayoutChange: boolean,
    ) => {
      const now = Date.now();
      const previousSession = navSessionRef.current;
      let nextSession = previousSession;
      let sessionEvent:
        | {
            kind: string;
            summary: string;
          }
        | null = null;

      if (nextSnapshot.navVisibleLikely) {
        if (!previousSession.active) {
          nextSession = {
            active: true,
            durationMs: 0,
            endedAt: null,
            glitchCount: kind === "manual-glitch" ? 1 : 0,
            id: ++navSessionIdRef.current,
            lastReason: nextSnapshot.navVisibleReason,
            layoutChangeCount: hasLayoutChange && kind === "layout-change" ? 1 : 0,
            startedAt: now,
          };
          sessionEvent = {
            kind: "nav-session",
            summary: `Nav-visible session started (${nextSnapshot.navVisibleReason})`,
          };
        } else {
          nextSession = {
            ...previousSession,
            active: true,
            durationMs: now - (previousSession.startedAt ?? now),
            endedAt: null,
            lastReason: nextSnapshot.navVisibleReason,
          };

          if (hasLayoutChange && kind === "layout-change") {
            nextSession.layoutChangeCount += 1;
          }
          if (kind === "manual-glitch") {
            nextSession.glitchCount += 1;
          }
        }
      } else if (previousSession.active) {
        nextSession = {
          ...previousSession,
          active: false,
          durationMs: now - (previousSession.startedAt ?? now),
          endedAt: now,
        };
        sessionEvent = {
          kind: "nav-session",
          summary: `Nav-visible session ended after ${formatDuration(nextSession.durationMs)}; glitches ${nextSession.glitchCount}; layout changes ${nextSession.layoutChangeCount}`,
        };
      }

      navSessionRef.current = nextSession;
      setNavSession(nextSession);
      return sessionEvent;
    },
    [],
  );

  const captureSnapshot = useCallback(
    (source: string, kind = "layout-change", forcedSummary?: string) => {
      const nextSnapshot = readSnapshot(hostEnvironment);
      const nextFingerprint = createFingerprint(nextSnapshot);
      const previousSnapshot = lastSnapshotRef.current;
      const hasLayoutChange = !previousSnapshot || fingerprintRef.current !== nextFingerprint;
      const sessionEvent = syncNavSession(nextSnapshot, kind, hasLayoutChange);

      setSnapshot(nextSnapshot);

      if (sessionEvent) {
        appendEvent(sessionEvent.kind, source, sessionEvent.summary, nextSnapshot);
      }

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

      if (!hasLayoutChange) {
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
    [appendEvent, hostEnvironment, syncNavSession],
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

    const shellMutationObserver = new MutationObserver((records) => {
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

    shellMutationObserver.observe(document.documentElement, {
      attributeFilter: ["class", "style"],
      attributes: true,
    });

    document
      .querySelectorAll("[data-viewport-shell]")
      .forEach((element) =>
        shellMutationObserver.observe(element, {
          attributeFilter: ["class", "style"],
          attributes: true,
        }),
      );

    const portalMutationObserver = new MutationObserver((records) => {
      const labels = records.flatMap((record) => {
        if (record.type === "childList") {
          const changedNodes = [...Array.from(record.addedNodes), ...Array.from(record.removedNodes)];
          if (changedNodes.some(nodeContainsTrackedDebugElement)) {
            return ["portal.childList"];
          }
          return [];
        }

        const target = record.target as Element;
        if (!isTrackedDebugElement(target)) {
          return [];
        }

        return [`tracked.${record.attributeName ?? "unknown"}`];
      });

      if (labels.length > 0) {
        scheduleCapture(`mutation:${Array.from(new Set(labels)).join(",")}`);
      }
    });

    if (document.body) {
      portalMutationObserver.observe(document.body, {
        attributeFilter: ["class", "data-state", "style"],
        attributes: true,
        childList: true,
        subtree: true,
      });
    }

    return () => {
      window.removeEventListener("resize", onWindowResize);
      window.removeEventListener("scroll", onWindowScroll);
      window.removeEventListener("orientationchange", onOrientationChange);
      window.visualViewport?.removeEventListener("resize", onViewportResize);
      window.visualViewport?.removeEventListener("scroll", onViewportScroll);
      window.clearInterval(pollId);
      shellMutationObserver.disconnect();
      portalMutationObserver.disconnect();

      if (rafIdRef.current !== null) {
        window.cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
    };
  }, [captureSnapshot, enabled, scheduleCapture]);

  const copySnapshot = useCallback(async () => {
    const payload = JSON.stringify(
      {
        copiedAt: new Date().toISOString(),
        currentSnapshot: snapshot,
        navVisibleSession: navSession,
      },
      null,
      2,
    );

    try {
      await navigator.clipboard.writeText(payload);
      setExportText(null);
    } catch {
      setExportText(payload);
    }
  }, [navSession, snapshot]);

  const copyLog = useCallback(async () => {
    const serialized = JSON.stringify(buildExportPayload(snapshot, navSession, events), null, 2);

    try {
      await navigator.clipboard.writeText(serialized);
      setExportText(null);
    } catch {
      setExportText(serialized);
    }
  }, [events, navSession, snapshot]);

  const toggleExportText = useCallback(() => {
    if (exportText) {
      setExportText(null);
      return;
    }

    setExportText(JSON.stringify(buildExportPayload(snapshot, navSession, events), null, 2));
  }, [events, exportText, navSession, snapshot]);

  const clearLog = useCallback(() => {
    setEvents([]);
    recentChangeTimesRef.current = [];
    lastChurnEventAtRef.current = 0;
    navSessionRef.current = DEFAULT_NAV_SESSION;
    navSessionIdRef.current = 0;
    setNavSession(DEFAULT_NAV_SESSION);
    scheduleCapture("manual.clear", "manual", "Log cleared");
  }, [scheduleCapture]);

  const markGlitch = useCallback(() => {
    const summary = snapshot
      ? `Manual glitch marker (${snapshot.navVisibleLikely ? `nav visible ${formatDuration(navSessionRef.current.durationMs)}` : "nav hidden"}; ${snapshot.navVisibleReason})`
      : "Manual glitch marker";
    scheduleCapture("manual.glitch", "manual-glitch", summary);
  }, [snapshot, scheduleCapture]);

  if (!enabled || !snapshot) {
    return null;
  }

  const compactRows: Array<[string, string | number | boolean | null]> = [
    ["nav visible", snapshot.navVisibleLikely ? "yes" : "no"],
    ["nav session", navSession.id ? `${navSession.active ? "active" : "ended"} ${formatDuration(navSession.durationMs)}` : "none"],
    ["safe bottom", `${snapshot.safeAreaBottomResolvedPx ?? "null"}px`],
    ["host bottom", snapshot.hostSafeAreaBottomPx],
    ["dialogs", `${snapshot.dialogSurfaceCount}/${snapshot.dialogOverlayCount}`],
  ];

  const rows: Array<[string, string | number | boolean | null]> = [
    ["chrome", snapshot.chromeState],
    ["nav visible", snapshot.navVisibleLikely],
    ["nav reason", snapshot.navVisibleReason],
    ["nav session id", navSession.id],
    ["nav session active", navSession.active],
    ["nav session dur", formatDuration(navSession.durationMs)],
    ["nav session glitches", navSession.glitchCount],
    ["nav session changes", navSession.layoutChangeCount],
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
    ["--browser top px", snapshot.browserTopResolvedPx],
    ["--browser bottom", snapshot.browserBottom],
    ["--browser bottom px", snapshot.browserBottomResolvedPx],
    ["--safe top", snapshot.safeAreaTop],
    ["--safe top px", snapshot.safeAreaTopResolvedPx],
    ["--safe bottom", snapshot.safeAreaBottom],
    ["--safe bottom px", snapshot.safeAreaBottomResolvedPx],
    ["host top px", snapshot.hostSafeAreaTopPx],
    ["host bottom px", snapshot.hostSafeAreaBottomPx],
    ["host client", snapshot.hostClientName ?? "(unknown)"],
    ["host fid", snapshot.hostClientFid],
    ["host source", snapshot.hostResolutionSource],
    ["header pt", snapshot.headerPaddingTop],
    ["nav pb", snapshot.navPaddingBottom],
    ["nav pb px", snapshot.navPaddingBottomPx],
    ["dialog overlays", snapshot.dialogOverlayCount],
    ["dialog overlay rects", snapshot.dialogOverlayRectSummary],
    ["dialog overlay blur", snapshot.dialogOverlayBackdropActiveCount],
    ["dialog surfaces", snapshot.dialogSurfaceCount],
    ["dialog surface rects", snapshot.dialogSurfaceRectSummary],
    ["dialog surface blur", snapshot.dialogSurfaceBackdropActiveCount],
    ["blur classes", snapshot.blurClassElementCount],
    ["backdrop active", snapshot.backdropFilterActiveCount],
    ["active", snapshot.activeElement],
  ];

  if (!panelOpen) {
    return (
      <div className="pointer-events-none fixed bottom-2 right-2 z-[4000]">
        <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-black/20 bg-black/85 px-2 py-1 text-[10px] leading-tight text-white shadow-lg">
          <span className="max-w-28 truncate text-white/70">
            {snapshot.navVisibleLikely ? `nav on ${formatDuration(navSession.durationMs)}` : "nav off"}
          </span>
          <button
            type="button"
            onClick={markGlitch}
            className="min-h-0 min-w-0 rounded-full border border-amber-400/60 px-2 py-0.5 text-[10px] text-amber-200"
          >
            Mark glitch
          </button>
          <button
            type="button"
            onClick={() => setPanelOpen(true)}
            className="min-h-0 min-w-0 rounded-full border border-white/30 px-2 py-0.5 text-[10px]"
          >
            Open debug
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="pointer-events-none fixed bottom-2 right-2 z-[4000]">
      <div
        className={`pointer-events-auto flex flex-col overflow-hidden rounded-lg border border-black/20 bg-black/85 p-2 text-[11px] leading-tight text-white shadow-lg ${expanded ? "max-h-[calc(100dvh-1rem)] w-[min(28rem,calc(100vw-1rem))]" : "w-[min(19rem,calc(100vw-1rem))] max-h-[44dvh]"}`}
      >
        <div className="mb-2 flex items-center justify-between gap-2">
          <span className="font-semibold">Viewport debug</span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPanelOpen(false)}
              className="min-h-0 min-w-0 rounded border border-white/30 px-2 py-0.5 text-[10px]"
            >
              Hide
            </button>
            <button
              type="button"
              onClick={() => setExpanded((value) => !value)}
              className="min-h-0 min-w-0 rounded border border-white/30 px-2 py-0.5 text-[10px]"
            >
              {expanded ? "Compact" : "Expand"}
            </button>
            {!expanded ? (
              <button
                type="button"
                onClick={markGlitch}
                className="min-h-0 min-w-0 rounded border border-amber-400/60 px-2 py-0.5 text-[10px] text-amber-200"
              >
                Mark glitch
              </button>
            ) : null}
          </div>
        </div>

        {!expanded ? (
          <>
            <div className="grid grid-cols-[6rem_1fr] gap-x-2 gap-y-0.5 font-mono">
              {compactRows.map(([label, value]) => (
                <div key={label} className="contents">
                  <span className="text-white/60">{label}</span>
                  <span className="break-all">{String(value)}</span>
                </div>
              ))}
            </div>
            <div className="mt-2 text-[10px] text-white/70">
              Expand when you need dialog rects, host insets, or the full event log.
            </div>
            <div className="mt-1 truncate text-[10px] text-white/60">
              {snapshot.timestamp}
            </div>
          </>
        ) : (
          <>
            <div className="mb-2 flex flex-wrap items-center gap-1">
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

            <div className="grid grid-cols-[8rem_1fr] gap-x-2 gap-y-0.5 font-mono">
              {rows.map(([label, value]) => (
                <div key={label} className="contents">
                  <span className="text-white/60">{label}</span>
                  <span className="break-all">{String(value)}</span>
                </div>
              ))}
            </div>

            <div className="mt-2 rounded border border-white/10 bg-white/5 p-2 text-[10px] text-white/75">
              Reproduce the issue with Base nav visible, keep the dialog open while the glitch is active, then tap `Mark glitch`. This export now includes host insets, resolved safe-area values, tracked dialog rects, and the current nav-visible session.
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
          </>
        )}
      </div>
    </div>
  );
}
