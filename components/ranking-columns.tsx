import type React from 'react';
import { splitDesktopRows, getRankRangeLabel, type RankedRow } from '@/lib/ranking-pagination';
export function RankingColumns<T extends RankedRow>({ rows, renderRow }: { rows: T[]; renderRow: (row: T, compact?: boolean) => React.ReactNode }) {
    const columns = splitDesktopRows(rows);

    // A desktop page is always DESKTOP_ITEMS_PER_PAGE rows split across two
    // columns, so the content height is bounded and known. These columns used
    // to be stretched to the viewport (`flex-1`) with an inner scroller, which
    // on any tall window left a band of dead space under the last row inside
    // each card and pushed the pagination to the bottom of the screen. Sizing
    // them to their rows removes the gap; the two columns still match each
    // other's height because grid items stretch by default.
    return (
      <div className="hidden tablet:grid tablet:grid-cols-2 tablet:gap-4">
        {columns.map((column, columnIndex) => (
          <div
            key={columnIndex}
            className="min-w-0 tablet:flex tablet:flex-col tablet:px-3 tablet:py-2"
          >
            <div className="flex h-8 flex-none items-center justify-between border-b border-[hsl(var(--divider)/0.66)] text-xs font-semibold text-muted-foreground">
              <span>{getRankRangeLabel(column)}</span>
            </div>
            <div className="divide-y divide-[hsl(var(--divider)/0.62)] overflow-visible">
              {column.length > 0 ? (
                column.map((row) => renderRow(row, true))
              ) : (
                <div className="flex min-h-[160px] items-center justify-center text-sm text-muted-foreground">
                  No more entries
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    );
  }
