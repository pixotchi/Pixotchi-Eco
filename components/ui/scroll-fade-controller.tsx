"use client";

import { useEffect } from "react";

const SCROLL_FADE_SELECTOR = ".surface-scroll-fade, .surface-scroll-area";
const EDGE_THRESHOLD = 2;

function setFadeAttribute(element: HTMLElement, name: "top" | "bottom", enabled: boolean) {
  const attr = `data-scroll-fade-${name}`;
  if (enabled) {
    element.setAttribute(attr, "true");
    return;
  }
  element.removeAttribute(attr);
}

function updateScrollFade(element: HTMLElement) {
  const maxScroll = element.scrollHeight - element.clientHeight;
  const canScroll = maxScroll > EDGE_THRESHOLD;

  setFadeAttribute(element, "top", canScroll && element.scrollTop > EDGE_THRESHOLD);
  setFadeAttribute(element, "bottom", canScroll && element.scrollTop < maxScroll - EDGE_THRESHOLD);
}

export function ScrollFadeController() {
  useEffect(() => {
    if (typeof document === "undefined") return;

    const elements = new Set<HTMLElement>();
    const cleanupCallbacks = new Map<HTMLElement, () => void>();
    let updateFrameId = 0;
    let syncFrameId = 0;

    const scheduleUpdate = () => {
      if (updateFrameId) return;
      updateFrameId = requestAnimationFrame(() => {
        updateFrameId = 0;
        elements.forEach(updateScrollFade);
      });
    };

    const resizeObserver = new ResizeObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.target instanceof HTMLElement) {
          scheduleUpdate();
        }
      });
    });

    const register = (element: HTMLElement) => {
      if (elements.has(element)) return;

      elements.add(element);
      const handleScroll = () => updateScrollFade(element);

      element.addEventListener("scroll", handleScroll, { passive: true });
      resizeObserver.observe(element);
      cleanupCallbacks.set(element, () => {
        element.removeEventListener("scroll", handleScroll);
        resizeObserver.unobserve(element);
        setFadeAttribute(element, "top", false);
        setFadeAttribute(element, "bottom", false);
      });
      updateScrollFade(element);
    };

    const syncElements = () => {
      const current = new Set(
        Array.from(document.querySelectorAll<HTMLElement>(SCROLL_FADE_SELECTOR))
      );

      current.forEach(register);
      elements.forEach((element) => {
        if (current.has(element) && document.contains(element)) return;
        cleanupCallbacks.get(element)?.();
        cleanupCallbacks.delete(element);
        elements.delete(element);
      });
    };

    const scheduleSync = () => {
      if (syncFrameId) return;
      syncFrameId = requestAnimationFrame(() => {
        syncFrameId = 0;
        syncElements();
        scheduleUpdate();
      });
    };

    const mutationObserver = new MutationObserver(() => {
      scheduleSync();
    });

    syncElements();
    mutationObserver.observe(document.body, { childList: true, subtree: true });
    window.addEventListener("resize", scheduleSync);

    return () => {
      if (updateFrameId) {
        cancelAnimationFrame(updateFrameId);
      }
      if (syncFrameId) {
        cancelAnimationFrame(syncFrameId);
      }
      window.removeEventListener("resize", scheduleSync);
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      cleanupCallbacks.forEach((cleanup) => cleanup());
      cleanupCallbacks.clear();
      elements.clear();
    };
  }, []);

  return null;
}
