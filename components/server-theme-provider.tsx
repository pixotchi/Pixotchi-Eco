"use client";

import { useEffect } from 'react';
import { ThemeProvider as NextThemesProvider, useTheme } from 'next-themes';
import { getClientTheme, applyTheme } from '@/lib/theme-utils';

interface ServerThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: string;
  storageKey?: string;
  themes?: string[];
}

// Dynamic loader no longer needed; themes are defined in CSS and applied via class

export function ServerThemeProvider({
  children,
  defaultTheme = 'light',
  storageKey = 'pixotchi-theme',
  themes = ["light", "dark", "green", "yellow", "red", "pink", "blue", "violet"]
}: ServerThemeProviderProps) {

  useEffect(() => {
    // Ensure theme is applied on mount to prevent flash of unstyled content
    const clientTheme = getClientTheme();
    if (clientTheme) {
      applyTheme(clientTheme);
    }
  }, []);

  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme={defaultTheme}
      enableSystem={false}
      themes={themes}
      storageKey={storageKey}
      disableTransitionOnChange={false}
    >
      {children}
    </NextThemesProvider>
  );
}
