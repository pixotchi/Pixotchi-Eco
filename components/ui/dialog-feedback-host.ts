"use client";

import * as React from "react";

type DialogFeedbackHost = {
  order: number;
};

const hosts = new Map<HTMLElement, DialogFeedbackHost>();
const listeners = new Set<() => void>();
let nextOrder = 0;

function emitChange() {
  listeners.forEach((listener) => listener());
}

function getActiveDialogFeedbackHost(): HTMLElement | null {
  let activeNode: HTMLElement | null = null;
  let activeOrder = -1;

  hosts.forEach(({ order }, node) => {
    if (order > activeOrder) {
      activeNode = node;
      activeOrder = order;
    }
  });

  return activeNode;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Registers a portal target inside Radix's active interaction and focus scope.
 * Consumers stay independent of individual dialogs while their feedback remains
 * operable when Radix makes the rest of the document inert.
 */
export function useDialogFeedbackHostRef(enabled: boolean) {
  const cleanupRef = React.useRef<(() => void) | null>(null);

  return React.useCallback(
    (node: HTMLDivElement | null) => {
      cleanupRef.current?.();
      cleanupRef.current = null;

      if (node && enabled) {
        hosts.set(node, { order: ++nextOrder });
        emitChange();
        cleanupRef.current = () => {
          if (hosts.delete(node)) emitChange();
        };
      }
    },
    [enabled]
  );
}

export function useActiveDialogFeedbackHost() {
  return React.useSyncExternalStore(
    subscribe,
    getActiveDialogFeedbackHost,
    () => null
  );
}
