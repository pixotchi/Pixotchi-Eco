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
  { name: "light", label: "Light", color: "#a7c7e7" },
  { name: "dark", label: "Dark", color: "#2d3c53" },
  { name: "green", label: "Green", color: "#78ad88" },
  { name: "yellow", label: "Yellow", color: "#c7ad66" },
  { name: "red", label: "Red", color: "#c59ba4" },
  { name: "pink", label: "Pink", color: "#ca9db8" },
  { name: "blue", label: "Blue", color: "#8aa0c1" },
  { name: "violet", label: "Violet", color: "#b9a4cf" }
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
      className={`flex min-h-11 w-full items-center justify-between gap-4 rounded-md px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ${
        checked
          ? "bg-background/55 shadow-[var(--shadow-hairline)]"
          : "hover:bg-accent/55"
      }`}
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
    >
      <span className="text-xs font-medium">{label}</span>
      <span
        className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-[background-color,box-shadow] ${
          checked
            ? "bg-[image:var(--gradient-control-active)] shadow-[var(--shadow-hairline)]"
            : "border border-border/60 bg-background/60"
        }`}
        aria-hidden="true"
      >
        <span
          className={`inline-block h-5 w-5 rounded-full bg-background shadow-sm transition-transform ${
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
    return <Button variant="outline" size="icon" disabled aria-label="Loading theme selector" />;
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
          <div className="base-logo-corner h-4 w-4" style={{ backgroundColor: currentTheme.color }} />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="p-2" aria-label="Theme selection menu">
        <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Available themes">
          {themes.map((themeOption) => (
            <Button
              key={themeOption.name}
              variant="outline"
              size="iconCompact"
              title={themeOption.label}
              onClick={() => handleThemeChange(themeOption.name)}
              className={`p-0 ${theme === themeOption.name ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""
                }`}
              role="radio"
              aria-checked={theme === themeOption.name}
              aria-label={`Select ${themeOption.label} theme`}
            >
              <div className="base-logo-corner h-5 w-5 shrink-0" style={{ backgroundColor: themeOption.color }} />
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
