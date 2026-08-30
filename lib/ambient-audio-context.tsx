"use client";

import {
    createContext,
    useContext,
    useState,
    useEffect,
    useRef,
    useCallback,
    useMemo,
    type ReactNode,
} from "react";
import { usePerformanceMode } from "@/components/ui/performance-mode";

/**
 * Ambient Audio context for managing background music playback.
 * Respects browser autoplay policies - audio only plays after user interaction.
 */

interface AmbientAudioContextValue {
    isEnabled: boolean;
    isPlaying: boolean;
    toggleAudio: () => void;
}

const AmbientAudioContext = createContext<AmbientAudioContextValue>({
    isEnabled: false,
    isPlaying: false,
    toggleAudio: () => { },
});

const STORAGE_KEY = "pixotchi:ambient-audio";
const AUDIO_SRC = "/PixotchiST.mp3";

export function AmbientAudioProvider({ children }: { children: ReactNode }) {
    const { enabled: performanceModeEnabled } = usePerformanceMode();
    const [isEnabled, setIsEnabled] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [hasInteracted, setHasInteracted] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Load preference from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            // Default to false (off) if no preference exists
            setIsEnabled(stored === null ? false : stored === "true");
        } catch {
            setIsEnabled(false);
        }
        setMounted(true);
    }, []);

    // Track first user interaction to enable autoplay
    useEffect(() => {
        if (hasInteracted) return;

        const handleInteraction = () => {
            setHasInteracted(true);
        };

        // Listen for any user interaction
        const events = ["click", "touchstart", "keydown"];
        events.forEach((event) => {
            document.addEventListener(event, handleInteraction, { once: true, passive: true });
        });

        return () => {
            events.forEach((event) => {
                document.removeEventListener(event, handleInteraction);
            });
        };
    }, [hasInteracted]);

    // Create the media element only after both the persisted opt-in and a real
    // user gesture are known. Constructing `new Audio(src)` on every cold boot
    // caused browsers to download the whole soundtrack even for muted users.
    useEffect(() => {
        if (!mounted || !isEnabled || !hasInteracted || performanceModeEnabled) {
            audioRef.current?.pause();
            return;
        }

        let audio = audioRef.current;
        if (!audio) {
            audio = new Audio();
            audio.preload = "none";
            audio.loop = true;
            audio.volume = 0.3;
            audio.src = AUDIO_SRC;
            audioRef.current = audio;

            const handlePlay = () => setIsPlaying(true);
            const handlePause = () => setIsPlaying(false);
            const handleEnded = () => setIsPlaying(false);
            audio.addEventListener("play", handlePlay);
            audio.addEventListener("pause", handlePause);
            audio.addEventListener("ended", handleEnded);
        }

        if (document.visibilityState === "visible") {
            void audio.play().catch(() => {
                // A browser can still reject playback if it does not count the
                // captured event as activation. The next toggle retries it.
            });
        }
    }, [hasInteracted, isEnabled, mounted, performanceModeEnabled]);

    // Release the media element and its resource when the provider unmounts.
    useEffect(() => {
        return () => {
            const audio = audioRef.current;
            if (!audio) return;
            audio.pause();
            audio.removeAttribute("src");
            audio.load();
            audioRef.current = null;
        };
    }, []);

    // Pause audio when app/tab loses focus, resume when it regains focus
    useEffect(() => {
        if (typeof document === 'undefined') return;

        const handleVisibilityChange = () => {
            const audio = audioRef.current;
            if (!audio) return;

            if (document.visibilityState === 'hidden') {
                // App went to background - pause audio
                audio.pause();
            } else if (
                document.visibilityState === 'visible' &&
                isEnabled &&
                hasInteracted &&
                !performanceModeEnabled
            ) {
                // App came back to foreground - resume if enabled
                audio.play().catch(() => {
                    // Ignore errors - browser may still block
                });
            }
        };

        document.addEventListener('visibilitychange', handleVisibilityChange);
        return () => {
            document.removeEventListener('visibilitychange', handleVisibilityChange);
        };
    }, [hasInteracted, isEnabled, performanceModeEnabled]);

    const toggleAudio = useCallback(() => {
        const newValue = !isEnabled;
        setIsEnabled(newValue);
        setHasInteracted(true); // User clicked toggle, so we have interaction

        try {
            localStorage.setItem(STORAGE_KEY, String(newValue));
        } catch {
            // Storage unavailable
        }
    }, [isEnabled]);

    useEffect(() => {
        if (!performanceModeEnabled || !isEnabled) {
            return;
        }

        setIsEnabled(false);
        audioRef.current?.pause();
        try {
            localStorage.setItem(STORAGE_KEY, "false");
        } catch {
            // Storage unavailable
        }
    }, [isEnabled, performanceModeEnabled]);

    /*
     * Always render the Provider — see the same note in lib/snow-context.tsx. Returning
     * a fragment until `mounted` changed this slot's element type and remounted the
     * whole provider tower below it, which also meant `new Audio()` ran twice.
     *
     * `mounted` itself stays: the play/pause effect above reads it so it cannot act
     * before the localStorage preference has landed.
     */
    const value = useMemo(
        () => ({ isEnabled, isPlaying, toggleAudio }),
        [isEnabled, isPlaying, toggleAudio],
    );

    return <AmbientAudioContext.Provider value={value}>{children}</AmbientAudioContext.Provider>;
}

export function useAmbientAudio() {
    return useContext(AmbientAudioContext);
}
