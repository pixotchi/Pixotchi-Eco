"use client";

import type { ReactNode } from "react";
import { ThemeInitializer } from "@/components/theme-initializer";
import { ServerThemeProvider } from "@/components/server-theme-provider";
import { AppToaster } from "@/components/ui/app-toaster";

const APP_THEMES = ["light", "dark", "green", "yellow", "red", "pink", "blue", "violet"];

export function CoreProviders({ children }: { children: ReactNode }) {
  return (
    <ServerThemeProvider
      defaultTheme="light"
      storageKey="pixotchi-theme"
      themes={APP_THEMES}
    >
      <ThemeInitializer />
      <AppToaster />
      {children}
    </ServerThemeProvider>
  );
}
