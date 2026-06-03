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

    const sync = () => {
      const headerHeight = getShellHeight("header");
      const statusHeight = getShellHeight("status");
      const navHeight = getShellHeight("nav");

      setRootPx("--app-header-height", headerHeight);
      setRootPx("--app-status-height", statusHeight);
      setRootPx("--app-bottom-nav-height", navHeight);
      setRootPx("--app-content-bottom-offset", navHeight + 12);
      const isDesktopShell = window.innerWidth >= 1280;
      const isMidShell = window.innerWidth >= 768 && !isDesktopShell;
      const shellMode: ShellMode = isDesktopShell ? "desktop" : isMidShell ? "mid" : "mobile";
      const isCompactShell = window.innerHeight <= 700 && !isDesktopShell;

      document.documentElement.dataset.appShellMode = shellMode;

      setRootValue(
        "--app-content-gutter",
        isDesktopShell ? "1.25rem" : isCompactShell ? "0.625rem" : isMidShell ? "1rem" : "1rem"
      );
    };

    const observer = new ResizeObserver(sync);
    const observed = Array.from(
      document.querySelectorAll<HTMLElement>("[data-viewport-shell]")
    );

    observed.forEach((element) => observer.observe(element));
    sync();

    window.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);

      document.documentElement.style.setProperty("--app-header-height", ZERO_VALUE);
      document.documentElement.style.setProperty("--app-status-height", ZERO_VALUE);
      document.documentElement.style.setProperty("--app-bottom-nav-height", ZERO_VALUE);
      document.documentElement.style.setProperty("--app-content-bottom-offset", ZERO_VALUE);
      document.documentElement.style.removeProperty("--app-content-gutter");
      delete document.documentElement.dataset.appShellMode;
    };
  }, []);
}
