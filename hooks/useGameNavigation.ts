'use client';

import { useCallback, useEffect, useLayoutEffect, useRef } from 'react';
import { useWebQueryState } from '@/hooks/useWebQueryState';
import { GAME_NAVIGATION_EVENT, isGameTab } from '@/lib/game-navigation';
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

  // Retain inactive query keys: each view owns its key and defaults. History
  // entries then represent the complete UI state, including Back/Forward.
  useEffect(() => {
    const navigate = (event: Event) => {
      const detail: unknown = (event as CustomEvent<unknown>).detail;
      if (typeof detail === 'object' && detail !== null && 'tab' in detail && isGameTab(detail.tab)) {
        setActiveTab(detail.tab);
      }
    };
    window.addEventListener(GAME_NAVIGATION_EVENT, navigate);
    return () => window.removeEventListener(GAME_NAVIGATION_EVENT, navigate);
  }, [setActiveTab]);

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
