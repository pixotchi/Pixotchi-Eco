"use client";
import * as React from "react";
import { usePerformanceMode } from "@/components/ui/performance-mode";

type IndicatorGeometry = {
  height: number;
  left: number;
  top: number;
  width: number;
};

function parseMotionDuration(value: string, fallback: number) {
  const amount = Number.parseFloat(value);
  if (!Number.isFinite(amount)) return fallback;
  if (value.trim().endsWith("ms")) return amount;
  if (value.trim().endsWith("s")) return amount * 1000;
  return fallback;
}


/** Shared geometry/motion only. Consumers own tab/radio semantics and selection. */
export function useSelectionIndicator({ containerRef, indicatorRef, itemRefs, selectedIndex, itemCount, layoutKey, animate = true }: {
  containerRef: React.RefObject<HTMLDivElement | null>;
  indicatorRef: React.RefObject<HTMLSpanElement | null>;
  itemRefs: React.RefObject<Array<HTMLButtonElement | null>>;
  selectedIndex: number;
  itemCount: number;
  layoutKey: string;
  animate?: boolean;
}) {
  const { enabled: performanceModeEnabled } = usePerformanceMode();
  const [prefersReducedMotion, setPrefersReducedMotion] = React.useState(false);
  const targetIndicatorGeometryRef = React.useRef<IndicatorGeometry | null>(null);
  const indicatorAnimationRef = React.useRef<Animation | null>(null);
  const suppressNextIndicatorMotionRef = React.useRef(false);
  const skipIndicatorMotion = !animate || performanceModeEnabled || prefersReducedMotion;
  React.useEffect(() => {
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    const syncPreference = () => setPrefersReducedMotion(reducedMotion.matches);
    syncPreference();

    try {
      reducedMotion.addEventListener("change", syncPreference);
      return () => reducedMotion.removeEventListener("change", syncPreference);
    } catch {
      reducedMotion.addListener(syncPreference);
      return () => reducedMotion.removeListener(syncPreference);
    }
  }, []);

  React.useEffect(() => () => {
    indicatorAnimationRef.current?.cancel();
    indicatorAnimationRef.current = null;
  }, []);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    const selectedItem = itemRefs.current[selectedIndex];
    if (!container || !indicator || !selectedItem) {
      indicatorAnimationRef.current?.cancel();
      indicatorAnimationRef.current = null;
      targetIndicatorGeometryRef.current = null;
      if (indicator) indicator.style.opacity = "0";
      return;
    }

    const updateIndicator = (allowMotion = true) => {
      const nextGeometry: IndicatorGeometry = {
        height: selectedItem.offsetHeight,
        left: selectedItem.offsetLeft,
        top: selectedItem.offsetTop,
        width: selectedItem.offsetWidth,
      };
      const previousTarget = targetIndicatorGeometryRef.current;

      if (
        previousTarget &&
        previousTarget.height === nextGeometry.height &&
        previousTarget.left === nextGeometry.left &&
        previousTarget.top === nextGeometry.top &&
        previousTarget.width === nextGeometry.width
      ) {
        suppressNextIndicatorMotionRef.current = false;
        // A newly attached ResizeObserver delivers its initial notification even
        // when geometry did not change. Do not cancel a pointer glide for it.
        if (skipIndicatorMotion && indicatorAnimationRef.current) {
          indicatorAnimationRef.current.cancel();
          indicatorAnimationRef.current = null;
        }
        return;
      }

      // Measure before cancelling an in-flight animation. The resulting inverse
      // transform starts at the currently rendered pill, so a rapid retarget
      // continues smoothly instead of snapping to its previous destination.
      const indicatorRect = indicator.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      const previousVisualGeometry = previousTarget && indicatorRect.width > 0 && indicatorRect.height > 0
        ? {
            height: indicatorRect.height,
            left: indicatorRect.left - containerRect.left - container.clientLeft + container.scrollLeft,
            top: indicatorRect.top - containerRect.top - container.clientTop + container.scrollTop,
            width: indicatorRect.width,
          }
        : null;
      indicatorAnimationRef.current?.cancel();
      indicatorAnimationRef.current = null;

      const finalTransform = `translate3d(${nextGeometry.left}px, ${nextGeometry.top}px, 0) scale(1, 1)`;
      indicator.style.height = `${nextGeometry.height}px`;
      indicator.style.opacity = "1";
      indicator.style.transform = finalTransform;
      indicator.style.transformOrigin = "top left";
      indicator.style.width = `${nextGeometry.width}px`;

      const shouldAnimate =
        allowMotion &&
        previousVisualGeometry !== null &&
        !suppressNextIndicatorMotionRef.current &&
        !skipIndicatorMotion &&
        typeof indicator.animate === "function";
      suppressNextIndicatorMotionRef.current = false;
      targetIndicatorGeometryRef.current = nextGeometry;
      if (!shouldAnimate) return;

      const computedStyle = window.getComputedStyle(container);
      const duration = parseMotionDuration(
        computedStyle.getPropertyValue("--motion-standard"),
        220
      );
      const easing = computedStyle.getPropertyValue("--ease-standard").trim() || "cubic-bezier(0.2, 0.8, 0.2, 1)";
      const animation = indicator.animate(
        [
          {
            transform: `translate3d(${previousVisualGeometry.left}px, ${previousVisualGeometry.top}px, 0) scale(${previousVisualGeometry.width / nextGeometry.width}, ${previousVisualGeometry.height / nextGeometry.height})`,
          },
          { transform: finalTransform },
        ],
        { duration, easing }
      );
      indicatorAnimationRef.current = animation;
      animation.onfinish = () => {
        if (indicatorAnimationRef.current === animation) {
          indicatorAnimationRef.current = null;
        }
      };
    };

    updateIndicator();

    if (typeof ResizeObserver === "undefined") return;

    const resizeObserver = new ResizeObserver(() => updateIndicator(false));
    resizeObserver.observe(container);
    itemRefs.current.forEach((option) => {
      if (option) resizeObserver.observe(option);
    });

    return () => {
      resizeObserver.disconnect();
    };
  }, [containerRef, indicatorRef, itemRefs, itemCount, layoutKey, selectedIndex, skipIndicatorMotion]);


  return suppressNextIndicatorMotionRef;
}
