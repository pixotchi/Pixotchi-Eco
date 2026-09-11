"use client";

import { useReducedMotion } from "motion/react";
import { usePerformanceMode } from "@/components/ui/performance-mode";

export const UI_SPRING = {
  type: "spring" as const,
  stiffness: 380,
  damping: 30,
  mass: 1,
};
export function useQuietMotion() {
  const reduced = useReducedMotion();
  const { enabled } = usePerformanceMode();
  return Boolean(reduced || enabled);
}

/** Capture a tile before opening its detail surface. Keyboard openings stay still. */
let origin: { rect: DOMRect; at: number } | null = null;
export function rememberSurfaceOrigin(element: HTMLElement, pointer = true) {
  origin = pointer
    ? { rect: element.getBoundingClientRect(), at: performance.now() }
    : null;
}
export function consumeSurfaceOrigin() {
  const value = origin;
  origin = null;
  return value && performance.now() - value.at < 1500 ? value.rect : null;
}
