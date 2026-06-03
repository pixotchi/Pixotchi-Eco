"use client";

import { useState, useEffect, useCallback, useMemo, useRef, type ReactNode } from "react";
import { useAccount } from "wagmi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BaseExpandedLoadingPageLoader } from "@/components/ui/loading";
import { useTabVisibility } from "@/lib/tab-visibility-context";
import { getAllActivity, getMyActivity } from "@/lib/activity-client";
import { ActivityEvent, ItemConsumedEvent, BundledItemConsumedEvent } from "@/lib/types";
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
    setPage: PaginationConfig["setPage"],
    className?: string
  ) => (
    <div
      className={cn(
        "flex-none border-t border-border/60 bg-card/95 pt-3",
        className
      )}
    >
      <div className="mx-auto grid max-w-xs grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2">
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
    const renderFeedState = (content: ReactNode) => (
      <div className="flex h-full min-h-0 flex-col">
        <div
          data-activity-feed-scroll
          className="min-h-0 flex-1 overflow-y-auto -mx-4 px-4 pb-3 lg:mx-0 lg:px-0 lg:pr-2"
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
      return renderFeedState(
        <div className="text-center text-muted-foreground">
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
      <div className="flex h-full min-h-0 flex-col">
        <div data-activity-feed-scroll className="min-h-0 flex-1 space-y-2 divide-y divide-border/60 overflow-y-auto -mx-4 px-4 pb-3 lg:mx-0 lg:px-0 lg:pr-2">
          {visibleActivities.map(renderActivity)}
        </div>

        {pagination && totalPages > 1 && (
          renderPaginationControls(activePage, totalPages, pagination.setPage)
        )}
      </div>
    );
  };

  return (
    <div className="h-full min-h-0 space-y-4 lg:mx-auto lg:max-w-7xl">
      <Card className="flex h-full min-h-[26rem] flex-col overflow-hidden lg:hidden" density="compact" surface="raised">
        <CardHeader className="flex-none">
          <div className="flex justify-between items-center">
            <div className="min-w-0">
              <CardTitle>Activity <span className="text-sm font-medium text-muted-foreground">(Last 24h)</span></CardTitle>
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
        <CardContent className="min-h-0 flex-1 overflow-hidden">
          {renderFeedContent(view, selectedActivities, selectedLoading, selectedError, {
            page: currentPage,
            setPage: setCurrentPage,
          })}
        </CardContent>
      </Card>

      <div className="hidden lg:grid lg:min-h-0 lg:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)] lg:gap-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(360px,0.95fr)]">
        <Card className="lg:flex lg:h-[calc(100dvh-8.25rem)] lg:flex-col xl:h-[calc(100dvh-7rem)]" surface="raised">
          <CardHeader className="flex-none">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>All Activity <span className="text-sm font-medium text-muted-foreground">(Last 24h)</span></CardTitle>
            </div>
          </CardHeader>
          <CardContent className="lg:min-h-0 lg:flex-1 lg:overflow-hidden">
            {renderFeedContent("all", activitiesByView.all, loadingByView.all, errorByView.all, {
              page: desktopPageByView.all,
              setPage: (nextPage) => setDesktopPage("all", nextPage),
            })}
          </CardContent>
        </Card>

        <Card className="lg:flex lg:h-[calc(100dvh-8.25rem)] lg:flex-col xl:h-[calc(100dvh-7rem)]" surface="raised">
          <CardHeader className="flex-none">
            <div className="flex items-center justify-between gap-3">
              <CardTitle>My Activity <span className="text-sm font-medium text-muted-foreground">(Last 24h)</span></CardTitle>
            </div>
          </CardHeader>
          <CardContent className="lg:min-h-0 lg:flex-1 lg:overflow-hidden">
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
