"use client";

import { useCallback } from 'react';
import { useWebQueryState } from '@/hooks/useWebQueryState';
import { DEFAULT_ACTIVITY_CATEGORY, DEFAULT_ACTIVITY_DIRECTION, isDirectionalActivityCategory, parseActivityCategory, parseActivityDirection, type ActivityCategoryId, type ActivityDirectionId } from '@/lib/activity-filters';

export type ActivityView = 'all' | 'my';
type FeedState = { page: number; category: ActivityCategoryId; direction: ActivityDirectionId };
export type ActivityViewState = Record<ActivityView, FeedState>;
const DEFAULT_FEED: FeedState = { page: 1, category: DEFAULT_ACTIVITY_CATEGORY, direction: DEFAULT_ACTIVITY_DIRECTION };
const DEFAULT_STATE: ActivityViewState = { all: DEFAULT_FEED, my: DEFAULT_FEED };

function normalizeFeed(value: Partial<FeedState> | null | undefined): FeedState {
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
      return { all: normalizeFeed(value?.all), my: normalizeFeed(value?.my) };
    } catch { return DEFAULT_STATE; }
  }
  if (!legacy) return DEFAULT_STATE;
  const view = legacy.get('activityView') === 'my' ? 'my' : 'all';
  return { ...DEFAULT_STATE, [view]: normalizeFeed({
    page: Number(legacy.get('activityPage')),
    category: parseActivityCategory(legacy.get('activityFilter')) ?? DEFAULT_ACTIVITY_CATEGORY,
    direction: parseActivityDirection(legacy.get('activityDirection')) ?? DEFAULT_ACTIVITY_DIRECTION,
  }) };
}

/** One URL-backed state per feed, shared by the single-pane and two-pane layouts. */
export function useActivityViewState(enabled: boolean) {
  const [feeds, setFeeds] = useWebQueryState<ActivityViewState>({
    key: 'activityFeeds', enabled, defaultValue: DEFAULT_STATE,
    parse: raw => parseActivityViewState(raw, typeof window === 'undefined' ? undefined : new URLSearchParams(window.location.search)),
    serialize: JSON.stringify,
  });
  const update = useCallback((view: ActivityView, change: (feed: FeedState) => FeedState) => {
    setFeeds(previous => ({ ...previous, [view]: normalizeFeed(change(previous[view])) }));
  }, [setFeeds]);
  const setPage = useCallback((view: ActivityView, next: number | ((previous: number) => number)) => update(view, feed => ({ ...feed, page: typeof next === 'function' ? next(feed.page) : next })), [update]);
  const setCategory = useCallback((view: ActivityView, category: ActivityCategoryId) => update(view, feed => ({ ...feed, category, page: 1 })), [update]);
  const setDirection = useCallback((view: ActivityView, direction: ActivityDirectionId) => update(view, feed => ({ ...feed, direction, page: 1 })), [update]);
  const reset = useCallback((view: ActivityView) => update(view, () => DEFAULT_FEED), [update]);
  return { feeds, setPage, setCategory, setDirection, reset };
}
