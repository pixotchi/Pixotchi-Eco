"use client";

import * as React from "react";
import * as DropdownMenuPrimitive from "@radix-ui/react-dropdown-menu";
import { Check, Circle } from "lucide-react";

import { cn } from "@/lib/utils";
import { useScrollFade } from '@/hooks/useScrollFade';

const DropdownMenu = DropdownMenuPrimitive.Root;

const DropdownMenuTrigger = DropdownMenuPrimitive.Trigger;

const DropdownMenuPortal = DropdownMenuPrimitive.Portal;

const DropdownMenuRadioGroup = DropdownMenuPrimitive.RadioGroup;

type DropdownMenuContentProps =
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Content> & {
    portalContainer?: React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Portal>["container"];
    matchTriggerWidth?: boolean;
  };

const DropdownMenuContent = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Content>,
  DropdownMenuContentProps
>(({ className, sideOffset = 4, collisionPadding = 8, portalContainer, matchTriggerWidth = false, style, ...props }, forwardedRef) => {
  const ref = useScrollFade(forwardedRef);
  const requestedHeight = typeof style?.maxHeight === 'number' ? `${style.maxHeight}px` : style?.maxHeight;
  const heightCaps = ['var(--radix-dropdown-menu-content-available-height)', 'var(--menu-max-height, 24rem)'];
  if (requestedHeight && !['none', 'inherit', 'initial', 'unset', 'revert', 'max-content', 'min-content', 'fit-content'].includes(requestedHeight)) heightCaps.push(requestedHeight);
  return (
  <DropdownMenuPortal container={portalContainer}>
    <DropdownMenuPrimitive.Content
      ref={ref}
      sideOffset={sideOffset}
      collisionPadding={collisionPadding}
      style={{ ...style, maxHeight: `min(${heightCaps.join(', ')})`, maxWidth: 'min(var(--radix-dropdown-menu-content-available-width), calc(100vw - 1rem))' }}
      className={cn(
        "z-[var(--z-dropdown)] min-w-[8rem] overflow-hidden rounded-[var(--radius-panel)] border border-[hsl(var(--edge-strong))] !bg-popover bg-[image:var(--gradient-dialog)] p-1 text-popover-foreground shadow-[var(--shadow-raised)] [transform-origin:var(--radix-dropdown-menu-content-transform-origin)] [animation-duration:var(--motion-quick)] [animation-timing-function:var(--ease-standard)] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2",
        'surface-scroll-fade overflow-x-hidden overflow-y-auto overscroll-contain [scroll-padding-block:0.25rem]',
        matchTriggerWidth && 'w-[var(--radix-dropdown-menu-trigger-width)]',
        className
      )}
      {...props}
    />
  </DropdownMenuPortal>
  );
});
DropdownMenuContent.displayName = DropdownMenuPrimitive.Content.displayName;

const DropdownMenuItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Item>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Item> & {
    inset?: boolean;
  }
>(({ className, inset, ...props }, ref) => (
  <DropdownMenuPrimitive.Item
    ref={ref}
    className={cn(
      "relative flex min-h-11 min-w-0 cursor-default select-none items-center whitespace-normal [overflow-wrap:anywhere] rounded-[var(--radius-nav)] px-3 py-2 text-sm outline-none transition-[background-color,color,box-shadow] focus:bg-[hsl(var(--nav-hover-bg))] focus:text-primary-strong focus:shadow-[var(--shadow-nav-hover)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      inset && "pl-8",
      className
    )}
    {...props}
  />
));
DropdownMenuItem.displayName = DropdownMenuPrimitive.Item.displayName;

const DropdownMenuCheckboxItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.CheckboxItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.CheckboxItem>
>(({ className, children, checked, ...props }, ref) => (
  <DropdownMenuPrimitive.CheckboxItem
    ref={ref}
    className={cn(
      "relative flex min-h-11 min-w-0 cursor-default select-none items-center whitespace-normal [overflow-wrap:anywhere] rounded-[var(--radius-nav)] py-2 pl-9 pr-3 text-sm outline-none transition-[background-color,color,box-shadow] focus:bg-[hsl(var(--nav-hover-bg))] focus:text-primary-strong focus:shadow-[var(--shadow-nav-hover)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      className
    )}
    checked={checked}
    {...props}
  >
    <span className="absolute left-3 flex h-4 w-4 items-center justify-center">
      <DropdownMenuPrimitive.ItemIndicator>
        <Check className="h-4 w-4" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.CheckboxItem>
));
DropdownMenuCheckboxItem.displayName =
  DropdownMenuPrimitive.CheckboxItem.displayName;

const DropdownMenuRadioItem = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.RadioItem>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.RadioItem> & {
    indicatorPosition?: 'start' | 'end';
  }
>(({ className, children, indicatorPosition = 'start', ...props }, ref) => (
  <DropdownMenuPrimitive.RadioItem
    ref={ref}
    className={cn(
      "relative flex min-h-11 min-w-0 cursor-default select-none items-center whitespace-normal [overflow-wrap:anywhere] rounded-[var(--radius-nav)] py-2 text-sm outline-none transition-[background-color,color,box-shadow] focus:bg-[hsl(var(--nav-hover-bg))] focus:text-primary-strong focus:shadow-[var(--shadow-nav-hover)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
      indicatorPosition === 'end' ? 'pl-3 pr-9' : 'pl-9 pr-3',
      className
    )}
    {...props}
  >
    <span className={cn("absolute flex h-4 w-4 items-center justify-center", indicatorPosition === 'end' ? 'right-3' : 'left-3')}>
      <DropdownMenuPrimitive.ItemIndicator>
        <Circle className="h-2 w-2 fill-current" />
      </DropdownMenuPrimitive.ItemIndicator>
    </span>
    {children}
  </DropdownMenuPrimitive.RadioItem>
));
DropdownMenuRadioItem.displayName = DropdownMenuPrimitive.RadioItem.displayName;

const DropdownMenuSeparator = React.forwardRef<
  React.ElementRef<typeof DropdownMenuPrimitive.Separator>,
  React.ComponentPropsWithoutRef<typeof DropdownMenuPrimitive.Separator>
>(({ className, ...props }, ref) => (
  <DropdownMenuPrimitive.Separator
    ref={ref}
    className={cn("-mx-1 my-1 h-px bg-[hsl(var(--divider)/0.72)]", className)}
    {...props}
  />
));
DropdownMenuSeparator.displayName = DropdownMenuPrimitive.Separator.displayName;

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuRadioGroup,
};
