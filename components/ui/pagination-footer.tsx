"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface PaginationFooterProps {
  currentPage: number;
  totalPages: number;
  onNext: () => void;
  onPrevious: () => void;
  className?: string;
}

export function PaginationFooter({
  currentPage,
  totalPages,
  onNext,
  onPrevious,
  className,
}: PaginationFooterProps) {
  if (totalPages <= 1) return null;

  return (
    <div
      className={cn(
        "surface-footer-divider dialog-footer-surface -mx-4 -mb-4 mt-0 flex min-h-[4.25rem] flex-none items-center overflow-visible px-4 py-3",
        className
      )}
    >
      <div className="mx-auto grid w-full max-w-xs grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <Button
          variant="compactUtility"
          size="touchCompact"
          onClick={onPrevious}
          disabled={currentPage === 1}
          leadingIcon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
          className="justify-center text-xs active:translate-y-0"
        >
          Back
        </Button>
        <span className="min-w-[5.5rem] text-center text-xs font-semibold tabular-nums text-muted-foreground">
          {currentPage} / {totalPages}
        </span>
        <Button
          variant="compactUtility"
          size="touchCompact"
          onClick={onNext}
          disabled={currentPage === totalPages}
          trailingIcon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
          className="justify-center text-xs active:translate-y-0"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
