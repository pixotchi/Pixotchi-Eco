"use client";

import { useCallback } from 'react';
import { useWebQueryState } from '@/hooks/useWebQueryState';
import { type ActivityCategoryId, type ActivityDirectionId } from '@/lib/activity-filters';
import { DEFAULT_ACTIVITY_FEED, DEFAULT_ACTIVITY_VIEW_STATE, normalizeActivityFeed, parseActivityViewState, serializeActivityViewState, type ActivityFeedState, type ActivityView, type ActivityViewState } from '@/lib/activity-view-state';

export { parseActivityViewState } from '@/lib/activity-view-state';
export type { ActivityView, ActivityViewState } from '@/lib/activity-view-state';

/** One URL-backed state per feed, shared by the single-pane and two-pane layouts. */
export function useActivityViewState(enabled: boolean) {
  const [feeds, setFeeds] = useWebQueryState<ActivityViewState>({
    key: 'activityFeeds', enabled, defaultValue: DEFAULT_ACTIVITY_VIEW_STATE,
    parse: parseActivityViewState,
    serialize: serializeActivityViewState,
  });
  const update = useCallback((view: ActivityView, change: (feed: ActivityFeedState) => ActivityFeedState) => {
    setFeeds(previous => ({ ...previous, [view]: normalizeActivityFeed(change(previous[view])) }));
  }, [setFeeds]);
  const setPage = useCallback((view: ActivityView, next: number | ((previous: number) => number)) => update(view, feed => ({ ...feed, page: typeof next === 'function' ? next(feed.page) : next })), [update]);
  const setCategory = useCallback((view: ActivityView, category: ActivityCategoryId) => update(view, feed => ({ ...feed, category, page: 1 })), [update]);
  const setDirection = useCallback((view: ActivityView, direction: ActivityDirectionId) => update(view, feed => ({ ...feed, direction, page: 1 })), [update]);
  const reset = useCallback((view: ActivityView) => update(view, () => DEFAULT_ACTIVITY_FEED), [update]);
  return { feeds, setPage, setCategory, setDirection, reset };
}
