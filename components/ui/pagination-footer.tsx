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
        "surface-footer-divider flex-none -mx-4 -mb-4 mt-2 bg-transparent px-4 pb-4 pt-3",
        "lg:mx-0 lg:mb-0 lg:px-0",
        className
      )}
    >
      <div className="mx-auto grid max-w-xs grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
        <Button
          variant="compactUtility"
          size="touchCompact"
          onClick={onPrevious}
          disabled={currentPage === 1}
          leadingIcon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
          className="justify-center text-xs"
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
          className="justify-center text-xs"
        >
          Next
        </Button>
      </div>
    </div>
  );
}
