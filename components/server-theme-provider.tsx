"use client";

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { THEME_NAMES } from '@/lib/theme-utils';

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
  themes = THEME_NAMES
}: ServerThemeProviderProps) {

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
