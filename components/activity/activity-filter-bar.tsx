"use client";

import { ToggleGroup } from "@/components/ui/toggle-group";
import {
ACTIVITY_CATEGORY_ARIA_LABELS,
ACTIVITY_CATEGORY_IDS,
ACTIVITY_CATEGORY_LABELS,
ACTIVITY_DIRECTION_ARIA_LABELS,
ACTIVITY_DIRECTION_IDS,
ACTIVITY_DIRECTION_LABELS,
parseActivityCategory,
parseActivityDirection,
type ActivityCategoryId,
type ActivityDirectionId,
} from "@/lib/activity-filters";
import { cn } from "@/lib/utils";

type ActivityFilterBarProps = {
  category: ActivityCategoryId;
  className?: string;
  direction: ActivityDirectionId;
  onCategoryChange: (nextCategory: ActivityCategoryId) => void;
  onDirectionChange: (nextDirection: ActivityDirectionId) => void;
  /** Direction needs the viewer's own plants/lands, so it is only shown on personal feeds. */
  showDirection: boolean;
};

const CATEGORY_OPTIONS = ACTIVITY_CATEGORY_IDS.map((id) => ({
  ariaLabel: ACTIVITY_CATEGORY_ARIA_LABELS[id],
  label: ACTIVITY_CATEGORY_LABELS[id],
  value: id,
}));

const DIRECTION_OPTIONS = ACTIVITY_DIRECTION_IDS.map((id) => ({
  ariaLabel: ACTIVITY_DIRECTION_ARIA_LABELS[id],
  label: ACTIVITY_DIRECTION_LABELS[id],
  value: id,
}));

export function ActivityFilterBar({
  category,
  className,
  direction,
  onCategoryChange,
  onDirectionChange,
  showDirection,
}: ActivityFilterBarProps) {
  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <ToggleGroup
        ariaLabel="Filter activity by type"
        className="w-full"
        getButtonClassName={() => "min-w-0 flex-1 px-2 max-[380px]:px-1 max-[340px]:text-[11px]"}
        onValueChange={(nextValue) => {
          const nextCategory = parseActivityCategory(String(nextValue));
          if (!nextCategory || nextCategory === category) return;
          onCategoryChange(nextCategory);
        }}
        options={CATEGORY_OPTIONS}
        value={category}
      />

      {showDirection && (
        <ToggleGroup
          ariaLabel="Filter attacks and raids by direction"
          className="w-full"
          getButtonClassName={() => "min-w-0 flex-1 px-2 max-[380px]:px-1 max-[340px]:text-[11px]"}
          onValueChange={(nextValue) => {
            const nextDirection = parseActivityDirection(String(nextValue));
            if (!nextDirection || nextDirection === direction) return;
            onDirectionChange(nextDirection);
          }}
          options={DIRECTION_OPTIONS}
          value={direction}
        />
      )}
    </div>
  );
}
