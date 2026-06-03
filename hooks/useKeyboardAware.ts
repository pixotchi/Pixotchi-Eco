"use client";

import { useState, useEffect, useCallback } from 'react';

interface KeyboardState {
  isVisible: boolean;
  height: number;
  animationDuration: number;
}

export function useKeyboardAware(): KeyboardState {
  const [keyboardState, setKeyboardState] = useState<KeyboardState>({
    isVisible: false,
    height: 0,
    animationDuration: 250
  });

  const updateKeyboardState = useCallback(() => {
    if (typeof window === 'undefined') return;

    const viewport = window.visualViewport;
    if (!viewport) {
      setKeyboardState({
        isVisible: false,
        height: 0,
        animationDuration: 250
      });
      return;
    }

    const windowHeight = window.innerHeight;
    const viewportHeight = viewport.height;
    const keyboardHeight = windowHeight - viewportHeight;

    const activeElement = document.activeElement;
    const isTextInputFocused =
      activeElement instanceof HTMLInputElement ||
      activeElement instanceof HTMLTextAreaElement ||
      (activeElement instanceof HTMLElement && activeElement.isContentEditable);
    const isKeyboardVisible = isTextInputFocused && keyboardHeight > 120;

    setKeyboardState({
      isVisible: isKeyboardVisible,
      height: keyboardHeight,
      animationDuration: 250
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    // Use visual viewport API for better keyboard detection
    const viewport = window.visualViewport;
    if (!viewport) {
      // Fallback to window resize events
      window.addEventListener('resize', updateKeyboardState);
      return () => window.removeEventListener('resize', updateKeyboardState);
    }

    // Listen to visual viewport changes
    viewport.addEventListener('resize', updateKeyboardState);
    viewport.addEventListener('scroll', updateKeyboardState);

    // Initial check
    updateKeyboardState();

    return () => {
      viewport.removeEventListener('resize', updateKeyboardState);
      viewport.removeEventListener('scroll', updateKeyboardState);
    };
  }, [updateKeyboardState]);

  return keyboardState;
}

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
      const visibleHeight = Math.round(viewport?.height ?? layoutHeight);
      const visibleWidth = Math.round(viewport?.width ?? layoutWidth);
      const offsetTop = Math.max(0, Math.round(viewport?.offsetTop ?? 0));
      const offsetLeft = Math.max(0, Math.round(viewport?.offsetLeft ?? 0));
      const rawOffsetBottom = Math.max(0, Math.round(layoutHeight - visibleHeight - offsetTop));
      const offsetRight = Math.max(0, Math.round(layoutWidth - visibleWidth - offsetLeft));
      const browserBottomInset =
        rawOffsetBottom > KEYBOARD_HEIGHT_THRESHOLD ? 0 : rawOffsetBottom;

      root.style.setProperty('--browser-safe-area-top', `${offsetTop}px`);
      root.style.setProperty('--browser-safe-area-right', `${offsetRight}px`);
      root.style.setProperty('--browser-safe-area-bottom', `${browserBottomInset}px`);
      root.style.setProperty('--browser-safe-area-left', `${offsetLeft}px`);
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

// Hook for managing focus and keyboard navigation
export function useKeyboardNavigation() {
  const [isKeyboardNavigation, setIsKeyboardNavigation] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    let lastKeyTime = 0;
    let consecutiveKeyCount = 0;

    const handleKeyDown = (event: KeyboardEvent) => {
      // Only Tab and arrow keys indicate keyboard navigation
      const navigationKeys = ['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

      if (navigationKeys.includes(event.key)) {
        const now = Date.now();

        // Reset counter if too much time has passed
        if (now - lastKeyTime > 5000) {
          consecutiveKeyCount = 0;
        }

        consecutiveKeyCount++;
        lastKeyTime = now;

        // If we've seen multiple navigation keys, enable keyboard navigation mode
        if (consecutiveKeyCount >= 3) {
          setIsKeyboardNavigation(true);
        }
      }
    };

    const handleMouseDown = () => {
      // Reset keyboard navigation mode on mouse interaction
      consecutiveKeyCount = 0;
      setIsKeyboardNavigation(false);
    };

    const handleTouchStart = () => {
      // Reset keyboard navigation mode on touch interaction
      consecutiveKeyCount = 0;
      setIsKeyboardNavigation(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('mousedown', handleMouseDown);
    window.addEventListener('touchstart', handleTouchStart);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('mousedown', handleMouseDown);
      window.removeEventListener('touchstart', handleTouchStart);
    };
  }, []);

  return isKeyboardNavigation;
}
