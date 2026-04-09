'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';
import { sdk } from '@farcaster/miniapp-sdk';

type SafeAreaInsets = { top: number; bottom: number; left: number; right: number };

type MiniAppClient = {
  platformType?: 'web' | 'mobile';
  clientFid?: number;
  added?: boolean;
  safeAreaInsets?: SafeAreaInsets;
  notificationDetails?: { url: string; token: string };
  name?: string;
  version?: string;
};

type MiniAppContext = {
  user?: { fid: number; username?: string; displayName?: string; pfpUrl?: string };
  location?: Record<string, unknown>;
  client?: MiniAppClient;
};

type FrameContextValue = {
  context: MiniAppContext | Record<string, unknown> | null;
  isInMiniApp: boolean;
} | null;

const FrameContext = createContext<FrameContextValue>(null);

const FRAME_CONTEXT_TIMEOUT_MS = 250;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((resolve) => {
      setTimeout(() => resolve(fallback), timeoutMs);
    }),
  ]);
}

function applySafeAreaInsets(context: MiniAppContext | null | undefined) {
  try {
    if (typeof document === "undefined") {
      throw new Error("No document available");
    }
    const insets: SafeAreaInsets | undefined = context?.client?.safeAreaInsets;
    if (insets) {
      const root = document.documentElement;
      root.style.setProperty('--safe-area-inset-top', `${insets.top}px`);
      root.style.setProperty('--safe-area-inset-bottom', `${insets.bottom}px`);
      root.style.setProperty('--safe-area-inset-left', `${insets.left}px`);
      root.style.setProperty('--safe-area-inset-right', `${insets.right}px`);
    }
  } catch {
    // no-op: rely on CSS env() fallbacks
  }
}

export function useFrameContext() {
  return useContext(FrameContext);
}

export function FrameProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<FrameContextValue>(null);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        // Small delay to ensure stable UI before reading context
        await new Promise((r) => setTimeout(r, 60));

        // Resolve context without blocking forever in non-miniapp webviews.
        let contextPromise: Promise<MiniAppContext | undefined>;
        try {
          // Some clients expose a promise; others a getter. Try both.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const maybeCtx: any = (sdk as any).context;
          contextPromise = typeof maybeCtx?.then === 'function'
            ? maybeCtx
            : Promise.resolve(maybeCtx as MiniAppContext | undefined);
        } catch {
          contextPromise = Promise.resolve(undefined);
        }

        const miniAppFlagPromise = sdk.isInMiniApp().catch(() => false);
        const initialContext = await withTimeout(contextPromise, FRAME_CONTEXT_TIMEOUT_MS, undefined);

        // Derive isInMiniApp; fallback to the SDK timeout-based check if needed
        let isInMiniApp = Boolean(initialContext);
        if (!isInMiniApp) {
          try {
            const flag = await miniAppFlagPromise;
            isInMiniApp = Boolean(flag);
          } catch {
            isInMiniApp = false;
          }
        }

        const resolvedContext = isInMiniApp
          ? (initialContext ?? await withTimeout(contextPromise, FRAME_CONTEXT_TIMEOUT_MS, undefined))
          : initialContext;

        applySafeAreaInsets(resolvedContext ?? null);

        if (isMounted) {
          const ctx = resolvedContext ?? null;
          setValue({ context: ctx, isInMiniApp });
        }

        contextPromise
          .then((lateContext) => {
            if (!isMounted || !lateContext) {
              return;
            }

            applySafeAreaInsets(lateContext);
            setValue({ context: lateContext, isInMiniApp: true });
          })
          .catch(() => {
            // Ignore late context failures; initial resolution already handled.
          });
      } catch {
        if (isMounted) setValue({ context: { error: 'Failed to initialize' } as any, isInMiniApp: false });
      }
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  return <FrameContext.Provider value={value}>{children}</FrameContext.Provider>;
}

