import { parseActivityViewState, serializeActivityViewState } from '@/lib/activity-view-state';
import { isGameTab } from '@/lib/game-navigation';
import type { Tab } from '@/lib/types';

// Only these keys belong to the game shell. Auth, referral, debug and other
// unrelated parameters (and the path/hash) must survive tab navigation.
const QUERY_SCOPES = {
  dashboardView: 'dashboard',
  mintType: 'mint',
  leaderboardPage: 'leaderboard',
  leaderboardFilter: 'leaderboard',
  leaderboardMine: 'leaderboard',
  leaderboardBoard: 'leaderboard',
  activityView: 'activity',
  activityFeeds: 'activity',
} as const satisfies Record<string, Tab>;
type QueryKey = keyof typeof QUERY_SCOPES;
type QueryValues = Partial<Record<QueryKey, string>>;
type Snapshot = { tab: Tab; values: QueryValues };
const QUERY_KEYS = Object.keys(QUERY_SCOPES) as QueryKey[];
const LEGACY_ACTIVITY_KEYS = ['activityPage', 'activityFilter', 'activityDirection'] as const;
const HISTORY_KEY = 'pixotchi:game-query';

function isQueryKey(key: string): key is QueryKey {
  return Object.hasOwn(QUERY_SCOPES, key);
}

export function parseQueryPage(raw: string | null): number | null {
  if (!raw || !/^\d+$/.test(raw)) return null;
  const page = Number(raw);
  return Number.isSafeInteger(page) && page > 0 ? page : null;
}

function canonicalValue(key: QueryKey, params: URLSearchParams): string | null {
  const raw = params.get(key);
  switch (key) {
    case 'dashboardView': return raw === 'lands' ? raw : null;
    case 'mintType': return raw === 'land' ? raw : null;
    case 'leaderboardPage': {
      const page = parseQueryPage(raw);
      return page !== null && page > 1 ? String(page) : null;
    }
    case 'leaderboardFilter': return raw === 'attackable' || raw === 'dead' ? raw : null;
    case 'leaderboardMine': return raw === '1' ? raw : null;
    case 'leaderboardBoard': return raw === 'players' || raw === 'lands' || raw === 'stake' || raw === 'rocks' ? raw : null;
    case 'activityView': return raw === 'my' ? raw : null;
    case 'activityFeeds': return serializeActivityViewState(parseActivityViewState(raw, params));
  }
}

/**
 * Each history entry remembers inactive tab selections. The visible URL is
 * authoritative for the active tab, including missing keys meaning defaults.
 * Reading has no side effects, so it is safe during a hook's initial render.
 */
function readSnapshot(): Snapshot {
  const params = new URLSearchParams(window.location.search);
  const rawTab = params.get('tab');
  const tab = isGameTab(rawTab) ? rawTab : 'dashboard';
  const stored = window.history.state?.[HISTORY_KEY];
  const candidates = new URLSearchParams();
  for (const key of QUERY_KEYS) {
    const remembered: unknown = stored?.version === 1 ? stored.values?.[key] : undefined;
    if (typeof remembered === 'string') candidates.set(key, remembered);
    // Also accept inactive keys in old shared links, then archive them when
    // canonicalizing. Their absence must not erase a remembered selection.
    if (QUERY_SCOPES[key] === tab || params.has(key)) {
      candidates.delete(key);
      const raw = params.get(key);
      if (raw !== null) candidates.set(key, raw);
    }
  }
  if (LEGACY_ACTIVITY_KEYS.some(key => params.has(key))) {
    // An old Activity link supersedes a remembered feed, too.
    if (!params.has('activityFeeds')) candidates.delete('activityFeeds');
    for (const key of LEGACY_ACTIVITY_KEYS) {
      const raw = params.get(key);
      if (raw !== null) candidates.set(key, raw);
    }
  }
  const values: QueryValues = {};
  for (const key of QUERY_KEYS) {
    const value = canonicalValue(key, candidates);
    if (value !== null) values[key] = value;
  }
  return { tab, values };
}

