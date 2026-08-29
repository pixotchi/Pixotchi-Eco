"use client";

import React, { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { Tab } from '@/lib/types';

/**
 * The context value is the active tab itself — a primitive — not an object.
 *
 * It previously published `{ activeTab, isTabVisible }` as a fresh object literal
 * with a fresh closure on every render, so every consumer re-rendered whenever the
 * shell did, regardless of whether the active tab actually changed. That also
 * pierced any React.memo applied further down.
 *
 * A primitive is structurally immune to the bug returning the moment someone adds
 * a field, which a useMemo in the provider would not be. The object shape is
 * rebuilt in the hook instead, so all eight consumers keep their existing API.
 */
const TabVisibilityContext = createContext<Tab | undefined>(undefined);

export function TabVisibilityProvider({
    activeTab,
    children
}: {
    activeTab: Tab;
    children: ReactNode
}) {
    return (
        <TabVisibilityContext.Provider value={activeTab}>
            {children}
        </TabVisibilityContext.Provider>
    );
}

export function useTabVisibility() {
    const activeTab = useContext(TabVisibilityContext);
    if (activeTab === undefined) {
        throw new Error('useTabVisibility must be used within a TabVisibilityProvider');
    }

    const isTabVisible = useCallback((tabName: Tab) => activeTab === tabName, [activeTab]);

    return useMemo(() => ({ activeTab, isTabVisible }), [activeTab, isTabVisible]);
}
