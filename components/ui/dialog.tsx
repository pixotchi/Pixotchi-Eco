"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

import { cn } from "@/lib/utils";

const Dialog = DialogPrimitive.Root;

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
type DialogMobileMode = "auto" | "center" | "sheet";
type DialogLayer = "default" | "nested";

const dialogSizeClassName: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  full: "w-[min(96vw,64rem)] max-w-none",
};

const dialogSurfaceClassName: Record<DialogSurface, string> = {
  default: "border-border/65 !bg-card bg-[image:var(--gradient-dialog)] text-card-foreground",
  soft: "border-border/65 !bg-popover bg-[image:var(--gradient-dialog)] text-popover-foreground",
  game: "border-white/15 !bg-slate-950 text-white shadow-[var(--shadow-modal)]",
  danger: "border-destructive/30 !bg-card bg-[image:var(--gradient-dialog)] text-card-foreground",
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    danger?: boolean;
    frameClassName?: string;
    hideCloseButton?: boolean;
    layer?: DialogLayer;
    mobileMode?: DialogMobileMode;
    overlayClassName?: string;
    size?: DialogSize;
    stickyFooter?: boolean;
    surface?: DialogSurface;
    useSafeAreaInset?: boolean;
  }
>(({
  children,
  className,
  danger = false,
  frameClassName,
  hideCloseButton,
  layer = "default",
  mobileMode = "auto",
  overlayClassName,
  size = "md",
  stickyFooter = false,
  surface = "default",
  useSafeAreaInset = true,
  onOpenAutoFocus,
  onCloseAutoFocus,
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
      ref={ref}
      data-viewport-debug-dialog-frame=""
      data-sticky-footer={stickyFooter ? "true" : undefined}
      className={cn(
        "fixed inset-0 flex justify-center",
        layer === "nested"
          ? "z-[var(--z-modal-nested)]"
          : "z-[var(--z-modal)]",
        mobileMode === "sheet" ? "items-end sm:items-center" : "items-center",
        useSafeAreaInset && "safe-area-inset",
        "[animation-duration:var(--motion-modal)] [animation-timing-function:var(--ease-standard)] data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        mobileMode === "sheet"
          ? "data-[state=closed]:slide-out-to-bottom-4 data-[state=open]:slide-in-from-bottom-4 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95"
          : "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
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
      style={{ pointerEvents: "none", ...style }}
      onOpenAutoFocus={(event) => {
        const active = typeof document !== "undefined" ? document.activeElement : null;
        openerRef.current =
          active instanceof HTMLElement && active !== document.body ? active : null;
        onOpenAutoFocus?.(event);
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
      {...props}
    >
      <div
        data-viewport-debug-dialog-surface=""
        className={cn(
          // Counterpart to the frame's pointer-events: none above. The second class
          // restores Radix's nested-layer inertness: when an inner dialog marks this
          // one aria-hidden, the panel must stop taking pointer events too, which the
          // frame's inline pointerEvents:none would otherwise have handled.
          "pointer-events-auto [[data-aria-hidden=true]_&]:pointer-events-none",
          "relative flex w-[min(94vw,100%)] flex-col overflow-hidden border p-5 surface-shadow-modal sm:p-6",
          /* Cap against the KEYBOARD-INCLUSIVE visual viewport, not just dvh:
             dvh ignores the on-screen keyboard on iOS, so a 90dvh panel kept its
             full height while the keyboard halved the screen and the sticky
             footer's submit button landed under it. --visual-viewport-height is
             maintained by useViewportInsets; the dvh term is the fallback for
             routes that don't run it. */
          "max-h-[min(90dvh,calc(var(--visual-viewport-height,100dvh)*0.9))]",
          "rounded-[var(--radius-dialog)]",
          dialogSizeClassName[size],
          dialogSurfaceClassName[danger ? "danger" : surface],
          className
        )}
      >
        {children}
        {!hideCloseButton && (
          <DialogPrimitive.Close
            aria-label="Close dialog"
            className={cn(
              // Position
              "absolute top-3 right-3 md:top-4 md:right-4 z-10",
              // Size and alignment
              "inline-flex h-11 min-h-11 w-11 min-w-11 items-center justify-center",
              // Visuals: match header/task/stake icon controls
              "rounded-[var(--radius-control)] border border-[hsl(var(--edge-panel))] !bg-card bg-[image:var(--gradient-control-surface)] text-foreground shadow-[var(--shadow-control)]",
              "[@media(hover:hover)_and_(pointer:fine)]:hover:border-primary/45 [@media(hover:hover)_and_(pointer:fine)]:hover:bg-[hsl(var(--nav-hover-bg))] [@media(hover:hover)_and_(pointer:fine)]:hover:text-primary [@media(hover:hover)_and_(pointer:fine)]:hover:shadow-[var(--shadow-glow)] [@media(hover:hover)_and_(pointer:fine)]:hover:brightness-[1.03] active:translate-y-0 active:scale-[0.985]",
              // Accessibility focus style
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              // Ensure ring offset blends with dialog background
              "ring-offset-background",
              // Behavior
              "transition-[border-color,background-color,color,box-shadow,filter,transform] duration-[var(--motion-quick)] ease-[var(--ease-standard)] disabled:pointer-events-none"
            )}
          >
            {/* aria-label above is the accessible name; the icon is decorative. */}
            <X className="h-4 w-4" aria-hidden="true" />
          </DialogPrimitive.Close>
        )}
      </div>
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
    className={cn(
      "surface-header-divider dialog-header-surface -mx-5 -mt-5 mb-0 flex flex-col space-y-2 px-5 pb-3 pt-5 pr-16 text-left sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6 sm:pr-16",
      className
    )}
    {...props}
  />
);
DialogHeader.displayName = "DialogHeader";

const DialogFooter = ({
  sticky = false,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { sticky?: boolean }) => (
  <div
    className={cn(
      "flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2",
      sticky && "surface-footer-divider dialog-footer-surface sticky -bottom-5 z-10 -mx-5 -mb-5 overflow-visible px-5 pb-[max(0.75rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom),var(--browser-safe-area-bottom))] pt-3 sm:-bottom-6 sm:-mx-6 sm:-mb-6 sm:px-6",
      className
    )}
    {...props}
  />
);
DialogFooter.displayName = "DialogFooter";

const DialogBody = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn("surface-scroll-fade -mx-1.5 min-h-0 flex-1 overflow-y-auto px-1.5 py-3", className)}
    {...props}
  />
);
DialogBody.displayName = "DialogBody";

const DialogTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn(
      "text-lg font-semibold leading-none tracking-tight",
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
    className={cn("text-sm leading-relaxed text-muted-foreground", className)}
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
