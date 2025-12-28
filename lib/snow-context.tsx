"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";

/**
 * Snow context for managing user preference for winter/snow effect.
 * Only active when NEXT_PUBLIC_SNOW_ENABLED is true.
 */

interface SnowContextValue {
    isEnabled: boolean;
    isFeatureEnabled: boolean;
    toggleSnow: () => void;
}

const SnowContext = createContext<SnowContextValue>({
    isEnabled: false,
    isFeatureEnabled: false,
    toggleSnow: () => { },
});

const STORAGE_KEY = "pixotchi:winter-mode";

export function SnowProvider({ children }: { children: ReactNode }) {
    const isFeatureEnabled = process.env.NEXT_PUBLIC_SNOW_ENABLED === "true";
    const [isEnabled, setIsEnabled] = useState(false);
    const [mounted, setMounted] = useState(false);

    // Load preference from localStorage on mount
    useEffect(() => {
        if (!isFeatureEnabled) {
            setMounted(true);
            return;
        }

        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            // Default to true (on) if no preference exists and feature is enabled
            setIsEnabled(stored === null ? true : stored === "true");
        } catch {
            setIsEnabled(true);
        }
        setMounted(true);
    }, [isFeatureEnabled]);

    const toggleSnow = () => {
        const newValue = !isEnabled;
        setIsEnabled(newValue);
        try {
            localStorage.setItem(STORAGE_KEY, String(newValue));
        } catch {
            // Storage unavailable
        }
    };

    // Don't render children until mounted to avoid hydration mismatch
    if (!mounted) {
        return <>{children}</>;
    }

    return (
        <SnowContext.Provider value={{ isEnabled: isFeatureEnabled && isEnabled, isFeatureEnabled, toggleSnow }}>
            {children}
        </SnowContext.Provider>
    );
}

export function useSnow() {
    return useContext(SnowContext);
}
