"use client";
import { animate as springAnimate } from 'motion';
import { UI_SPRING } from '@/lib/motion';
import * as React from "react";
import { usePerformanceMode } from "@/components/ui/performance-mode";

type IndicatorGeometry = {
  height: number;
  left: number;
  top: number;
  width: number;
};

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
  const indicatorAnimationRef = React.useRef<{ stop: () => void } | null>(null);
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
    indicatorAnimationRef.current?.stop();
    indicatorAnimationRef.current = null;
  }, []);

  React.useLayoutEffect(() => {
    const container = containerRef.current;
    const indicator = indicatorRef.current;
    const selectedItem = itemRefs.current[selectedIndex];
    if (!container || !indicator || !selectedItem) {
      indicatorAnimationRef.current?.stop();
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
          indicatorAnimationRef.current.stop();
          indicatorAnimationRef.current = null;
          indicator.style.transform = `translate3d(${nextGeometry.left}px, ${nextGeometry.top}px, 0) scale(1, 1)`;
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
      indicatorAnimationRef.current?.stop();
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

      // Leading and trailing edges settle independently. Long horizontal moves
      // stretch the capsule briefly; interruption starts from its rendered bounds.
      let left = previousVisualGeometry.left;
      let right = left + previousVisualGeometry.width;
      let top = previousVisualGeometry.top;
      const paint = () => {
        indicator.style.transform = `translate3d(${left}px, ${top}px, 0) scale(${Math.max(1, right - left) / nextGeometry.width}, 1)`;
      };
      paint();
      const rightward = nextGeometry.left > left;
      const trailingSpring = { ...UI_SPRING, stiffness: 320, damping: 30 };
      const leftMotion = springAnimate(left, nextGeometry.left, { ...(rightward ? trailingSpring : UI_SPRING), onUpdate: value => { left = value; paint(); } });
      const rightMotion = springAnimate(right, nextGeometry.left + nextGeometry.width, { ...(rightward ? UI_SPRING : trailingSpring), onUpdate: value => { right = value; paint(); } });
      const topMotion = springAnimate(top, nextGeometry.top, { ...UI_SPRING, onUpdate: value => { top = value; paint(); } });
      const animation = { stop: () => { leftMotion.stop(); rightMotion.stop(); topMotion.stop(); } };
      indicatorAnimationRef.current = animation;
      void Promise.all([leftMotion, rightMotion, topMotion]).then(() => {
        if (indicatorAnimationRef.current === animation) {
          indicator.style.transform = finalTransform;
          indicatorAnimationRef.current = null;
        }
      });
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
