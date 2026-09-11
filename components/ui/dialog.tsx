"use client";
import { animate } from 'motion';
import { consumeSurfaceOrigin, UI_SPRING, useQuietMotion } from '@/lib/motion';

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";
import { useDialogFeedbackHostRef } from "@/components/ui/dialog-feedback-host";
import { getDialogOpener, registerDialogEscape, routeNestedDialogEscape, trackDialogOpeners } from "@/lib/dialog-focus";
import { ScrollArea } from './scroll-area';

const DialogOpenContext = React.createContext(false);
const DialogOpenChangeContext = React.createContext<(open: boolean) => void>(() => {});
type DialogLayout = "custom" | "form" | "detail" | "game";
const DialogLayoutContext = React.createContext<DialogLayout>("custom");
const DialogScrollsTogetherContext = React.createContext(false);

/** Keep the usual body scrollport until fixed chrome would crowd out its content.
 * The DOM stays mounted when text size or the visible viewport changes. */
function useAdaptiveDialogScroll(surface: HTMLDivElement | null, enabled: boolean) {
  const [scrollTogether, setScrollTogether] = React.useState(false);
  React.useLayoutEffect(() => {
    if (!surface || !enabled) {
      setScrollTogether(false);
      return;
    }
    let frame = 0;
    const measure = () => {
      frame = 0;
      const header = surface.querySelector<HTMLElement>('[data-dialog-header]');
      const body = surface.querySelector<HTMLElement>('[data-dialog-body]');
      const footer = surface.querySelector<HTMLElement>('[data-dialog-footer]');
      if (!body) return;
      const heightWithMargins = (element: HTMLElement | null) => {
        if (!element) return 0;
        const style = getComputedStyle(element);
        return element.getBoundingClientRect().height + parseFloat(style.marginTop) + parseFloat(style.marginBottom);
      };
      const style = getComputedStyle(surface);
      const available = surface.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom);
      const remaining = available - heightWithMargins(header) - heightWithMargins(footer);
      const minimumBody = Math.min(240, surface.clientHeight * 0.4);
      setScrollTogether(remaining < minimumBody && body.scrollHeight > remaining + 1);
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(measure); };
    const resize = new ResizeObserver(schedule);
    resize.observe(surface);
    surface.querySelectorAll('[data-dialog-header], [data-dialog-body], [data-dialog-footer]').forEach(node => resize.observe(node));
    const mutation = new MutationObserver(schedule);
    mutation.observe(surface, { childList: true, subtree: true, characterData: true });
    measure();
    return () => { resize.disconnect(); mutation.disconnect(); cancelAnimationFrame(frame); };
  }, [surface, enabled]);

  React.useLayoutEffect(() => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && surface?.querySelector('[data-dialog-scroll-content]')?.contains(focused)) {
      focused.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }, [scrollTogether, surface]);
  return scrollTogether;
}

const Dialog = ({
  defaultOpen = false,
  onOpenChange,
  open,
  ...props
}: React.ComponentPropsWithoutRef<typeof DialogPrimitive.Root>) => {
  const [uncontrolledOpen, setUncontrolledOpen] = React.useState(defaultOpen);
  const resolvedOpen = open ?? uncontrolledOpen;
  React.useEffect(trackDialogOpeners, []);

  const handleOpenChange = React.useCallback(
    (nextOpen: boolean) => {
      if (open === undefined) setUncontrolledOpen(nextOpen);
      onOpenChange?.(nextOpen);
    },
    [onOpenChange, open]
  );

  return (
    <DialogOpenContext.Provider value={resolvedOpen}>
      <DialogOpenChangeContext.Provider value={handleOpenChange}>
      <DialogPrimitive.Root
        {...props}
        open={resolvedOpen}
        onOpenChange={handleOpenChange}
      />
      </DialogOpenChangeContext.Provider>
    </DialogOpenContext.Provider>
  );
};
Dialog.displayName = DialogPrimitive.Root.displayName;

const DialogTrigger = DialogPrimitive.Trigger;

const DialogPortal = DialogPrimitive.Portal;

const DialogOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    ref={ref}
    data-viewport-debug-dialog-overlay=""
    className={cn(
      "fixed inset-0 bg-black/60 backdrop-blur-[var(--blur-overlay)]",
      "supports-[backdrop-filter]:bg-black/50 motion-reduce:bg-black/75 motion-reduce:backdrop-blur-none",
      "[animation-duration:var(--motion-standard)] [animation-timing-function:var(--ease-standard)] data-[state=open]:animate-in data-[state=closed]:animate-out",
      "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
      className
    )}
    aria-hidden="true"
    {...props}
  />
));
DialogOverlay.displayName = DialogPrimitive.Overlay.displayName;

type DialogSize = "sm" | "md" | "lg" | "xl" | "full";
type DialogSurface = "default" | "soft" | "game" | "danger";
type DialogMobileMode = "center" | "sheet";
type DialogLayer = "default" | "nested";

const dialogSizeClassName: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  full: "w-[min(96vw,64rem)] max-w-none",
};

const dialogSurfaceClassName: Record<DialogSurface, string> = {
  default: "border-[hsl(var(--edge-panel))] !bg-card text-card-foreground",
  soft: "border-[hsl(var(--edge-panel))] !bg-popover text-popover-foreground",
  game: "border-white/15 !bg-slate-950 text-white shadow-[var(--shadow-modal)]",
  danger: "border-destructive/30 !bg-card bg-[image:var(--gradient-dialog)] text-card-foreground",
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    danger?: boolean;
    morphFromTrigger?: boolean;
    /** Let header/footer scroll with the body if enlarged text or a short viewport leaves too little body space. */
    adaptiveScroll?: boolean;
    padding?: "default" | "compact" | "none";
    frameClassName?: string;
    hideCloseButton?: boolean;
    layer?: DialogLayer;
    /** form/detail: only DialogBody scrolls; game: the entire surface scrolls.
     * custom preserves feature-owned layouts during incremental migration. */
    layout?: DialogLayout;
    mobileMode?: DialogMobileMode;
    overlayClassName?: string;
    size?: DialogSize;
    /** Styles for the visual surface; inherited style targets the viewport frame. */
    surfaceStyle?: React.CSSProperties;
    surface?: DialogSurface;
    useSafeAreaInset?: boolean;
  }
