'use client';

import React, { createContext, useContext, useMemo } from 'react';
import { type MiniAppContext, useHostEnvironment } from '@/lib/host-environment';

type FrameContextValue = {
  context: MiniAppContext | Record<string, unknown> | null;
  isInMiniApp: boolean;
} | null;

const FrameContext = createContext<FrameContextValue>(null);

export function useFrameContext() {
  return useContext(FrameContext);
}

export function FrameProvider({ children }: { children: React.ReactNode }) {
  const hostEnvironment = useHostEnvironment();
  const value = useMemo<FrameContextValue>(() => {
    if (!hostEnvironment.initialized) {
      return null;
    }

    return {
      context: hostEnvironment.context,
      isInMiniApp: hostEnvironment.isMiniApp,
    };
  }, [hostEnvironment.context, hostEnvironment.initialized, hostEnvironment.isMiniApp]);

  return <FrameContext.Provider value={value}>{children}</FrameContext.Provider>;
}
