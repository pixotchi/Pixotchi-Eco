"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Palette } from "lucide-react";

import { Button, buttonVariants } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { THEMES, Theme } from "@/lib/theme-utils";
import { useSnow } from "@/lib/snow-context";
import { useAmbientAudio } from "@/lib/ambient-audio-context";
import { usePerformanceMode } from "@/components/ui/performance-mode";
import toast from "react-hot-toast";

const SECRET_EVENT_NAME = "pixotchi:secret-garden-unlock";
const PERFORMANCE_MODE_BLOCKED_MESSAGE = "Performance Mode is on. Disable Performance Mode first to use this effect.";

const themes: Array<{ name: Theme; label: string; color: string }> = [
  { name: "light", label: "Light", color: "bg-slate-300" },
  { name: "dark", label: "Dark", color: "bg-[#2D3C53]" },
  { name: "green", label: "Green", color: "bg-green-500" },
  { name: "yellow", label: "Yellow", color: "bg-yellow-500" },
  { name: "red", label: "Red", color: "bg-red-500" },
  { name: "pink", label: "Pink", color: "bg-pink-500" },
  { name: "blue", label: "Blue", color: "bg-blue-500" },
  { name: "violet", label: "Violet", color: "bg-fuchsia-500" }
];

const themeMenuButtonClass = "h-8 min-h-8 w-8 min-w-8 !rounded-[6px] border border-input bg-background bg-none p-0 shadow-none backdrop-blur-none hover:border-input hover:bg-accent hover:bg-none hover:text-accent-foreground active:translate-y-0 active:scale-100";
/* The hairline border keeps the swatch legible when its colour matches the
   surface behind it (the Light swatch on the light header button, and the Dark
   swatch in dark theme, both used to read as a blank/broken button). */
const themeSwatchClass = "h-4 w-4 rounded-[2px] border border-[hsl(var(--border-strong)/0.45)]";
const themeTriggerSwatchClass = "absolute bottom-1.5 right-1.5 h-2.5 w-2.5 rounded-full border-2 border-background shadow-[0_0_0_1px_hsl(var(--border-strong)/0.55)]";

/*
 * A Radix menu item, not a hand-rolled button.
 *
 * The eight swatches and these two toggles used to be a bare <div role="radiogroup">
 * of <button role="radio"> plus two <button role="switch"> inside DropdownMenuContent
 * (role="menu"). Radix's roving focus only manages menu ITEMS, so there were none to
 * manage: focus stopped on the content container, and neither arrow keys nor Tab could
 * reach any control. The whole menu was keyboard-dead (WCAG 2.1.1, Level A) — and
 * "menu" may not own "radiogroup"/"switch" in the first place.
 *
 * onSelect is prevented on every item so the menu stays open, which the multi-pick
 * theme sequence depends on. onCheckedChange still fires.
 */
function MenuSwitchItem({
  label,
  checked,
  onCheckedChange,
}: {
  label: string;
  checked: boolean;
  onCheckedChange: () => void;
}) {
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(event) => event.preventDefault()}
      className={cn(
        "min-h-11 w-full justify-between gap-4 py-2 pl-2 pr-2 text-left",
        // Radix renders its own check indicator as the first child; this control
        // shows state with the pill instead.
        "[&>span:first-child]:hidden",
        checked && "bg-background/55 shadow-[var(--shadow-hairline)]",
      )}
    >
      <span className="text-xs font-medium">{label}</span>
      <span
        className={`relative inline-flex h-6 w-10 shrink-0 items-center rounded-full transition-[background-color,border-color,box-shadow] duration-[var(--motion-standard)] ease-[var(--ease-standard)] ${
          checked
            ? "border border-primary/35 bg-primary bg-[image:var(--gradient-control-active)] shadow-[var(--shadow-hairline)]"
            : "border border-[hsl(var(--edge-panel))] bg-muted/75 bg-[image:var(--gradient-panel)] shadow-[inset_0_1px_2px_hsl(var(--foreground)/0.10)]"
        }`}
        aria-hidden="true"
      >
        <span
          className={`inline-block h-5 w-5 transform-gpu rounded-full border transition-[translate,background-color,border-color,box-shadow] duration-[var(--motion-standard)] ease-[var(--ease-standard)] motion-reduce:transition-none ${
            checked ? "translate-x-[18px]" : "translate-x-0.5"
          } ${
            checked
              ? "border-white/55 bg-primary-foreground shadow-[var(--shadow-hairline)]"
              : "border-[hsl(var(--edge-strong))] bg-card shadow-[0_1px_2px_hsl(var(--foreground)/0.20)]"
          }`}
        />
      </span>
    </DropdownMenuCheckboxItem>
  );
}

