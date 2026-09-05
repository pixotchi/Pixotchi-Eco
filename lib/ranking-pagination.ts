export const DESKTOP_ITEMS_PER_PAGE = 20;
export const DESKTOP_COLUMN_SIZE = 10;
export type RankedRow = { rank: number };
export function getTotalPages(itemCount: number, pageSize: number) {
  return Math.ceil(itemCount / pageSize) || 1;
}

export function getBoundedPage(page: number, itemCount: number, pageSize: number) {
  return Math.min(Math.max(page, 1), getTotalPages(itemCount, pageSize));
}

export function getPageRows<T>(rows: T[], page: number, pageSize: number) {
  const activePage = getBoundedPage(page, rows.length, pageSize);
  const start = (activePage - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

export function splitDesktopRows<T>(rows: T[]) {
  return [
    rows.slice(0, DESKTOP_COLUMN_SIZE),
    rows.slice(DESKTOP_COLUMN_SIZE, DESKTOP_ITEMS_PER_PAGE),
  ];
}

export function getRankRangeLabel(rows: RankedRow[]) {
  if (rows.length === 0) return "No entries";
  const firstRank = rows[0]?.rank;
  const lastRank = rows[rows.length - 1]?.rank;
  return firstRank === lastRank ? `Rank #${firstRank}` : `Ranks #${firstRank}-${lastRank}`;
}
