"use client";

import { Toaster } from "react-hot-toast";

export function AppToaster() {
  return (
    <Toaster
      position="top-center"
      toastOptions={{
        duration: 4000,
        style: {
          backgroundColor: "hsl(var(--card) / 0.97)",
          backgroundImage: "var(--gradient-surface)",
          border: "1px solid hsl(var(--border) / 0.75)",
          borderRadius: "var(--radius-panel)",
          boxShadow: "var(--shadow-raised), inset 0 1px 0 hsl(var(--background) / 0.44)",
          color: "hsl(var(--foreground))",
          zIndex: "var(--z-toast)",
          backdropFilter: "blur(var(--blur-surface))",
          WebkitBackdropFilter: "blur(var(--blur-surface))",
          padding: "0.875rem 1rem",
          fontSize: "0.875rem",
          lineHeight: "1.35",
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
