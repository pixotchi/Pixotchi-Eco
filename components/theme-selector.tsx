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

const rawSequence = process.env.NEXT_PUBLIC_THEME_KONAMI_SEQUENCE;

if (!rawSequence) {
  throw new Error("NEXT_PUBLIC_THEME_KONAMI_SEQUENCE env var is required");
}

const SECRET_SEQUENCE: Theme[] = rawSequence
  .split(",")
  .map((token) => token.trim().toLowerCase())
  .filter((token): token is Theme => Boolean(THEMES[token as Theme]));

if (SECRET_SEQUENCE.length !== 5) {
  throw new Error("NEXT_PUBLIC_THEME_KONAMI_SEQUENCE must contain exactly 5 valid theme names");
}
const SECRET_TIMEOUT_MS = 15000;

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
  const [mounted, setMounted] = React.useState(false);
  const sequenceIndexRef = React.useRef(0);
  const timeoutRef = React.useRef<number | null>(null);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  React.useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        window.clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
    };
  }, []);

  const resetSecretSequence = React.useCallback(() => {
    sequenceIndexRef.current = 0;
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  }, []);

  const maybeStartTimeout = React.useCallback(() => {
    if (timeoutRef.current) {
      window.clearTimeout(timeoutRef.current);
    }
    timeoutRef.current = window.setTimeout(() => {
      resetSecretSequence();
    }, SECRET_TIMEOUT_MS);
  }, [resetSecretSequence]);

  const handleSecretProgress = React.useCallback((selectedTheme: string) => {
    const normalized = selectedTheme as Theme;

    if (!SECRET_SEQUENCE.includes(normalized)) {
      resetSecretSequence();
      return;
    }

    const currentIndex = sequenceIndexRef.current;
    const expectedTheme = SECRET_SEQUENCE[currentIndex];

    if (normalized === expectedTheme) {
      maybeStartTimeout();
      sequenceIndexRef.current += 1;

      if (sequenceIndexRef.current >= SECRET_SEQUENCE.length) {
        if (typeof window !== "undefined") {
          window.dispatchEvent(new CustomEvent("pixotchi:secret-garden-unlock"));
        }
        resetSecretSequence();
      }
      return;
    }

    // Allow restarting the combo if they hit the first theme again mid-sequence
    if (normalized === SECRET_SEQUENCE[0]) {
      sequenceIndexRef.current = 1;
      maybeStartTimeout();
    } else {
      resetSecretSequence();
    }
  }, [maybeStartTimeout, resetSecretSequence]);

  const handleThemeChange = React.useCallback((newTheme: string) => {
    if (THEMES[newTheme as Theme]) {
      setTheme(newTheme);
      // Also use our custom theme persistence for better SSR support
      setClientTheme(newTheme as Theme);
      handleSecretProgress(newTheme);
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
              className={`h-8 w-8 ${
                theme === themeOption.name ? "ring-2 ring-ring ring-offset-2 ring-offset-background" : ""
              }`}
              role="radio"
              aria-checked={theme === themeOption.name}
              aria-label={`Select ${themeOption.label} theme`}
            >
              <div className={`h-4 w-4 rounded-sm ${themeOption.color}`} />
            </Button>
          ))}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
} 