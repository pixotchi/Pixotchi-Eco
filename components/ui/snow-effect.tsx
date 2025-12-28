"use client";

import { useEffect, useRef, memo } from "react";
import { useSnow } from "@/lib/snow-context";

/**
 * Subtle snow particles effect for winter/Christmas celebrations.
 * Controlled via NEXT_PUBLIC_SNOW_ENABLED environment variable
 * and user toggle in theme selector.
 * 
 * Features:
 * - Realistic falling motion with slight horizontal drift
 * - Variable snowflake sizes for depth perception
 * - Low particle count to keep UI unobstructed
 * - Respects prefers-reduced-motion
 * - Pauses when tab is not visible (performance)
 */

interface Snowflake {
    x: number;
    y: number;
    radius: number;
    speed: number;
    wind: number;
    opacity: number;
}

const SNOWFLAKE_COUNT = 40; // Subtle - not too many
const MIN_RADIUS = 1;
const MAX_RADIUS = 3;
const MIN_SPEED = 0.3;
const MAX_SPEED = 1.2;
const WIND_VARIANCE = 0.3;

function SnowEffectCanvas() {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const snowflakesRef = useRef<Snowflake[]>([]);
    const animationRef = useRef<number>(0);
    const isVisibleRef = useRef(true);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Check for reduced motion preference
        const prefersReducedMotion = window.matchMedia(
            "(prefers-reduced-motion: reduce)"
        ).matches;
        if (prefersReducedMotion) return;

        // Set canvas size
        const updateSize = () => {
            canvas.width = window.innerWidth;
            canvas.height = window.innerHeight;
        };
        updateSize();
        window.addEventListener("resize", updateSize);

        // Initialize snowflakes
        const initSnowflakes = () => {
            snowflakesRef.current = Array.from({ length: SNOWFLAKE_COUNT }, () => ({
                x: Math.random() * canvas.width,
                y: Math.random() * canvas.height,
                radius: MIN_RADIUS + Math.random() * (MAX_RADIUS - MIN_RADIUS),
                speed: MIN_SPEED + Math.random() * (MAX_SPEED - MIN_SPEED),
                wind: (Math.random() - 0.5) * WIND_VARIANCE,
                opacity: 0.3 + Math.random() * 0.5, // 0.3 to 0.8 opacity
            }));
        };
        initSnowflakes();

        // Visibility change handler
        const handleVisibility = () => {
            isVisibleRef.current = document.visibilityState === "visible";
        };
        document.addEventListener("visibilitychange", handleVisibility);

        // Animation loop
        const animate = () => {
            if (!isVisibleRef.current) {
                animationRef.current = requestAnimationFrame(animate);
                return;
            }

            ctx.clearRect(0, 0, canvas.width, canvas.height);

            snowflakesRef.current.forEach((flake) => {
                // Draw snowflake
                ctx.beginPath();
                ctx.arc(flake.x, flake.y, flake.radius, 0, Math.PI * 2);
                ctx.fillStyle = `rgba(255, 255, 255, ${flake.opacity})`;
                ctx.fill();

                // Update position
                flake.y += flake.speed;
                flake.x += flake.wind + Math.sin(flake.y * 0.01) * 0.3; // Gentle sway

                // Reset if out of bounds
                if (flake.y > canvas.height + flake.radius) {
                    flake.y = -flake.radius;
                    flake.x = Math.random() * canvas.width;
                }
                if (flake.x > canvas.width + flake.radius) {
                    flake.x = -flake.radius;
                }
                if (flake.x < -flake.radius) {
                    flake.x = canvas.width + flake.radius;
                }
            });

            animationRef.current = requestAnimationFrame(animate);
        };

        animate();

        return () => {
            window.removeEventListener("resize", updateSize);
            document.removeEventListener("visibilitychange", handleVisibility);
            cancelAnimationFrame(animationRef.current);
        };
    }, []);

    return (
        <canvas
            ref={canvasRef}
            className="pointer-events-none fixed inset-0 z-[50]"
            style={{ opacity: 0.7 }}
            aria-hidden="true"
        />
    );
}

/**
 * Snow effect wrapper that reads from SnowContext.
 * Add to providers.tsx or layout to enable globally.
 */
export const SnowEffect = memo(function SnowEffect() {
    const { isEnabled } = useSnow();

    if (!isEnabled) return null;

    return <SnowEffectCanvas />;
});

export default SnowEffect;
