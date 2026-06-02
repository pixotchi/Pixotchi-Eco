"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useAccount } from "wagmi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BaseExpandedLoadingPageLoader } from "@/components/ui/loading";
import { useTabVisibility } from "@/lib/tab-visibility-context";
import { getAllActivity, getMyActivity } from "@/lib/activity-client";
import { ActivityEvent, ItemConsumedEvent, BundledItemConsumedEvent, ShopItem, GardenItem } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { ChevronLeft, ChevronRight, Terminal } from "lucide-react";
import {
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
} from "@/components/activity";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { StatusChip } from "@/components/ui/premium";
import { cn } from "@/lib/utils";
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

export default function ActivityTab() {
  const frame = useFrameContext();
  const isMiniApp = Boolean(frame?.isInMiniApp);
  const { address, isConnected } = useAccount();
  const isSolana = useIsSolanaWallet();
  const twinAddress = useTwinAddress();
  const { isTabVisible } = useTabVisibility();
  const isVisible = isTabVisible('activity');
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
  const [view, setView] = useWebQueryState<ActivityView>({
    key: "activityView",
    defaultValue: "all",
    enabled: !isMiniApp,
    parse: (rawValue) => (rawValue === "all" || rawValue === "my" ? rawValue : null),
    serialize: (value) => (value === "all" ? null : value),
  });
  const [shopItemMap, setShopItemMap] = useState<ItemMap>({});
  const [gardenItemMap, setGardenItemMap] = useState<ItemMap>({});
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
  const { shopItems, gardenItems } = useItemCatalogs();

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
          const recentActivities =
            feedView === "my" && myAddress
              ? await getMyActivity(myAddress)
              : await getAllActivity();

          return {
            feedView,
            activities: bundleItemConsumedEvents(recentActivities),
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

  useEffect(() => {
    const newShopItemMap: ItemMap = {};
    shopItems.forEach((item: ShopItem) => {
      newShopItemMap[item.id] = item.name;
    });
    setShopItemMap(newShopItemMap);

    const newGardenItemMap: ItemMap = {};
    gardenItems.forEach((item: GardenItem) => {
      newGardenItemMap[item.id] = item.name;
    });
    setGardenItemMap(newGardenItemMap);
  }, [shopItems, gardenItems]);

  // Note: Removed auto-reset effect that caused race condition when switching to 'my' view
  // The UI now handles missing wallet/address gracefully in renderContent()

  // Refresh when tab becomes visible
  useEffect(() => {
    if (!isVisible) return;

    fetchActivities();
  }, [isVisible, fetchActivities]);

  const renderActivity = (activity: ProcessedActivityEvent) => {
    switch (activity.__typename) {
      case "Attack":
        return <AttackEventRenderer key={activity.id} event={activity} userAddress={address} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap} />;
      case "Killed":
        return <KilledEventRenderer key={activity.id} event={activity} userAddress={address} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap} />;
      case "Mint":
        return <MintEventRenderer key={activity.id} event={activity} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap} />;
      case "Played":
        return <PlayedEventRenderer key={activity.id} event={activity} userAddress={address} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap} />;
      case "ItemConsumed":
        return <ItemConsumedEventRenderer key={activity.id} event={activity as BundledItemConsumedEvent} userAddress={address} itemMap={gardenItemMap} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap} />;
      case "ShopItemPurchased":
        return <ShopItemPurchasedEventRenderer key={activity.id} event={activity} userAddress={address} itemMap={shopItemMap} shopItemMap={shopItemMap} gardenItemMap={gardenItemMap} />;
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
      default:
        return null;
    }
  };

  const selectedActivities = activitiesByView[view];
  const selectedLoading = loadingByView[view];
  const selectedError = errorByView[view];
  const selectedTotalPages = Math.ceil(selectedActivities.length / ITEMS_PER_PAGE);

  const setDesktopPage = useCallback((
    feedView: ActivityView,
    nextPage: number | ((previousPage: number) => number)
  ) => {
    setDesktopPageByView(prev => ({
      ...prev,
      [feedView]: typeof nextPage === "function" ? nextPage(prev[feedView]) : nextPage,
    }));
  }, []);

  const scrollActivityToTop = useCallback(() => {
    window.requestAnimationFrame(() => {
      const contentShell = document.querySelector<HTMLElement>('[data-viewport-shell="content"]');
      contentShell?.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
  }, []);

  const renderPaginationControls = useCallback((
    activePage: number,
    totalPages: number,
    setPage: PaginationConfig["setPage"],
    className?: string
  ) => (
    <div
      className={cn(
        "sticky bottom-0 z-20 -mx-4 border-t border-border/70 bg-card/95 px-4 py-2 shadow-[0_-14px_28px_-22px_hsl(var(--foreground)/0.55)] backdrop-blur-md",
        "xl:static xl:mx-0 xl:mt-3 xl:flex-none xl:border-t xl:border-border/60 xl:bg-transparent xl:px-0 xl:pb-0 xl:pt-3 xl:shadow-none xl:backdrop-blur-none",
        className
      )}
    >
      <div className="mx-auto grid max-w-sm grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 rounded-[var(--radius-panel)] border border-border/70 bg-background/80 p-1 shadow-[var(--shadow-hairline)] xl:border-0 xl:bg-transparent xl:p-0 xl:shadow-none">
        <Button
          variant="compactUtility"
          size="touchCompact"
          onClick={() => {
            setPage(prev => Math.max(prev - 1, 1));
            scrollActivityToTop();
          }}
          disabled={activePage === 1}
          leadingIcon={<ChevronLeft className="h-4 w-4" aria-hidden="true" />}
          className="justify-center"
        >
          Back
        </Button>
        <span className="min-w-[5.5rem] text-center text-xs font-semibold tabular-nums text-muted-foreground">
          {activePage} / {totalPages}
        </span>
        <Button
          variant="compactUtility"
          size="touchCompact"
          onClick={() => {
            setPage(prev => Math.min(prev + 1, totalPages));
            scrollActivityToTop();
          }}
          disabled={activePage === totalPages}
          trailingIcon={<ChevronRight className="h-4 w-4" aria-hidden="true" />}
          className="justify-center"
        >
          Next
        </Button>
      </div>
    </div>
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

  useEffect(() => {
    setDesktopPageByView(prev => {
      let changed = false;
      const next = { ...prev };

      (["all", "my"] as ActivityView[]).forEach((feedView) => {
        const maxPage = Math.max(1, Math.ceil(activitiesByView[feedView].length / ITEMS_PER_PAGE));

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
  }, [activitiesByView]);

  const renderFeedContent = (
    feedView: ActivityView,
    activities: ProcessedActivityEvent[],
    loading: boolean,
    error: string | null,
    pagination?: PaginationConfig
  ) => {
    if (loading && activities.length === 0) {
      return (
        <div className="flex items-center justify-center py-8">
          <BaseExpandedLoadingPageLoader text="Loading activities..." />
        </div>
      );
    }

    if (error) {
      return (
        <Alert variant="destructive" className="mt-4">
          <Terminal className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      );
    }

    if (feedView === 'my' && !isWalletConnected) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <p>Connect your wallet to see your activity.</p>
        </div>
      );
    }

    if (activities.length === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <p>No recent {feedView === 'my' ? 'personal' : ''} activity found in the last 24 hours.</p>
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
      <div className="space-y-4 xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:space-y-0">
        <div className="space-y-2 divide-y divide-border/60 -mx-4 px-4 pb-16 xl:mx-0 xl:min-h-0 xl:flex-1 xl:overflow-y-auto xl:px-0 xl:pb-0 xl:pr-2">
          {visibleActivities.map(renderActivity)}
        </div>

        {pagination && totalPages > 1 && (
          renderPaginationControls(activePage, totalPages, pagination.setPage)
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4 xl:mx-auto xl:max-w-7xl">
      <Card className="xl:hidden" density="compact" surface="raised">
        <CardHeader>
          <div className="flex justify-between items-center">
            <div className="min-w-0">
              <CardTitle>Activity</CardTitle>
              <div className="mt-1">
                <StatusChip tone="info">{selectedActivities.length} events in 24h</StatusChip>
              </div>
            </div>
            <ToggleGroup
              value={view}
              onValueChange={(nextValue) => {
                if (nextValue !== "all" && nextValue !== "my") {
                  return;
                }

                if (nextValue === view) {
                  return;
                }

                setCurrentPage(1);
                setView(nextValue);
              }}
              options={[
                { value: 'all', label: 'All' },
                { value: 'my', label: 'My Activity' },
              ]}
            />
          </div>
        </CardHeader>
        <CardContent>
          {renderFeedContent(view, selectedActivities, selectedLoading, selectedError, {
            page: currentPage,
            setPage: setCurrentPage,
          })}
        </CardContent>
      </Card>

      <div className="hidden xl:grid xl:min-h-0 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)] xl:gap-5">
        <Card className="xl:flex xl:h-[calc(100dvh-7rem)] xl:flex-col" surface="raised">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>All Activity</CardTitle>
              <StatusChip tone="info">{activitiesByView.all.length} events</StatusChip>
            </div>
          </CardHeader>
          <CardContent className="xl:min-h-0 xl:flex-1">
            {renderFeedContent("all", activitiesByView.all, loadingByView.all, errorByView.all, {
              page: desktopPageByView.all,
              setPage: (nextPage) => setDesktopPage("all", nextPage),
            })}
          </CardContent>
        </Card>

        <Card className="xl:flex xl:h-[calc(100dvh-7rem)] xl:flex-col" surface="raised">
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>My Activity</CardTitle>
              <StatusChip tone={activitiesByView.my.length > 0 ? "success" : "neutral"}>{activitiesByView.my.length} events</StatusChip>
            </div>
          </CardHeader>
          <CardContent className="xl:min-h-0 xl:flex-1">
            {renderFeedContent("my", activitiesByView.my, loadingByView.my, errorByView.my, {
              page: desktopPageByView.my,
              setPage: (nextPage) => setDesktopPage("my", nextPage),
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
} 
