"use client";

import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { animate, type AnimationPlaybackControls } from "motion";
import { UI_SPRING, useQuietMotion } from "@/lib/motion";

/** Axis-locked navigation that leaves controls, horizontal scrollers and OS edge gestures alone. */
export function useTabSwipe<T extends string>({
  container,
  tabs,
  selected,
  onSelect,
  animateSelection,
}: {
  container: RefObject<HTMLDivElement | null>;
  tabs: readonly T[];
  selected: T;
  onSelect: (tab: T) => void;
  animateSelection: boolean;
}) {
  const quiet = useQuietMotion();
  const animation = useRef<AnimationPlaybackControls | null>(null);
  const direction = useRef(0);
  const previous = useRef(selected);
  const latest = useRef({ tabs, selected, onSelect, quiet });
  latest.current = { tabs, selected, onSelect, quiet };
  useLayoutEffect(() => {
    const panel = container.current?.querySelector<HTMLElement>(
      `#tabpanel-${selected}`,
    );
    if (!panel || previous.current === selected) return;
    previous.current = selected;
    animation.current?.stop();
    const distance = direction.current
      ? direction.current * Math.min(container.current?.clientWidth ?? 320, 480)
      : 12;
    direction.current = 0;
    panel.style.transform = "none";
    if (quiet || !animateSelection) return;
    animation.current = animate(
      panel,
      {
        transform: [`translate3d(${distance}px, 0, 0)`, "translate3d(0, 0, 0)"],
      },
      UI_SPRING,
    );
    return () => {
      animation.current?.stop();
      panel.style.transform = "none";
    };
  }, [selected, container, quiet, animateSelection]);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    let gesture: {
      id: number;
      x: number;
      y: number;
      lastX: number;
      at: number;
      velocity: number;
      locked: boolean;
      panel: HTMLElement;
    } | null = null;
    const settle = () => {
      if (!gesture) return;
      const { panel, id } = gesture;
      gesture = null;
      if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
      animation.current?.stop();
      if (latest.current.quiet) panel.style.transform = "none";
      else
        animation.current = animate(
          panel,
          { transform: "translate3d(0, 0, 0)" },
          UI_SPRING,
        );
    };
    const down = (event: PointerEvent) => {
      if (
        event.pointerType !== "touch" ||
        !event.isPrimary ||
        window.innerWidth >= 1280 ||
        event.clientX < 24 ||
        event.clientX > window.innerWidth - 24
      )
        return;
      const target = event.target as HTMLElement;
      if (
        target.closest(
          'button,a,input,select,textarea,[role="slider"],[role="tablist"],[data-no-swipe],canvas,[contenteditable="true"]',
        )
      )
        return;
      for (
        let node: HTMLElement | null = target;
        node && node !== element;
        node = node.parentElement
      ) {
        if (
          node.scrollWidth > node.clientWidth + 2 &&
          /auto|scroll/.test(getComputedStyle(node).overflowX)
        )
          return;
      }
      const panel = target.closest<HTMLElement>('[role="tabpanel"]');
      if (!panel || !latest.current.tabs.includes(latest.current.selected))
        return;
      gesture = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        lastX: event.clientX,
        at: event.timeStamp,
        velocity: 0,
        locked: false,
        panel,
      };
    };
    const move = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const dx = event.clientX - gesture.x;
      const dy = event.clientY - gesture.y;
      if (!gesture.locked) {
        if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) {
          gesture = null;
          return;
        }
        if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
        gesture.locked = true;
        animation.current?.stop();
        element.setPointerCapture(event.pointerId);
      }
      event.preventDefault();
      const elapsed = event.timeStamp - gesture.at;
      if (elapsed > 0)
        gesture.velocity = (event.clientX - gesture.lastX) / elapsed;
      gesture.lastX = event.clientX;
      gesture.at = event.timeStamp;
      const index = latest.current.tabs.indexOf(latest.current.selected);
      const boundary =
        (index === 0 && dx > 0) ||
        (index === latest.current.tabs.length - 1 && dx < 0);
      const offset = boundary
        ? Math.sign(dx) * 48 * (1 - Math.exp(-Math.abs(dx) / 160))
        : dx;
      gesture.panel.style.transform = `translate3d(${offset}px, 0, 0)`;
    };
    const up = (event: PointerEvent) => {
      if (!gesture || event.pointerId !== gesture.id) return;
      const dx = event.clientX - gesture.x;
      const velocity =
        event.timeStamp - gesture.at < 100 ? gesture.velocity : 0;
      const index = latest.current.tabs.indexOf(latest.current.selected);
      const step = dx < 0 ? 1 : -1;
      const next = latest.current.tabs[index + step];
      const commits =
        gesture.locked &&
        next &&
        (Math.abs(dx) > Math.min(110, element.clientWidth * 0.25) ||
          (Math.abs(dx) > 30 &&
            Math.abs(velocity) > 0.5 &&
            Math.sign(velocity) === Math.sign(dx)));
      if (commits) {
        const panel = gesture.panel;
        const id = gesture.id;
        gesture = null;
        if (element.hasPointerCapture(id)) element.releasePointerCapture(id);
        panel.style.transform = "none";
        direction.current = step;
        latest.current.onSelect(next);
      } else settle();
    };
    // Touch starts with implicit capture on the original child. Transferring it
    // to the scroller emits a bubbling lost event from that child; only losing
    // the scroller's own capture should cancel navigation.
    const lostCapture = (event: PointerEvent) => {
      if (event.target === element) settle();
    };
    element.addEventListener("pointerdown", down);
    element.addEventListener("pointermove", move, { passive: false });
    element.addEventListener("pointerup", up);
    element.addEventListener("pointercancel", settle);
    element.addEventListener("lostpointercapture", lostCapture);
    return () => {
      if (gesture) gesture.panel.style.transform = "none";
      gesture = null;
      animation.current?.stop();
      element.removeEventListener("pointerdown", down);
      element.removeEventListener("pointermove", move);
      element.removeEventListener("pointerup", up);
      element.removeEventListener("pointercancel", settle);
      element.removeEventListener("lostpointercapture", lostCapture);
    };
  }, [container]);
}
