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
      "fixed inset-0 z-[var(--z-overlay)] bg-black/60 backdrop-blur-[2px] sm:backdrop-blur-sm",
      "supports-[backdrop-filter]:bg-black/50 motion-reduce:bg-black/75 motion-reduce:backdrop-blur-none",
      "duration-[var(--motion-standard)] data-[state=open]:animate-in data-[state=closed]:animate-out",
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

const dialogSizeClassName: Record<DialogSize, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
  full: "w-[min(96vw,72rem)] max-w-none",
};

const dialogSurfaceClassName: Record<DialogSurface, string> = {
  default: "border-border/80 bg-background text-foreground",
  soft: "border-border/70 bg-card/95 bg-[image:var(--gradient-dialog)] text-card-foreground backdrop-blur-md",
  game: "border-white/15 bg-slate-950/90 text-white shadow-[var(--shadow-modal)]",
  danger: "border-destructive/30 bg-background text-foreground",
};

const DialogContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content> & {
    danger?: boolean;
    frameClassName?: string;
    hideCloseButton?: boolean;
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
  mobileMode = "auto",
  overlayClassName,
  size = "md",
  stickyFooter = false,
  surface = "default",
  useSafeAreaInset = true,
  ...props
}, ref) => (
  <DialogPortal>
    <DialogOverlay className={overlayClassName} />
    <DialogPrimitive.Content
      ref={ref}
      data-viewport-debug-dialog-frame=""
      data-sticky-footer={stickyFooter ? "true" : undefined}
      className={cn(
        "fixed inset-0 z-[var(--z-modal)] flex justify-center",
        mobileMode === "sheet" ? "items-end sm:items-center" : "items-center",
        useSafeAreaInset && "safe-area-inset",
        "duration-[var(--motion-modal)] data-[state=open]:animate-in data-[state=closed]:animate-out",
        "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
        mobileMode === "sheet"
          ? "data-[state=closed]:slide-out-to-bottom-4 data-[state=open]:slide-in-from-bottom-4 sm:data-[state=closed]:zoom-out-95 sm:data-[state=open]:zoom-in-95"
          : "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
        frameClassName
      )}
      {...props}
    >
      <div
        data-viewport-debug-dialog-surface=""
        className={cn(
          "relative flex w-full flex-col overflow-hidden border p-5 shadow-[var(--shadow-modal)] sm:p-6",
          "max-h-[calc(100dvh-2rem)] sm:max-h-[90dvh]",
          mobileMode === "sheet"
            ? "rounded-t-[var(--radius-dialog)] rounded-b-none sm:rounded-[var(--radius-dialog)]"
            : "rounded-[var(--radius-dialog)]",
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
              // Visuals: avoid borders, provide hover background only
              "rounded-md bg-transparent text-muted-foreground hover:bg-muted/60",
              // Accessibility focus style (no persistent ring/border)
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
              // Ensure ring offset blends with dialog background
              "ring-offset-background",
              // Behavior
              "transition-colors disabled:pointer-events-none"
            )}
          >
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </div>
    </DialogPrimitive.Content>
  </DialogPortal>
));
DialogContent.displayName = DialogPrimitive.Content.displayName;

const DialogHeader = ({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) => (
  <div
    className={cn(
      "surface-header-divider -mx-5 -mt-5 mb-4 flex flex-col space-y-2 bg-transparent px-5 pb-4 pt-5 pr-16 text-left sm:-mx-6 sm:-mt-6 sm:px-6 sm:pt-6 sm:pr-16",
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
      sticky && "surface-footer-divider sticky bottom-0 z-10 -mx-5 mt-4 bg-transparent px-5 pb-[max(0.75rem,env(safe-area-inset-bottom),var(--safe-area-inset-bottom),var(--browser-safe-area-bottom))] pt-3 sm:-mx-6 sm:px-6",
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
    className={cn("min-h-0 flex-1 overflow-y-auto", className)}
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
