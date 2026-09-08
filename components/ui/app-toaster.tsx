"use client";

import * as React from "react";
import { createPortal } from "react-dom";
import { resolveValue, ToastBar, useToasterStore, type DefaultToastOptions, type Toast } from "react-hot-toast";
import { Check, X } from "lucide-react";
import { useActiveDialogFeedbackHost } from "./dialog-feedback-host";
import { AppToastLifetime } from "./app-toast-lifetime";

const toastOptions: DefaultToastOptions = {
  className: "surface-lifted",
  duration: 4000,
  loading: { duration: Infinity },
  style: {
    backgroundColor: "hsl(var(--card))",
    backgroundImage: "var(--gradient-surface)",
    border: "1px solid hsl(var(--border) / 0.6)",
    borderRadius: "var(--radius-control)",
    boxShadow: "var(--shadow-hairline)",
    color: "hsl(var(--foreground))",
    zIndex: "var(--z-toast)",
    padding: "0.875rem 1rem",
    fontSize: "0.875rem",
    lineHeight: "1.35",
  },
  success: {
    // Static completed-state icons remain visible when motion is disabled.
    icon: <Check aria-hidden="true" data-toast-icon="success" className="h-5 w-5 shrink-0 rounded-full bg-[hsl(var(--success))] p-0.5 text-[hsl(var(--success-foreground))]" />,
  },
  error: {
    icon: <X aria-hidden="true" data-toast-icon="error" className="h-5 w-5 shrink-0 rounded-full bg-destructive p-0.5 text-destructive-foreground" />,
  },
};

function AppToast({ notification, offset, onHeight }: {
  notification: Toast;
  offset: number;
  onHeight: (id: string, height: number) => void;
}) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [height, setHeight] = React.useState(0);
  React.useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () => {
      const next = element.getBoundingClientRect().height;
      setHeight(next);
      onHeight(notification.id, next);
    };
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    measure();
    return () => { observer.disconnect(); onHeight(notification.id, 0); };
  }, [notification.id, onHeight]);

  const position = notification.position ?? "top-center";
  const top = position.startsWith("top");
  const measured = { ...notification, height };
  return (
    <div
      ref={ref}
      data-app-toast={notification.id}
      aria-hidden={!notification.visible || undefined}
      inert={!notification.visible || undefined}
      className="[&>*]:pointer-events-auto"
      style={{
        position: "absolute", left: 0, right: 0,
        [top ? "top" : "bottom"]: 0,
        display: "flex",
        justifyContent: position.endsWith("center") ? "center" : position.endsWith("right") ? "flex-end" : "flex-start",
        transform: `translateY(${offset * (top ? 1 : -1)}px)`,
        transition: "transform var(--motion-standard) var(--ease-standard)",
        zIndex: notification.visible ? 1 : undefined,
      }}
    >
      {notification.type === "custom"
        ? resolveValue(notification.message, measured)
        : <ToastBar toast={measured} position={position} />}
    </div>
  );
}

export function AppToaster() {
  // Subscribe without useToaster's timers: each notification owns its remaining
  // visible time, including notifications completed halfway through a pause.
  const { toasts } = useToasterStore(toastOptions);
  const activeDialogHost = useActiveDialogFeedbackHost();
  const [mounted, setMounted] = React.useState(false);
  const [pauses, setPauses] = React.useState({ hidden: false, hover: false, focus: false });
  const [heights, setHeights] = React.useState<Record<string, number>>({});
  const setPause = React.useCallback((source: keyof typeof pauses, value: boolean) => {
    setPauses(current => current[source] === value ? current : { ...current, [source]: value });
  }, []);
  const onHeight = React.useCallback((id: string, height: number) => {
    setHeights(current => {
      if ((current[id] ?? 0) === height) return current;
      const next = { ...current };
      if (height) next[id] = height;
      else delete next[id];
      return next;
    });
  }, []);

  React.useLayoutEffect(() => {
    setMounted(true);
    const onVisibility = () => setPause("hidden", document.hidden);
    onVisibility();
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [setPause]);
  React.useEffect(() => {
    // A portal move can remove a hovered/focused node without a leave event.
    setPause("hover", false);
    setPause("focus", false);
  }, [activeDialogHost, setPause]);

  const paused = pauses.hidden || pauses.hover || pauses.focus;
  const offsets = new Map<string, number>();
  return (
    <>
      {/* Lifetime controllers stay mounted when the portal moves into or out of
          a nested dialog. There is only one notification renderer. */}
      {toasts.map(notification => <AppToastLifetime key={notification.id} notification={notification} paused={paused} />)}
      {mounted && createPortal(
        <div
          data-rht-toaster=""
          style={{
            position: "fixed", pointerEvents: "none", left: 16, right: 16, bottom: 16,
            top: "max(1rem, env(safe-area-inset-top), var(--safe-area-inset-top), var(--browser-safe-area-top))",
            zIndex: "var(--z-toast)",
          }}
          onPointerEnter={event => { if (event.pointerType === "mouse") setPause("hover", true); }}
          onPointerLeave={() => setPause("hover", false)}
          onFocusCapture={() => setPause("focus", true)}
          onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPause("focus", false); }}
        >
          {toasts.map(notification => {
            const position = notification.position ?? "top-center";
            const offset = offsets.get(position) ?? 0;
            if (notification.visible && heights[notification.id]) offsets.set(position, offset + heights[notification.id] + 8);
            return <AppToast key={notification.id} notification={notification} offset={offset} onHeight={onHeight} />;
          })}
        </div>,
        activeDialogHost ?? document.body,
      )}
    </>
  );
}
