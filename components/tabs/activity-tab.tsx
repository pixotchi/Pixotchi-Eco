"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useAccount } from "wagmi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BaseExpandedLoadingPageLoader } from "@/components/ui/loading";
import { getAllActivity, getMyActivity } from "@/lib/activity-service";
import { ActivityEvent, ItemConsumedEvent, BundledItemConsumedEvent, ShopItem, GardenItem } from "@/lib/types";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal, User, Globe } from "lucide-react";
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
} from "@/components/activity";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { useItemCatalogs } from "@/hooks/useItemCatalogs";
import { useIsSolanaWallet, useTwinAddress } from "@/components/solana";

type ActivityView = "all" | "my";
type ItemMap = { [key: string]: string };
type ProcessedActivityEvent = Exclude<ActivityEvent, ItemConsumedEvent> | BundledItemConsumedEvent;

const ITEMS_PER_PAGE = 12;

export default function ActivityTab() {
  const { address, isConnected } = useAccount();
  const isSolana = useIsSolanaWallet();
  const twinAddress = useTwinAddress();
  const myAddress = isSolana ? twinAddress : address;
  const isWalletConnected = isConnected || (isSolana && !!twinAddress);
  const [allActivities, setAllActivities] = useState<ProcessedActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<ActivityView>("all");
  const [shopItemMap, setShopItemMap] = useState<ItemMap>({});
  const [gardenItemMap, setGardenItemMap] = useState<ItemMap>({});
  const [currentPage, setCurrentPage] = useState(1);
  const { shopItems, gardenItems, isLoading: catalogsLoading } = useItemCatalogs();

  // Request deduplication ref to prevent multiple simultaneous calls
  const fetchActivitiesPendingRef = useRef<string | null>(null);

  const bundleItemConsumedEvents = (activities: ActivityEvent[]): ProcessedActivityEvent[] => {
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
    
    // Re-sort by timestamp
    allProcessedEvents.sort((a, b) => parseInt(b.timestamp) - parseInt(a.timestamp));
    
    return allProcessedEvents;
  };

  const fetchActivities = useCallback(async () => {
    // Create a unique key for this fetch based on parameters
    const fetchKey = `${view}-${myAddress || 'all'}-${shopItems.length}-${gardenItems.length}`;

    // Prevent duplicate calls with the same parameters
    if (fetchActivitiesPendingRef.current === fetchKey) {
      return;
    }

    fetchActivitiesPendingRef.current = fetchKey;

    try {
      setLoading(true);
      setError(null);

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
      
      let recentActivities: ActivityEvent[] = [];

      if (view === "my" && myAddress) {
        recentActivities = await getMyActivity(myAddress);
      } else {
        recentActivities = await getAllActivity();
      }
      
      // Only update if parameters haven't changed during the fetch
      if (fetchActivitiesPendingRef.current === fetchKey) {
        const processedActivities = bundleItemConsumedEvents(recentActivities);
        setAllActivities(processedActivities);
        setCurrentPage(1); // Reset to first page when activities change
      }
    } catch (err) {
      console.error(err);
      // Only set error if parameters haven't changed
      if (fetchActivitiesPendingRef.current === fetchKey) {
        setError("Failed to load activities. Please try again later.");
      }
    } finally {
      // Clear pending flag only if parameters haven't changed
      if (fetchActivitiesPendingRef.current === fetchKey) {
        setLoading(false);
        fetchActivitiesPendingRef.current = null;
      }
    }
  }, [view, myAddress, shopItems, gardenItems]);

  useEffect(() => {
    if (view === 'my' && (!isWalletConnected || !myAddress)) {
      setView('all');
    } else {
      fetchActivities();
    }
  }, [view, isWalletConnected, myAddress, fetchActivities]);

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
      default:
        return null;
    }
  };

  // Calculate pagination values
  const totalItems = allActivities.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentActivities = allActivities.slice(startIndex, endIndex);

  const renderContent = () => {
    if (loading || catalogsLoading) {
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

    if (view === 'my' && !isWalletConnected) {
      return (
          <div className="text-center py-8 text-muted-foreground">
              <p>Connect your wallet to see your activity.</p>
          </div>
      );
    }

    if (totalItems === 0) {
      return (
        <div className="text-center py-8 text-muted-foreground">
          <p>No recent {view === 'my' ? 'personal' : ''} activity found in the last 24 hours.</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="space-y-2 divide-y -mx-4 px-4">
          {currentActivities.map(renderActivity)}
        </div>
        
        {totalPages > 1 && (
          <div className="flex justify-center items-center pt-4">
            <div className="flex space-x-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
                disabled={currentPage === 1}
              >
                Back
              </Button>
              <span className="flex items-center px-3 text-sm">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
                disabled={currentPage === totalPages}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <div className="flex justify-between items-center">
            <CardTitle>Activity (Last 24h)</CardTitle>
            <ToggleGroup
              value={view}
              onValueChange={(v) => setView(v as 'all' | 'my')}
              options={[
                { value: 'all', label: 'All' },
                { value: 'my', label: 'My Activity' },
              ]}
            />
          </div>
        </CardHeader>
        <CardContent>
          {renderContent()}
        </CardContent>
      </Card>
    </div>
  );
} 