function historyStateForWrite(): Record<string, unknown> {
  const state = { ...window.history.state };
  // Next uses these flags to identify its own writes and bypass router sync.
  // Its patched History API restores the flags/tree for external writes; do
  // not pass the bypass flags ourselves or useSearchParams will stay stale.
  delete state.__NA;
  delete state._N;
  return state;
}

function commit(snapshot: Snapshot, mode: 'push' | 'replace') {
  const url = new URL(window.location.href);
  for (const key of ['tab', ...QUERY_KEYS, ...LEGACY_ACTIVITY_KEYS]) url.searchParams.delete(key);
  if (snapshot.tab !== 'dashboard') url.searchParams.set('tab', snapshot.tab);
  for (const key of QUERY_KEYS) {
    const value = snapshot.values[key];
    if (QUERY_SCOPES[key] === snapshot.tab && value !== undefined) url.searchParams.set(key, value);
  }
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  const stored = window.history.state?.[HISTORY_KEY];
  if (nextUrl === currentUrl && stored?.version === 1 && JSON.stringify(stored.values) === JSON.stringify(snapshot.values)) return;
  const state = { ...historyStateForWrite(), [HISTORY_KEY]: { version: 1, values: snapshot.values } };
  // Do not add entries for repeated tab clicks, normalization or filter edits.
  if (mode === 'push' && nextUrl !== currentUrl) window.history.pushState(state, '', nextUrl);
  else window.history.replaceState(state, '', nextUrl);
}

export function normalizeWebQueryState() {
  commit(readSnapshot(), 'replace');
}

export function readWebQueryValue(key: string): string | null {
  if (key === 'tab') return readSnapshot().tab;
  if (isQueryKey(key)) return readSnapshot().values[key] ?? null;
  return new URLSearchParams(window.location.search).get(key);
}

function updateValue(snapshot: Snapshot, key: QueryKey, value: string | null) {
  const params = new URLSearchParams();
  if (value !== null) params.set(key, value);
  const canonical = canonicalValue(key, params);
  if (canonical === null) delete snapshot.values[key];
  else snapshot.values[key] = canonical;
}

export function navigateWebQueryTab(tab: Tab, options?: { dashboardView?: 'plants' | 'lands'; mintType?: 'plant' | 'land' }) {
  const snapshot = readSnapshot();
  const previousTab = snapshot.tab;
  // Save the outgoing entry before applying target options so Back restores
  // its own selections, regardless of provider/listener mounting order.
  commit(snapshot, 'replace');
  snapshot.tab = tab;
  if (tab === 'dashboard' && options?.dashboardView !== undefined) updateValue(snapshot, 'dashboardView', options.dashboardView);
  if (tab === 'mint' && options?.mintType !== undefined) updateValue(snapshot, 'mintType', options.mintType);
  commit(snapshot, tab === previousTab ? 'replace' : 'push');
}

export function writeWebQueryValue(key: string, value: string | null, mode: 'push' | 'replace') {
  if (key === 'tab') {
    const tab = isGameTab(value) ? value : 'dashboard';
    if (mode === 'push') navigateWebQueryTab(tab);
    else commit({ ...readSnapshot(), tab }, 'replace');
    return;
  }
  if (isQueryKey(key)) {
    const snapshot = readSnapshot();
    updateValue(snapshot, key, value);
    // Hidden components can update retained state without leaking their keys
    // into the visible tab's URL or adding a history entry.
    commit(snapshot, QUERY_SCOPES[key] === snapshot.tab ? mode : 'replace');
    return;
  }
  const url = new URL(window.location.href);
  if (value === null || value === '') url.searchParams.delete(key);
  else url.searchParams.set(key, value);
  const nextUrl = `${url.pathname}${url.search}${url.hash}`;
  const state = historyStateForWrite();
  if (mode === 'push' && nextUrl !== `${window.location.pathname}${window.location.search}${window.location.hash}`) window.history.pushState(state, '', nextUrl);
  else window.history.replaceState(state, '', nextUrl);
}
