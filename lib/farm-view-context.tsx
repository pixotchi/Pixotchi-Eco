"use client";

import React, { createContext, useContext, useMemo, type ReactNode } from 'react';

import { useWebQueryState } from '@/hooks/useWebQueryState';

export type DashboardView = 'plants' | 'lands';
export type MintType = 'plant' | 'land';

/**
 * Single source of truth for the Plants/Lands and Plant/Land switchers.
 *
 * These two values are read and written from three places at once: the shared
 * mobile toggle in the app shell (visible below 54rem), DashboardTab's own
 * switcher and MintTab's own switcher (both visible at 54rem and up).
 *
 * They used to be three independent `useWebQueryState` calls sharing a key.
 * That works on web, where the hook keeps instances in sync through the URL and
 * a window event — but BOTH of those channels are gated on `enabled`, which is
 * `!isMiniApp`. Inside the Farcaster / Base Mini App webview `enabled` is false,
 * so the instances degraded to independent `useState`s: the shell toggle flipped
 * its own pill while the tab kept rendering the other view, leaving Lands and
 * Land-minting unreachable on the app's primary mobile surface.
 *
 * Holding the hooks once here fixes that without changing web behaviour: on web
 * the provider still owns `?dashboardView=` / `?mintType=` (deep links, refresh
 * and back/forward keep working), and in the Mini App every consumer shares the
 * one local state.
 */
interface FarmViewContextType {
  dashboardView: DashboardView;
  setDashboardView: (value: DashboardView) => void;
  mintType: MintType;
  setMintType: (value: MintType) => void;
}

const FarmViewContext = createContext<FarmViewContextType | undefined>(undefined);

export function FarmViewProvider({
  isMiniApp,
  children,
}: {
  isMiniApp: boolean;
  children: ReactNode;
}) {
  const [dashboardView, setDashboardView] = useWebQueryState<DashboardView>({
    key: 'dashboardView',
    defaultValue: 'plants',
    enabled: !isMiniApp,
    parse: (rawValue) => (rawValue === 'plants' || rawValue === 'lands' ? rawValue : null),
    serialize: (value) => (value === 'plants' ? null : value),
  });
  const [mintType, setMintType] = useWebQueryState<MintType>({
    key: 'mintType',
    defaultValue: 'plant',
    enabled: !isMiniApp,
    parse: (rawValue) => (rawValue === 'plant' || rawValue === 'land' ? rawValue : null),
    serialize: (value) => (value === 'plant' ? null : value),
  });

  const value = useMemo(
    () => ({ dashboardView, setDashboardView, mintType, setMintType }),
    [dashboardView, setDashboardView, mintType, setMintType],
  );

  return <FarmViewContext.Provider value={value}>{children}</FarmViewContext.Provider>;
}

export function useFarmView() {
  const context = useContext(FarmViewContext);
  if (context === undefined) {
    throw new Error('useFarmView must be used within a FarmViewProvider');
  }
  return context;
}
