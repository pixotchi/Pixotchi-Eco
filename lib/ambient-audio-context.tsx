"use client";

import {
    createContext,
    useContext,
    useState,
    useEffect,
    useRef,
    useCallback,
    type ReactNode,
} from "react";

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
    const [isEnabled, setIsEnabled] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [hasInteracted, setHasInteracted] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Initialize audio element
    useEffect(() => {
        if (typeof window === "undefined") return;

        const audio = new Audio(AUDIO_SRC);
        audio.loop = true;
        audio.volume = 0.3; // Ambient volume - not too loud
        audio.preload = "auto";
        audioRef.current = audio;

        // Track playing state
        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);
        const handleEnded = () => setIsPlaying(false);

        audio.addEventListener("play", handlePlay);
        audio.addEventListener("pause", handlePause);
        audio.addEventListener("ended", handleEnded);

        return () => {
            audio.removeEventListener("play", handlePlay);
            audio.removeEventListener("pause", handlePause);
            audio.removeEventListener("ended", handleEnded);
            audio.pause();
            audio.src = "";
            audioRef.current = null;
        };
    }, []);

    // Load preference from localStorage on mount
    useEffect(() => {
        try {
            const stored = localStorage.getItem(STORAGE_KEY);
            // Default to true (on) if no preference exists
            setIsEnabled(stored === null ? true : stored === "true");
        } catch {
            setIsEnabled(true);
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

    // Play/pause based on enabled state
    // Try to play immediately if enabled - some contexts (like mini apps) may allow autoplay
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio || !mounted) return;

        if (isEnabled) {
            // Try to play - if it works, mark as interacted
            audio.play()
                .then(() => {
                    // Playback started successfully - browser allowed it
                    if (!hasInteracted) {
                        setHasInteracted(true);
                    }
                })
                .catch((err) => {
                    // Autoplay was prevented - wait for user interaction
                    console.log("[AmbientAudio] Waiting for user interaction:", err.message);
                });
        } else {
            audio.pause();
        }
    }, [isEnabled, hasInteracted, mounted]);

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

    // Don't render children until mounted to avoid hydration mismatch
    if (!mounted) {
        return <>{children}</>;
    }

    return (
        <AmbientAudioContext.Provider value={{ isEnabled, isPlaying, toggleAudio }}>
            {children}
        </AmbientAudioContext.Provider>
    );
}

export function useAmbientAudio() {
    return useContext(AmbientAudioContext);
}
