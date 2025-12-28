"use client";

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from "react";

const STORAGE_KEY = 'pixotchi:ethMode';

// Environment variable to completely enable/disable ETH mode feature
// Set NEXT_PUBLIC_ETH_MODE_ENABLED=true to enable ETH mode on a branch
export const isEthModeFeatureEnabled = (): boolean => {
    return process.env.NEXT_PUBLIC_ETH_MODE_ENABLED === 'true';
};

interface EthModeContextType {
    isEthMode: boolean;
    setEthMode: (enabled: boolean) => void;
    toggleEthMode: () => void;
    isFeatureEnabled: boolean; // Whether the feature is enabled via env var
}

const EthModeContext = createContext<EthModeContextType | undefined>(undefined);

export function EthModeProvider({ children }: { children: ReactNode }) {
    const [isEthMode, setIsEthMode] = useState<boolean>(false);
    const [isInitialized, setIsInitialized] = useState(false);

    // Initialize from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            if (stored !== null) {
                setIsEthMode(stored === 'true');
            }
        } catch (e) {
            // localStorage not available (SSR or privacy mode)
            console.warn('[EthMode] localStorage not available');
        }
        setIsInitialized(true);
    }, []);

    // Persist to localStorage when value changes
    useEffect(() => {
        if (!isInitialized) return;
        try {
            localStorage.setItem(STORAGE_KEY, String(isEthMode));
        } catch (e) {
            console.warn('[EthMode] Failed to persist to localStorage');
        }
    }, [isEthMode, isInitialized]);

    // Sync across browser tabs
    useEffect(() => {
        const handleStorageChange = (e: StorageEvent) => {
            if (e.key === STORAGE_KEY && e.newValue !== null) {
                setIsEthMode(e.newValue === 'true');
            }
        };
        window.addEventListener('storage', handleStorageChange);
        return () => window.removeEventListener('storage', handleStorageChange);
    }, []);

    const setEthMode = useCallback((enabled: boolean) => {
        setIsEthMode(enabled);
    }, []);

    const toggleEthMode = useCallback(() => {
        setIsEthMode(prev => !prev);
    }, []);

    return (
        <EthModeContext.Provider value={{
            isEthMode: isEthModeFeatureEnabled() && isEthMode, // Only true if feature enabled AND user toggled on
            setEthMode,
            toggleEthMode,
            isFeatureEnabled: isEthModeFeatureEnabled()
        }}>
            {children}
        </EthModeContext.Provider>
    );
}

export function useEthMode() {
    const context = useContext(EthModeContext);
    if (context === undefined) {
        throw new Error('useEthMode must be used within an EthModeProvider');
    }
    return context;
}

// Safe hook that doesn't throw when used outside provider (for optional usage)
export function useEthModeSafe() {
    const context = useContext(EthModeContext);
    return context ?? { isEthMode: false, setEthMode: () => { }, toggleEthMode: () => { }, isFeatureEnabled: false };
}
