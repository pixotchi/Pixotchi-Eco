"use client";

import { useEffect } from 'react';
import { useTheme } from 'next-themes';
import { getClientTheme, syncThemeMetadata, Theme, THEMES } from '@/lib/theme-utils';

export function ThemeInitializer() {
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    const currentTheme = getClientTheme();
    if (currentTheme && theme !== currentTheme) {
      setTheme(currentTheme);
      return;
    }

    if (theme && THEMES[theme as Theme]) {
      syncThemeMetadata(theme as Theme);
    }
  }, [theme, setTheme]);

  // This component doesn't render anything, it just ensures theme consistency
  return null;
}
