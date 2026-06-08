"use client";

import { useEffect } from "react";

const ZERO_VALUE = "0px";
type ShellMode = "mobile" | "mid" | "desktop";

function setRootPx(name: string, value: number) {
  document.documentElement.style.setProperty(name, `${Math.max(0, Math.round(value))}px`);
}

function setRootValue(name: string, value: string) {
  document.documentElement.style.setProperty(name, value);
}

function getShellHeight(name: string) {
  const element = document.querySelector<HTMLElement>(`[data-viewport-shell="${name}"]`);
  if (!element) return 0;
  return element.getBoundingClientRect().height;
}

export function useViewportShellMetrics() {
  useEffect(() => {
    if (typeof window === "undefined") return;

    let frameId: number | null = null;

    const sync = () => {
      frameId = null;
      const headerHeight = getShellHeight("header");
      const statusHeight = getShellHeight("status");
      const navHeight = getShellHeight("nav");
      const isDesktopShell = window.innerWidth >= 1280;

      setRootPx("--app-header-height", headerHeight);
      setRootPx("--app-status-height", statusHeight);
      setRootPx("--app-bottom-nav-height", navHeight);
      setRootPx("--app-content-bottom-offset", 0);
      const isMidShell = window.innerWidth >= 768 && !isDesktopShell;
      const shellMode: ShellMode = isDesktopShell ? "desktop" : isMidShell ? "mid" : "mobile";
      const isCompactShell = window.innerHeight <= 700 && !isDesktopShell;

      document.documentElement.dataset.appShellMode = shellMode;

      setRootValue(
        "--app-content-gutter",
        isDesktopShell ? "1.25rem" : isCompactShell ? "0.625rem" : isMidShell ? "1rem" : "1rem"
      );
    };

    const scheduleSync = () => {
      if (frameId !== null) return;
      frameId = window.requestAnimationFrame(sync);
    };

    const observer = new ResizeObserver(scheduleSync);
    const observed = Array.from(
      document.querySelectorAll<HTMLElement>("[data-viewport-shell]")
    );

    observed.forEach((element) => observer.observe(element));
    sync();

    window.addEventListener("resize", scheduleSync);
    window.visualViewport?.addEventListener("resize", scheduleSync);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", scheduleSync);
      window.visualViewport?.removeEventListener("resize", scheduleSync);

      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }

      document.documentElement.style.setProperty("--app-header-height", ZERO_VALUE);
      document.documentElement.style.setProperty("--app-status-height", ZERO_VALUE);
      document.documentElement.style.setProperty("--app-bottom-nav-height", ZERO_VALUE);
      document.documentElement.style.setProperty("--app-content-bottom-offset", ZERO_VALUE);
      document.documentElement.style.removeProperty("--app-content-gutter");
      delete document.documentElement.dataset.appShellMode;
    };
  }, []);
}
