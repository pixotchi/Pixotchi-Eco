"use client";

import * as React from "react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEMES, setClientTheme, Theme } from "@/lib/theme-utils";
import { useSnow } from "@/lib/snow-context";

const SECRET_EVENT_NAME = "pixotchi:secret-garden-unlock";

const themes = [
  { name: "light", label: "Light", color: "bg-slate-300" },
  { name: "dark", label: "Dark", color: "bg-slate-800" },
  { name: "green", label: "Green", color: "bg-green-500" },
  { name: "yellow", label: "Yellow", color: "bg-yellow-500" },
  { name: "red", label: "Red", color: "bg-red-500" },
  { name: "pink", label: "Pink", color: "bg-pink-500" },
  { name: "blue", label: "Blue", color: "bg-blue-500" },
  { name: "violet", label: "Violet", color: "bg-fuchsia-500" }
];

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const { isEnabled: isSnowEnabled, isFeatureEnabled: isSnowFeatureEnabled, toggleSnow } = useSnow();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const handleSecretProgress = React.useCallback(async (selectedTheme: string) => {
    try {
      const response = await fetch("/api/secret-garden/progress", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ theme: selectedTheme }),
        credentials: "include",
      });

      if (!response.ok) {
        return;
      }

      const data = (await response.json()) as {
        status?: string;
        token?: string;
      };

      if (data?.status === "unlock" && data.token && typeof window !== "undefined") {
        window.dispatchEvent(
          new CustomEvent(SECRET_EVENT_NAME, {
            detail: { token: data.token },
          })
        );
      }
    } catch (error) {
      console.warn("Secret garden progress check failed", error);
    }
  }, []);

  const handleThemeChange = React.useCallback((newTheme: string) => {
    if (THEMES[newTheme as Theme]) {
      setTheme(newTheme);
      // Also use our custom theme persistence for better SSR support
      setClientTheme(newTheme as Theme);
      void handleSecretProgress(newTheme);
    }
  }, [handleSecretProgress, setTheme]);

  if (!mounted) {
    // Render a placeholder to prevent layout shift
    return <Button variant="outline" size="icon" disabled className="h-9 w-9" />;
  }

  const currentTheme = themes.find((t) => t.name === theme) ?? themes[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="icon"
          title={`Change theme: ${currentTheme.label}`}
          aria-label={`Current theme: ${currentTheme.label}. Click to change theme`}
        >
          <div className={`h-4 w-4 rounded-sm ${currentTheme.color}`} />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="p-2" aria-label="Theme selection menu">
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Available themes">
          {themes.map((themeOption) => (
            <Button
              key={themeOption.name}
              variant="outline"
              size="icon"
              title={themeOption.label}
              onClick={() => handleThemeChange(themeOption.name)}
              className={`h-8 w-8 ${theme === themeOption.name ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""
                }`}
              role="radio"
              aria-checked={theme === themeOption.name}
              aria-label={`Select ${themeOption.label} theme`}
            >
              <div className={`h-4 w-4 rounded-sm ${themeOption.color}`} />
            </Button>
          ))}
        </div>
        {/* Winter Mode Toggle - only shown when feature is enabled via env */}
        {isSnowFeatureEnabled && (
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-border">
            <span className="text-xs font-medium">Winter Mode</span>
            <button
              onClick={toggleSnow}
              style={{ width: '28px', height: '16px', minWidth: '28px', minHeight: '16px', padding: 0 }}
              className={`relative inline-flex items-center rounded-full transition-colors p-0 ${isSnowEnabled ? 'bg-value' : 'bg-muted'
                }`}
              aria-pressed={isSnowEnabled}
              role="switch"
              aria-label="Toggle winter snow effect"
            >
              <span
                style={{ width: '12px', height: '12px', minWidth: '12px', minHeight: '12px' }}
                className={`inline-block transform rounded-full bg-white shadow-sm transition-transform ${isSnowEnabled ? 'translate-x-[14px]' : 'translate-x-[2px]'
                  }`}
              />
            </button>
          </div>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
} 