"use client";

import { useEffect, useRef } from "react";
import { useTheme } from "next-themes";

import {
  syncThemeCookie,
  THEMES,
  type Theme,
  updateMetaThemeColor,
} from "@/lib/theme-utils";

const META_THEME_UPDATE_DELAY_MS = 450;

export function ThemeInitializer() {
  const { resolvedTheme } = useTheme();
  const metaUpdateTimeoutRef = useRef<number | null>(null);

  useEffect(() => {
    if (!resolvedTheme || !(resolvedTheme in THEMES)) {
      return;
    }

    const nextTheme = resolvedTheme as Theme;

    syncThemeCookie(nextTheme);

    if (metaUpdateTimeoutRef.current !== null) {
      window.clearTimeout(metaUpdateTimeoutRef.current);
    }

    metaUpdateTimeoutRef.current = window.setTimeout(() => {
      updateMetaThemeColor(nextTheme);
      metaUpdateTimeoutRef.current = null;
    }, META_THEME_UPDATE_DELAY_MS);

    return () => {
      if (metaUpdateTimeoutRef.current !== null) {
        window.clearTimeout(metaUpdateTimeoutRef.current);
        metaUpdateTimeoutRef.current = null;
      }
    };
  }, [resolvedTheme]);

  return null;
}
