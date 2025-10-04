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

export function useFrameContext() {
  return useContext(FrameContext);
}

export function FrameProvider({ children }: { children: React.ReactNode }) {
  const [value, setValue] = useState<FrameContextValue>(null);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        // Signal readiness; tolerate multiple calls across app
        await sdk.actions.ready();
        // Small delay to ensure stable UI before reading context
        await new Promise((r) => setTimeout(r, 60));

        // Resolve context (resolves to undefined outside miniapp)
        let context: any | undefined;
        try {
          // Some clients expose a promise; others a getter. Try both.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const maybeCtx: any = (sdk as any).context;
          context = typeof maybeCtx?.then === 'function' ? await maybeCtx : maybeCtx;
        } catch {
          context = undefined;
        }

        // Derive isInMiniApp; fallback to explicit check if needed
        let isInMiniApp = Boolean(context);
        if (!isInMiniApp) {
          try {
            const flag = await sdk.isInMiniApp();
            isInMiniApp = Boolean(flag);
          } catch {
            isInMiniApp = false;
          }
        }

        // Apply safe-area insets globally if available
        try {
          const insets: SafeAreaInsets | undefined = (context as any)?.client?.safeAreaInsets;
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

        if (isMounted) {
          const ctx = (context as MiniAppContext) ?? null;
          setValue({ context: ctx, isInMiniApp });
          try { (window as any).__pixotchi_frame_context__ = { context: ctx, isInMiniApp }; } catch {}
        }
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


