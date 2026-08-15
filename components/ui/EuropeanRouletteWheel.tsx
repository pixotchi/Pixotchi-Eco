"use client";

import React, { useCallback, useEffect, useRef } from 'react';

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
    // The continuous spin is driven straight into the DOM rather than through
    // React state. Calling setState per animation frame re-rendered all 74 SVG
    // nodes (37 pockets + 37 labels) at 60fps, which visibly janked the casino
    // dialog on low-end mobile. Transforms are cheap; re-renders are not.
    const wheelRef = useRef<HTMLDivElement | null>(null);
    const ballRef = useRef<HTMLDivElement | null>(null);
    const rotationRef = useRef(0);
    const ballAngleRef = useRef(0);
    const animationRef = useRef<number | null>(null);
    const settleTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
        return (index / 37) * 360;
    };

    const cancelContinuousSpin = useCallback(() => {
        if (animationRef.current !== null) {
            cancelAnimationFrame(animationRef.current);
            animationRef.current = null;
        }
    }, []);

    const clearSettleTimer = useCallback(() => {
        if (settleTimeoutRef.current !== null) {
            clearTimeout(settleTimeoutRef.current);
            settleTimeoutRef.current = null;
        }
    }, []);

    // Animate wheel spin
    useEffect(() => {
        if (!spinning || animationRef.current !== null) return;

        clearSettleTimer();

        const animate = () => {
            // Continuous fast spin while waiting for result
            rotationRef.current = (rotationRef.current + 12) % 360;
            // Ball spins opposite
            ballAngleRef.current = (ballAngleRef.current - 12) % 360;
            applyTransforms('none');

            animationRef.current = requestAnimationFrame(animate);
        };

        animationRef.current = requestAnimationFrame(animate);
    }, [applyTransforms, clearSettleTimer, spinning]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cancelContinuousSpin();
            clearSettleTimer();
        };
    }, [cancelContinuousSpin, clearSettleTimer]);

    useEffect(() => {
        if (spinning || winningNumber !== null) return;

        cancelContinuousSpin();
        clearSettleTimer();
    }, [cancelContinuousSpin, clearSettleTimer, spinning, winningNumber]);

    // Handle landing on winning number
    useEffect(() => {
        if (winningNumber !== null) {
            // Stop continuous animation before settling on the winning pocket.
            cancelContinuousSpin();
            clearSettleTimer();

            // Calculate final position to land on winning number
            const targetAngle = getNumberAngle(winningNumber);
            const extraSpins = 3 * 360; // 3 full rotations for effect
            const finalRotation = extraSpins + (360 - targetAngle);

            // Animate to final position.
            // Wheel spins clockwise to put winning number at top (0deg).
            // Ball spins counter-clockwise and must also end at top (0deg), so it
            // gets a whole number of extra turns for relative motion.
            const ballSpins = 5 * 360; // 5 full rotations relative to start
            rotationRef.current = finalRotation;
            ballAngleRef.current = -ballSpins;

            // The transition runs from whatever transform the RAF loop last wrote,
            // so the settle continues smoothly out of the continuous spin.
            applyTransforms('transform 3s cubic-bezier(0.17, 0.67, 0.12, 0.99)');

            // Notify completion after animation
            settleTimeoutRef.current = setTimeout(() => {
                settleTimeoutRef.current = null;
                onSpinComplete?.();
            }, 3000);
        }
    }, [applyTransforms, cancelContinuousSpin, clearSettleTimer, winningNumber, onSpinComplete]);

    const pocketAngle = 360 / 37;

    return (
        <div className="relative w-full h-full">
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
