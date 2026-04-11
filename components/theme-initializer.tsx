"use client";

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { applyTheme, THEME_STORAGE_KEY, Theme, THEMES } from '@/lib/theme-utils';

export function ThemeInitializer() {
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    // Ensure theme is applied on client-side mount
    const getClientTheme = (): Theme => {
      if (typeof window === 'undefined') return 'light';

      try {
        const stored = localStorage.getItem(THEME_STORAGE_KEY) as Theme;
        return stored && THEMES[stored] ? stored : 'light';
      } catch (error) {
        console.warn('Error getting client theme:', error);
        return 'light';
      }
    };

    const currentTheme = getClientTheme();

    if (currentTheme && theme !== currentTheme) {
      setTheme(currentTheme);
      applyTheme(currentTheme);
    }
  }, [theme, setTheme]);

  // This component doesn't render anything, it just ensures theme consistency
  return null;
}
