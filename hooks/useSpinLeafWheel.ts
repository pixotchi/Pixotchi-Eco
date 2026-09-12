"use client";

import { useCallback, useEffect, useRef, useState, type CSSProperties } from "react";

export const SPIN_LEAF_SEGMENTS = 6;
const SETTLE_DURATION_MS = 2200;
type WheelPhase = "idle" | "spinning" | "revealing" | "settling";

/** Cosmetic wheel ownership. Receipt decoding and chain readiness stay in the round controller. */
export function useSpinLeafWheel({ active, pending }: { active: boolean; pending: boolean }) {
  const rotorRef = useRef<HTMLDivElement | null>(null);
  const [phase, setPhase] = useState<WheelPhase>("idle");
  const [rotation, setRotation] = useState(0);
  const [target, setTarget] = useState<number | null>(null);

  const freeze = useCallback(() => {
    const rotor = rotorRef.current;
    if (!rotor) return;
    const computed = getComputedStyle(rotor).transform;
    const matrix = new DOMMatrixReadOnly(computed === "none" ? undefined : computed);
    const angle = ((Math.atan2(matrix.b, matrix.a) * 180 / Math.PI) + 360) % 360;
    // React must receive the same angle as the imperative freeze or its next
    // render replaces the animated position with the previous resting angle.
    rotor.style.animation = "none";
    rotor.style.transform = `rotate(${angle}deg)`;
    setRotation(angle);
  }, []);

  const start = useCallback(() => {
    if (rotorRef.current) {
      rotorRef.current.style.animation = "";
      rotorRef.current.style.transform = "";
    }
    setPhase("spinning");
    setTarget(null);
  }, []);
  const stop = useCallback(() => {
    freeze();
    setPhase("idle");
    setTarget(null);
  }, [freeze]);
  const reveal = useCallback(() => {
    freeze();
    setPhase("revealing");
    setTarget(null);
  }, [freeze]);
  const finish = useCallback((rewardIndex?: number | null) => {
    if (rewardIndex === undefined || rewardIndex === null || !Number.isInteger(rewardIndex)
      || rewardIndex < 0 || rewardIndex >= SPIN_LEAF_SEGMENTS) { stop(); return; }
    // Capture the animated angle before arming the transition; do not snap to zero.
    const rotor = rotorRef.current;
    if (rotor) {
      const computed = getComputedStyle(rotor).transform;
      rotor.style.animation = "none";
      rotor.style.transform = computed === "none" ? "rotate(0deg)" : computed;
      void rotor.offsetHeight;
    }
    const segmentAngle = 360 / SPIN_LEAF_SEGMENTS;
    setPhase("settling");
    setTarget(4 * 360 + (SPIN_LEAF_SEGMENTS - 1 - rewardIndex) * segmentAngle + segmentAngle / 2);
  }, [stop]);

  useEffect(() => {
    if (!active) return;
    setPhase(pending ? "spinning" : "idle");
  }, [active, pending]);

  useEffect(() => {
    if (target === null) return;
    const timeout = setTimeout(() => {
      setRotation(((target % 360) + 360) % 360);
      setTarget(null);
      setPhase(pending ? "spinning" : "idle");
    }, SETTLE_DURATION_MS);
    return () => clearTimeout(timeout);
  }, [pending, target]);

  const style: CSSProperties | undefined = target !== null
    ? { transform: `rotate(${target}deg)` }
    : phase === "spinning" ? undefined : { transform: `rotate(${rotation}deg)` };
  const className = target !== null ? "transition-transform duration-[2200ms] ease-out"
    : phase === "spinning" ? "animate-[spin-slow_1.5s_linear_infinite]" : "";
  return { rotorRef, style, className, start, stop, reveal, finish };
}
