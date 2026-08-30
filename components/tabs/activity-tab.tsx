"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle, TabCard } from "@/components/ui/card";
import { BaseExpandedLoadingPageLoader } from "@/components/ui/loading";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { useTabVisibility } from "@/lib/tab-visibility-context";
import { getAllActivity, getMyActivity } from "@/lib/activity-client";
import {
  ACTIVITY_CATEGORY_EMPTY_LABELS,
  ACTIVITY_DIRECTION_EMPTY_LABELS,
  createActivityPerspective,
  DEFAULT_ACTIVITY_CATEGORY,
  DEFAULT_ACTIVITY_DIRECTION,
  EMPTY_ACTIVITY_PERSPECTIVE,
  filterActivityEvents,
  hasActivityPerspective,
  isDirectionalActivityCategory,
  parseActivityCategory,
  parseActivityDirection,
  resolveActivityDirection,
  type ActivityCategoryId,
  type ActivityDirectionId,
  type ActivityPerspective,
} from "@/lib/activity-filters";
import { ActivityEvent, ItemConsumedEvent, BundledItemConsumedEvent } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";
import {
  ActivityFilterBar,
  AttackEventRenderer,
  KilledEventRenderer,
  MintEventRenderer,
  PlayedEventRenderer,
  ItemConsumedEventRenderer,
  ShopItemPurchasedEventRenderer,
  LandTransferEventRenderer,
  LandMintedEventRenderer,
  LandNameChangedEventRenderer,
  VillageUpgradeEventRenderer,
  VillageSpeedUpEventRenderer,
  TownUpgradeEventRenderer,
  TownSpeedUpEventRenderer,
  QuestStartedEventRenderer,
  QuestFinalizedEventRenderer,
  VillageProductionClaimedEventRenderer,
  BarracksBuiltEventRenderer,
  BarracksRaidEventRenderer,
  CasinoBuiltEventRenderer,
  RouletteSpinResultEventRenderer,
  BlackjackResultEventRenderer,
  BaccaratRoundResultEventRenderer,
} from "@/components/activity";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { useItemCatalogs } from "@/hooks/useItemCatalogs";
import { useIsSolanaWallet, useTwinAddress } from "@/components/solana";
import { useFrameContext } from "@/lib/frame-context";
import { useWebQueryState } from "@/hooks/useWebQueryState";

type ActivityView = "all" | "my";
type ItemMap = { [key: string]: string };
type ProcessedActivityEvent = Exclude<ActivityEvent, ItemConsumedEvent> | BundledItemConsumedEvent;
type PaginationConfig = {
  page: number;
  setPage: (nextPage: number | ((previousPage: number) => number)) => void;
};
type FilterConfig = {
  category: ActivityCategoryId;
  direction: ActivityDirectionId;
  onCategoryChange: (nextCategory: ActivityCategoryId) => void;
  onDirectionChange: (nextDirection: ActivityDirectionId) => void;
  onReset: () => void;
  showDirection: boolean;
};

const ITEMS_PER_PAGE = 12;

function bundleItemConsumedEvents(activities: ActivityEvent[]): ProcessedActivityEvent[] {
  const bundledMap = new Map<string, BundledItemConsumedEvent>();
  const otherEvents: Exclude<ActivityEvent, ItemConsumedEvent>[] = [];

  activities.forEach(activity => {
    if (activity.__typename === 'ItemConsumed') {
      const key = `${activity.nftId}-${activity.timestamp}-${activity.itemId}`;

      if (bundledMap.has(key)) {
        const existing = bundledMap.get(key)!;
        existing.quantity += 1;
      } else {
        bundledMap.set(key, {
          ...activity,
          quantity: 1
        });
      }
    } else {
      otherEvents.push(activity as Exclude<ActivityEvent, ItemConsumedEvent>);
    }
  });

  const bundledEvents = Array.from(bundledMap.values());
  const allProcessedEvents = [...otherEvents, ...bundledEvents];

  allProcessedEvents.sort((a, b) => {
    const timeA = Number(a.timestamp);
    const timeB = Number(b.timestamp);
    if (isNaN(timeA) && isNaN(timeB)) return 0;
    if (isNaN(timeA)) return 1;
    if (isNaN(timeB)) return -1;
    return timeB - timeA;
  });

  return allProcessedEvents;
}

