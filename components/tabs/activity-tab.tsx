"use client";

import { useRef, useEffect, useCallback, useMemo, type ReactNode } from "react";
import { useActivityFeeds } from "@/hooks/useActivityFeeds";
import { useActivityViewState } from "@/hooks/useActivityViewState";
import { ScrollArea } from "@/components/ui/scroll-area";
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
  WarehouseAssignmentEventRenderer,
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
import { TABLET_MEDIA_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { cn } from "@/lib/utils";
import { ActivityIdentityContext } from "@/components/activity/event-renderers";
import { ActivityRowBoundary } from "@/components/activity/activity-row-boundary";

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
  const usesCompactPageScroll = useMediaQuery("(max-width: 53.99rem) and (max-height: 700px)");
  const myAddress = isSolana ? twinAddress : address;
  const isWalletConnected = isConnected || (isSolana && !!twinAddress);
  const { activitiesByView, loadingByView, errorByView, lastSuccessByView, myAssetIds, refresh } = useActivityFeeds({
    owner: myAddress ?? null,
    visible: isVisible,
    loadAll: getAllActivity,
    loadMy: getMyActivity,
    transform: bundleItemConsumedEvents,
  });
  const feedRefs = useRef<Record<ActivityView, HTMLDivElement | null>>({ all: null, my: null });
  const feedRefCallbacks = useMemo(() => ({
    all: (node: HTMLDivElement | null) => { feedRefs.current.all = node; },
    my: (node: HTMLDivElement | null) => { feedRefs.current.my = node; },
  }), []);
  const { feeds, setPage, setCategory, setDirection, reset } = useActivityViewState(!isMiniApp);
  const [view, setView] = useWebQueryState<ActivityView>({
    key: "activityView",
    defaultValue: "all",
    enabled: !isMiniApp,
    parse: (rawValue) => (rawValue === "all" || rawValue === "my" ? rawValue : null),
    serialize: (value) => (value === "all" ? null : value),
  });
  const { page: currentPage, category: categoryFilter, direction: directionFilter } = feeds[view];
  const setCurrentPage = useCallback((next: number | ((previous: number) => number)) => setPage(view, next), [setPage, view]);
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
        return <LandTransferEventRenderer key={activity.id} event={activity} userAddress={myAddress} />;
      case "LandMintedEvent":
        return <LandMintedEventRenderer key={activity.id} event={activity} userAddress={myAddress} />;
      case "LandNameChangedEvent":
        return <LandNameChangedEventRenderer key={activity.id} event={activity} />;
      case "VillageUpgradedWithLeafEvent":
        return <VillageUpgradeEventRenderer key={activity.id} event={activity} userAddress={myAddress} />;
      case "VillageSpeedUpWithSeedEvent":
        return <VillageSpeedUpEventRenderer key={activity.id} event={activity} userAddress={myAddress} />;
      case "TownUpgradedWithLeafEvent":
        return <TownUpgradeEventRenderer key={activity.id} event={activity} userAddress={myAddress} />;
      case "TownSpeedUpWithSeedEvent":
        return <TownSpeedUpEventRenderer key={activity.id} event={activity} userAddress={myAddress} />;
      case "QuestStartedEvent":
        return <QuestStartedEventRenderer key={activity.id} event={activity} />;
      case "QuestFinalizedEvent":
        return <QuestFinalizedEventRenderer key={activity.id} event={activity} userAddress={myAddress} />;
      case "VillageProductionClaimedEvent":
        return <VillageProductionClaimedEventRenderer key={activity.id} event={activity} />;
      case "WarehouseAssignmentEvent":
        return <WarehouseAssignmentEventRenderer key={activity.id} event={activity} />;
      case "BarracksBuiltEvent":
        return <BarracksBuiltEventRenderer key={activity.id} event={activity} />;
      case "BarracksRaidEvent":
        return <BarracksRaidEventRenderer key={activity.id} event={activity} />;
      // Casino Event Renderers
      case "CasinoBuiltEvent":
        return <CasinoBuiltEventRenderer key={activity.id} event={activity} userAddress={myAddress} />;
      case "RouletteSpinResultEvent":
        return <RouletteSpinResultEventRenderer key={activity.id} event={activity} userAddress={myAddress} />;
      case "BlackjackResultEvent":
        return <BlackjackResultEventRenderer key={activity.id} event={activity} userAddress={myAddress} />;
      case "BaccaratRoundResultEvent":
        return <BaccaratRoundResultEventRenderer key={activity.id} event={activity} userAddress={myAddress} />;
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
      category: feeds.all.category,
    }),
    [activitiesByView, feeds.all.category]
  );
  const desktopMyDirection = resolveActivityDirection(
    feeds.my.category,
    feeds.my.direction,
    perspective
  );
  const desktopMyActivities = useMemo(
    () => filterActivityEvents(activitiesByView.my, {
      category: feeds.my.category,
      direction: desktopMyDirection,
      perspective,
    }),
    [activitiesByView, feeds.my.category, desktopMyDirection, perspective]
  );

  const selectedLoading = loadingByView[view];
  const selectedError = errorByView[view];
  const scrollActivityToTop = useCallback((feedView: ActivityView) => {
    window.requestAnimationFrame(() => {
      const feedScroll = feedRefs.current[feedView];
      const fallbackShell = feedScroll?.closest<HTMLElement>('[data-viewport-shell="content"]');
      const scrollOwner = usesCompactPageScroll ? fallbackShell : (feedScroll ?? fallbackShell);
      scrollOwner?.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
  }, [usesCompactPageScroll]);

  const renderPaginationControls = useCallback((
    feedView: ActivityView,
    activePage: number,
    totalPages: number,
    setPage: PaginationConfig["setPage"]
  ) => (
    <PaginationFooter
      currentPage={activePage}
      totalPages={totalPages}
      onPrevious={() => {
        setPage(prev => Math.max(prev - 1, 1));
        scrollActivityToTop(feedView);
      }}
      onNext={() => {
        setPage(prev => Math.min(prev + 1, totalPages));
        scrollActivityToTop(feedView);
      }}
    />
  ), [scrollActivityToTop]);

  const desktopTotalsByView = useMemo(() => ({
    all: desktopAllActivities.length,
    my: desktopMyActivities.length,
  }), [desktopAllActivities.length, desktopMyActivities.length]);

  useEffect(() => {
    (["all", "my"] as ActivityView[]).forEach(feedView => {
      // A deep link is not out of range until a successful response proves it.
      if (!lastSuccessByView[feedView] || loadingByView[feedView] || errorByView[feedView]) return;
      const maxPage = Math.max(1, Math.ceil(desktopTotalsByView[feedView] / ITEMS_PER_PAGE));
      if (feeds[feedView].page > maxPage) setPage(feedView, maxPage);
    });
  }, [desktopTotalsByView, errorByView, feeds, lastSuccessByView, loadingByView, setPage]);

  const renderFeedContent = (
    feedView: ActivityView,
    activities: readonly ProcessedActivityEvent[],
    loading: boolean,
    error: string | null,
    filter: FilterConfig,
    pagination?: PaginationConfig,
    usePageScroll = false,
  ) => {
    const refreshNotice = error && activitiesByView[feedView].length > 0 ? (
      <Alert variant="warning" role="status">
        <AlertTitle>Showing saved activity</AlertTitle>
        <AlertDescription>
          The latest update failed. {lastSuccessByView[feedView] && <>Last updated {new Date(lastSuccessByView[feedView]!).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</>}
        </AlertDescription>
        <Button variant="outline" size="touchCompact" className="mt-2" onClick={() => void refresh()}>Retry activity</Button>
      </Alert>
    ) : null;
    const renderFeedState = (content: ReactNode) => (
      <div className={cn("flex min-h-0 flex-col gap-3", usePageScroll ? "h-auto" : "h-full")}>
        {refreshNotice}
        <ScrollArea
          ref={feedRefCallbacks[feedView]}
          data-activity-feed-scroll
          className={cn(
            "min-h-0 rounded-[var(--radius-panel)] px-3 pb-3 pt-2 tablet:pr-3",
            usePageScroll ? "flex-none overflow-visible" : "flex-1 overflow-y-auto",
          )}
        >
          <div className="flex min-h-full items-center justify-center py-8">
            {content}
          </div>
        </ScrollArea>
      </div>
    );

    if (loading && activities.length === 0) {
      return renderFeedState(
        <div className="text-center">
          <BaseExpandedLoadingPageLoader text="Loading activities..." />
        </div>
      );
    }

    if (error && activitiesByView[feedView].length === 0) {
      return renderFeedState(
        <Alert variant="destructive" className="w-full">
          <Terminal className="h-4 w-4" />
          <AlertTitle>Activity could not load</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
          <Button variant="outline" size="touchCompact" className="mt-3" onClick={() => void refresh()}>Retry activity</Button>
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
      <div className={cn("flex min-h-0 flex-col gap-3", usePageScroll ? "h-auto" : "h-full")}>
        {refreshNotice}
        <ScrollArea
          ref={feedRefCallbacks[feedView]}
          data-activity-feed-scroll
          className={cn(
            "min-h-0 space-y-2 divide-y divide-[hsl(var(--divider)/0.62)] rounded-[var(--radius-panel)] px-3 pb-3 pt-2 tablet:pr-3",
            usePageScroll ? "flex-none overflow-visible" : "flex-1 overflow-y-auto",
          )}
        >
          <ActivityIdentityContext.Provider value={perspective}>
            {visibleActivities.map(activity => <ActivityRowBoundary key={activity.id} record={activity}>{renderActivity(activity)}</ActivityRowBoundary>)}
          </ActivityIdentityContext.Provider>
        </ScrollArea>

        {pagination && totalPages > 1 && (
          renderPaginationControls(feedView, activePage, totalPages, pagination.setPage)
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
  const isDesktopActivity = useMediaQuery(TABLET_MEDIA_QUERY);

  const mobileFilter: FilterConfig = {
    category: categoryFilter,
    direction: mobileDirection,
    onCategoryChange: next => setCategory(view, next),
    onDirectionChange: next => setDirection(view, next),
    onReset: () => reset(view),
    showDirection: view === 'my' && isDirectionalActivityCategory(categoryFilter) && canFilterByDirection,
  };
  const desktopAllFilter: FilterConfig = {
    category: feeds.all.category,
    direction: DEFAULT_ACTIVITY_DIRECTION,
    onCategoryChange: (nextCategory) => setCategory('all', nextCategory),
    onDirectionChange: (nextDirection) => setDirection('all', nextDirection),
    onReset: () => reset('all'),
    showDirection: false,
  };
  const desktopMyFilter: FilterConfig = {
    category: feeds.my.category,
    direction: desktopMyDirection,
    onCategoryChange: (nextCategory) => setCategory('my', nextCategory),
    onDirectionChange: (nextDirection) => setDirection('my', nextDirection),
    onReset: () => reset('my'),
    showDirection: isDirectionalActivityCategory(feeds.my.category) && canFilterByDirection,
  };

  return (
    <div className={cn("min-h-0 space-y-4 tablet:mx-auto tablet:h-full tablet:max-w-7xl", usesCompactPageScroll ? "h-auto" : "h-full")}>
      {!isDesktopActivity && (
      <TabCard
        /* No outer pb-4: it stacked on the inner p-4 and left a 16px dead band
           between the pagination footer surface and the card edge. */
        className={cn(
          "flex flex-col tablet:hidden",
          usesCompactPageScroll
            ? "h-auto min-h-0 overflow-visible"
            : "h-full min-h-[26rem] overflow-hidden",
        )}
      >
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
        <CardContent className={cn("min-h-0 overflow-visible", usesCompactPageScroll ? "flex-none" : "flex-1")}>
          {renderFeedContent(view, mobileActivities, selectedLoading, selectedError, mobileFilter, {
            page: currentPage,
            setPage: setCurrentPage,
          }, usesCompactPageScroll)}
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
              page: feeds.all.page,
              setPage: (nextPage) => setPage("all", nextPage),
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
              page: feeds.my.page,
              setPage: (nextPage) => setPage("my", nextPage),
            })}
          </CardContent>
        </TabCard>
      </div>
      )}
    </div>
  );
}
