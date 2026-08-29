import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

/**
 * Shared empty state.
 *
 * Extracted from the two good implementations (plants-view and lands-view, which
 * were byte-identical) so the Ranking boards stop shipping a bare grey sentence
 * where the rest of the app shows a medallion, a heading and a next step.
 *
 * Deliberately layout-neutral: it does NOT bake in a height. The dashboard views
 * pass `className="h-[60vh]"`, while the Ranking boards render inside an
 * already-centred, scrollable container where a fixed height would overflow the
 * scrollport.
 *
 * `action` is optional and mostly unused on purpose — the house pattern is prose
 * ("Head over to the 'Mint' tab..."), because most of these surfaces have no
 * tab-switching API in scope.
 */
export function EmptyState({
  action,
  className,
  description,
  icon: Icon,
  title,
}: {
  action?: ReactNode;
  className?: string;
  description: ReactNode;
  icon: LucideIcon;
  title: string;
}) {
  return (
    <div className={cn("flex flex-col items-center justify-center p-4 text-center", className)}>
      <div className="mb-4 flex h-24 w-24 items-center justify-center rounded-full bg-muted">
        <Icon className="h-12 w-12 text-muted-foreground" aria-hidden="true" />
      </div>
      <h3 className="mb-2 text-lg font-semibold text-foreground">{title}</h3>
      <p className="max-w-sm text-muted-foreground">{description}</p>
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}
