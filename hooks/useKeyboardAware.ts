"use client";

import { useEffect } from 'react';

// Sync browser-driven viewport insets into CSS custom properties.
// The shell height itself should be owned by CSS viewport units, not JS.
export function useViewportInsets() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const root = document.documentElement;
    const KEYBOARD_HEIGHT_THRESHOLD = 150;
    let frameId: number | null = null;
    let orientationTimeoutId: number | null = null;

    const updateInsets = () => {
      frameId = null;

      const viewport = window.visualViewport;
      const layoutHeight = window.innerHeight;
      const layoutWidth = window.innerWidth;
      // Pinch zoom also shrinks and offsets VisualViewport, but those values are
      // not browser chrome, a cutout, or the on-screen keyboard. Feeding them
      // into shell padding/max-height makes the page reflow underneath users
      // who zoom for readability. Only scale-1 viewport changes own layout.
      const isPinchZoomed = Boolean(
        viewport && Math.abs((viewport.scale ?? 1) - 1) > 0.01,
      );
      const visibleHeight = isPinchZoomed
        ? layoutHeight
        : Math.round(viewport?.height ?? layoutHeight);
      const visibleWidth = isPinchZoomed
        ? layoutWidth
        : Math.round(viewport?.width ?? layoutWidth);
      const offsetTop = isPinchZoomed
        ? 0
        : Math.max(0, Math.round(viewport?.offsetTop ?? 0));
      const offsetLeft = isPinchZoomed
        ? 0
        : Math.max(0, Math.round(viewport?.offsetLeft ?? 0));
      const rawOffsetBottom = Math.max(0, Math.round(layoutHeight - visibleHeight - offsetTop));
      const offsetRight = Math.max(0, Math.round(layoutWidth - visibleWidth - offsetLeft));
      const browserBottomInset =
        rawOffsetBottom > KEYBOARD_HEIGHT_THRESHOLD ? 0 : rawOffsetBottom;

      root.style.setProperty('--browser-safe-area-top', `${offsetTop}px`);
      root.style.setProperty('--browser-safe-area-right', `${offsetRight}px`);
      root.style.setProperty('--browser-safe-area-bottom', `${browserBottomInset}px`);
      root.style.setProperty('--browser-safe-area-left', `${offsetLeft}px`);
      // The KEYBOARD-INCLUSIVE visible height. dvh tracks browser chrome but NOT
      // the on-screen keyboard on iOS, so any dialog sized in dvh keeps its full
      // height while the keyboard halves the visual viewport — and sticky-footer
      // submit buttons land under the keyboard. Dialog panels cap their height
      // with this variable (see components/ui/dialog.tsx), falling back to dvh
      // where it is unset. The zeroed-above-threshold safe-area inset above is
      // deliberate and unchanged; this is the separate keyboard-aware channel.
      root.style.setProperty('--visual-viewport-height', `${visibleHeight}px`);
    };

    const scheduleUpdate = () => {
      if (frameId !== null) {
        return;
      }

      frameId = window.requestAnimationFrame(updateInsets);
    };

    const handleOrientationChange = () => {
      // Let the browser settle before recomputing inset values.
      if (orientationTimeoutId !== null) {
        window.clearTimeout(orientationTimeoutId);
      }

      orientationTimeoutId = window.setTimeout(scheduleUpdate, 100);
    };

    const viewport = window.visualViewport;
    scheduleUpdate();

    // Per the VisualViewport spec, `resize` reflects chrome show/hide and keyboard state;
    // `scroll` is for pinch-zoom panning and fires continuously during page scroll, which
    // samples mid-animation values on WebViews that animate their address bar. Listening
    // only to `resize` is the correct signal for committed chrome state.
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('orientationchange', handleOrientationChange);
    viewport?.addEventListener('resize', scheduleUpdate);

    return () => {
      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('orientationchange', handleOrientationChange);
      viewport?.removeEventListener('resize', scheduleUpdate);

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      if (orientationTimeoutId !== null) {
        window.clearTimeout(orientationTimeoutId);
      }
    };
  }, []);
}
