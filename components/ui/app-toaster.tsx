"use client";

import { Toaster } from "react-hot-toast";
import { Check, X } from "lucide-react";

export function AppToaster() {
  return (
    <Toaster
      position="top-center"
      toastOptions={{
        className: "chat-white-surface",
        duration: 4000,
        style: {
          backgroundColor: "hsl(var(--card))",
          backgroundImage: "var(--gradient-surface)",
          border: "1px solid hsl(var(--border) / 0.6)",
          borderRadius: "var(--radius-control)",
          boxShadow: "var(--shadow-hairline)",
          color: "hsl(var(--foreground))",
          zIndex: "var(--z-toast)",
          padding: "0.875rem 1rem",
          fontSize: "0.875rem",
          lineHeight: "1.35",
        },
        success: {
          // Built-in status icons start invisible and animate over a loader.
          // Static SVGs keep completed states visible when motion is disabled.
          icon: <Check aria-hidden="true" data-toast-icon="success" className="h-5 w-5 shrink-0 rounded-full bg-[hsl(var(--success))] p-0.5 text-[hsl(var(--success-foreground))]" />,
        },
        error: {
          icon: <X aria-hidden="true" data-toast-icon="error" className="h-5 w-5 shrink-0 rounded-full bg-destructive p-0.5 text-destructive-foreground" />,
        },
      }}
      containerStyle={{
        top: "max(1rem, env(safe-area-inset-top), var(--safe-area-inset-top), var(--browser-safe-area-top))",
        zIndex: "var(--z-toast)",
      }}
    />
  );
}