interface ThemeSelectorProps {
  enableSecretGardenProgress?: boolean;
  showMusicToggle?: boolean;
}

export function ThemeSelector({
  enableSecretGardenProgress = true,
  showMusicToggle = true,
}: ThemeSelectorProps) {
  const { theme, setTheme } = useTheme();
  const { isEnabled: isSnowEnabled, isFeatureEnabled: isSnowFeatureEnabled, toggleSnow } = useSnow();
  const { isEnabled: isMusicEnabled, toggleAudio } = useAmbientAudio();
  const { enabled: performanceModeEnabled } = usePerformanceMode();
  const [mounted, setMounted] = React.useState(false);

  React.useEffect(() => {
    setMounted(true);
  }, []);

  const handleSecretProgress = React.useCallback(async (selectedTheme: string) => {
    if (!enableSecretGardenProgress) {
      return;
    }

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
  }, [enableSecretGardenProgress]);

  const handleThemeChange = React.useCallback((newTheme: string) => {
    if (THEMES[newTheme as Theme]) {
      setTheme(newTheme);
      void handleSecretProgress(newTheme);
    }
  }, [handleSecretProgress, setTheme]);

  const handleSnowToggle = React.useCallback(() => {
    if (performanceModeEnabled) {
      toast.error(PERFORMANCE_MODE_BLOCKED_MESSAGE);
      return;
    }

    toggleSnow();
  }, [performanceModeEnabled, toggleSnow]);

  const handleMusicToggle = React.useCallback(() => {
    if (performanceModeEnabled) {
      toast.error(PERFORMANCE_MODE_BLOCKED_MESSAGE);
      return;
    }

    toggleAudio();
  }, [performanceModeEnabled, toggleAudio]);

  if (!mounted) {
    // Render a placeholder to prevent layout shift
    return (
      <Button variant="headerIcon" size="icon" disabled aria-label="Loading theme selector">
        <Palette className="h-5 w-5" aria-hidden="true" />
      </Button>
    );
  }

  const currentTheme = themes.find((t) => t.name === theme) ?? themes[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="headerIcon"
          size="icon"
          title={`Change theme: ${currentTheme.label}`}
          aria-label={`Current theme: ${currentTheme.label}. Click to change theme`}
          className="relative"
        >
          <Palette className="h-5 w-5 text-foreground/85" aria-hidden="true" />
          <span className={`${themeTriggerSwatchClass} ${currentTheme.color}`} aria-hidden="true" />
          <span className="sr-only">Toggle theme</span>
        </Button>
      </DropdownMenuTrigger>
      {/* No aria-label here: Radix already points aria-labelledby at the trigger. */}
      <DropdownMenuContent align="end" className="p-2">
        <DropdownMenuRadioGroup
          className="grid grid-cols-4 gap-2"
          value={theme ?? ""}
          onValueChange={handleThemeChange}
        >
          {themes.map((themeOption) => (
            <DropdownMenuRadioItem
              key={themeOption.name}
              value={themeOption.name}
              title={themeOption.label}
              /* Keep the menu open: choosing several themes in sequence is a real
                 flow here, and a menu that closes on every pick makes it unusable. */
              onSelect={(event) => event.preventDefault()}
              className={cn(
                buttonVariants({ variant: "outline", size: "icon" }),
                themeMenuButtonClass,
                // Radix's check indicator is absolutely positioned in the left gutter
                // this control does not have; the swatch itself carries the state.
                "[&>span:first-child]:hidden",
                // Deliberately not a ring: buttonVariants already spends the ring on
                // focus-visible, so selection and focus must stay distinguishable.
                "data-[state=checked]:border-primary data-[state=checked]:shadow-[0_0_0_2px_hsl(var(--primary)/0.35)]",
              )}
            >
              <div className={`${themeSwatchClass} ${themeOption.color}`} />
              <span className="sr-only">{themeOption.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {/* Winter Mode Toggle - only shown when feature is enabled via env */}
        {isSnowFeatureEnabled && (
          <>
            <DropdownMenuSeparator />
            <MenuSwitchItem
              label="Winter Mode"
              checked={isSnowEnabled}
              onCheckedChange={handleSnowToggle}
            />
          </>
        )}
        {showMusicToggle && (
          <>
            {!isSnowFeatureEnabled && <DropdownMenuSeparator />}
            <MenuSwitchItem
              label="Music"
              checked={isMusicEnabled}
              onCheckedChange={handleMusicToggle}
            />
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
} 
