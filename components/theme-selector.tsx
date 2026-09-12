"use client";

import * as React from "react";
import { useTheme } from "next-themes";
import { Check, Settings } from "lucide-react";

import { Button } from "@/components/ui/button";
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
import { THEMES, THEME_NAMES, Theme } from "@/lib/theme-utils";
import { useSnow } from "@/lib/snow-context";
import { useAmbientAudio } from "@/lib/ambient-audio-context";
import { usePerformanceMode } from "@/components/ui/performance-mode";
import toast from "react-hot-toast";

const SECRET_EVENT_NAME = "pixotchi:secret-garden-unlock";
const PERFORMANCE_MODE_BLOCKED_MESSAGE = "Performance Mode is on. Disable Performance Mode first to use this effect.";

const themePresentation: Record<Theme, { label: string; color: string; ink: string }> = {
  light: { label: "Light", color: "#CBD5E1", ink: "#0F172A" },
  dark: { label: "Dark", color: "#2D3C53", ink: "#FFFFFF" },
  green: { label: "Green", color: "#22C55E", ink: "#0F172A" },
  yellow: { label: "Yellow", color: "#EAB308", ink: "#0F172A" },
  red: { label: "Red", color: "#EF4444", ink: "#FFFFFF" },
  pink: { label: "Pink", color: "#EC4899", ink: "#FFFFFF" },
  blue: { label: "Blue", color: "#3B82F6", ink: "#FFFFFF" },
  violet: { label: "Violet", color: "#D946EF", ink: "#FFFFFF" },
};
const themes = THEME_NAMES.map(name => ({ name, ...themePresentation[name] }));

// The whole touch target is the swatch. Selection uses a check; keyboard focus
// uses a separate outline so both states remain clear on every palette.
const themeMenuButtonClass = "h-[44px] min-h-[44px] w-[44px] min-w-[44px] cursor-pointer justify-center rounded-full border border-black/10 p-0 shadow-none transition-[filter,box-shadow] duration-[var(--motion-quick)] hover:brightness-105 active:brightness-95 focus:shadow-none focus-visible:outline-2 focus-visible:outline-solid focus-visible:outline-offset-[3px] focus-visible:outline-ring";
const themeTriggerSwatchClass = "absolute bottom-[6px] right-[6px] h-[10px] w-[10px] rounded-full border-2 border-background shadow-[0_0_0_1px_hsl(var(--border-strong)/0.55)]";

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
 * onSelect is prevented on theme/effect items so the menu stays open, which the multi-pick
 * theme sequence depends on. onCheckedChange still fires.
 */
export function MenuSwitchItem({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string;
  description?: string;
  checked: boolean;
  onCheckedChange: () => void;
}) {
  return (
    <DropdownMenuCheckboxItem
      title={description}
      aria-description={description}
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
  children?: React.ReactNode;
  triggerRef?: React.Ref<HTMLButtonElement>;
  onCloseAutoFocus?: (event: Event) => void;
}

export function ThemeSelector({
  enableSecretGardenProgress = true,
  showMusicToggle = true,
  children,
  triggerRef,
  onCloseAutoFocus,
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
      <Button variant="headerIcon" size="headerIcon" disabled aria-label="Loading settings">
        <Settings className="h-5 w-5" aria-hidden="true" />
      </Button>
    );
  }

  const currentTheme = themes.find((t) => t.name === theme) ?? themes[0];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          ref={triggerRef}
          variant="headerIcon"
          size="headerIcon"
          title={`Settings · ${currentTheme.label} theme`}
          aria-label="Settings"
          className="relative"
        >
          <Settings className="h-5 w-5 text-foreground/85" aria-hidden="true" />
          <span className={themeTriggerSwatchClass} style={{ backgroundColor: currentTheme.color }} aria-hidden="true" />
        </Button>
      </DropdownMenuTrigger>
      {/* No aria-label here: Radix already points aria-labelledby at the trigger. */}
      <DropdownMenuContent
        align="end"
        // Four 44px swatches, three gaps, padding, and the border set the width.
        className={cn("w-[calc(176px+2.5rem+2px)] p-2", children && "[--menu-max-height:48rem]")}
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DropdownMenuRadioGroup
          className="grid grid-cols-[repeat(4,44px)] justify-center gap-2 py-1"
          aria-label="Theme"
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
              style={{ backgroundColor: themeOption.color, color: themeOption.ink }}
              className={cn(
                themeMenuButtonClass,
                // Radix's check indicator is absolutely positioned in the left gutter
                // this control does not have; the swatch itself carries the state.
                "[&>span:first-child]:hidden",
              )}
            >
              {theme === themeOption.name && <Check className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />}
              <span className="sr-only">{themeOption.label}</span>
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {/* Winter Mode Toggle - only shown when feature is enabled via env */}
        {isSnowFeatureEnabled && (
          <>
            {/* The shared separator's my-1 is tuned for text rows, which carry
                their own padding. Match the swatch grid's spacing here. */}
            <DropdownMenuSeparator className="my-2" />
            <MenuSwitchItem
              label="Winter Mode"
              checked={isSnowEnabled}
              onCheckedChange={handleSnowToggle}
            />
          </>
        )}
        {showMusicToggle && (
          <>
            {!isSnowFeatureEnabled && <DropdownMenuSeparator className="my-2" />}
            <MenuSwitchItem
              label="Music"
              checked={isMusicEnabled}
              onCheckedChange={handleMusicToggle}
            />
          </>
        )}
        {children}
      </DropdownMenuContent>
    </DropdownMenu>
  );
} 
