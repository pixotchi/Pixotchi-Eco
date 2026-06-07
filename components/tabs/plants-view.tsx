"use client";

import ArcadeDialog from "@/components/arcade/ArcadeDialog";
import EditPlantName from "@/components/edit-plant-name";
import { SponsoredBadge } from "@/components/paymaster-toggle";
import QuantitySelector from "@/components/quantity-selector";
import { SolanaNotSupported,useIsSolanaWallet,useTwinAddress } from "@/components/solana";
import ClaimRewardsTransaction from "@/components/transactions/claim-rewards-transaction";
import ReviveTransaction from "@/components/transactions/revive-transaction";
import SolanaBridgeButton from "@/components/transactions/solana-bridge-button";
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
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { useTabVisibility } from "@/lib/tab-visibility-context";
import { GardenItem,Plant,ShopItem } from "@/lib/types";
import { cn,formatEth,formatScore,formatTokenAmount,getActiveFences,getPlantStatusText,getStrainName } from '@/lib/utils';
import {
ChevronDown,
Flower2
} from "lucide-react";
import Image from "next/image";
import { useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState } from "react";
import { toast } from "react-hot-toast";
import { useAccount } from "wagmi";
import PlantImage from "../PlantImage";
import CountdownTimer from "../countdown-timer";
import FenceTimer from "../fence-timer";
import ItemDetailsPanel from "../item-details-panel";

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

  // Use ref to track selected plant ID without causing re-renders or re-fetches
  const selectedPlantIdRef = useRef<number | null>(null);
  const loadedPlantsAddressRef = useRef<string | null>(null);
  const selectedPlantId = selectedPlant?.id ?? null;
  const selectedPlantStatus = selectedPlant?.status ?? null;

  // Request deduplication ref to prevent multiple simultaneous calls
  const fetchDataPendingRef = useRef<string | null>(null);

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

  const getItemQuantity = (itemId: string) => {
    // For regular wallets, default to 1 for garden items since they can't change quantity
    // For smart wallets, default to 0 (user selects quantity)
    const defaultQuantity = (!isSmartWallet && !smartWalletLoading && itemType === 'garden') ? 1 : 0;
    return itemQuantities[itemId] || defaultQuantity;
  };

  const fetchData = useCallback(async () => {
    if (!address) {
      fetchDataPendingRef.current = null;
      loadedPlantsAddressRef.current = null;
      return;
    }

    // Prevent duplicate calls for the same address
    if (fetchDataPendingRef.current === address) {
      return;
    }

    fetchDataPendingRef.current = address;

    try {
      // Only show full page loader on initial load for this wallet.
      if (loadedPlantsAddressRef.current !== address) {
        setLoading(true);
      }
      setError(null);

      const plantsData = await getPlantsByOwner(address);

      // Only update if address hasn't changed during the fetch
      if (fetchDataPendingRef.current === address) {
        setPlants(plantsData);

        // After refetching, try to find the previously selected plant in the new data
        // Use ref to get the current selected ID without causing dependency issues
        if (plantsData.length > 0) {
          const currentSelectedId = selectedPlantIdRef.current;
          const newSelectedPlant = currentSelectedId
            ? plantsData.find(p => p.id === currentSelectedId)
            : null;
          // Always update with fresh data - either preserve selection or select first
          const plantToSelect = newSelectedPlant || plantsData[0];
          setSelectedPlant(plantToSelect);
          // Update ref to match the selected plant
          selectedPlantIdRef.current = plantToSelect.id;
        } else {
          setSelectedPlant(null);
          selectedPlantIdRef.current = null;
        }
        loadedPlantsAddressRef.current = address;
      }
    } catch (err) {
      console.error("Error fetching dashboard data:", err);
      // Only set error if address hasn't changed
      if (fetchDataPendingRef.current === address) {
        setError("Failed to load dashboard data. Please refresh.");
      }
    } finally {
      // Clear pending flag only if address hasn't changed
      if (fetchDataPendingRef.current === address) {
        setLoading(false);
        fetchDataPendingRef.current = null;
      }
    }
  }, [address]); // Selection and initial-load state are handled through refs.

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
  useEffect(() => {
    if (isVisible && address) {
      fetchData();
    }
  }, [isVisible, address, fetchData]);

  const onPurchaseSuccess = useCallback(() => {
    toast.success("Purchase successful! Updating plant data...");
    fetchData(); // Refetch all data
    // Manually trigger a balance refresh across the app
    window.dispatchEvent(new Event('balances:refresh'));
  }, [fetchData]);

  const renderNoPlantsView = () => (
    <div className="flex flex-col items-center justify-center h-[60vh] text-center p-4">
      <div className="w-24 h-24 bg-muted rounded-full flex items-center justify-center mb-4">
        <Flower2 className="w-12 h-12 text-muted-foreground" />
      </div>
      <h3 className="text-lg font-semibold text-foreground mb-2">
        No Plants Yet!
      </h3>
      <p className="text-muted-foreground">
        Head over to the &apos;Mint&apos; tab to grow your first plant.
      </p>
    </div>
  );

  // Only block render if we have NO plants data at all
  // If we have plants, we show them (Activity API maintains state) and update silently
  // Catalogs loading shouldn't block the main view either
  if (loading && plants.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <BaseExpandedLoadingPageLoader text="Loading dashboard..." />
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
              ? "space-y-4 min-[54rem]:mx-auto min-[54rem]:grid min-[54rem]:w-full min-[54rem]:max-w-[980px] min-[54rem]:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] min-[54rem]:items-start min-[54rem]:justify-center min-[54rem]:gap-5 min-[54rem]:space-y-0 xl:grid-cols-[minmax(320px,420px)_minmax(360px,520px)]"
              : "space-y-4 min-[54rem]:mx-auto min-[54rem]:grid min-[54rem]:w-full min-[54rem]:max-w-[1100px] min-[54rem]:grid-cols-[minmax(300px,380px)_minmax(0,1fr)] min-[54rem]:items-start min-[54rem]:justify-center min-[54rem]:gap-5 min-[54rem]:space-y-0 xl:grid-cols-[minmax(320px,420px)_minmax(500px,640px)]"
          }
        >
          <div className="space-y-4 min-[54rem]:sticky min-[54rem]:top-0">
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
                        <Image src="/icons/Shield.svg" alt="Shield" width={28} height={28} className="h-7 w-7" title="Fence protection active" />
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
                <p>Claiming rewards will burn your current points and reset this plant&apos;s level to 0.</p>
                <div className="flex items-center gap-2 font-medium text-foreground">
                  <Image src="/icons/ethlogo.svg" alt="ETH" width={16} height={16} />
                  <span>{formatEth(selectedPlant.rewards)} ETH</span>
                </div>
                <div className="space-y-2 pt-2">
                  <p className="text-sm font-medium text-foreground">Type <strong>CONFIRM</strong> to claim:</p>
                  <Input
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
                        setClaimOpen(false);
                        setClaimConfirmationText("");
                        toast.success('Rewards claimed via bridge!');
                        fetchData();
                        window.dispatchEvent(new Event('balances:refresh'));
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
                        setClaimOpen(false);
                        setClaimConfirmationText("");
                        toast.success('Rewards claimed!');
                        fetchData();
                        window.dispatchEvent(new Event('balances:refresh'));
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

          {/* Arcade Dialog */}
          <ArcadeDialog
            open={arcadeOpen}
            onOpenChange={setArcadeOpen}
            plant={selectedPlant}
          />

          </div>

          <div className="min-w-0 min-[54rem]:w-full">
          {/* Items / Revive Section */}
          {selectedPlant.status === 4 ? (
            <TabCard className="min-[54rem]:w-full">
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
                            toast.success('You revived your plant.');
                            fetchData();
                            window.dispatchEvent(new Event('balances:refresh'));
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
            <TabCard className="min-[54rem]:h-fit min-[54rem]:w-full">
              <CardHeader>
                <div className="flex justify-between items-center">
                  <CardTitle>Marketplace</CardTitle>
                </div>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 gap-4 min-[54rem]:grid-cols-[minmax(220px,260px)_minmax(0,340px)] min-[54rem]:items-start min-[54rem]:justify-center">
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