function isActivityFilterActive(category: ActivityCategoryId, direction: ActivityDirectionId): boolean {
  return category !== DEFAULT_ACTIVITY_CATEGORY || direction !== DEFAULT_ACTIVITY_DIRECTION;
}

function getEmptyFeedMessage(
  feedView: ActivityView,
  category: ActivityCategoryId,
  direction: ActivityDirectionId
): string {
  if (isDirectionalActivityCategory(category) && direction !== DEFAULT_ACTIVITY_DIRECTION) {
    return `No ${ACTIVITY_DIRECTION_EMPTY_LABELS[direction]} in the last 24 hours.`;
  }

  if (category !== DEFAULT_ACTIVITY_CATEGORY) {
    return `No recent ${ACTIVITY_CATEGORY_EMPTY_LABELS[category]} in the last 24 hours.`;
  }

  return `No recent ${feedView === 'my' ? 'personal ' : ''}activity found in the last 24 hours.`;
}

export default function ActivityTab() {
  const frame = useFrameContext();
  const isMiniApp = Boolean(frame?.isInMiniApp);
  const { address, isConnected } = useAccount();
  const isSolana = useIsSolanaWallet();
  const twinAddress = useTwinAddress();
  const { isTabVisible } = useTabVisibility();
  const isVisible = isTabVisible('activity');
  // See the 30s freshness guard on the visibility refetch effect below.
  const lastVisibleFetchRef = useRef(0);
  const myAddress = isSolana ? twinAddress : address;
  const isWalletConnected = isConnected || (isSolana && !!twinAddress);
  const [activitiesByView, setActivitiesByView] = useState<Record<ActivityView, ProcessedActivityEvent[]>>({
    all: [],
    my: [],
  });
  const [loadingByView, setLoadingByView] = useState<Record<ActivityView, boolean>>({
    all: true,
    my: false,
  });
  const [errorByView, setErrorByView] = useState<Record<ActivityView, string | null>>({
    all: null,
    my: null,
  });
  const [desktopPageByView, setDesktopPageByView] = useState<Record<ActivityView, number>>({
    all: 1,
    my: 1,
  });
  // Plant/land IDs the personal feed was scoped to, returned by /api/activity/my.
  // They let us tell an attack on the viewer from one the viewer launched. The
  // owning address is stored with them so a previous wallet's assets can never be
  // used to classify the current wallet's feed.
  const [myAssetIds, setMyAssetIds] = useState<{ address: string | null; landIds: string[]; plantIds: string[] }>({
    address: null,
    landIds: [],
    plantIds: [],
  });
  const [view, setView] = useWebQueryState<ActivityView>({
    key: "activityView",
    defaultValue: "all",
    enabled: !isMiniApp,
    parse: (rawValue) => (rawValue === "all" || rawValue === "my" ? rawValue : null),
    serialize: (value) => (value === "all" ? null : value),
  });
  const [currentPage, setCurrentPage] = useWebQueryState<number>({
    key: "activityPage",
    defaultValue: 1,
    enabled: !isMiniApp,
    parse: (rawValue) => {
      if (!rawValue) return null;
      const parsed = Number.parseInt(rawValue, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    },
    serialize: (value) => (value <= 1 ? null : value.toString()),
  });
  const [categoryFilter, setCategoryFilter] = useWebQueryState<ActivityCategoryId>({
    key: "activityFilter",
    defaultValue: DEFAULT_ACTIVITY_CATEGORY,
    enabled: !isMiniApp,
    parse: parseActivityCategory,
    serialize: (value) => (value === DEFAULT_ACTIVITY_CATEGORY ? null : value),
  });
  const [directionFilter, setDirectionFilter] = useWebQueryState<ActivityDirectionId>({
    key: "activityDirection",
    defaultValue: DEFAULT_ACTIVITY_DIRECTION,
    enabled: !isMiniApp,
    parse: parseActivityDirection,
    serialize: (value) => (value === DEFAULT_ACTIVITY_DIRECTION ? null : value),
  });
  // The desktop layout shows both feeds at once, so each column keeps its own
  // filter and page - mirroring how pagination already works here.
  const [desktopFilterByView, setDesktopFilterByView] = useState<Record<ActivityView, ActivityCategoryId>>({
    all: DEFAULT_ACTIVITY_CATEGORY,
    my: DEFAULT_ACTIVITY_CATEGORY,
  });
  const [desktopDirectionByView, setDesktopDirectionByView] = useState<Record<ActivityView, ActivityDirectionId>>({
    all: DEFAULT_ACTIVITY_DIRECTION,
    my: DEFAULT_ACTIVITY_DIRECTION,
  });
  const { shopItems, gardenItems } = useItemCatalogs();
  const shopItemMap = useMemo<ItemMap>(() => {
    const nextMap: ItemMap = {};
    shopItems.forEach((item) => {
      nextMap[item.id] = item.name;
    });
    return nextMap;
  }, [shopItems]);
  const gardenItemMap = useMemo<ItemMap>(() => {
    const nextMap: ItemMap = {};
    gardenItems.forEach((item) => {
      nextMap[item.id] = item.name;
    });
    return nextMap;
  }, [gardenItems]);

  // Request deduplication ref to prevent multiple simultaneous calls
  const fetchActivitiesPendingRef = useRef<string | null>(null);
  const activitiesByViewRef = useRef(activitiesByView);

  const fetchActivities = useCallback(async () => {
    const fetchKey = myAddress || 'public';

    if (fetchActivitiesPendingRef.current === fetchKey) {
      return;
    }

    fetchActivitiesPendingRef.current = fetchKey;

    const feedsToFetch: ActivityView[] = myAddress ? ["all", "my"] : ["all"];

    setLoadingByView(prev => ({
      all: feedsToFetch.includes("all") && activitiesByViewRef.current.all.length === 0 ? true : prev.all,
      my: feedsToFetch.includes("my") && activitiesByViewRef.current.my.length === 0 ? true : false,
    }));
    setErrorByView(prev => ({
      all: feedsToFetch.includes("all") ? null : prev.all,
      my: feedsToFetch.includes("my") ? null : prev.my,
    }));

    try {
      const results = await Promise.allSettled(
        feedsToFetch.map(async (feedView) => {
          if (feedView === "my" && myAddress) {
            const { activities, landIds, plantIds } = await getMyActivity(myAddress);
            return {
              activities: bundleItemConsumedEvents(activities),
              assetIds: { address: myAddress, landIds, plantIds },
              feedView,
            };
          }

          return {
            activities: bundleItemConsumedEvents(await getAllActivity()),
            assetIds: null,
            feedView,
          };
        })
      );

      if (fetchActivitiesPendingRef.current === fetchKey) {
        setActivitiesByView(prev => {
          const next = { ...prev };

          results.forEach((result, index) => {
            const feedView = feedsToFetch[index];
            if (result.status === "fulfilled") {
              next[feedView] = result.value.activities;
            }
          });

          return next;
        });

        results.forEach((result) => {
          if (result.status === "fulfilled" && result.value.assetIds) {
            setMyAssetIds(result.value.assetIds);
          }
        });

        setErrorByView(prev => {
          const next = { ...prev };

          results.forEach((result, index) => {
            const feedView = feedsToFetch[index];
            next[feedView] = result.status === "rejected"
              ? "Failed to load activities. Please try again later."
              : null;
          });

          return next;
        });
      }
    } catch (err) {
      console.error(err);
      if (fetchActivitiesPendingRef.current === fetchKey) {
        setErrorByView(prev => ({
          ...prev,
          all: "Failed to load activities. Please try again later.",
          my: myAddress ? "Failed to load activities. Please try again later." : prev.my,
        }));
      }
    } finally {
      if (fetchActivitiesPendingRef.current === fetchKey) {
        setLoadingByView(prev => ({
          ...prev,
          all: false,
          my: false,
        }));
        fetchActivitiesPendingRef.current = null;
      }
    }
  }, [myAddress]);

  useEffect(() => {
    activitiesByViewRef.current = activitiesByView;
  }, [activitiesByView]);

  // Note: Removed auto-reset effect that caused race condition when switching to 'my' view
  // The UI now handles missing wallet/address gracefully in renderContent()

  // Refresh when tab becomes visible
  useEffect(() => {
    if (!isVisible) return;
    if (Date.now() - lastVisibleFetchRef.current < 30_000) return;
    lastVisibleFetchRef.current = Date.now();

    fetchActivities();
  }, [isVisible, fetchActivities]);

  // Only trust the stored assets while they still belong to the connected wallet.
  const perspective = useMemo<ActivityPerspective>(
    () => (myAddress && myAssetIds.address === myAddress
      ? createActivityPerspective(myAssetIds.plantIds, myAssetIds.landIds)
      : EMPTY_ACTIVITY_PERSPECTIVE),
    [myAddress, myAssetIds]
  );
  const canFilterByDirection = hasActivityPerspective(perspective);

  const getPerspectiveForView = useCallback(
    (feedView: ActivityView) => (feedView === 'my' ? perspective : EMPTY_ACTIVITY_PERSPECTIVE),
    [perspective]
  );

  // Clear the personal feed the moment the wallet changes: the previous
  // account's rows used to keep rendering (with loading forced false because
  // the stale list was non-empty) until the new fetch resolved.
  useEffect(() => {
    setActivitiesByView((previous) => (previous.my.length ? { ...previous, my: [] } : previous));
    setLoadingByView((previous) => ({ ...previous, my: Boolean(myAddress) }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [myAddress]);

  const renderActivity = (activity: ProcessedActivityEvent) => {
    switch (activity.__typename) {
      case "Attack":
        return <AttackEventRenderer key={activity.id} event={activity} perspective={perspective} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap} />;
      case "Killed":
        return <KilledEventRenderer key={activity.id} event={activity} perspective={perspective} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap} />;
      case "Mint":
        return <MintEventRenderer key={activity.id} event={activity} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap} />;
      case "Played":
        return <PlayedEventRenderer key={activity.id} event={activity} perspective={perspective} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap} />;
      case "ItemConsumed":
        return <ItemConsumedEventRenderer key={activity.id} event={activity as BundledItemConsumedEvent} perspective={perspective} itemMap={gardenItemMap} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap} />;
      case "ShopItemPurchased":
        return <ShopItemPurchasedEventRenderer key={activity.id} event={activity} perspective={perspective} itemMap={shopItemMap} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap} />;
      // Land Event Renderers
      case "LandTransferEvent":
        return <LandTransferEventRenderer key={activity.id} event={activity} userAddress={address} />;
      case "LandMintedEvent":
        return <LandMintedEventRenderer key={activity.id} event={activity} userAddress={address} />;
      case "LandNameChangedEvent":
        return <LandNameChangedEventRenderer key={activity.id} event={activity} />;
      case "VillageUpgradedWithLeafEvent":
        return <VillageUpgradeEventRenderer key={activity.id} event={activity} userAddress={address} />;
      case "VillageSpeedUpWithSeedEvent":
        return <VillageSpeedUpEventRenderer key={activity.id} event={activity} userAddress={address} />;
      case "TownUpgradedWithLeafEvent":
        return <TownUpgradeEventRenderer key={activity.id} event={activity} userAddress={address} />;
      case "TownSpeedUpWithSeedEvent":
        return <TownSpeedUpEventRenderer key={activity.id} event={activity} userAddress={address} />;
      case "QuestStartedEvent":
        return <QuestStartedEventRenderer key={activity.id} event={activity} />;
      case "QuestFinalizedEvent":
        return <QuestFinalizedEventRenderer key={activity.id} event={activity} userAddress={address} />;
      case "VillageProductionClaimedEvent":
        return <VillageProductionClaimedEventRenderer key={activity.id} event={activity} />;
      case "BarracksBuiltEvent":
        return <BarracksBuiltEventRenderer key={activity.id} event={activity} />;
      case "BarracksRaidEvent":
        return <BarracksRaidEventRenderer key={activity.id} event={activity} />;
      // Casino Event Renderers
      case "CasinoBuiltEvent":
        return <CasinoBuiltEventRenderer key={activity.id} event={activity} userAddress={address} />;
      case "RouletteSpinResultEvent":
        return <RouletteSpinResultEventRenderer key={activity.id} event={activity} userAddress={address} />;
      case "BlackjackResultEvent":
        return <BlackjackResultEventRenderer key={activity.id} event={activity} userAddress={address} />;
      case "BaccaratRoundResultEvent":
        return <BaccaratRoundResultEventRenderer key={activity.id} event={activity} userAddress={address} />;
      default:
        return null;
    }
  };

  // Direction only applies to combat categories on a feed whose owner we know.
  const mobileDirection = resolveActivityDirection(
    categoryFilter,
    directionFilter,
    getPerspectiveForView(view)
  );
  const mobileActivities = useMemo(
    () => filterActivityEvents(activitiesByView[view], {
      category: categoryFilter,
      direction: mobileDirection,
      perspective: getPerspectiveForView(view),
    }),
    [activitiesByView, categoryFilter, getPerspectiveForView, mobileDirection, view]
  );
  const desktopAllActivities = useMemo(
    () => filterActivityEvents(activitiesByView.all, {
      category: desktopFilterByView.all,
    }),
    [activitiesByView, desktopFilterByView.all]
  );
  const desktopMyDirection = resolveActivityDirection(
    desktopFilterByView.my,
    desktopDirectionByView.my,
    perspective
  );
  const desktopMyActivities = useMemo(
    () => filterActivityEvents(activitiesByView.my, {
      category: desktopFilterByView.my,
      direction: desktopMyDirection,
      perspective,
    }),
    [activitiesByView, desktopFilterByView.my, desktopMyDirection, perspective]
  );

  const selectedLoading = loadingByView[view];
  const selectedError = errorByView[view];
  const selectedTotalPages = Math.ceil(mobileActivities.length / ITEMS_PER_PAGE);

  const setDesktopPage = useCallback((
    feedView: ActivityView,
    nextPage: number | ((previousPage: number) => number)
  ) => {
    setDesktopPageByView(prev => ({
      ...prev,
      [feedView]: typeof nextPage === "function" ? nextPage(prev[feedView]) : nextPage,
    }));
  }, []);

  const setDesktopCategory = useCallback((feedView: ActivityView, nextCategory: ActivityCategoryId) => {
    setDesktopFilterByView(prev => ({ ...prev, [feedView]: nextCategory }));
    if (!isDirectionalActivityCategory(nextCategory)) {
      setDesktopDirectionByView(prev => ({ ...prev, [feedView]: DEFAULT_ACTIVITY_DIRECTION }));
    }
    setDesktopPage(feedView, 1);
  }, [setDesktopPage]);

  const setDesktopDirection = useCallback((feedView: ActivityView, nextDirection: ActivityDirectionId) => {
    setDesktopDirectionByView(prev => ({ ...prev, [feedView]: nextDirection }));
    setDesktopPage(feedView, 1);
  }, [setDesktopPage]);

  const resetDesktopFilter = useCallback((feedView: ActivityView) => {
    setDesktopFilterByView(prev => ({ ...prev, [feedView]: DEFAULT_ACTIVITY_CATEGORY }));
    setDesktopDirectionByView(prev => ({ ...prev, [feedView]: DEFAULT_ACTIVITY_DIRECTION }));
    setDesktopPage(feedView, 1);
  }, [setDesktopPage]);

  const handleMobileCategoryChange = useCallback((nextCategory: ActivityCategoryId) => {
    setCategoryFilter(nextCategory);
    if (!isDirectionalActivityCategory(nextCategory)) {
      setDirectionFilter(DEFAULT_ACTIVITY_DIRECTION);
    }
    setCurrentPage(1);
  }, [setCategoryFilter, setCurrentPage, setDirectionFilter]);

  const handleMobileDirectionChange = useCallback((nextDirection: ActivityDirectionId) => {
    setDirectionFilter(nextDirection);
    setCurrentPage(1);
  }, [setCurrentPage, setDirectionFilter]);

  const resetMobileFilter = useCallback(() => {
    setCategoryFilter(DEFAULT_ACTIVITY_CATEGORY);
    setDirectionFilter(DEFAULT_ACTIVITY_DIRECTION);
    setCurrentPage(1);
  }, [setCategoryFilter, setCurrentPage, setDirectionFilter]);

  const scrollActivityToTop = useCallback(() => {
    window.requestAnimationFrame(() => {
      const feedScroll = document.querySelector<HTMLElement>('[data-activity-feed-scroll]');
      const fallbackShell = document.querySelector<HTMLElement>('[data-viewport-shell="content"]');
      (feedScroll ?? fallbackShell)?.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
  }, []);

  const renderPaginationControls = useCallback((
    activePage: number,
    totalPages: number,
    setPage: PaginationConfig["setPage"]
  ) => (
    <PaginationFooter
      currentPage={activePage}
      totalPages={totalPages}
      onPrevious={() => {
        setPage(prev => Math.max(prev - 1, 1));
        scrollActivityToTop();
      }}
      onNext={() => {
        setPage(prev => Math.min(prev + 1, totalPages));
        scrollActivityToTop();
      }}
    />
  ), [scrollActivityToTop]);

  useEffect(() => {
    if (selectedTotalPages === 0) {
      if (currentPage !== 1) {
        setCurrentPage(1);
      }
      return;
    }

    if (currentPage > selectedTotalPages) {
      setCurrentPage(selectedTotalPages);
    }
  }, [currentPage, selectedTotalPages, setCurrentPage]);

  const desktopTotalsByView = useMemo(() => ({
    all: desktopAllActivities.length,
    my: desktopMyActivities.length,
  }), [desktopAllActivities.length, desktopMyActivities.length]);

  useEffect(() => {
    setDesktopPageByView(prev => {
      let changed = false;
      const next = { ...prev };

      (["all", "my"] as ActivityView[]).forEach((feedView) => {
        const maxPage = Math.max(1, Math.ceil(desktopTotalsByView[feedView] / ITEMS_PER_PAGE));

        if (next[feedView] > maxPage) {
          next[feedView] = maxPage;
          changed = true;
        }

        if (next[feedView] < 1) {
          next[feedView] = 1;
          changed = true;
        }
      });

      return changed ? next : prev;
    });
  }, [desktopTotalsByView]);

  const renderFeedContent = (
    feedView: ActivityView,
    activities: readonly ProcessedActivityEvent[],
    loading: boolean,
    error: string | null,
    filter: FilterConfig,
    pagination?: PaginationConfig
  ) => {
    const renderFeedState = (content: ReactNode) => (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div
          data-activity-feed-scroll
          className="surface-scroll-area min-h-0 flex-1 overflow-y-auto rounded-[var(--radius-panel)] px-3 pb-3 pt-2 tablet:pr-3"
        >
          <div className="flex min-h-full items-center justify-center py-8">
            {content}
          </div>
        </div>
      </div>
    );

    if (loading && activities.length === 0) {
      return renderFeedState(
        <div className="text-center">
          <BaseExpandedLoadingPageLoader text="Loading activities..." />
        </div>
      );
    }

    if (error) {
      return renderFeedState(
        <Alert variant="destructive" className="w-full">
          <Terminal className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      );
    }

    if (feedView === 'my' && !isWalletConnected) {
      return renderFeedState(
        <div className="text-center text-muted-foreground">
          <p>Connect your wallet to see your activity.</p>
        </div>
      );
    }

    if (activities.length === 0) {
      const filterActive = isActivityFilterActive(filter.category, filter.direction);

      return renderFeedState(
        <div className="space-y-3 text-center text-muted-foreground">
          <p>{getEmptyFeedMessage(feedView, filter.category, filter.direction)}</p>
          {filterActive && (
            <Button
              variant="outline"
              size="touchCompact"
              onClick={filter.onReset}
              className="text-xs"
            >
              Show all activity
            </Button>
          )}
        </div>
      );
    }

    const totalPages = Math.ceil(activities.length / ITEMS_PER_PAGE);
    const activePage = pagination ? Math.min(Math.max(pagination.page, 1), Math.max(totalPages, 1)) : 1;
    const startIndex = (activePage - 1) * ITEMS_PER_PAGE;
    const visibleActivities = pagination
      ? activities.slice(startIndex, startIndex + ITEMS_PER_PAGE)
      : activities;

    return (
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div data-activity-feed-scroll className="surface-scroll-area min-h-0 flex-1 space-y-2 divide-y divide-[hsl(var(--divider)/0.62)] overflow-y-auto rounded-[var(--radius-panel)] px-3 pb-3 pt-2 tablet:pr-3">
          {visibleActivities.map(renderActivity)}
        </div>

        {pagination && totalPages > 1 && (
          renderPaginationControls(activePage, totalPages, pagination.setPage)
        )}
      </div>
    );
  };

  /*
   * Render one layout, not both.
   *
   * The mobile feed and the two-column desktop grid were both mounted and CSS hid one:
   * at 390px that left 152 of 285 nodes (53%) with a zero-size box, including a second
   * twelve-row feed and 13 of the 25 activity icons.
   *
   * The tablet classes stay as the first-frame guard for the gap between a resize
   * crossing the breakpoint and the matchMedia change event landing.
   *
   * DOM only: the fetches key off `myAddress`, and the desktop feed memos are
   * unconditional, so nothing here changes what is requested.
   */
  const [isDesktopActivity, setIsDesktopActivity] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(min-width: 54rem)').matches),
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mediaQuery = window.matchMedia('(min-width: 54rem)');
    setIsDesktopActivity(mediaQuery.matches);
    const handleChange = (event: MediaQueryListEvent) => setIsDesktopActivity(event.matches);
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  const mobileFilter: FilterConfig = {
    category: categoryFilter,
    direction: mobileDirection,
    onCategoryChange: handleMobileCategoryChange,
    onDirectionChange: handleMobileDirectionChange,
    onReset: resetMobileFilter,
    showDirection: view === 'my' && isDirectionalActivityCategory(categoryFilter) && canFilterByDirection,
  };
  const desktopAllFilter: FilterConfig = {
    category: desktopFilterByView.all,
    direction: DEFAULT_ACTIVITY_DIRECTION,
    onCategoryChange: (nextCategory) => setDesktopCategory('all', nextCategory),
    onDirectionChange: (nextDirection) => setDesktopDirection('all', nextDirection),
    onReset: () => resetDesktopFilter('all'),
    showDirection: false,
  };
  const desktopMyFilter: FilterConfig = {
    category: desktopFilterByView.my,
    direction: desktopMyDirection,
    onCategoryChange: (nextCategory) => setDesktopCategory('my', nextCategory),
    onDirectionChange: (nextDirection) => setDesktopDirection('my', nextDirection),
    onReset: () => resetDesktopFilter('my'),
    showDirection: isDirectionalActivityCategory(desktopFilterByView.my) && canFilterByDirection,
  };

  return (
    <div className="h-full min-h-0 space-y-4 tablet:mx-auto tablet:max-w-7xl">
      {!isDesktopActivity && (
      <TabCard className="flex h-full min-h-[26rem] flex-col overflow-hidden pb-4 tablet:hidden">
        <CardHeader className="flex-none">
          <div className="flex justify-between items-center gap-3">
            <div className="min-w-0">
              <CardTitle>Activity <span className="text-sm font-medium text-muted-foreground">(Last 24h)</span></CardTitle>
            </div>
            <ToggleGroup
              ariaLabel="Activity scope"
              value={view}
              onValueChange={(nextValue) => {
                if (nextValue !== "all" && nextValue !== "my") {
                  return;
                }

                if (nextValue === view) {
                  return;
                }

                // Direction needs the viewer's own assets, so it cannot survive a
                // switch to the public feed.
                if (nextValue === "all") {
                  setDirectionFilter(DEFAULT_ACTIVITY_DIRECTION);
                }

                setCurrentPage(1);
                setView(nextValue);
              }}
              options={[
                { value: 'all', label: 'All' },
                { value: 'my', label: 'Mine' },
              ]}
            />
          </div>
          <ActivityFilterBar
            category={mobileFilter.category}
            className="pt-1"
            direction={mobileFilter.direction}
            onCategoryChange={mobileFilter.onCategoryChange}
            onDirectionChange={mobileFilter.onDirectionChange}
            showDirection={mobileFilter.showDirection}
          />
        </CardHeader>
        <CardContent className="min-h-0 flex-1 overflow-visible">
          {renderFeedContent(view, mobileActivities, selectedLoading, selectedError, mobileFilter, {
            page: currentPage,
            setPage: setCurrentPage,
          })}
        </CardContent>
      </TabCard>
      )}

      {isDesktopActivity && (
      <div className="hidden tablet:grid tablet:h-full tablet:min-h-0 tablet:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] tablet:gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <TabCard className="tablet:flex tablet:h-full tablet:min-h-0 tablet:flex-col tablet:overflow-hidden">
          <CardHeader className="flex-none">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>All Activity <span className="text-sm font-medium text-muted-foreground">(Last 24h)</span></CardTitle>
            </div>
            <ActivityFilterBar
              category={desktopAllFilter.category}
              className="pt-1"
              direction={desktopAllFilter.direction}
              onCategoryChange={desktopAllFilter.onCategoryChange}
              onDirectionChange={desktopAllFilter.onDirectionChange}
              showDirection={desktopAllFilter.showDirection}
            />
          </CardHeader>
          <CardContent className="tablet:min-h-0 tablet:flex-1 tablet:overflow-visible">
            {renderFeedContent("all", desktopAllActivities, loadingByView.all, errorByView.all, desktopAllFilter, {
              page: desktopPageByView.all,
              setPage: (nextPage) => setDesktopPage("all", nextPage),
            })}
          </CardContent>
        </TabCard>

        <TabCard className="tablet:flex tablet:h-full tablet:min-h-0 tablet:flex-col tablet:overflow-hidden">
          <CardHeader className="flex-none">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>My Activity <span className="text-sm font-medium text-muted-foreground">(Last 24h)</span></CardTitle>
            </div>
            <ActivityFilterBar
              category={desktopMyFilter.category}
              className="pt-1"
              direction={desktopMyFilter.direction}
              onCategoryChange={desktopMyFilter.onCategoryChange}
              onDirectionChange={desktopMyFilter.onDirectionChange}
              showDirection={desktopMyFilter.showDirection}
            />
          </CardHeader>
          <CardContent className="tablet:min-h-0 tablet:flex-1 tablet:overflow-visible">
            {renderFeedContent("my", desktopMyActivities, loadingByView.my, errorByView.my, desktopMyFilter, {
              page: desktopPageByView.my,
              setPage: (nextPage) => setDesktopPage("my", nextPage),
            })}
          </CardContent>
        </TabCard>
      </div>
      )}
    </div>
  );
}
