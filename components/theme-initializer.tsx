"use client";

import { useLayoutEffect } from "react";
import { updateMetaThemeColor } from "@/lib/theme-utils";

export function ThemeInitializer() {
  useLayoutEffect(() => {
    // Observe the applied class, not a delayed copy of next-themes state. This
    // also follows login theme cycling and nested providers without timer races.
    updateMetaThemeColor();
    const observer = new MutationObserver(updateMetaThemeColor);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class', 'style'] });
    return () => observer.disconnect();
  }, []);
  return null;
}
