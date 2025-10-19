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
    const isKeyboardVisible = keyboardHeight > 150;

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

// Hook for managing viewport height (handles mobile browser UI changes)
export function useViewportHeight() {
  const [viewportHeight, setViewportHeight] = useState<number>(0);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const updateHeight = () => {
      const vh = window.innerHeight * 0.01;
      document.documentElement.style.setProperty('--vh', `${vh}px`);
      setViewportHeight(window.innerHeight);
    };

    updateHeight();

    // Update on resize and orientation change
    window.addEventListener('resize', updateHeight);
    window.addEventListener('orientationchange', () => {
      // Small delay to account for mobile browser UI adjustments
      setTimeout(updateHeight, 100);
    });

    return () => {
      window.removeEventListener('resize', updateHeight);
      window.removeEventListener('orientationchange', updateHeight);
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
