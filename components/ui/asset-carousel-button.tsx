import { ChevronLeft, ChevronRight } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button, type ButtonProps } from "@/components/ui/button";

type AssetCarouselButtonProps = Omit<
  ButtonProps,
  "children" | "leadingIcon" | "size" | "trailingIcon" | "variant"
> & {
  direction: "previous" | "next";
  label: string;
};

export function AssetCarouselButton({
  className,
  direction,
  label,
  title,
  type = "button",
  ...props
}: AssetCarouselButtonProps) {
  const Icon = direction === "previous" ? ChevronLeft : ChevronRight;

  return (
    <Button
      {...props}
      aria-label={label}
      className={cn(
        "absolute top-1/2 z-20 -translate-y-1/2 rounded-[var(--radius-control)] bg-card/90 backdrop-blur-md shadow-[var(--shadow-control)] active:!-translate-y-1/2 active:brightness-[0.98] disabled:!-translate-y-1/2",
        direction === "previous" ? "left-2" : "right-2",
        className
      )}
      size="icon"
      title={title ?? label}
      type={type}
      variant="surfaceControl"
    >
      <Icon className="h-5 w-5" aria-hidden="true" />
    </Button>
  );
}
