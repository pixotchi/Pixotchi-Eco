import type { Tab } from '@/lib/types';

export const GAME_TABS: readonly Tab[] = ['dashboard', 'mint', 'activity', 'leaderboard', 'swap', 'about'];
export const GAME_NAVIGATION_EVENT = 'pixotchi:navigate-game';

export function isGameTab(value: unknown): value is Tab {
  return typeof value === 'string' && GAME_TABS.some((tab) => tab === value);
}

/** Navigate through the shell on both URL-backed web and local Mini App surfaces. */
export function navigateToGameTab(tab: Tab, options?: { dashboardView?: 'plants' | 'lands'; mintType?: 'plant' | 'land' }) {
  window.dispatchEvent(new CustomEvent(GAME_NAVIGATION_EVENT, { detail: { tab, ...options } }));
}
