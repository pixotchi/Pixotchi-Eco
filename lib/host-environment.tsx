"use client";

import { sdk } from "@farcaster/miniapp-sdk";
import React,{ createContext,useContext,useEffect,useState } from "react";

export type SafeAreaInsets = {
  top: number;
  bottom: number;
  left: number;
  right: number;
};

export type MiniAppClient = {
  platformType?: "web" | "mobile";
  clientFid?: number;
  added?: boolean;
  safeAreaInsets?: SafeAreaInsets;
  notificationDetails?: { url: string; token: string };
  name?: string;
  version?: string;
};

export type MiniAppContext = {
  user?: { fid: number; username?: string; displayName?: string; pfpUrl?: string };
  location?: Record<string, unknown>;
  client?: MiniAppClient;
};

export type HostEnvironmentResolutionSource =
  | "pending"
  | "ssr"
  | "context"
  | "flag"
  | "fallback"
  | "late-context"
  | "error";

export type HostEnvironmentResolutionStatus =
  | "pending"
  | "resolved"
  | "upgraded"
  | "failed";

export type HostEnvironmentState = {
  initialized: boolean;
  isMiniApp: boolean;
  clientFid: number | null;
  context: MiniAppContext | Record<string, unknown> | null;
  resolutionSource: HostEnvironmentResolutionSource;
  resolutionStatus: HostEnvironmentResolutionStatus;
};

type HostEnvironmentListener = (state: HostEnvironmentState) => void;
type TimedMiniAppCheck = (timeoutMs?: number) => Promise<boolean>;

const HOST_ENVIRONMENT_TIMEOUT_MS = 250;

const DEFAULT_HOST_ENVIRONMENT: HostEnvironmentState = {
  initialized: typeof window === "undefined",
  isMiniApp: false,
  clientFid: null,
  context: null,
  resolutionSource: typeof window === "undefined" ? "ssr" : "pending",
  resolutionStatus: typeof window === "undefined" ? "resolved" : "pending",
};

const HostEnvironmentContext = createContext<HostEnvironmentState>(DEFAULT_HOST_ENVIRONMENT);

let hostEnvironmentSnapshot = DEFAULT_HOST_ENVIRONMENT;
let hostEnvironmentPromise: Promise<HostEnvironmentState> | null = null;
let hostEnvironmentContextPromise: Promise<MiniAppContext | undefined> | null = null;
let lateContextListenerAttached = false;
const listeners = new Set<HostEnvironmentListener>();

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]);
}

function applySafeAreaInsets(context: MiniAppContext | Record<string, unknown> | null) {
  try {
    if (typeof document === "undefined" || !context || typeof context !== "object") {
      return;
    }

    const insets = (context as MiniAppContext)?.client?.safeAreaInsets;
    if (!insets) {
      return;
    }

    const root = document.documentElement;
    root.style.setProperty("--safe-area-inset-top", `${insets.top}px`);
    root.style.setProperty("--safe-area-inset-bottom", `${insets.bottom}px`);
    root.style.setProperty("--safe-area-inset-left", `${insets.left}px`);
    root.style.setProperty("--safe-area-inset-right", `${insets.right}px`);
  } catch {
    // no-op: rely on CSS env() fallbacks
  }
}

function notifyHostEnvironmentListeners(nextState: HostEnvironmentState) {
  listeners.forEach((listener) => {
    listener(nextState);
  });
}

function updateHostEnvironmentSnapshot(nextState: HostEnvironmentState) {
  hostEnvironmentSnapshot = nextState;
  applySafeAreaInsets(nextState.context);

  console.info("[HostEnv] resolved", {
    clientFid: nextState.clientFid,
    initialized: nextState.initialized,
    isMiniApp: nextState.isMiniApp,
    resolutionSource: nextState.resolutionSource,
    resolutionStatus: nextState.resolutionStatus,
  });

  notifyHostEnvironmentListeners(nextState);
}

function getMiniAppContextPromise(): Promise<MiniAppContext | undefined> {
  if (hostEnvironmentContextPromise) {
    return hostEnvironmentContextPromise;
  }

  try {
    const maybeContext: unknown = (sdk as { context?: unknown }).context;
    hostEnvironmentContextPromise =
      typeof (maybeContext as Promise<MiniAppContext | undefined>)?.then === "function"
        ? (maybeContext as Promise<MiniAppContext | undefined>)
        : Promise.resolve(maybeContext as MiniAppContext | undefined);
  } catch {
    hostEnvironmentContextPromise = Promise.resolve(undefined);
  }

  return hostEnvironmentContextPromise;
}

