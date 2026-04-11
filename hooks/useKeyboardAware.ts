"use client";

import { useState, useEffect, useCallback } from 'react';

const KEYBOARD_HEIGHT_THRESHOLD = 150;
const HOST_CHROME_VISIBLE_THRESHOLD = 32;

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

    // Check if we're on a mobile device
    const isMobile = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(
      navigator.userAgent
    );

    if (!isMobile) return;

    const viewport = window.visualViewport;
    if (!viewport) return;

    const windowHeight = window.innerHeight;
    const viewportHeight = viewport.height;
    const keyboardHeight = windowHeight - viewportHeight;

    // Consider keyboard visible if height > 150px (accounting for some threshold)
    const isKeyboardVisible = keyboardHeight > KEYBOARD_HEIGHT_THRESHOLD;

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

    // Initial check
    updateKeyboardState();

    return () => {
      viewport.removeEventListener('resize', updateKeyboardState);
    };
  }, [updateKeyboardState]);

  return keyboardState;
}

// Hook for managing viewport height (handles mobile browser UI changes)
export function useViewportHeight() {
  const [viewportHeight, setViewportHeight] = useState<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;

    const root = document.documentElement;
    let previousViewportHeight: number | null = null;
    let previousBrowserTop: string | null = null;
    let previousBrowserRight: string | null = null;
    let previousBrowserBottom: string | null = null;
    let previousBrowserLeft: string | null = null;
    let previousHostChromeBottomInset: string | null = null;
    let previousHostChromeState: 'visible' | 'hidden' | null = null;
    let pendingAnimationFrame: number | null = null;

    const parsePixelValue = (value: string) => {
      const normalized = value.trim();
      if (!normalized || normalized === '(empty)') {
        return null;
      }

      const match = normalized.match(/-?\d+(\.\d+)?/);
      if (!match) {
        return null;
      }

      const parsed = Number(match[0]);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const resolveCssLengthValue = (
      value: string,
      property: 'paddingBottom' | 'paddingTop',
    ): number | null => {
      if (!value || value === '(empty)') {
        return null;
      }

      const probe = document.createElement('div');
      probe.style.position = 'fixed';
      probe.style.visibility = 'hidden';
      probe.style.pointerEvents = 'none';
      probe.style.inset = '0 auto auto 0';
      probe.style[property] = value;
      document.body.appendChild(probe);

      const resolved = parsePixelValue(getComputedStyle(probe)[property]);
      probe.remove();
      return resolved;
    };

    const updateHostChromeState = () => {
      const styles = getComputedStyle(root);
      const safeBottom = resolveCssLengthValue(
        styles.getPropertyValue('--safe-area-inset-bottom'),
        'paddingBottom',
      ) ?? 0;
      const browserBottom = resolveCssLengthValue(
        styles.getPropertyValue('--browser-safe-area-bottom'),
        'paddingBottom',
      ) ?? 0;
      const bottomInset = Math.max(safeBottom, browserBottom);
      const nextInset = `${bottomInset}px`;
      const nextState = bottomInset >= HOST_CHROME_VISIBLE_THRESHOLD ? 'visible' : 'hidden';

      if (previousHostChromeBottomInset !== nextInset) {
        root.style.setProperty('--host-chrome-bottom-inset', nextInset);
        previousHostChromeBottomInset = nextInset;
      }

      if (previousHostChromeState !== nextState) {
        root.dataset.hostChrome = nextState;
        previousHostChromeState = nextState;
      }
    };

    const updateHeight = () => {
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
      const nextBrowserTop = `${offsetTop}px`;
      const nextBrowserRight = `${offsetRight}px`;
      const nextBrowserBottom = `${browserBottomInset}px`;
      const nextBrowserLeft = `${offsetLeft}px`;

      if (previousViewportHeight !== visibleHeight) {
        root.style.setProperty('--vh', `${visibleHeight * 0.01}px`);
        previousViewportHeight = visibleHeight;
        setViewportHeight(visibleHeight);
      }

      if (previousBrowserTop !== nextBrowserTop) {
        root.style.setProperty('--browser-safe-area-top', nextBrowserTop);
        previousBrowserTop = nextBrowserTop;
      }
      if (previousBrowserRight !== nextBrowserRight) {
        root.style.setProperty('--browser-safe-area-right', nextBrowserRight);
        previousBrowserRight = nextBrowserRight;
      }
      if (previousBrowserBottom !== nextBrowserBottom) {
        root.style.setProperty('--browser-safe-area-bottom', nextBrowserBottom);
        previousBrowserBottom = nextBrowserBottom;
      }
      if (previousBrowserLeft !== nextBrowserLeft) {
        root.style.setProperty('--browser-safe-area-left', nextBrowserLeft);
        previousBrowserLeft = nextBrowserLeft;
      }

      updateHostChromeState();
    };

    const scheduleUpdate = () => {
      if (pendingAnimationFrame !== null) {
        return;
      }

      pendingAnimationFrame = window.requestAnimationFrame(() => {
        pendingAnimationFrame = null;
        updateHeight();
      });
    };

    const handleOrientationChange = () => {
      // Small delay to account for mobile browser UI adjustments
      window.setTimeout(scheduleUpdate, 100);
    };

    const viewport = window.visualViewport;
    updateHeight();

    // Update on viewport resize, browser chrome movement, and orientation changes.
    window.addEventListener('resize', scheduleUpdate);
    window.addEventListener('orientationchange', handleOrientationChange);
    viewport?.addEventListener('resize', scheduleUpdate);
    const hostChromePoll = window.setInterval(updateHostChromeState, 250);

    return () => {
      if (pendingAnimationFrame !== null) {
        window.cancelAnimationFrame(pendingAnimationFrame);
      }

      window.removeEventListener('resize', scheduleUpdate);
      window.removeEventListener('orientationchange', handleOrientationChange);
      viewport?.removeEventListener('resize', scheduleUpdate);
      window.clearInterval(hostChromePoll);
      root.style.removeProperty('--host-chrome-bottom-inset');
      root.style.removeProperty('--browser-safe-area-top');
      root.style.removeProperty('--browser-safe-area-right');
      root.style.removeProperty('--browser-safe-area-bottom');
      root.style.removeProperty('--browser-safe-area-left');
      delete root.dataset.hostChrome;
    };
  }, []);

  return viewportHeight;
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
