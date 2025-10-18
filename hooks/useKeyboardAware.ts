"use client";

import { useState, useEffect, useCallback, useEffectEvent } from 'react';

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

    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );

    if (!isMobile) return;

    const viewport = window.visualViewport;
    if (!viewport) return;

    const windowHeight = window.innerHeight;
    const viewportHeight = viewport.height;
    const keyboardHeight = windowHeight - viewportHeight;

    const isKeyboardVisible = keyboardHeight > 150;

    setKeyboardState({
      isVisible: isKeyboardVisible,
      height: keyboardHeight,
      animationDuration: 250
    });
  }, []);

  // ✅ useEffectEvent: Setup viewport listeners without depending on updateKeyboardState
  const setupViewportListeners = useEffectEvent(() => {
    if (typeof window === 'undefined') return () => {};

    const viewport = window.visualViewport;
    if (!viewport) {
      window.addEventListener('resize', updateKeyboardState);
      return () => window.removeEventListener('resize', updateKeyboardState);
    }

    viewport.addEventListener('resize', updateKeyboardState);
    viewport.addEventListener('scroll', updateKeyboardState);

    updateKeyboardState();

    return () => {
      viewport.removeEventListener('resize', updateKeyboardState);
      viewport.removeEventListener('scroll', updateKeyboardState);
    };
  });

  useEffect(() => {
    const cleanup = setupViewportListeners();
    return cleanup;
  }, [setupViewportListeners]);

  return keyboardState;
}

// Hook for managing viewport height (handles mobile browser UI changes)
export function useViewportHeight() {
  const [viewportHeight, setViewportHeight] = useState<number>(0);

  // ✅ useEffectEvent: Handle viewport height updates without dependency churn
  const updateHeight = useEffectEvent(() => {
    const vh = window.innerHeight * 0.01;
    document.documentElement.style.setProperty('--vh', `${vh}px`);
    setViewportHeight(window.innerHeight);
  });

  // ✅ useEffectEvent: Setup viewport listeners
  const setupHeightListeners = useEffectEvent(() => {
    if (typeof window === 'undefined') return () => {};

    updateHeight();

    window.addEventListener('resize', updateHeight);
    const orientationHandler = () => {
      setTimeout(updateHeight, 100);
    };
    window.addEventListener('orientationchange', orientationHandler);

    return () => {
      window.removeEventListener('resize', updateHeight);
      window.removeEventListener('orientationchange', orientationHandler);
    };
  });

  useEffect(() => {
    const cleanup = setupHeightListeners();
    return cleanup;
  }, [setupHeightListeners]);

  return viewportHeight;
}

// Hook for managing focus and keyboard navigation
export function useKeyboardNavigation() {
  const [isKeyboardNavigation, setIsKeyboardNavigation] = useState(false);

  // ✅ useEffectEvent: Handle keyboard events without dependencies
  const setupKeyboardNavigation = useEffectEvent(() => {
    if (typeof window === 'undefined') return () => {};

    let lastKeyTime = 0;
    let consecutiveKeyCount = 0;

    const handleKeyDown = (event: KeyboardEvent) => {
      const navigationKeys = ['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

      if (navigationKeys.includes(event.key)) {
        const now = Date.now();

        if (now - lastKeyTime > 5000) {
          consecutiveKeyCount = 0;
        }

        consecutiveKeyCount++;
        lastKeyTime = now;

        if (consecutiveKeyCount >= 3) {
          setIsKeyboardNavigation(true);
        }
      }
    };

    const handleMouseDown = () => {
      consecutiveKeyCount = 0;
      setIsKeyboardNavigation(false);
    };

    const handleTouchStart = () => {
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
  });

  useEffect(() => {
    const cleanup = setupKeyboardNavigation();
    return cleanup;
  }, [setupKeyboardNavigation]);

  return isKeyboardNavigation;
}