function toHostEnvironmentState(
  input: {
    context: MiniAppContext | Record<string, unknown> | null;
    isMiniApp: boolean;
    resolutionSource: HostEnvironmentResolutionSource;
    resolutionStatus: HostEnvironmentResolutionStatus;
  },
): HostEnvironmentState {
  const clientFid =
    input.context && typeof input.context === "object"
      ? Number((input.context as MiniAppContext)?.client?.clientFid ?? null)
      : null;

  const normalizedClientFid = Number.isFinite(clientFid) ? clientFid : null;

  return {
    initialized: true,
    isMiniApp: input.isMiniApp,
    clientFid: normalizedClientFid,
    context: input.context,
    resolutionSource: input.resolutionSource,
    resolutionStatus: input.resolutionStatus,
  };
}

function attachLateContextListener(contextPromise: Promise<MiniAppContext | undefined>) {
  if (lateContextListenerAttached) {
    return;
  }

  lateContextListenerAttached = true;

  contextPromise
    .then((lateContext) => {
      if (!lateContext) {
        return;
      }

      const nextState = toHostEnvironmentState({
        context: lateContext,
        isMiniApp: true,
        resolutionSource:
          hostEnvironmentSnapshot.isMiniApp && hostEnvironmentSnapshot.context
            ? hostEnvironmentSnapshot.resolutionSource
            : "late-context",
        resolutionStatus:
          hostEnvironmentSnapshot.isMiniApp && hostEnvironmentSnapshot.context
            ? hostEnvironmentSnapshot.resolutionStatus
            : "upgraded",
      });

      const hasMeaningfulChange =
        !hostEnvironmentSnapshot.isMiniApp ||
        hostEnvironmentSnapshot.clientFid !== nextState.clientFid ||
        hostEnvironmentSnapshot.context !== nextState.context;

      if (!hasMeaningfulChange) {
        return;
      }

      updateHostEnvironmentSnapshot(nextState);
    })
    .catch(() => {
      // Ignore late context failures; initial resolution already handled.
    });
}

export async function ensureHostEnvironmentResolved(): Promise<HostEnvironmentState> {
  if (typeof window === "undefined") {
    return hostEnvironmentSnapshot;
  }

  if (hostEnvironmentPromise) {
    return hostEnvironmentPromise;
  }

  const contextPromise = getMiniAppContextPromise();
  attachLateContextListener(contextPromise);

  hostEnvironmentPromise = (async () => {
    try {
      const initialContext = await withTimeout(
        contextPromise,
        HOST_ENVIRONMENT_TIMEOUT_MS,
        undefined,
      );

      if (initialContext) {
        const nextState = toHostEnvironmentState({
          context: initialContext,
          isMiniApp: true,
          resolutionSource: "context",
          resolutionStatus: "resolved",
        });
        updateHostEnvironmentSnapshot(nextState);
        return nextState;
      }

      let isMiniApp = false;
      try {
        isMiniApp = Boolean(
          await (sdk.isInMiniApp as TimedMiniAppCheck)(HOST_ENVIRONMENT_TIMEOUT_MS),
        );
      } catch {
        isMiniApp = false;
      }

      const resolvedContext = isMiniApp
        ? (await withTimeout(contextPromise, HOST_ENVIRONMENT_TIMEOUT_MS, undefined)) ?? null
        : null;

      const nextState = toHostEnvironmentState({
        context: resolvedContext,
        isMiniApp,
        resolutionSource: isMiniApp ? "flag" : "fallback",
        resolutionStatus: "resolved",
      });
      updateHostEnvironmentSnapshot(nextState);
      return nextState;
    } catch {
      const nextState = {
        ...DEFAULT_HOST_ENVIRONMENT,
        initialized: true,
        context: { error: "Failed to initialize" } as Record<string, unknown>,
        resolutionSource: "error" as const,
        resolutionStatus: "failed" as const,
      };
      updateHostEnvironmentSnapshot(nextState);
      return nextState;
    }
  })();

  return hostEnvironmentPromise;
}

export function getHostEnvironmentSnapshot(): HostEnvironmentState {
  return hostEnvironmentSnapshot;
}

export function subscribeToHostEnvironment(listener: HostEnvironmentListener) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function HostEnvironmentProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<HostEnvironmentState>(() => getHostEnvironmentSnapshot());

  useEffect(() => {
    setState(getHostEnvironmentSnapshot());
    const unsubscribe = subscribeToHostEnvironment(setState);
    void ensureHostEnvironmentResolved();
    return unsubscribe;
  }, []);

  return (
    <HostEnvironmentContext.Provider value={state}>
      {children}
    </HostEnvironmentContext.Provider>
  );
}

export function useHostEnvironment() {
  return useContext(HostEnvironmentContext);
}
