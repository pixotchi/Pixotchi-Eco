'use client';

import { PrivyProvider, type PrivyClientConfig } from '@privy-io/react-auth';
import { useTheme } from 'next-themes';
import { useMemo, type ComponentProps } from 'react';

export function vendorTheme(theme: string | undefined): 'light' | 'dark' {
  return theme === 'dark' ? 'dark' : 'light';
}

/** Vendor dialogs use the player's selected theme, independent of the hero's decorative cycle. */
export function ThemedPrivyProvider({ config, ...props }: ComponentProps<typeof PrivyProvider>) {
  const { forcedTheme, resolvedTheme, theme } = useTheme();
  const appearanceTheme = vendorTheme(forcedTheme ?? resolvedTheme ?? theme);
  const themedConfig = useMemo<PrivyClientConfig>(() => ({
    ...config,
    appearance: { ...config?.appearance, theme: appearanceTheme },
  }), [appearanceTheme, config]);
  return <PrivyProvider {...props} config={themedConfig} />;
}
