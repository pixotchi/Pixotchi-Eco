'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useWebQueryState, WEB_QUERY_STATE_EVENT } from '@/hooks/useWebQueryState';
import { GAME_NAVIGATION_EVENT, isGameTab } from '@/lib/game-navigation';
import { navigateWebQueryTab } from '@/lib/web-query-state';
import type { Tab } from '@/lib/types';

export function useGameNavigation(isMiniApp: boolean) {
  const [activeTab, setActiveTab] = useWebQueryState<Tab>({
    key: 'tab', defaultValue: 'dashboard', enabled: !isMiniApp, history: 'push',
    parse: (value) => isGameTab(value) ? value : null,
    serialize: (value) => value === 'dashboard' ? null : value,
  });
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const positions = useRef<Partial<Record<Tab, number>>>({});
  const visibleTab = useRef(activeTab);

  // Apply the tab and its destination view in one history entry. Inactive
  // selections live in history state, while only the current tab is in the URL.
  useEffect(() => {
    const navigate = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (typeof detail === 'object' && detail !== null && 'tab' in detail && isGameTab(detail.tab)) {
        if (isMiniApp) {
          setActiveTab(detail.tab);
        } else {
          navigateWebQueryTab(detail.tab, {
            dashboardView: 'dashboardView' in detail && (detail.dashboardView === 'plants' || detail.dashboardView === 'lands') ? detail.dashboardView : undefined,
            mintType: 'mintType' in detail && (detail.mintType === 'plant' || detail.mintType === 'land') ? detail.mintType : undefined,
          });
          window.dispatchEvent(new Event(WEB_QUERY_STATE_EVENT));
        }
      }
    };
    window.addEventListener(GAME_NAVIGATION_EVENT, navigate);
    return () => window.removeEventListener(GAME_NAVIGATION_EVENT, navigate);
  }, [isMiniApp, setActiveTab]);

  const onContentScroll = useCallback(() => {
    const scroller = contentScrollRef.current;
    if (scroller) positions.current[visibleTab.current] = scroller.scrollTop;
  }, []);

  useLayoutEffect(() => {
    visibleTab.current = activeTab;
    contentScrollRef.current?.scrollTo({ top: positions.current[activeTab] ?? 0, left: 0, behavior: 'auto' });
  }, [activeTab]);

  return { activeTab, setActiveTab, contentScrollRef, onContentScroll };
}
