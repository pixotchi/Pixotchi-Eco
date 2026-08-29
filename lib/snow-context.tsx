"use client";

import { createContext, useCallback, useContext, useMemo, useState, useEffect, type ReactNode } from "react";
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

    // Load preference from localStorage on mount
    useEffect(() => {
        if (!isFeatureEnabled) return;

        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            // Default to off; users can opt in when the seasonal feature is enabled.
            setIsEnabled(stored === null ? false : stored === "true");
        } catch {
            setIsEnabled(false);
        }
    }, [isFeatureEnabled]);

    const toggleSnow = useCallback(() => {
        setIsEnabled((previous) => {
            const newValue = !previous;
            try {
                localStorage.setItem(STORAGE_KEY, String(newValue));
            } catch {
                // Storage unavailable
            }
            return newValue;
        });
    }, []);

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

    /*
     * Always render the Provider.
     *
     * This used to return a bare fragment until a mount effect flipped `mounted`.
     * Changing the element type at this slot from Fragment to Context.Provider makes
     * React tear down and rebuild the entire subtree — and everything below here is the
     * provider tower (Paymaster -> Privy -> QueryClient -> HostEnvironment). Nesting
     * AmbientAudioProvider, which had the same shape, meant PrivyProvider was
     * constructed three times on every cold boot.
     *
     * There is no hydration mismatch to avoid: isEnabled starts false on both server
     * and client, and only the effect above raises it.
     */
    const value = useMemo(
        () => ({ isEnabled: isFeatureEnabled && isEnabled, isFeatureEnabled, toggleSnow }),
        [isEnabled, isFeatureEnabled, toggleSnow],
    );

    return <SnowContext.Provider value={value}>{children}</SnowContext.Provider>;
}

export function useSnow() {
    return useContext(SnowContext);
}
