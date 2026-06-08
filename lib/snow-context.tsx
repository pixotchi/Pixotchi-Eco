"use client";

import { createContext, useContext, useState, useEffect, type ReactNode } from "react";
import { usePerformanceMode } from "@/components/ui/performance-mode";

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
    const { enabled: performanceModeEnabled } = usePerformanceMode();
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
            // Default to off; users can opt in when the seasonal feature is enabled.
            setIsEnabled(stored === null ? false : stored === "true");
        } catch {
            setIsEnabled(false);
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

    useEffect(() => {
        if (!performanceModeEnabled || !isEnabled) {
            return;
        }

        setIsEnabled(false);
        try {
            localStorage.setItem(STORAGE_KEY, "false");
        } catch {
            // Storage unavailable
        }
    }, [isEnabled, performanceModeEnabled]);

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
