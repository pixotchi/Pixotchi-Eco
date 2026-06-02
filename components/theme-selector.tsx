"use client";

import * as React from "react";
import { useTheme } from "next-themes";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { THEMES, Theme } from "@/lib/theme-utils";
import { useSnow } from "@/lib/snow-context";
import { useAmbientAudio } from "@/lib/ambient-audio-context";

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

function MenuSwitchRow({
  label,
  checked,
  onClick,
  ariaLabel,
}: {
  label: string;
  checked: boolean;
  onClick: () => void;
  ariaLabel: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex min-h-8 w-full items-center justify-between gap-4 rounded-md px-1.5 py-1.5 text-left transition-colors hover:bg-accent/55 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
    >
      <span className="text-xs font-medium">{label}</span>
      <span
        className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors ${
          checked ? "bg-[hsl(var(--success))]" : "bg-muted-foreground/24"
        }`}
        aria-hidden="true"
      >
        <span
          className={`inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          }`}
        />
      </span>
    </button>
  );
}

export function ThemeSelector() {
  const { theme, setTheme } = useTheme();
  const { isEnabled: isSnowEnabled, isFeatureEnabled: isSnowFeatureEnabled, toggleSnow } = useSnow();
  const { isEnabled: isMusicEnabled, toggleAudio } = useAmbientAudio();
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
      void handleSecretProgress(newTheme);
    }
  }, [handleSecretProgress, setTheme]);

  if (!mounted) {
    // Render a placeholder to prevent layout shift
    return <Button variant="outline" size="icon" disabled className="h-9 w-9" aria-label="Loading theme selector" />;
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
          <div className="mt-2 border-t border-border pt-2">
            <MenuSwitchRow
              label="Winter Mode"
              checked={isSnowEnabled}
              onClick={toggleSnow}
              ariaLabel="Toggle winter snow effect"
            />
          </div>
        )}
        {/* Ambient Music Toggle */}
        <div className={`${isSnowFeatureEnabled ? 'mt-1' : 'mt-2 border-t border-border pt-2'}`}>
          <MenuSwitchRow
            label="Music"
            checked={isMusicEnabled}
            onClick={toggleAudio}
            ariaLabel="Toggle ambient music"
          />
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
} 
