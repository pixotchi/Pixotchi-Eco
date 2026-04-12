"use client";

import type { ReactNode } from "react";
import { Toaster } from "react-hot-toast";
import { ThemeInitializer } from "@/components/theme-initializer";
import { ServerThemeProvider } from "@/components/server-theme-provider";

const APP_THEMES = ["light", "dark", "green", "yellow", "red", "pink", "blue", "violet"];

export function CoreProviders({ children }: { children: ReactNode }) {
  return (
    <ServerThemeProvider
      defaultTheme="light"
      storageKey="pixotchi-theme"
      themes={APP_THEMES}
    >
      <ThemeInitializer />
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 4000,
          style: {
            backgroundColor: "hsl(var(--background))",
            color: "hsl(var(--foreground))",
            border: "1px solid hsl(var(--border))",
            zIndex: 9999,
          },
          success: {
            iconTheme: {
              primary: "hsl(var(--primary))",
              secondary: "hsl(var(--primary-foreground))",
            },
          },
          error: {
            iconTheme: {
              primary: "hsl(var(--destructive))",
              secondary: "hsl(var(--destructive-foreground))",
            },
          },
        }}
        containerStyle={{
          top: "max(1rem, var(--safe-area-inset-top), var(--browser-safe-area-top))",
          zIndex: 9999,
        }}
      />
      {children}
    </ServerThemeProvider>
  );
}
