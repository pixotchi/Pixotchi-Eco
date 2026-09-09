import { DEFAULT_ACTIVITY_CATEGORY, DEFAULT_ACTIVITY_DIRECTION, isDirectionalActivityCategory, parseActivityCategory, parseActivityDirection, type ActivityCategoryId, type ActivityDirectionId } from '@/lib/activity-filters';

export type ActivityView = 'all' | 'my';
export type ActivityFeedState = { page: number; category: ActivityCategoryId; direction: ActivityDirectionId };
export type ActivityViewState = Record<ActivityView, ActivityFeedState>;
export const DEFAULT_ACTIVITY_FEED: ActivityFeedState = { page: 1, category: DEFAULT_ACTIVITY_CATEGORY, direction: DEFAULT_ACTIVITY_DIRECTION };
export const DEFAULT_ACTIVITY_VIEW_STATE: ActivityViewState = { all: DEFAULT_ACTIVITY_FEED, my: DEFAULT_ACTIVITY_FEED };

export function normalizeActivityFeed(value: Partial<ActivityFeedState> | null | undefined): ActivityFeedState {
  const category = parseActivityCategory(value?.category ?? null) ?? DEFAULT_ACTIVITY_CATEGORY;
  return {
    page: Number.isSafeInteger(value?.page) && Number(value?.page) > 0 ? Number(value?.page) : 1,
    category,
    direction: isDirectionalActivityCategory(category) ? parseActivityDirection(value?.direction ?? null) ?? DEFAULT_ACTIVITY_DIRECTION : DEFAULT_ACTIVITY_DIRECTION,
  };
}

export function parseActivityViewState(raw: string | null, legacy?: URLSearchParams): ActivityViewState {
  if (raw) {
    try {
      const value = JSON.parse(raw) as Partial<ActivityViewState>;
      return { all: normalizeActivityFeed(value?.all), my: normalizeActivityFeed(value?.my) };
    } catch { return DEFAULT_ACTIVITY_VIEW_STATE; }
  }
  if (!legacy) return DEFAULT_ACTIVITY_VIEW_STATE;
  const view = legacy.get('activityView') === 'my' ? 'my' : 'all';
  const page = legacy.get('activityPage');
  return { ...DEFAULT_ACTIVITY_VIEW_STATE, [view]: normalizeActivityFeed({
    page: page && /^\d+$/.test(page) ? Number(page) : 1,
    category: parseActivityCategory(legacy.get('activityFilter')) ?? DEFAULT_ACTIVITY_CATEGORY,
    direction: parseActivityDirection(legacy.get('activityDirection')) ?? DEFAULT_ACTIVITY_DIRECTION,
  }) };
}

/** Keep links compact: omitted feeds and fields are restored to their defaults. */
export function serializeActivityViewState(state: ActivityViewState): string | null {
  const result: Partial<Record<ActivityView, Partial<ActivityFeedState>>> = {};
  for (const view of ['all', 'my'] as const) {
    const feed = normalizeActivityFeed(state[view]);
    const fields: Partial<ActivityFeedState> = {};
    if (feed.page !== 1) fields.page = feed.page;
    if (feed.category !== DEFAULT_ACTIVITY_CATEGORY) fields.category = feed.category;
    if (feed.direction !== DEFAULT_ACTIVITY_DIRECTION) fields.direction = feed.direction;
    if (Object.keys(fields).length) result[view] = fields;
  }
  return Object.keys(result).length ? JSON.stringify(result) : null;
}
