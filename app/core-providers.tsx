"use client";

import type { ReactNode } from "react";
import { ServerThemeProvider } from "@/components/server-theme-provider";
import { AppToaster } from "@/components/ui/app-toaster";

import { THEME_NAMES } from "@/lib/theme-utils";

export function CoreProviders({ children }: { children: ReactNode }) {
  return (
    <ServerThemeProvider
      defaultTheme="light"
      storageKey="pixotchi-theme"
      themes={THEME_NAMES}
    >
      <AppToaster />
      {children}
    </ServerThemeProvider>
  );
}
