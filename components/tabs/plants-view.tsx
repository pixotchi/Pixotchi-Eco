"use client";

import EditPlantName from "@/components/edit-plant-name";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { SponsoredBadge } from "@/components/paymaster-toggle";
import QuantitySelector from "@/components/quantity-selector";
import { SolanaNotSupported,useIsSolanaWallet,useTwinAddress } from "@/components/solana";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, TabCard } from "@/components/ui/card";
import { Dialog,DialogContent,DialogDescription,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import {
DropdownMenu,
DropdownMenuContent,
DropdownMenuItem,
DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AssetCarouselButton } from "@/components/ui/asset-carousel-button";
import { Input } from "@/components/ui/input";
import { BaseExpandedLoadingPageLoader } from "@/components/ui/loading";
import { StandardContainer } from "@/components/ui/pixel-container";
import { InlineBalanceNotice } from "@/components/ui/premium";
import { useItemCatalogs } from "@/hooks/useItemCatalogs";
import { ITEM_ICONS } from "@/lib/constants";
import {
getPlantsByOwner,
getRevivePrice,
getTokenBalance,
} from "@/lib/contracts";
import { usePaymaster } from "@/lib/paymaster-context";
import {
invalidateOwnerResources,
isAbortError,
onOwnerResourceInvalidation,
ownerInvalidationMatches,
retryOwnerRead,
} from "@/lib/owner-resource-invalidation";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { useTabVisibility } from "@/lib/tab-visibility-context";
import { GardenItem,Plant,ShopItem } from "@/lib/types";
import { cn,formatEth,formatScore,formatTokenAmount,getActiveFences,getPlantStatusText,getStrainName } from '@/lib/utils';
import {
ChevronDown,
Flower2
} from "lucide-react";
import Image from "next/image";
import dynamic from "next/dynamic";
import { useCallback,useEffect,useId,useLayoutEffect,useMemo,useRef,useState } from "react";
import { toast } from "react-hot-toast";
import { useAccount } from "wagmi";
import PlantImage from "../PlantImage";
import CountdownTimer from "../countdown-timer";
import FenceTimer from "../fence-timer";

const ArcadeDialog = dynamic(() => import("@/components/arcade/ArcadeDialog"), {
  ssr: false,
});
const ClaimRewardsTransaction = dynamic(() => import("@/components/transactions/claim-rewards-transaction"), {
  loading: () => <Button className="w-full" disabled>Loading...</Button>,
  ssr: false,
});
const ReviveTransaction = dynamic(() => import("@/components/transactions/revive-transaction"), {
  loading: () => <Button className="w-full" disabled>Loading...</Button>,
  ssr: false,
});
const SolanaBridgeButton = dynamic(() => import("@/components/transactions/solana-bridge-button"), {
  loading: () => <Button className="w-full" disabled>Loading...</Button>,
  ssr: false,
});
const ItemDetailsPanel = dynamic(() => import("@/components/item-details-panel"), {
  loading: () => (
    <div className="flex min-h-[16rem] items-center justify-center rounded-[var(--radius-panel)] border border-border/60 bg-card/80">
      <BaseExpandedLoadingPageLoader text="Loading marketplace..." />
    </div>
  ),
  ssr: false,
});

const DEFAULT_REVIVE_PRICE = BigInt(100) * (BigInt(10) ** BigInt(18));
// Removed BalanceCard from tabs; status bar now shows balances globally

const REWARD_VALUE_MAX_FONT_SIZE = 13;
const REWARD_VALUE_MIN_FONT_SIZE = 8;

type MarketplaceItemOption = {
  item: GardenItem | ShopItem;
  itemType: "garden" | "shop";
};

function isFenceShopItem(item: ShopItem) {
  const name = item.name.toLowerCase();
  return name.includes("fence") || name.includes("shield");
}

function FittedEthRewardValue({ amount }: { amount: string }) {
  const frameRef = useRef<HTMLDivElement | null>(null);
  const valueRef = useRef<HTMLSpanElement | null>(null);
  const [fontSize, setFontSize] = useState(REWARD_VALUE_MAX_FONT_SIZE);

  useLayoutEffect(() => {
    const frame = frameRef.current;
    const value = valueRef.current;
    if (!frame || !value) return;

    let frameId = 0;
    const measure = () => {
      const currentFontSize = Number.parseFloat(window.getComputedStyle(value).fontSize) || REWARD_VALUE_MAX_FONT_SIZE;
      const naturalWidth = value.scrollWidth * (REWARD_VALUE_MAX_FONT_SIZE / currentFontSize);
      const availableWidth = Math.max(0, frame.clientWidth - 8);
      const nextFontSize = Math.max(
        REWARD_VALUE_MIN_FONT_SIZE,
        Math.min(REWARD_VALUE_MAX_FONT_SIZE, (availableWidth / Math.max(naturalWidth, 1)) * REWARD_VALUE_MAX_FONT_SIZE)
      );
      setFontSize(Math.floor(nextFontSize * 10) / 10);
    };
    const scheduleMeasure = () => {
      cancelAnimationFrame(frameId);
      frameId = requestAnimationFrame(measure);
    };

    scheduleMeasure();
    const observer = new ResizeObserver(scheduleMeasure);
    observer.observe(frame);

    return () => {
      cancelAnimationFrame(frameId);
      observer.disconnect();
    };
  }, [amount]);

  return (
    <div ref={frameRef} className="w-full min-w-0 overflow-hidden text-center" title={`${amount} ETH`}>
      <span
        ref={valueRef}
        style={{ fontSize }}
        className="inline-flex max-w-full items-center justify-center gap-0.5 whitespace-nowrap font-bold leading-none tabular-nums"
      >
        <Image src="/icons/ethlogo.svg" alt="" aria-hidden="true" width={14} height={14} className="h-[1em] w-[1em] shrink-0" />
        <span>{amount} ETH</span>
      </span>
    </div>
  );
}

type PlantInvariant = (plants: Plant[]) => boolean;

type PlantFetchOptions = {
  force?: boolean;
  until?: PlantInvariant;
};

type QueuedPlantFetch = {
  force: boolean;
  invariants: PlantInvariant[];
};

function didPlantSnapshotChange(before: Plant, after: Plant | undefined): boolean {
  if (!after) return true;
  return (
    before.level !== after.level ||
    before.name !== after.name ||
    before.rewards !== after.rewards ||
    before.score !== after.score ||
    before.stars !== after.stars ||
    before.status !== after.status ||
    JSON.stringify(before.extensions) !== JSON.stringify(after.extensions) ||
    JSON.stringify(before.fenceV2) !== JSON.stringify(after.fenceV2)
  );
}

export default function PlantsView() {
  const { address: evmAddress } = useAccount();

  // Solana wallet support - use Twin address for Solana users
  const isSolana = useIsSolanaWallet();
  const twinAddress = useTwinAddress();

  // Use Twin address for Solana users, EVM address otherwise
  // Memoize to prevent unnecessary re-renders when dependencies haven't actually changed
  const address = useMemo(() => {
    return evmAddress || (isSolana && twinAddress ? twinAddress as `0x${string}` : undefined);
  }, [evmAddress, isSolana, twinAddress]);
  const ownerKey = address?.toLowerCase() ?? null;
  const { isSponsored } = usePaymaster();
  const { isSmartWallet, isLoading: smartWalletLoading } = useSmartWallet();
  const { isTabVisible } = useTabVisibility();
  const isVisible = isTabVisible('dashboard');
  const [plants, setPlants] = useState<Plant[]>([]);
  const [selectedPlant, setSelectedPlant] = useState<Plant | null>(null);
  const [selectedItem, setSelectedItem] = useState<ShopItem | GardenItem | null>(null);
  const { shopItems, gardenItems } = useItemCatalogs();
  const [itemType, setItemType] = useState<"shop" | "garden">("garden");

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [itemQuantities, setItemQuantities] = useState<Record<string, number>>({});
  const [claimOpen, setClaimOpen] = useState(false);
  const [arcadeOpen, setArcadeOpen] = useState(false);
  const [claimConfirmationText, setClaimConfirmationText] = useState("");
  const [revivePrice, setRevivePrice] = useState<bigint>(DEFAULT_REVIVE_PRICE);
  const [seedBalance, setSeedBalance] = useState<bigint>(BigInt(0));
  const [reviveDataLoading, setReviveDataLoading] = useState(false);
  const claimConfirmationId = useId();
  const claimConfirmationDescriptionId = `${claimConfirmationId}-description`;

  // Use ref to track selected plant ID without causing re-renders or re-fetches
  const selectedPlantIdRef = useRef<number | null>(null);
  const loadedPlantsAddressRef = useRef<string | null>(null);
  const selectedPlantId = selectedPlant?.id ?? null;
  const selectedPlantStatus = selectedPlant?.status ?? null;

  // Owner generation + abort protection prevents a late wallet-A read from
  // committing into wallet B. A queued slot preserves a refresh requested while
  // a read is already in flight instead of silently dropping it.
  const queryClient = useQueryClient();
  const ownerKeyRef = useRef<string | null>(ownerKey);
  const ownerGenerationRef = useRef(0);
  const activeFetchAbortRef = useRef<AbortController | null>(null);
  const fetchDataPendingRef = useRef<{ generation: number; ownerKey: string } | null>(null);
  const fetchDataQueuedRef = useRef<QueuedPlantFetch | null>(null);
  const lastVisibleFetchRef = useRef(0);

  const fenceStatuses = useMemo(() => {
    if (!selectedPlant) return [];
    return getActiveFences(selectedPlant);
  }, [selectedPlant]);

  const hasActiveFence = fenceStatuses.length > 0;

  const handleQuantityChange = (itemId: string, quantity: number) => {
    setItemQuantities(prev => ({
      ...prev,
      [itemId]: quantity
    }));
  };

  const getItemQuantity = useCallback((itemId: string) => {
    // For regular wallets, default to 1 for garden items since they can't change quantity
    // For smart wallets, default to 0 (user selects quantity)
    const defaultQuantity = (!isSmartWallet && !smartWalletLoading && itemType === 'garden') ? 1 : 0;
    return itemQuantities[itemId] || defaultQuantity;
  }, [isSmartWallet, smartWalletLoading, itemType, itemQuantities]);

  const fetchData = useCallback(async ({ force = false, until }: PlantFetchOptions = {}) => {
    if (!address || !ownerKey) return;

    const pending = fetchDataPendingRef.current;
    if (pending?.ownerKey === ownerKey) {
      const queued = fetchDataQueuedRef.current ?? { force: false, invariants: [] };
      queued.force ||= force;
      if (until) queued.invariants.push(until);
      fetchDataQueuedRef.current = queued;
      return;
    }

    const generation = ownerGenerationRef.current;
    const requestIdentity = { generation, ownerKey };
    const controller = new AbortController();
    activeFetchAbortRef.current?.abort();
    activeFetchAbortRef.current = controller;
    fetchDataPendingRef.current = requestIdentity;

    try {
      if (loadedPlantsAddressRef.current !== ownerKey) setLoading(true);
      setError(null);

      const plantsQueryKey = queryKeys.plantsByOwner(ownerKey);
      const readPlants = async () => {
        if (force || until) {
          await queryClient.invalidateQueries({
            exact: true,
            queryKey: plantsQueryKey,
            refetchType: "none",
          });
        }
        return queryClient.fetchQuery({
          queryKey: plantsQueryKey,
          queryFn: () => getPlantsByOwner(address),
          staleTime: force || until ? 0 : 30_000,
        });
      };

      const plantsData = until
        ? await retryOwnerRead(readPlants, { accept: until, signal: controller.signal })
        : await readPlants();

      const isCurrentOwner =
        !controller.signal.aborted &&
        ownerKeyRef.current === ownerKey &&
        ownerGenerationRef.current === generation &&
        fetchDataPendingRef.current?.generation === generation;
      if (!isCurrentOwner) return;

      setPlants(plantsData);
      if (plantsData.length > 0) {
        const currentSelectedId = selectedPlantIdRef.current;
        const freshSelection = currentSelectedId
          ? plantsData.find((plant) => plant.id === currentSelectedId)
          : null;
        const plantToSelect = freshSelection ?? plantsData[0];
        setSelectedPlant(plantToSelect);
        selectedPlantIdRef.current = plantToSelect.id;
      } else {
        setSelectedPlant(null);
        selectedPlantIdRef.current = null;
      }
      loadedPlantsAddressRef.current = ownerKey;
    } catch (err) {
      if (!isAbortError(err)) {
        console.error("Error fetching dashboard data:", err);
        if (ownerKeyRef.current === ownerKey && ownerGenerationRef.current === generation) {
          setError("Failed to load dashboard data. Please refresh.");
        }
      }
    } finally {
      const ownsPendingSlot =
        fetchDataPendingRef.current?.ownerKey === ownerKey &&
        fetchDataPendingRef.current?.generation === generation;
      if (ownsPendingSlot) {
        fetchDataPendingRef.current = null;
        setLoading(false);
        const queued = fetchDataQueuedRef.current;
        fetchDataQueuedRef.current = null;
        if (queued && ownerKeyRef.current === ownerKey) {
          const queuedInvariant = queued.invariants.length
            ? (nextPlants: Plant[]) => queued.invariants.every((invariant) => invariant(nextPlants))
            : undefined;
          queueMicrotask(() => {
            void fetchData({ force: queued.force, until: queuedInvariant });
          });
        }
      }
    }
  }, [address, ownerKey, queryClient]);

  // Clear wallet-owned state before paint on disconnect/address changes. The
  // generation and abort also make every already-running callback stale.
  useLayoutEffect(() => {
    if (ownerKeyRef.current === ownerKey) return;
    const previousOwner = ownerKeyRef.current;
    ownerKeyRef.current = ownerKey;
    ownerGenerationRef.current += 1;
    activeFetchAbortRef.current?.abort();
    activeFetchAbortRef.current = null;
    fetchDataPendingRef.current = null;
    fetchDataQueuedRef.current = null;
    lastVisibleFetchRef.current = 0;
    loadedPlantsAddressRef.current = null;
    selectedPlantIdRef.current = null;
    setPlants([]);
    setSelectedPlant(null);
    setError(null);
    setLoading(Boolean(ownerKey));
    setClaimOpen(false);
    setArcadeOpen(false);
    setClaimConfirmationText("");
    setSeedBalance(BigInt(0));
    if (previousOwner) {
      void queryClient.cancelQueries({ queryKey: queryKeys.plantsByOwner(previousOwner) });
    }
  }, [ownerKey, queryClient]);

  useEffect(() => () => activeFetchAbortRef.current?.abort(), []);

  // Sync ref when selectedPlant changes (so ref is always up to date)
  useEffect(() => {
    selectedPlantIdRef.current = selectedPlantId;
  }, [selectedPlantId]);

  // Set default selected item when catalogs are loaded
  useEffect(() => {
    if (!selectedItem) {
      if (gardenItems.length > 0) {
        setSelectedItem(gardenItems[0]);
        setItemType('garden');
      } else {
        const fenceItem = shopItems.find(isFenceShopItem);
        if (!fenceItem) return;
        setSelectedItem(fenceItem);
        setItemType('shop');
      }
    }
  }, [selectedItem, gardenItems, shopItems]);

  useEffect(() => {
    if (!selectedPlantId || selectedPlantStatus !== 4) {
      setReviveDataLoading(false);
      return;
    }

    let cancelled = false;

    const fetchReviveData = async () => {
      setReviveDataLoading(true);

      try {
        const [price, balance] = await Promise.all([
          getRevivePrice().catch(() => DEFAULT_REVIVE_PRICE),
          address ? getTokenBalance(address).catch(() => BigInt(0)) : Promise.resolve(BigInt(0)),
        ]);

        if (!cancelled) {
          setRevivePrice(price || DEFAULT_REVIVE_PRICE);
          setSeedBalance(balance || BigInt(0));
        }
      } finally {
        if (!cancelled) {
          setReviveDataLoading(false);
        }
      }
    };

    void fetchReviveData();

    return () => {
      cancelled = true;
    };
  }, [address, selectedPlantId, selectedPlantStatus]);

  // Fetch data when address changes - properly include fetchData in deps
  // Refresh when dashboard becomes visible
  // Refetch on tab visibility, but not more than once per 30s: every switch
  // back to this tab used to fire an unconditional refetch (toggling two tabs
  // twice cost ~10 network round-trips app-wide).
  useEffect(() => {
    if (isVisible && address && Date.now() - lastVisibleFetchRef.current > 30_000) {
      lastVisibleFetchRef.current = Date.now();
      void fetchData();
    }
  }, [isVisible, address, fetchData]);

  useEffect(() => {
    const unsubscribe = onOwnerResourceInvalidation((detail) => {
      if (!ownerInvalidationMatches(detail, ownerKey, "plants")) return;
      if (detail.clear) {
        ownerGenerationRef.current += 1;
        activeFetchAbortRef.current?.abort();
        activeFetchAbortRef.current = null;
        fetchDataPendingRef.current = null;
        fetchDataQueuedRef.current = null;
        loadedPlantsAddressRef.current = null;
        selectedPlantIdRef.current = null;
        setPlants([]);
        setSelectedPlant(null);
        setLoading(false);
        setError(null);
        setClaimOpen(false);
        setArcadeOpen(false);
        return;
      }
      // Local mutation callbacks below already enqueue a stronger invariant.
      if (detail.source?.startsWith("plants-view:")) return;

      const expected = detail.expected;
      const baseline = [...plants];
      const baselineById = new Map(baseline.map((plant) => [plant.id, plant]));
      const hasExplicitExpectation = Boolean(
        expected?.plantCountAtLeast !== undefined ||
        expected?.plantIdsAbsent?.length ||
        expected?.plantIdsPresent?.length
      );
      const shouldObserveMutation = Boolean(
        detail.transactionHash ||
        detail.source?.includes("arcade") ||
        detail.source?.includes("mint") ||
        detail.source?.includes("transfer")
      );
      const until = hasExplicitExpectation || shouldObserveMutation
        ? (nextPlants: Plant[]) => {
            const ids = new Set(nextPlants.map((plant) => plant.id));
            if (expected?.plantCountAtLeast !== undefined && nextPlants.length < expected.plantCountAtLeast) return false;
            if (expected?.plantIdsPresent?.some((id) => !ids.has(id))) return false;
            if (expected?.plantIdsAbsent?.some((id) => ids.has(id))) return false;
            if (hasExplicitExpectation) return true;
            if (nextPlants.length !== baseline.length) return true;
            if (baseline.some((plant) => !ids.has(plant.id))) return true;
            return nextPlants.some((plant) => didPlantSnapshotChange(baselineById.get(plant.id) ?? plant, plant));
          }
        : undefined;

      void fetchData({ force: detail.force, until });
    });
    return unsubscribe;
  }, [fetchData, ownerKey, plants]);

  const lastLifecycleReconcileRef = useRef(0);
  useEffect(() => {
    if (!address || !isVisible) return;
    const reconcile = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      const now = Date.now();
      if (now - lastLifecycleReconcileRef.current < 15_000) return;
      lastLifecycleReconcileRef.current = now;
      void fetchData({ force: true });
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") reconcile();
    };
    window.addEventListener("focus", reconcile);
    window.addEventListener("online", reconcile);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("focus", reconcile);
      window.removeEventListener("online", reconcile);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [address, fetchData, isVisible]);

  const onPurchaseSuccess = useCallback(() => {
    toast.success("Purchase successful! Updating plant data...");
    const baseline = selectedPlant;
    const quantity = selectedItem ? getItemQuantity(selectedItem.id) : 1;
    const gardenItem = itemType === "garden" ? selectedItem as GardenItem | null : null;
    const until = baseline
      ? (nextPlants: Plant[]) => {
          const updated = nextPlants.find((plant) => plant.id === baseline.id);
          if (!updated) return false;
          if (gardenItem) {
            const pointsDelta = Math.max(0, Number(gardenItem.points || 0) * Math.max(1, quantity));
            const lifetimeDelta = Math.max(0, Number(gardenItem.timeExtension || 0) * Math.max(1, quantity));
            if (pointsDelta > 0 && updated.score >= baseline.score + pointsDelta) return true;
            if (lifetimeDelta > 0 && updated.timeUntilStarving > baseline.timeUntilStarving) return true;
          }
          return didPlantSnapshotChange(baseline, updated);
        }
      : undefined;

    invalidateOwnerResources({
      address: ownerKey,
      domains: ["plants", "balances"],
      source: "plants-view:purchase",
    });
    void fetchData({ force: true, until });
  }, [fetchData, itemType, ownerKey, selectedItem, selectedPlant, getItemQuantity]);

  const reconcileClaimSuccess = useCallback((message: string) => {
    const baseline = selectedPlant;
    setClaimOpen(false);
    setClaimConfirmationText("");
    toast.success(message);
    invalidateOwnerResources({
      address: ownerKey,
      domains: ["plants", "balances"],
      source: "plants-view:claim",
    });
    void fetchData({
      force: true,
      until: baseline
        ? (nextPlants) => {
            const updated = nextPlants.find((plant) => plant.id === baseline.id);
            return Boolean(updated && (
              updated.rewards < baseline.rewards ||
              updated.score < baseline.score ||
              updated.level < baseline.level
            ));
          }
        : undefined,
    });
  }, [fetchData, ownerKey, selectedPlant]);

  const reconcileReviveSuccess = useCallback(() => {
    const revivedPlantId = selectedPlant?.id;
    toast.success("You revived your plant.");
    invalidateOwnerResources({
      address: ownerKey,
      domains: ["plants", "balances"],
      source: "plants-view:revive",
    });
    void fetchData({
      force: true,
      until: revivedPlantId === undefined
        ? undefined
        : (nextPlants) => nextPlants.some(
            (plant) => plant.id === revivedPlantId && plant.status !== 4,
          ),
    });
  }, [fetchData, ownerKey, selectedPlant?.id]);

  const renderNoPlantsView = () => (
    <EmptyState
      className="min-h-[60dvh]"
      icon={Flower2}
      title="No Plants Yet!"
      description="Go to the Mint tab to grow your first plant."
    />
  );

  // Only block render if we have NO plants data at all
  // If we have plants, we show them (Activity API maintains state) and update silently
  // Catalogs loading shouldn't block the main view either
  if (loading && plants.length === 0) {
    // Skeleton shaped like the real layout below (a TabCard wrapping an
    // aspect-square plant stage, then the name and action rows), so the content
    // does not jump when it resolves. A centred logo loader in a short box
    // resolving into a several-hundred-pixel card shifted the whole page.
    return (
      <div className="space-y-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading Farm...</span>
        <TabCard>
          <CardContent className="space-y-4">
            <Skeleton className="aspect-square w-full rounded-[var(--radius-panel)]" />
            <Skeleton className="mx-auto h-6 w-40" />
            <Skeleton className="mx-auto h-4 w-56" />
            <div className="grid grid-cols-2 gap-2 pt-1">
              <Skeleton className="h-14 w-full" />
              <Skeleton className="h-14 w-full" />
            </div>
          </CardContent>
        </TabCard>
      </div>
    );
  }
  if (error) return <Card><CardContent className="py-4 text-center text-destructive">{error}</CardContent></Card>;
  if (plants.length === 0) return renderNoPlantsView();

  return (
    <div className="space-y-4">
      {selectedPlant && (
        <div
          className={
            selectedPlant.status === 4
              ? "space-y-4 tablet:mx-auto tablet:grid tablet:w-full tablet:max-w-[980px] tablet:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] tablet:items-start tablet:justify-center tablet:gap-5 tablet:space-y-0 xl:grid-cols-[minmax(320px,420px)_minmax(360px,520px)]"
              : "space-y-4 tablet:mx-auto tablet:grid tablet:w-full tablet:max-w-[1100px] tablet:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] tablet:items-start tablet:justify-center tablet:gap-5 tablet:space-y-0 xl:grid-cols-[minmax(320px,420px)_minmax(500px,640px)]"
          }
        >
          <div className="space-y-4 tablet:sticky tablet:top-0">
          {plants.length > 1 && (
            <TabCard>
              <CardHeader><CardTitle>Select Plant</CardTitle></CardHeader>
              <CardContent>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      {selectedPlant ? (
                        <div className="flex min-w-0 items-center space-x-2">
                          <PlantImage selectedPlant={selectedPlant} width={24} height={24} />
                          <span className="truncate font-pixel">{selectedPlant.name || `Plant #${selectedPlant.id}`}</span>
                        </div>
                      ) : "Select a Plant"}
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] max-h-60 overflow-y-auto">
                    {plants.map((plant) => (
                      <DropdownMenuItem key={plant.id} onSelect={() => setSelectedPlant(plant)}>
                        <div className="flex min-w-0 items-center space-x-2">
                          <PlantImage selectedPlant={plant} width={24} height={24} />
                          <span className="truncate"><span className="font-pixel">{plant.name || `Plant #${plant.id}`}</span> (Lvl {plant.level})</span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardContent>
            </TabCard>
          )}
          {/* Plant "Screen" Display */}
          <TabCard>
            <CardContent className="p-4 space-y-3">
              {/* Main image container with stats overlay */}
              <div className="relative w-full aspect-square overflow-hidden rounded-[var(--radius-panel)] border border-border/45 bg-card bg-[image:var(--gradient-creature-stage)] surface-shadow-raised">
                <div className="pointer-events-none absolute inset-x-8 bottom-8 h-10 rounded-[50%] bg-[hsl(var(--scene-floor)/0.46)] blur-xl" />

                {/* Top corners: points and stars */}
                <div className="absolute left-3 right-3 top-3 z-20 flex items-start justify-between gap-2 text-[11px] font-bold text-foreground/80 sm:text-sm">
                  <div className="flex min-h-7 max-w-[48%] items-center gap-1 whitespace-nowrap rounded-[calc(var(--radius-control)-0.25rem)] border border-border/35 bg-card/75 px-2 py-1 shadow-[var(--shadow-hairline)] backdrop-blur-md">
                    <Image src="/icons/pts.svg" alt="Points" width={16} height={16} className="h-4 w-4 shrink-0" />
                    <span className="truncate">{formatScore(selectedPlant.score)} PTS</span>
                  </div>
                  <div className="flex min-h-7 max-w-[48%] items-center gap-1 whitespace-nowrap rounded-[calc(var(--radius-control)-0.25rem)] border border-border/35 bg-card/75 px-2 py-1 shadow-[var(--shadow-hairline)] backdrop-blur-md">
                    <Image src="/icons/Star.svg" alt="Stars" width={16} height={16} className="h-4 w-4 shrink-0" />
                    <span className="truncate">{selectedPlant.stars}</span>
                  </div>
                </div>

                {/* Center: Plant Image - restore previous inner padding */}
                <div className="absolute inset-6 sm:inset-8 flex items-center justify-center z-10">
                  <div className="relative">
                    <PlantImage selectedPlant={selectedPlant} width={180} height={180} priority={true} />
                    {hasActiveFence && (
                      <div className="absolute top-0 right-0 z-10">
                        <Image src="/icons/Shield.png" alt="Shield" width={28} height={28} className="h-7 w-7" title="Fence protection active" />
                      </div>
                    )}
                  </div>
                </div>

                {/* Next/Previous controls for multiple plants */}
                {plants.length > 1 && (
                  <>
                    <AssetCarouselButton
                      onClick={() => {
                        const idx = selectedPlant ? plants.findIndex(p => p.id === selectedPlant.id) : -1;
                        if (idx >= 0) {
                          const nextIndex = (idx - 1 + plants.length) % plants.length;
                          setSelectedPlant(plants[nextIndex]);
                        }
                      }}
                      direction="previous"
                      label="Previous plant"
                      title="Previous"
                    />
                    <AssetCarouselButton
                      onClick={() => {
                        const idx = selectedPlant ? plants.findIndex(p => p.id === selectedPlant.id) : -1;
                        if (idx >= 0) {
                          const nextIndex = (idx + 1) % plants.length;
                          setSelectedPlant(plants[nextIndex]);
                        }
                      }}
                      direction="next"
                      label="Next plant"
                      title="Next"
                    />
                  </>
                )}

                {/* Bottom Status Bar - Timer and Health */}
                <div className="absolute bottom-3 left-3 right-3 z-20">
                  <div className="flex justify-between items-end text-sm font-bold text-foreground/80">
                    {/* Bottom-left: Timers */}
                    <div className="flex flex-col justify-start gap-1">
                      {/* Fence Timer (if active) */}
                      {hasActiveFence && (
                        <div className="flex flex-col gap-1">
                          {fenceStatuses.map((fence) => (
                            <div key={`${fence.type}-${fence.effectUntil}`} className="flex min-h-7 items-center gap-1 rounded-[calc(var(--radius-control)-0.25rem)] border border-border/35 bg-card/75 px-2 py-1 shadow-[var(--shadow-hairline)] backdrop-blur-md">
                              <FenceTimer effectUntil={fence.effectUntil} noBackground={true} className="text-sm" label={fence.type} />
                            </div>
                          ))}
                        </div>
                      )}
                      {/* TOD Timer */}
                      <div className="flex min-h-7 items-center gap-1 rounded-[calc(var(--radius-control)-0.25rem)] border border-border/35 bg-card/75 px-2 py-1 shadow-[var(--shadow-hairline)] backdrop-blur-md">
                        <CountdownTimer timeUntilStarving={selectedPlant.timeUntilStarving} noBackground={true} className="text-sm" />
                      </div>
                    </div>
                    {/* Bottom-right: Health Status */}
                    <div className="flex justify-end">
                      <div className="flex min-h-7 items-center gap-1 rounded-[calc(var(--radius-control)-0.25rem)] border border-border/35 bg-card/75 px-2 py-1 shadow-[var(--shadow-hairline)] backdrop-blur-md">
                        <Image
                          src={selectedPlant.status === 4 ? "/icons/skull.png" : "/icons/HEART.svg"}
                          alt={selectedPlant.status === 4 ? "Dead" : "Health"}
                          width={16}
                          height={16}
                          className="w-4 h-4 object-contain"
                        />
                        <span>{getPlantStatusText(selectedPlant.status)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Plant Name and Strain */}
              <div className="text-center">
                <div className="inline-flex max-w-full items-center justify-center gap-1">
                  <span className="w-7 shrink-0" aria-hidden="true" />
                  <h3 className="min-w-0 truncate font-pixel text-lg">{selectedPlant.name || `Plant #${selectedPlant.id}`}</h3>
                  <EditPlantName
                    plant={selectedPlant}
                    onNameChanged={(plantId, newName) => {
                      // Update the selected plant name locally
                      setSelectedPlant(prev => prev ? { ...prev, name: newName } : null);
                      // Update the plants array
                      setPlants(prev => prev.map(p =>
                        p.id === plantId ? { ...p, name: newName } : p
                      ));
                    }}
                    iconSize={18}
                    className="h-11 min-h-11 w-11 min-w-11 shrink-0"
                  />
                </div>
                <div className="mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  <span className="inline-flex items-center gap-1 font-semibold text-foreground/80">
                    <Image src="/icons/level.svg" alt="" width={14} height={14} className="h-3.5 w-3.5" aria-hidden="true" />
                    LVL {selectedPlant.level}
                  </span>
                  <span aria-hidden="true">•</span>
                  <span>{getStrainName(selectedPlant.strain)}</span>
                  {selectedPlant.timePlantBorn && (
                    <>
                      <span aria-hidden="true">•</span>
                      <span>Planted {new Date(Number(selectedPlant.timePlantBorn) * 1000).toLocaleDateString()}</span>
                    </>
                  )}
                </div>
              </div>

              {/* Actions Section: Unclaimed Rewards + Arcade */}
              <div className="pt-3 border-t border-border">
                <div className="grid grid-cols-2 gap-2">
                  {/* Claim Rewards (half width) */}
                  <Button
                    type="button"
                    variant="ghost"
                    className="group h-auto min-h-0 w-full justify-stretch rounded-[var(--radius-panel)] bg-transparent p-0 text-left hover:bg-transparent"
                    onClick={() => {
                      if (!selectedPlant || Number(selectedPlant.rewards) <= 0) {
                        toast.error('No rewards to claim');
                        return;
                      }
                      setClaimOpen(true);
                    }}
                    title={`${formatEth(selectedPlant.rewards)} ETH rewards`}
                    aria-label={`Claim ${formatEth(selectedPlant.rewards)} ETH rewards`}
                  >
                    <StandardContainer className="surface-control flex min-h-[3.25rem] w-full min-w-0 flex-col items-center justify-center gap-1 overflow-hidden px-2 py-1.5 text-center transition-[filter] group-hover:brightness-105 sm:min-h-[3.5rem]">
                      <p className="text-xs font-semibold leading-tight">Rewards</p>
                      <FittedEthRewardValue amount={formatEth(selectedPlant.rewards)} />
                    </StandardContainer>
                  </Button>

                  {/* Arcade Games (half width) */}
                  <Button
                    type="button"
                    variant="ghost"
                    className="group h-auto min-h-0 w-full justify-stretch rounded-[var(--radius-panel)] bg-transparent p-0 text-left hover:bg-transparent"
                    onClick={() => setArcadeOpen(true)}
                    title="Arcade games"
                    aria-label="Open arcade games"
                  >
                    <StandardContainer className="surface-control flex min-h-[3.25rem] w-full min-w-0 items-center justify-center gap-1.5 px-1.5 py-1.5 transition-[filter] group-hover:brightness-105 min-[360px]:gap-2 min-[360px]:px-2 sm:min-h-[3.5rem]">
                      <Image src="/icons/GAME.png" alt="Arcade" width={22} height={22} className="h-5 w-5 shrink-0 min-[360px]:h-[22px] min-[360px]:w-[22px]" />
                      <div className="min-w-0 max-w-full">
                        <p className="text-xs font-semibold leading-tight">Arcade</p>
                        <p className="whitespace-normal text-[11px] font-bold leading-tight min-[360px]:text-xs">Play games</p>
                      </div>
                    </StandardContainer>
                  </Button>
                </div>
              </div>
            </CardContent>
          </TabCard>

          {/* Claim Rewards Dialog */}
          {claimOpen && (
            <Dialog open={claimOpen} onOpenChange={(open) => {
              setClaimOpen(open);
              if (!open) {
                setClaimConfirmationText(""); // Reset confirmation text when dialog closes
              }
            }}>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Claim ETH Rewards?</DialogTitle>
                  <DialogDescription>
                    Confirm this irreversible claim. Your current points will be burned and this plant will reset to level 0.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-3 text-sm text-muted-foreground">
                  <p id={claimConfirmationDescriptionId}>Claiming rewards will burn your current points and reset this plant&apos;s level to 0.</p>
                  <div className="flex items-center gap-2 font-medium text-foreground">
                    <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                    <span>{formatEth(selectedPlant.rewards)} ETH</span>
                  </div>
                  <div className="space-y-2 pt-2">
                    <label htmlFor={claimConfirmationId} className="text-sm font-medium text-foreground">
                      Type <strong>CONFIRM</strong> to claim:
                    </label>
                    <Input
                      id={claimConfirmationId}
                      aria-describedby={claimConfirmationDescriptionId}
                      value={claimConfirmationText}
                      onChange={(e) => setClaimConfirmationText(e.target.value)}
                      placeholder="CONFIRM"
                      className="font-mono"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3 pt-2">
                  <Button variant="outline" className="flex-1" onClick={() => {
                    setClaimOpen(false);
                    setClaimConfirmationText("");
                  }}>Cancel</Button>
                  <div className="flex-1">
                    {isSolana ? (
                      <SolanaBridgeButton
                        actionType="claimRewards"
                        plantId={selectedPlant.id}
                        buttonText="Yes, Claim"
                        buttonClassName="w-full"
                        disabled={Number(selectedPlant.rewards) <= 0 || claimConfirmationText !== "CONFIRM"}
                        onSuccess={() => {
                          reconcileClaimSuccess("Rewards claimed via bridge!");
                        }}
                        onError={() => {
                          toast.error('Claim failed');
                        }}
                      />
                    ) : (
                      <ClaimRewardsTransaction
                        plantId={selectedPlant.id}
                        buttonText="Yes, Claim"
                        buttonClassName="w-full"
                        disabled={Number(selectedPlant.rewards) <= 0 || claimConfirmationText !== "CONFIRM"}
                        minimal
                        onSuccess={() => {
                          reconcileClaimSuccess("Rewards claimed!");
                        }}
                        onError={() => {
                          toast.error('Claim failed');
                        }}
                      />
                    )}
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          )}

          {/* Arcade Dialog */}
          {arcadeOpen && (
            <ArcadeDialog
              open={arcadeOpen}
              onOpenChange={setArcadeOpen}
              plant={selectedPlant}
            />
          )}

          </div>

          <div className="min-w-0 tablet:w-full">
          {/* Items / Revive Section */}
          {selectedPlant.status === 4 ? (
            <TabCard className="tablet:w-full">
              <CardHeader>
                <CardTitle>Revive Plant</CardTitle>
              </CardHeader>
              <CardContent className="pt-1">
                <div className="grid grid-cols-1 gap-4">
                  <StandardContainer className="p-3 bg-destructive/10">
                    <div className="flex items-start space-x-2">
                      <Image
                        src="/icons/skull.png"
                        alt="Dead plant"
                        width={16}
                        height={16}
                        className="mt-0.5 h-4 w-4 flex-shrink-0 object-contain"
                      />
                      <div className="text-sm text-foreground">
                        <div className="font-medium">This plant is dead</div>
                        <div className="text-xs mt-1">
                          Revive it to restore marketplace access and continue caring for it from the farm tab.
                        </div>
                      </div>
                    </div>
                  </StandardContainer>

                  <div className="chromatic-white-surface space-y-4 rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-4 shadow-[var(--shadow-hairline)]">
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Revive cost</span>
                      <span className="font-semibold text-foreground">
                        {reviveDataLoading ? "Loading..." : `${formatTokenAmount(revivePrice)} SEED`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between text-sm">
                      <span className="text-muted-foreground">Your SEED balance</span>
                      <span className="font-semibold text-foreground">
                        {reviveDataLoading ? "Loading..." : `${formatTokenAmount(seedBalance)} SEED`}
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-medium">Confirm Revive</span>
                      <SponsoredBadge show={isSponsored && isSmartWallet && !isSolana} />
                    </div>
                    {isSolana ? (
                      <SolanaNotSupported feature="Revive action" />
                    ) : (
                      <>
                        <ReviveTransaction
                          plantId={selectedPlant.id}
                          buttonText={
                            reviveDataLoading
                              ? "Checking Revive Cost"
                              : seedBalance < revivePrice
                                ? "Insufficient SEED"
                                : "Revive Plant"
                          }
                          buttonClassName="w-full"
                          disabled={reviveDataLoading || seedBalance < revivePrice}
                          onSuccess={() => {
                            reconcileReviveSuccess();
                          }}
                          onError={() => {
                            toast.error('Revive failed');
                          }}
                        />
                        {seedBalance < revivePrice && !reviveDataLoading && (
                          <InlineBalanceNotice>
                            Not enough SEED. Balance: {formatTokenAmount(seedBalance)} • Required: {formatTokenAmount(revivePrice)}
                          </InlineBalanceNotice>
                        )}
                      </>
                    )}
                  </div>
                </div>
              </CardContent>
            </TabCard>
          ) : (
            <TabCard className="tablet:h-fit tablet:w-full">
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>Marketplace</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 tablet:grid-cols-[minmax(220px,260px)_minmax(0,340px)] tablet:items-start tablet:justify-center">
                  {/* Item Selection with Quantity - Grouped by category */}
                  <div className="space-y-2">
                    {(() => {
                      const todItems: MarketplaceItemOption[] = gardenItems
                        .filter((item: GardenItem) => Number(item.timeExtension) > 0 && Number(item.points) === 0)
                        .map((item) => ({ item, itemType: "garden" as const }));
                      const ptsItems: MarketplaceItemOption[] = gardenItems
                        .filter((item: GardenItem) => Number(item.points) > 0 && Number(item.timeExtension) === 0)
                        .map((item) => ({ item, itemType: "garden" as const }));
                      const hybridItems: MarketplaceItemOption[] = gardenItems
                        .filter((item: GardenItem) => Number(item.points) > 0 && Number(item.timeExtension) > 0)
                        .map((item) => ({ item, itemType: "garden" as const }));
                      const fenceItem = shopItems.find(isFenceShopItem);

                      if (fenceItem) {
                        hybridItems.splice(Math.min(2, hybridItems.length), 0, {
                          item: fenceItem,
                          itemType: "shop" as const,
                        });
                      }

                      const renderItemGroup = (items: MarketplaceItemOption[], label: string) => {
                        if (items.length === 0) return null;
                        return (
                          <div key={label} className="space-y-1.5">
                            <div className="flex items-center justify-center gap-2">
                              <div className="h-px w-14 shrink-0 bg-border/50" />
                              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">{label}</span>
                              <div className="h-px w-14 shrink-0 bg-border/50" />
                            </div>
                            <div className={items.length === 4 ? "grid grid-cols-4 gap-1.5" : "grid grid-cols-3 gap-2"}>
                              {items.map(({ item, itemType: optionItemType }) => {
                                const quantity = getItemQuantity(item.id);
                                const isSelected = selectedItem?.id === item.id && itemType === optionItemType;
                                return (
                                  <div key={`${optionItemType}-${item.id}`} className="space-y-1">
                                    <div className="flex justify-center">
                                      <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        onClick={() => {
                                          setSelectedItem(item);
                                          setItemType(optionItemType);
                                        }}
                                        className={cn(
                                          "h-14 min-h-14 w-14 min-w-14 rounded-[var(--radius-control)] border p-0 transition-[background-color,border-color,box-shadow]",
                                          isSelected
                                            ? "border-primary bg-primary/10 shadow-[0_0_0_2px_hsl(var(--primary)/0.14)]"
                                            : "border-border/45 bg-card/70 hover:border-primary/35 hover:bg-[hsl(var(--nav-hover-bg))]"
                                        )}
                                        aria-label={`Select ${item.name}`}
                                        aria-pressed={isSelected}
                                      >
                                        <div className="flex h-12 w-12 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] p-2">
                                          <Image src={ITEM_ICONS[item.name.toLowerCase()] || '/icons/BEE.png'} alt={item.name} width={32} height={32} />
                                        </div>
                                      </Button>
                                    </div>
                                    {optionItemType === "garden" && isSmartWallet && (
                                      <div className="flex justify-center">
                                        <QuantitySelector
                                          quantity={quantity}
                                          onQuantityChange={(newQuantity) => {
                                            handleQuantityChange(item.id, newQuantity);
                                            setSelectedItem(item);
                                            setItemType("garden");
                                          }}
                                          max={80}
                                          min={0}
                                          size={items.length === 4 ? "xs" : "sm"}
                                        />
                                      </div>
                                    )}
                                    {optionItemType === "garden" && !smartWalletLoading && !isSmartWallet && (
                                      <div className="flex justify-center">
                                        <div className="text-xs text-muted-foreground px-2 py-1">
                                          Qty: 1
                                        </div>
                                      </div>
                                    )}
                                    {optionItemType === "shop" && (
                                      <div className="flex justify-center">
                                        <div className="max-w-16 truncate px-2 py-1 text-center text-xs font-medium text-muted-foreground">
                                          {item.name}
                                        </div>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      };

                      return (
                        <div className="space-y-2">
                          {renderItemGroup(todItems, 'Lifetime Hours (TOD)')}
                          {renderItemGroup(ptsItems, 'Points (PTS)')}
                          {renderItemGroup(hybridItems, 'Hybrid')}
                        </div>
                      );
                    })()}
                  </div>

                  {/* Item Details and Purchase */}
                  <ItemDetailsPanel
                    selectedItem={selectedItem}
                    selectedPlant={selectedPlant}
                    itemType={itemType}
                    onPurchaseSuccess={onPurchaseSuccess}
                    quantity={selectedItem ? getItemQuantity(selectedItem.id) : 0}
                  />
                </div>
              </CardContent>
            </TabCard>
          )}
          </div>
        </div>
      )}
    </div>
  );
}