>(({
  children,
  className,
  danger = false,
  morphFromTrigger = false,
  adaptiveScroll = false,
  padding = "default",
  frameClassName,
  hideCloseButton,
  layer = "default",
  layout = "custom",
  mobileMode = "center",
  overlayClassName,
  size = "md",
  surfaceStyle,
  surface = "default",
  useSafeAreaInset = true,
  onOpenAutoFocus,
  onCloseAutoFocus,
  onEscapeKeyDown,
  style,
  ...props
}, ref) => {
  /*
   * Restore focus to whatever opened the dialog.
   *
   * Most dialogs here are state-controlled (`open` / `onOpenChange`) rather than
   * wrapped in a DialogTrigger — 17 of 20 — so Radix has no trigger element to
   * hand focus back to and it falls through to <body>. Keyboard users lose their
   * place and have to tab from the top of the page again.
   *
   * onOpenAutoFocus fires before focus moves into the dialog, so document.activeElement
   * is still the opener at that point.
   */
  const openerRef = React.useRef<HTMLElement | null>(null);
  const dialogOpen = React.useContext(DialogOpenContext);
  const changeDialogOpen = React.useContext(DialogOpenChangeContext);
  const feedbackHostRef = useDialogFeedbackHostRef(dialogOpen);
  const frameRef = React.useRef<HTMLDivElement | null>(null);
  const [surfaceNode, setSurfaceNode] = React.useState<HTMLDivElement | null>(null);
  const quietMotion = useQuietMotion();
  const wasOpen = React.useRef(false);
  React.useLayoutEffect(() => {
    if (!surfaceNode) return;
    const opening = dialogOpen && !wasOpen.current;
    wasOpen.current = dialogOpen;
    const origin = opening && morphFromTrigger ? consumeSurfaceOrigin() : null;
    if (quietMotion) { surfaceNode.style.transform = 'none'; return; }
    const sheet = mobileMode === 'sheet' && window.matchMedia('(max-width: 639px)').matches;
    let from = sheet ? 'translate3d(0, 48px, 0) scale(1, 1)' : 'translate3d(0, 8px, 0) scale(.96, .96)';
    if (origin) {
      const rect = surfaceNode.getBoundingClientRect();
      // Keep the content legible while the surface traces back to its source tile.
      const scale = Math.max(.7, Math.min(1, origin.width / rect.width));
      const x = origin.left + origin.width / 2 - rect.left - rect.width / 2;
      const y = origin.top + origin.height / 2 - rect.top - rect.height / 2;
      from = `translate3d(${x}px, ${y}px, 0) scale(${scale}, ${scale})`;
    }
    const animation = animate(surfaceNode, { transform: opening ? [from, 'translate3d(0, 0, 0) scale(1, 1)'] : dialogOpen ? 'translate3d(0, 0, 0) scale(1, 1)' : from }, UI_SPRING);
    return () => animation.stop();
  }, [dialogOpen, surfaceNode, quietMotion, mobileMode, morphFromTrigger]);
  const scrollTogether = useAdaptiveDialogScroll(surfaceNode, adaptiveScroll);
  const escapeCleanup = React.useRef<(() => void) | null>(null);
  const escapeHandler = React.useRef<(event: KeyboardEvent) => void>(() => {});
  escapeHandler.current = (event) => {
    onEscapeKeyDown?.(event);
    if (!event.defaultPrevented) changeDialogOpen(false);
  };
  const setFrameRef = React.useCallback((node: HTMLDivElement | null) => {
    escapeCleanup.current?.();
    frameRef.current = node;
    escapeCleanup.current = node ? registerDialogEscape(node, event => escapeHandler.current(event)) : null;
    if (typeof ref === 'function') ref(node);
    else if (ref) ref.current = node;
  }, [ref]);

  return (
  <DialogPortal>
    <DialogOverlay
      className={cn(
        layer === "nested"
          ? "z-[calc(var(--z-modal-nested)-1)]"
          : "z-[var(--z-overlay)]",
        overlayClassName
      )}
    />
    <DialogPrimitive.Content
      ref={setFrameRef}
      data-viewport-debug-dialog-frame=""
      className={cn(
        // Radix Presence observes this node, so it needs its own exit animation.
        // This is opacity-only: unlike a transform, it does not change the
        // containing block for viewport-fixed feedback hosted beneath it.
        "dialog-feedback-frame-motion fixed inset-0 flex justify-center",
        layer === "nested"
          ? "z-[var(--z-modal-nested)]"
          : "z-[var(--z-modal)]",
        mobileMode === "sheet" ? "items-end sm:items-center" : "items-center",
        useSafeAreaInset && "safe-area-inset",
        frameClassName
      )}
      /*
       * Let backdrop pointerdowns reach the Overlay.
       *
       * This frame spans the viewport and paints above the Overlay, so it used to
       * swallow every backdrop press before Radix could classify it as "outside":
       * DismissableLayer's inside test is a React-tree flag set by an
       * onPointerDownCapture on THIS node, not a contains() check — so a full-screen
       * Content marks every press as inside and onPointerDownOutside never fires.
       * Click-outside dismissal was dead for every dialog in the app.
       *
       * Making the frame transparent to pointers lets the press land on
       * DialogOverlay, which Radix registers as a dismissable surface, and the
       * dismissal path runs normally. The panel below re-enables pointer events.
       *
       * Must be an inline style: Radix writes pointerEvents inline on this node and
       * spreads props.style last, so a utility class would lose the cascade.
       */
      style={{
        pointerEvents: "none",
        // Position the frame in the visible viewport too: limiting only the
        // panel's height leaves bottom sheets anchored behind the keyboard.
        top: "var(--visual-viewport-offset-top, 0px)",
        height: "var(--visual-viewport-height, 100dvh)",
        bottom: "auto",
        // The frame already includes the visual viewport's vertical offset.
        paddingTop: useSafeAreaInset ? "max(1rem, env(safe-area-inset-top), var(--safe-area-inset-top, 0px))" : undefined,
        ...style,
      }}
      onOpenAutoFocus={(event) => {
        openerRef.current = getDialogOpener();
        onOpenAutoFocus?.(event);
        // Adaptive detail surfaces can scroll their heading away if the first
        // body action receives browser autofocus. Start on the visible close
        // control; a feature's explicit autofocus handler still takes precedence.
        const close = adaptiveScroll ? frameRef.current?.querySelector<HTMLButtonElement>('[data-dialog-close]') : null;
        if (!event.defaultPrevented && close) {
          event.preventDefault();
          close.focus({ preventScroll: true });
        }
      }}
      onCloseAutoFocus={(event) => {
        onCloseAutoFocus?.(event);
        const opener = openerRef.current;
        openerRef.current = null;
        // Only take over when Radix has nothing to restore to (no DialogTrigger)
        // and the opener is still in the document.
        if (event.defaultPrevented || !opener || !opener.isConnected) return;
        event.preventDefault();
        opener.focus({ preventScroll: true });
      }}
      onEscapeKeyDown={(event) => {
        if (!routeNestedDialogEscape(frameRef.current, event)) onEscapeKeyDown?.(event);
      }}
      {...props}
    >
      <div
        ref={setSurfaceNode}
        data-viewport-debug-dialog-surface=""
        data-dialog-layout={layout}
        data-dialog-scroll={scrollTogether ? 'content' : 'body'}
        style={surfaceStyle}
        data-state={dialogOpen ? "open" : "closed"}
        className={cn(
          // Counterpart to the frame's pointer-events: none above. The second class
          // restores Radix's nested-layer inertness: when an inner dialog marks this
          // one aria-hidden, the panel must stop taking pointer events too, which the
          // frame's inline pointerEvents:none would otherwise have handled.
          "pointer-events-auto [[data-aria-hidden=true]_&]:pointer-events-none",
          "relative flex w-[min(94vw,100%)] flex-col overflow-hidden border p-[var(--dialog-padding)] surface-shadow-modal",
          // Keep motion on the visual card. A transform on Radix Content turns the
          // full-screen focus scope into the containing block for fixed feedback,
          // which makes transaction notices appear attached to this card.
          /* Cap against the KEYBOARD-INCLUSIVE visual viewport, not just dvh:
             dvh ignores the on-screen keyboard on iOS, so a 90dvh panel kept its
             full height while the keyboard halved the screen and the sticky
             footer's submit button landed under it. --visual-viewport-height is
             maintained by useViewportInsets; the dvh term is the fallback for
             routes that don't run it. */
          "max-h-[min(90dvh,calc(var(--visual-viewport-height,100dvh)*0.9))]",
          "rounded-[var(--radius-dialog)]",
          padding === "none" ? "[--dialog-padding:0px]" : padding === "compact" ? "[--dialog-padding:0.75rem] sm:[--dialog-padding:1rem] md:[--dialog-padding:1.5rem]" : "[--dialog-padding:1.25rem] sm:[--dialog-padding:1.5rem]",
          dialogSizeClassName[size],
          dialogSurfaceClassName[danger ? "danger" : surface],
          layout === "game" && "overflow-y-auto overscroll-contain [&>*]:shrink-0",
          className
        )}
      >
        <DialogLayoutContext.Provider value={layout}>
          <DialogScrollsTogetherContext.Provider value={scrollTogether}>
            {adaptiveScroll ? (
              <ScrollArea
                data-dialog-scroll-content=""
                className={scrollTogether
                  ? "-m-[var(--dialog-padding)] min-h-0 flex-1 overflow-y-auto overscroll-contain p-[var(--dialog-padding)]"
                  : "contents"}
              >
                {children}
              </ScrollArea>
            ) : children}
          </DialogScrollsTogetherContext.Provider>
        </DialogLayoutContext.Provider>
        {!hideCloseButton && (
          <DialogPrimitive.Close
            data-dialog-close=""
            aria-label="Close dialog"
            className={cn(
              // Position
              "absolute top-[12px] right-[12px] md:top-[16px] md:right-[16px] z-20",
              // Size and alignment
              "inline-flex h-[44px] min-h-[44px] w-[44px] min-w-[44px] items-center justify-center",
              // Visuals: match header/task/stake icon controls
              "rounded-[var(--radius-control)] border border-[hsl(var(--edge-panel))] !bg-card bg-[image:var(--gradient-control-surface)] text-foreground shadow-[var(--shadow-control)]",
              "[@media(hover:hover)_and_(pointer:fine)]:hover:border-primary/45 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[hsl(var(--nav-hover-bg))] [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary [@media(hover:hover)_and_(pointer:fine)]:hover:shadow-[var(--shadow-glow)] [@media(hover:hover)_and_(pointer:fine)]:hover:brightness-[1.03] active:translate-y-0 active:scale-[0.985]",
              // Accessibility focus style
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              // Ensure ring offset blends with dialog background
              "ring-offset-background",
              // Behavior
              "transition-[border-color,background-color,color,box-shadow,filter,transform,translate,scale] duration-[var(--motion-quick)] ease-[var(--ease-standard)] focus-visible:transition-none disabled:pointer-events-none"
            )}
          >
            {/* aria-label above is the accessible name; the icon is decorative. */}
            <X className="h-[20px] w-[20px]" aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
      </div>
      <div
        ref={feedbackHostRef}
        data-dialog-feedback-host=""
        className="pointer-events-auto [[data-aria-hidden=true]_&]:pointer-events-none"
      />
    </DialogPrimitive.Content>
  </DialogPortal>
  );
});
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    data-dialog-header=""
    className={cn(
      "surface-header-divider dialog-header-surface -mx-[var(--dialog-padding)] -mt-[var(--dialog-padding)] mb-0 flex shrink-0 flex-col space-y-2 px-[var(--dialog-padding)] pb-3 pt-[var(--dialog-padding)] pr-[64px] text-left",
      className
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  sticky,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { sticky?: boolean }) => {
  const layout = React.useContext(DialogLayoutContext);
  const scrollTogether = React.useContext(DialogScrollsTogetherContext);
  const fixed = sticky ?? layout === "form";
  return (
  <div
    data-dialog-footer=""
    className={cn(
      "flex shrink-0 flex-col-reverse gap-2 sm:flex-row sm:justify-end",
      fixed && "surface-footer-divider dialog-footer-surface sticky -bottom-[var(--dialog-padding)] z-10 -mx-[var(--dialog-padding)] -mb-[var(--dialog-padding)] overflow-visible px-[var(--dialog-padding)] pb-[max(0.75rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom),var(--browser-safe-area-bottom))] pt-3",
      className,
      scrollTogether && "static"
    )}
    {...props}
  />
  );
};
DialogFooter.displayName = "DialogFooter";

const DialogBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => {
  const scrollTogether = React.useContext(DialogScrollsTogetherContext);
  return (
  <ScrollArea
    data-dialog-body=""
    className={cn("surface-scroll-fade -mx-[min(0.375rem,var(--dialog-padding,0.375rem))] min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 py-3", className, scrollTogether && "flex-none overflow-visible")}
    {...props}
  />
  );
};
DialogBody.displayName = "DialogBody";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "type-dialog-title [overflow-wrap:anywhere]",
      className
    )}
    {...props}
  />
));
DialogTitle.displayName = DialogPrimitive.Title.displayName;

const DialogDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description
    ref={ref}
    className={cn("text-sm leading-relaxed text-muted-foreground [overflow-wrap:anywhere]", className)}
    {...props}
  />
));
DialogDescription.displayName = DialogPrimitive.Description.displayName;

export {
  Dialog,
  DialogTrigger,
  DialogContent,
  DialogHeader,
  DialogFooter,
  DialogBody,
  DialogTitle,
  DialogDescription,
}; 
