"use client";

import React, { createContext, useContext, ReactNode } from 'react';
import { Tab } from '@/lib/types';

interface TabVisibilityContextType {
    activeTab: Tab;
    isTabVisible: (tabName: Tab) => boolean;
}

const TabVisibilityContext = createContext<TabVisibilityContextType | undefined>(undefined);

export function TabVisibilityProvider({
    activeTab,
    children
}: {
    activeTab: Tab;
    children: ReactNode
}) {
    const isTabVisible = (tabName: Tab) => activeTab === tabName;

    return (
        <TabVisibilityContext.Provider value={{ activeTab, isTabVisible }}>
            {children}
        </TabVisibilityContext.Provider>
    );
}

export function useTabVisibility() {
    const context = useContext(TabVisibilityContext);
    if (context === undefined) {
        throw new Error('useTabVisibility must be used within a TabVisibilityProvider');
    }
    return context;
}
