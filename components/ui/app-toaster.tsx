"use client";

import { Toaster } from "react-hot-toast";

export function AppToaster() {
  return (
    <Toaster
      position="top-center"
      toastOptions={{
        duration: 4000,
        style: {
          backgroundColor: "hsl(var(--background))",
          border: "1px solid hsl(var(--border))",
          borderRadius: "var(--radius-panel)",
          boxShadow: "var(--shadow-raised)",
          color: "hsl(var(--foreground))",
          zIndex: "var(--z-toast)",
        },
        success: {
          iconTheme: {
            primary: "hsl(var(--success))",
            secondary: "hsl(var(--success-foreground))",
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
        top: "max(1rem, env(safe-area-inset-top), var(--safe-area-inset-top), var(--browser-safe-area-top))",
        zIndex: "var(--z-toast)",
      }}
    />
  );
}
