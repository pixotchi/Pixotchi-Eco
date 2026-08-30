"use client";

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { usePerformanceMode } from '@/components/ui/performance-mode';

const CONTINUOUS_WHEEL_SPEED_DEGREES_PER_SECOND = 720;
const CONTINUOUS_BALL_SPEED_DEGREES_PER_SECOND = 900;
const SETTLE_DURATION_MS = 3000;

// European roulette wheel numbers in order (37 pockets: 0 and 1-36)
const EUROPEAN_WHEEL_NUMBERS = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10,
    5, 24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];

interface EuropeanRouletteWheelProps {
    spinning: boolean;
    winningNumber: number | null;
    onSpinComplete?: () => void;
}

export default function EuropeanRouletteWheel({
    spinning,
    winningNumber,
    onSpinComplete
}: EuropeanRouletteWheelProps) {
    const { enabled: performanceModeEnabled } = usePerformanceMode();
    const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);
    const [pageVisible, setPageVisible] = useState(true);
    // The continuous spin is driven straight into the DOM rather than through
    // React state. Calling setState per animation frame re-rendered all 74 SVG
    // nodes (37 pockets + 37 labels) at 60fps, which visibly janked the casino
    // dialog on low-end mobile. Transforms are cheap; re-renders are not.
    const wheelRef = useRef<HTMLDivElement | null>(null);
    const ballRef = useRef<HTMLDivElement | null>(null);
    const rotationRef = useRef(0);
    const ballAngleRef = useRef(0);
    const animationRef = useRef<number | null>(null);
    const lastFrameTimeRef = useRef<number | null>(null);
    const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const completedWinningNumberRef = useRef<number | null>(null);
    const onSpinCompleteRef = useRef(onSpinComplete);
    const motionDisabled = performanceModeEnabled || prefersReducedMotion || !pageVisible;

    useEffect(() => {
        onSpinCompleteRef.current = onSpinComplete;
    }, [onSpinComplete]);

    useEffect(() => {
        const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
        const syncPreference = () => setPrefersReducedMotion(reducedMotion.matches);
        syncPreference();
        try {
            reducedMotion.addEventListener('change', syncPreference);
            return () => reducedMotion.removeEventListener('change', syncPreference);
        } catch {
            reducedMotion.addListener(syncPreference);
            return () => reducedMotion.removeListener(syncPreference);
        }
    }, []);

    useEffect(() => {
        const syncVisibility = () => setPageVisible(document.visibilityState === 'visible');
        syncVisibility();
        document.addEventListener('visibilitychange', syncVisibility);
        return () => document.removeEventListener('visibilitychange', syncVisibility);
    }, []);

    const applyTransforms = useCallback((transition: string) => {
        if (wheelRef.current) {
            wheelRef.current.style.transition = transition;
            wheelRef.current.style.transform = `rotate(${rotationRef.current}deg)`;
        }
        if (ballRef.current) {
            ballRef.current.style.transition = transition;
            ballRef.current.style.transform = `rotate(${ballAngleRef.current}deg)`;
        }
    }, []);

    // Get pocket color
    const getPocketColor = (num: number): string => {
        if (num === 0) return '#16a34a'; // green
        return RED_NUMBERS.includes(num) ? '#dc2626' : '#1f2937'; // red or black
    };

    // Calculate angle for a specific number on the wheel
    const getNumberAngle = (num: number): number => {
        const index = EUROPEAN_WHEEL_NUMBERS.indexOf(num);
        if (index === -1) return 0;
        // SVG pockets span index..index+1; target their center rather than the
        // boundary between two numbers, which otherwise parks the pointer line
        // (and ball) ambiguously between adjacent results.
        return ((index + 0.5) / EUROPEAN_WHEEL_NUMBERS.length) * 360;
    };

    const cancelContinuousSpin = useCallback(() => {
        if (animationRef.current !== null) {
            cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
        }
        lastFrameTimeRef.current = null;
    }, []);

    const clearSettleTimer = useCallback(() => {
        if (settleTimeoutRef.current !== null) {
            clearTimeout(settleTimeoutRef.current);
            settleTimeoutRef.current = null;
        }
    }, []);

    // Animate wheel spin
    useEffect(() => {
        if (!spinning || winningNumber !== null || motionDisabled) {
            cancelContinuousSpin();
            return;
        }
        if (animationRef.current !== null) return;

        clearSettleTimer();

        const animate = (timestamp: number) => {
            const previousTimestamp = lastFrameTimeRef.current ?? timestamp;
            const elapsedSeconds = Math.min((timestamp - previousTimestamp) / 1000, 0.05);
            lastFrameTimeRef.current = timestamp;

            rotationRef.current = (rotationRef.current + CONTINUOUS_WHEEL_SPEED_DEGREES_PER_SECOND * elapsedSeconds) % 360;
            ballAngleRef.current = (ballAngleRef.current - CONTINUOUS_BALL_SPEED_DEGREES_PER_SECOND * elapsedSeconds) % 360;
            applyTransforms('none');

            animationRef.current = requestAnimationFrame(animate);
        };

        animationRef.current = requestAnimationFrame(animate);
    }, [applyTransforms, cancelContinuousSpin, clearSettleTimer, motionDisabled, spinning, winningNumber]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cancelContinuousSpin();
            clearSettleTimer();
        };
    }, [cancelContinuousSpin, clearSettleTimer]);

    useEffect(() => {
        if (winningNumber === null) {
            completedWinningNumberRef.current = null;
        }
        if (spinning || winningNumber !== null) return;

        cancelContinuousSpin();
        clearSettleTimer();
    }, [cancelContinuousSpin, clearSettleTimer, spinning, winningNumber]);

    // Handle landing on winning number
    useEffect(() => {
        if (winningNumber !== null && completedWinningNumberRef.current !== winningNumber) {
            // Stop continuous animation before settling on the winning pocket.
            cancelContinuousSpin();
            clearSettleTimer();

            // Calculate final position to land on winning number
            const targetAngle = getNumberAngle(winningNumber);
            const currentRotation = rotationRef.current;
            const currentNormalized = ((currentRotation % 360) + 360) % 360;
            const targetNormalized = (360 - targetAngle) % 360;
            const clockwiseDelta = (targetNormalized - currentNormalized + 360) % 360;
            const finalRotation = currentRotation + (3 * 360) + clockwiseDelta;

            // Animate to final position.
            // Wheel spins clockwise to put winning number at top (0deg).
            // Ball spins counter-clockwise and must also end at top (0deg), so it
            // gets a whole number of extra turns for relative motion.
            const ballNormalized = ((ballAngleRef.current % 360) + 360) % 360;
            const ballSpins = (5 * 360) + ballNormalized;
            rotationRef.current = finalRotation;
            ballAngleRef.current -= ballSpins;

            const completeSpin = () => {
                if (completedWinningNumberRef.current === winningNumber) return;
                completedWinningNumberRef.current = winningNumber;
                onSpinCompleteRef.current?.();
            };

            if (motionDisabled) {
                applyTransforms('none');
                completeSpin();
                return;
            }

            // The transition runs from whatever transform the RAF loop last wrote,
            // so the settle continues smoothly out of the continuous spin.
            applyTransforms(`transform ${SETTLE_DURATION_MS}ms cubic-bezier(0.23, 1, 0.32, 1)`);

            const wheel = wheelRef.current;
            const handleTransitionEnd = (event: TransitionEvent) => {
                if (event.propertyName !== 'transform') return;
                clearSettleTimer();
                completeSpin();
            };
            wheel?.addEventListener('transitionend', handleTransitionEnd);

            // Fallback for background tabs or engines that drop transitionend.
            settleTimeoutRef.current = setTimeout(() => {
                settleTimeoutRef.current = null;
                completeSpin();
            }, SETTLE_DURATION_MS + 100);

            return () => {
                wheel?.removeEventListener('transitionend', handleTransitionEnd);
                clearSettleTimer();
            };
        }
    }, [applyTransforms, cancelContinuousSpin, clearSettleTimer, motionDisabled, winningNumber]);

    const pocketAngle = 360 / 37;

    return (
        <div aria-hidden="true" className="relative w-full h-full">
            {/* Outer ring */}
            <div className="absolute inset-0 rounded-full bg-gradient-to-b from-amber-700 to-amber-900 shadow-lg" />

            {/* Wheel with numbers */}
            <div
                ref={wheelRef}
                className="absolute inset-[4%] rounded-full overflow-hidden shadow-inner"
                style={{ transform: 'rotate(0deg)', transition: 'none' }}
            >
                {/* Colored pockets */}
                <svg viewBox="0 0 100 100" className="w-full h-full">
                    {EUROPEAN_WHEEL_NUMBERS.map((num, i) => {
                        const startAngle = (i * pocketAngle - 90) * (Math.PI / 180);
                        const endAngle = ((i + 1) * pocketAngle - 90) * (Math.PI / 180);
                        const x1 = 50 + 50 * Math.cos(startAngle);
                        const y1 = 50 + 50 * Math.sin(startAngle);
                        const x2 = 50 + 50 * Math.cos(endAngle);
                        const y2 = 50 + 50 * Math.sin(endAngle);

                        return (
                            <path
                                key={num}
                                d={`M 50 50 L ${x1} ${y1} A 50 50 0 0 1 ${x2} ${y2} Z`}
                                fill={getPocketColor(num)}
                                stroke="#333"
                                strokeWidth="0.3"
                            />
                        );
                    })}

                    {/* Number labels */}
                    {EUROPEAN_WHEEL_NUMBERS.map((num, i) => {
                        const angle = ((i + 0.5) * pocketAngle - 90) * (Math.PI / 180);
                        const x = 50 + 40 * Math.cos(angle);
                        const y = 50 + 40 * Math.sin(angle);
                        const textRotation = (i + 0.5) * pocketAngle;

                        return (
                            <text
                                key={`text-${num}`}
                                x={x}
                                y={y}
                                fill="white"
                                fontSize="4"
                                fontWeight="bold"
                                textAnchor="middle"
                                dominantBaseline="middle"
                                transform={`rotate(${textRotation}, ${x}, ${y})`}
                            >
                                {num}
                            </text>
                        );
                    })}
                </svg>

                {/* Center hub */}
                <div className="absolute inset-[35%] rounded-full bg-gradient-to-b from-amber-600 to-amber-800 border-2 border-amber-500 shadow-lg flex items-center justify-center">
                    <div className="w-1/2 h-1/2 rounded-full bg-gradient-to-b from-amber-500 to-amber-700" />
                </div>
            </div>

            {/* Ball */}
            <div
                ref={ballRef}
                className="absolute inset-[8%] rounded-full pointer-events-none"
                style={{ transform: 'rotate(0deg)', transition: 'none' }}
            >
                <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[8%] h-[8%] rounded-full bg-white shadow-md border border-gray-300" />
            </div>

            {/* Pointer indicator */}
            <div className="absolute top-0 left-1/2 -translate-x-1/2 -translate-y-1 z-10">
                <div className="w-0 h-0 border-l-[6px] border-r-[6px] border-t-[10px] border-l-transparent border-r-transparent border-t-amber-400 drop-shadow-md" />
            </div>
        </div>
    );
}
