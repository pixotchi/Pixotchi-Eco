"use client";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Card, CardContent, CardHeader, CardTitle, TabCard } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { AssetCarouselButton } from "@/components/ui/asset-carousel-button";
import {
DropdownMenu,
DropdownMenuContent,
DropdownMenuItem,
DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BaseExpandedLoadingPageLoader } from "@/components/ui/loading";
import {
barracksGetLandStateV2,
casinoIsBuilt,
checkLandSpeedUpApproval,
checkLeafTokenApproval,
getLandById,
getLandsByOwner,
getTownBuildingsByLandId,
getVillageBuildingsByLandId
} from "@/lib/contracts";
import { CLIENT_ENV } from "@/lib/env-config";
import { BuildingData,BuildingType,Land } from "@/lib/types";
import { formatXP } from "@/lib/utils";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback,useEffect,useRef,useState } from "react";
import { useAccount,useWatchBlockNumber } from "wagmi";
// Removed BalanceCard from tabs; status bar now shows balances globally
import BuildingGrid from "@/components/building-grid";
import { EditLandName } from "@/components/edit-land-name";
import { SolanaNotSupported,useIsSolanaWallet } from "@/components/solana";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { useLandMap } from "@/hooks/useLandMap";
import { ChevronDown,LandPlot } from "lucide-react";
import LandImage from "../LandImage";

import { useSmartWallet } from "@/lib/smart-wallet-context";
import { useTabVisibility } from "@/lib/tab-visibility-context";
import { useDocumentVisible } from "@/hooks/useDocumentVisible";
import { DESKTOP_MEDIA_QUERY, useMediaQuery } from "@/hooks/useMediaQuery";
import { dispatchPostTransactionRefresh, POST_TRANSACTION_REFRESH_DELAYS_MS } from "@/lib/transaction-refresh";

// Each inline panel reserves space while its chunk loads; without a fallback
// the section collapsed to zero height and popped in (visible layout jump).
const dynamicPanelFallback = () => (
  <div className="min-h-24 animate-pulse rounded-[var(--radius-panel)] border border-[hsl(var(--edge-panel))] bg-card/60" aria-hidden="true" />
);
const BatchClaimCard = dynamic(() => import("@/components/transactions/batch-claim-card"), {
  loading: dynamicPanelFallback,
  ssr: false,
});
const BatchQuestStartCard = dynamic(() => import("@/components/transactions/batch-quest-start-card"), {
  loading: dynamicPanelFallback,
  ssr: false,
});
const BuildingDetailsPanel = dynamic(() => import("@/components/building-details-panel"), {
  loading: dynamicPanelFallback,
  ssr: false,
});
const LandMapModal = dynamic(() => import("@/components/map/land-map-modal").then((mod) => mod.LandMapModal), {
  ssr: false,
});

const BARRACKS_ENABLED = CLIENT_ENV.BARRACKS_ENABLED;
const CASINO_ENABLED = CLIENT_ENV.CASINO_ENABLED;
const LAND_SELECTION_STORAGE_KEY = 'pixotchi:selected-land-id';
const BUILDING_TYPE_STORAGE_KEY = 'pixotchi:selected-building-type';
const BUILDING_ID_STORAGE_KEY = 'pixotchi:selected-building-id';
type LandUtilityPanel = 'batch-claim' | 'batch-quests';

function readStoredBigInt(key: string): bigint | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(key);
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function readStoredNumber(key: string): number | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readStoredBuildingType(): BuildingType {
  if (typeof window === 'undefined') return 'village';
  return window.localStorage.getItem(BUILDING_TYPE_STORAGE_KEY) === 'town' ? 'town' : 'village';
}

/**
 * A grid tile for a cross-land utility panel, rendered alongside the real
 * buildings. Markup mirrors BuildingItem in building-grid.tsx (including its
 * denseLabels variant) so utility tiles line up with buildings on every layout.
 */
function UtilityBuildingTile({
  ariaLabel,
  denseLabels = false,
  glyph,
  label,
  onSelect,
  selected,
  sublabel,
}: {
  ariaLabel: string;
  denseLabels?: boolean;
  glyph: string;
  label: string;
  onSelect: () => void;
  selected: boolean;
  sublabel: string;
}) {
  return (
    <div className={`${denseLabels ? 'w-20 min-w-0 ' : ''}space-y-1`}>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={onSelect}
          aria-label={ariaLabel}
          aria-pressed={selected}
          className={`building-button building-element rounded-[var(--radius-control)] border p-0 transition-[background-color,border-color,box-shadow] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 ring-offset-background ${selected ? 'border-primary/45 bg-primary/10 bg-[image:var(--gradient-selection)] shadow-[var(--shadow-glow)]' : 'border-border/45 bg-card/75 surface-shadow hover:border-primary/35 hover:bg-[hsl(var(--nav-hover-bg))]'}`}
        >
          <div className="building-element relative flex h-16 w-16 items-center justify-center rounded-[calc(var(--radius-control)-0.125rem)] p-2">
            <span
              className={`font-pixel text-[1.35rem] leading-none tracking-normal ${selected ? 'text-primary' : 'text-foreground/80'}`}
              aria-hidden="true"
            >
              {glyph}
            </span>
          </div>
        </button>
      </div>
      <div className={`${denseLabels ? 'min-w-0 ' : ''}text-center`}>
        <div
          className={denseLabels
            ? "min-h-[1.75rem] text-[11px] font-semibold leading-tight [overflow-wrap:anywhere]"
            : "text-xs font-semibold truncate"
          }
          title={label}
        >
          {label}
        </div>
        <div className={denseLabels ? "text-[11px] leading-tight text-muted-foreground" : "text-xs text-muted-foreground"}>
          {sublabel}
        </div>
      </div>
    </div>
  );
}

export default function LandsView() {
  // Gate: Solana wallets cannot use Land features
  const isSolana = useIsSolanaWallet();

  if (isSolana) {
    return (
      <div className="p-4">
        <SolanaNotSupported feature="Land NFTs and building management" />
      </div>
    );
  }

  return <LandsViewContent />;
}

function LandsViewContent() {
  const { address } = useAccount();
  useSmartWallet();
  const [lands, setLands] = useState<Land[]>([]);
  const [selectedLand, setSelectedLand] = useState<Land | null>(null);
  const { isTabVisible } = useTabVisibility();
  const isVisible = isTabVisible('dashboard');
  // See the 30s freshness guard on the visibility refetch effect below.
  const lastVisibleFetchRef = useRef(0);
  const isDocumentVisible = useDocumentVisible();
  // Real gate for the duplicated grids below (the CSS classes remain as the
  // first-frame guard between a resize and this state syncing).
  const isDesktopLand = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const [isMapOpen, setIsMapOpen] = useState(false);

  // Map data hook
  const { totalSupply, neighborData } = useLandMap(lands);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Building management state
  const [buildingType, setBuildingType] = useState<BuildingType>(() => readStoredBuildingType());
  const [villageBuildings, setVillageBuildings] = useState<BuildingData[]>([]);
  const [townBuildings, setTownBuildings] = useState<BuildingData[]>([]);
  const [selectedBuilding, setSelectedBuilding] = useState<BuildingData | null>(null);
  const [selectedUtilityPanel, setSelectedUtilityPanel] = useState<LandUtilityPanel | null>(null);
  const selectedLandId = selectedLand?.tokenId ?? null;
  const selectedBuildingId = selectedBuilding?.id ?? null;
  const [buildingsLoading, setBuildingsLoading] = useState(false);
  const [currentBlock, setCurrentBlock] = useState<bigint>(BigInt(0));
  // Remember last selected building id to persist across land switches
  const lastSelectedBuildingIdRef = useRef<number | null>(readStoredNumber(BUILDING_ID_STORAGE_KEY));

  // Request deduplication refs to prevent multiple simultaneous calls
  const fetchDataPendingRef = useRef<string | null>(null);
  const fetchApprovalStatusPendingRef = useRef<string | null>(null);
  const fetchBuildingDataPendingRef = useRef<bigint | null>(null);
  const fetchBuildingDataQueuedRef = useRef(false);

  // Token approval state for land interactions
  const [leafAllowance, setLeafAllowance] = useState<bigint>(BigInt(0));
  const [seedAllowance, setSeedAllowance] = useState<bigint>(BigInt(0));

  // Fetch land contract approval status (LEAF + SEED)
  const fetchApprovalStatus = useCallback(async () => {
    if (!address) {
      setLeafAllowance(BigInt(0));
      setSeedAllowance(BigInt(0));
      fetchApprovalStatusPendingRef.current = null;
      return;
    }

    // Prevent duplicate calls for the same address
    if (fetchApprovalStatusPendingRef.current === address) {
      return;
    }

    fetchApprovalStatusPendingRef.current = address;

    try {
      const [currentLeafAllowance, currentSeedAllowance] = await Promise.all([
        checkLeafTokenApproval(address),
        checkLandSpeedUpApproval(address),
      ]);
      // Only update if address hasn't changed during the fetch
      if (fetchApprovalStatusPendingRef.current === address) {
        setLeafAllowance(currentLeafAllowance);
        setSeedAllowance(currentSeedAllowance);
      }
    } catch (error) {
      console.error("Failed to fetch land token approval status:", error);
      // Only set error if address hasn't changed
      if (fetchApprovalStatusPendingRef.current === address) {
        setLeafAllowance(BigInt(0));
        setSeedAllowance(BigInt(0));
      }
    } finally {
      // Clear pending flag only if address hasn't changed
      if (fetchApprovalStatusPendingRef.current === address) {
        fetchApprovalStatusPendingRef.current = null;
      }
    }
  }, [address]);

  const fetchData = useCallback(async () => {
    if (!address) {
      fetchDataPendingRef.current = null;
      return;
    }

    // Prevent duplicate calls for the same address
    if (fetchDataPendingRef.current === address) {
      return;
    }

    fetchDataPendingRef.current = address;

    // Only show full page loader on initial load
    if (lands.length === 0) {
      setLoading(true);
    }
    setError(null);

    try {
      const landsData = await getLandsByOwner(address);

      // Only update if address hasn't changed during the fetch
      if (fetchDataPendingRef.current === address) {
        setLands(landsData);

        if (landsData.length > 0) {
          const currentSelectedId = selectedLand?.tokenId;
          const storedSelectedId = readStoredBigInt(LAND_SELECTION_STORAGE_KEY);
          const preferredSelectedId = currentSelectedId ?? storedSelectedId;
          const newSelectedLand = landsData.find(p => p.tokenId === preferredSelectedId);
          setSelectedLand(newSelectedLand || landsData[0]);
        } else {
          setSelectedLand(null);
        }
      }
    } catch (err) {
      console.error("Error fetching lands data:", err);
      // Only set error if address hasn't changed
      if (fetchDataPendingRef.current === address) {
        setError("Failed to load your lands. Please try again.");
      }
    } finally {
      // Clear pending flag only if address hasn't changed
      if (fetchDataPendingRef.current === address) {
        setLoading(false);
        fetchDataPendingRef.current = null;
      }
    }
  }, [address, selectedLand?.tokenId, lands.length]);

  const fetchBuildingData = useCallback(async () => {
    if (selectedLandId == null) {
      setVillageBuildings([]);
      setTownBuildings([]);
      setSelectedBuilding(null);
      setSelectedUtilityPanel(null);
      fetchBuildingDataPendingRef.current = null;
      fetchBuildingDataQueuedRef.current = false;
      return;
    }

    const landId = selectedLandId;

    // Prevent duplicate calls for the same land
    if (fetchBuildingDataPendingRef.current === landId) {
      fetchBuildingDataQueuedRef.current = true;
      return;
    }

    fetchBuildingDataPendingRef.current = landId;
    setBuildingsLoading(true);

    try {
      const [villageData, townData, barracksState, casinoBuilt] = await Promise.all([
        getVillageBuildingsByLandId(landId),
        getTownBuildingsByLandId(landId),
        BARRACKS_ENABLED ? barracksGetLandStateV2(landId) : Promise.resolve(null),
        CASINO_ENABLED ? casinoIsBuilt(landId) : Promise.resolve(false),
      ]);

      // Only update if land hasn't changed during the fetch
      if (fetchBuildingDataPendingRef.current === landId) {
        setVillageBuildings(villageData || []);

        // Add prebuilt utility buildings that are not part of TownFacet output
        const prebuiltBuildings = [
          {
            id: 1, // Stake House
            level: 1,
            maxLevel: 1,
            productionRatePlantPointsPerDay: BigInt(0),
            productionRatePlantLifetimePerDay: BigInt(0),
            accumulatedPoints: BigInt(0),
            accumulatedLifetime: BigInt(0),
            levelUpgradeCostLeaf: BigInt(0),
            levelUpgradeCostSeedInstant: BigInt(0),
            levelUpgradeCostSeed: BigInt(0),
            levelUpgradeBlockInterval: BigInt(0),
            isUpgrading: false,
            blockHeightUpgradeInitiated: BigInt(0),
            blockHeightUntilUpgradeDone: BigInt(0)
          },
          {
            id: 3, // Warehouse
            level: 1,
            maxLevel: 1,
            productionRatePlantPointsPerDay: BigInt(0),
            productionRatePlantLifetimePerDay: BigInt(0),
            accumulatedPoints: BigInt(0),
            accumulatedLifetime: BigInt(0),
            levelUpgradeCostLeaf: BigInt(0),
            levelUpgradeCostSeedInstant: BigInt(0),
            levelUpgradeCostSeed: BigInt(0),
            levelUpgradeBlockInterval: BigInt(0),
            isUpgrading: false,
            blockHeightUpgradeInitiated: BigInt(0),
            blockHeightUntilUpgradeDone: BigInt(0)
          },
          ...(CASINO_ENABLED ? [{
            id: 6, // Casino
            level: casinoBuilt ? 1 : 0,
            maxLevel: 1,
            productionRatePlantPointsPerDay: BigInt(0),
            productionRatePlantLifetimePerDay: BigInt(0),
            accumulatedPoints: BigInt(0),
            accumulatedLifetime: BigInt(0),
            levelUpgradeCostLeaf: BigInt(0),
            levelUpgradeCostSeedInstant: BigInt(0),
            levelUpgradeCostSeed: BigInt(0),
            levelUpgradeBlockInterval: BigInt(0),
            isUpgrading: false,
            blockHeightUpgradeInitiated: BigInt(0),
            blockHeightUntilUpgradeDone: BigInt(0)
          }] : []),
        ];

        if (BARRACKS_ENABLED) {
          prebuiltBuildings.push({
            id: 8, // Barracks
            level: barracksState?.isBuilt ? 1 : 0,
            maxLevel: 1,
            productionRatePlantPointsPerDay: BigInt(0),
            productionRatePlantLifetimePerDay: BigInt(0),
            accumulatedPoints: BigInt(0),
            accumulatedLifetime: BigInt(0),
            levelUpgradeCostLeaf: BigInt(0),
            levelUpgradeCostSeedInstant: BigInt(0),
            levelUpgradeCostSeed: BigInt(0),
            levelUpgradeBlockInterval: BigInt(0),
            isUpgrading: false,
            blockHeightUpgradeInitiated: BigInt(0),
            blockHeightUntilUpgradeDone: BigInt(0)
          });
        }

        // Combine prebuilt buildings with contract data, avoiding duplicates
        const allTownBuildings = [...prebuiltBuildings];
        if (townData) {
          townData.forEach(building => {
            // Only add if not already in prebuilt (avoid duplicates)
            if (!prebuiltBuildings.some(prebuilt => prebuilt.id === building.id)) {
              allTownBuildings.push(building);
            }
          });
        }

        allTownBuildings.sort((a, b) => Number(a.id) - Number(b.id));

        setTownBuildings(allTownBuildings);

        // Choose preferred building for the new land: try last selected id, else first
        const currentBuildings = buildingType === 'village' ? (villageData || []) : allTownBuildings;

        if (currentBuildings.length > 0) {
          const preferredId = lastSelectedBuildingIdRef.current;

          // If we have a preferred ID (e.g. from previous selection), try to find it in the NEW data
          if (preferredId != null) {
            const freshBuilding = currentBuildings.find(b => Number(b.id) === Number(preferredId));

            // If we found the building in the fresh data, ALWAYS update selectedBuilding state 
            // to ensure meaningful properties (level, isUpgrading) are reflected in the UI.
            if (freshBuilding) {
              setSelectedBuilding(freshBuilding);
            } else {
              // Fallback if the building ID is no longer valid for some reason, select the first one
              setSelectedBuilding(currentBuildings[0]);
            }
          } else {
            // No preference, just select the first one
            setSelectedBuilding(currentBuildings[0]);
          }
        } else {
          setSelectedBuilding(null);
        }
      }
    } catch (err) {
      console.error("Error fetching building data:", err);
      // Only set error if land hasn't changed
      if (fetchBuildingDataPendingRef.current === landId) {
        setVillageBuildings([]);
        setTownBuildings([]);
      }
    } finally {
      // Clear pending flag only if land hasn't changed
      if (fetchBuildingDataPendingRef.current === landId) {
        setBuildingsLoading(false);
        fetchBuildingDataPendingRef.current = null;
      }

      if (fetchBuildingDataQueuedRef.current && selectedLandId === landId) {
        fetchBuildingDataQueuedRef.current = false;
        setTimeout(() => {
          void fetchBuildingData();
        }, 0);
      }
    }
  }, [selectedLandId, buildingType]); // Selection persistence is tracked through lastSelectedBuildingIdRef.

  // When switching back to Warehouse, refresh the land summary to get latest warehouse balances
  useEffect(() => {
    const refreshWarehouseOnSelect = async () => {
      if (selectedLandId == null || buildingType !== 'town' || selectedBuildingId !== 3) return;
      try {
        const latest = await getLandById(selectedLandId);
        if (latest) {
          // Update only the selected land info (keeping array intact to avoid extra renders)
          setSelectedLand(latest);
        }
      } catch {
        // noop
      }
    };
    refreshWarehouseOnSelect();
  }, [selectedBuildingId, buildingType, selectedLandId]);

  const refreshBuildingSnapshot = useCallback(() => {
    fetchBuildingData();
    (async () => {
      try {
        if (selectedLandId != null) {
          const latest = await getLandById(selectedLandId);
          if (latest) setSelectedLand(latest);
        }
      } catch { }
    })();
  }, [fetchBuildingData, selectedLandId]);

  const scheduleBuildingSnapshotRefresh = useCallback(() => {
    for (const delay of POST_TRANSACTION_REFRESH_DELAYS_MS) {
      if (delay <= 0) {
        refreshBuildingSnapshot();
      } else {
        window.setTimeout(refreshBuildingSnapshot, delay);
      }
    }
  }, [refreshBuildingSnapshot]);

  // Combined function to refresh both building data and balances after transactions.
  const handleBuildingTransactionSuccess = useCallback(() => {
    scheduleBuildingSnapshotRefresh();
    dispatchPostTransactionRefresh(['balances:refresh', 'buildings:refresh']);
  }, [scheduleBuildingSnapshotRefresh]);

  const handleBatchClaimSuccess = useCallback(() => {
    fetchBuildingData();
    if (selectedLand) {
      getLandById(selectedLand.tokenId).then(latest => {
        if (latest) setSelectedLand(latest);
      });
    }
  }, [fetchBuildingData, selectedLand]);

  // Refresh when dashboard becomes visible
  useEffect(() => {
    if (isVisible && Date.now() - lastVisibleFetchRef.current > 30_000) {
      lastVisibleFetchRef.current = Date.now();
      fetchData();
    }
  }, [isVisible, fetchData]);

  useEffect(() => {
    if (address) {
      fetchApprovalStatus();
    }
  }, [address, fetchApprovalStatus]);

  // Listen for global buildings refresh events (emitted on tx success in panels)
  useEffect(() => {
    const handler = () => refreshBuildingSnapshot();
    window.addEventListener('buildings:refresh', handler as EventListener);
    return () => window.removeEventListener('buildings:refresh', handler as EventListener);
  }, [refreshBuildingSnapshot]);

  // Remove aggressive image preloads; Next/Image will handle efficient lazy-loading

  useEffect(() => {
    fetchBuildingData();
  }, [fetchBuildingData]);

  // When switching lands, refresh the selected land summary and reset visible building
  useEffect(() => {
    if (selectedLandId == null) return;
    // Reset selected building so fetchBuildingData will pick first of new land
    setSelectedBuilding(null);
    setSelectedUtilityPanel(null);
    (async () => {
      try {
        const latest = await getLandById(selectedLandId);
        if (latest) setSelectedLand(latest);
      } catch { }
    })();
  }, [selectedLandId]);

  // Track last selected building id to persist across land switches
  useEffect(() => {
    if (selectedBuildingId !== null && typeof selectedBuildingId !== 'undefined') {
      lastSelectedBuildingIdRef.current = Number(selectedBuildingId);
      window.localStorage.setItem(BUILDING_ID_STORAGE_KEY, String(selectedBuildingId));
    }
  }, [selectedBuildingId]);

  useEffect(() => {
    window.localStorage.setItem(BUILDING_TYPE_STORAGE_KEY, buildingType);
  }, [buildingType]);

  useEffect(() => {
    if (selectedLandId == null) return;
    window.localStorage.setItem(LAND_SELECTION_STORAGE_KEY, selectedLandId.toString());
  }, [selectedLandId]);

  // Watch for block updates to track upgrade progress
  // Only watch when we have buildings that are actually upgrading
  const hasUpgradingBuildings = [...villageBuildings, ...townBuildings].some(building => building.isUpgrading);

  useWatchBlockNumber({
    onBlockNumber(blockNumber) {
      setCurrentBlock(blockNumber);
    },
    // Gated on the in-app tab AND document visibility: the old guard only
    // checked for upgrading buildings, so a backgrounded webview kept polling
    // the RPC every 3s and re-rendering this whole view.
    enabled: hasUpgradingBuildings && isVisible && isDocumentVisible,
    pollingInterval: 3000 // Check every 3 seconds instead of every block
  });

  const handleBuildingSelect = useCallback((type: BuildingType, building: BuildingData) => {
    setSelectedUtilityPanel(null);
    setBuildingType(type);
    setSelectedBuilding(building);
  }, []);

  const handleBatchClaimUtilitySelect = useCallback(() => {
    setBuildingType('village');
    setSelectedUtilityPanel('batch-claim');
  }, []);

  const handleBatchQuestUtilitySelect = useCallback(() => {
    setBuildingType('town');
    setSelectedUtilityPanel('batch-quests');
  }, []);

  const handleBatchQuestSuccess = useCallback(() => {
    fetchBuildingData();
  }, [fetchBuildingData]);


  // Only block render if we have NO lands data at all
  if (loading && lands.length === 0) {
    // Skeleton shaped like the real layout (selector + land stage + name),
    // mirroring plants-view's documented pattern, so content doesn't jump in.
    return (
      <div className="space-y-4" aria-busy="true" aria-live="polite">
        <span className="sr-only">Loading your lands...</span>
        <TabCard>
          <CardContent className="space-y-4">
            <Skeleton className="h-12 w-full" />
            <Skeleton className="aspect-square w-full rounded-[var(--radius-panel)]" />
            <Skeleton className="mx-auto h-6 w-40" />
            <Skeleton className="mx-auto h-4 w-24" />
          </CardContent>
        </TabCard>
      </div>
    );
  }

  if (error) {
    return (
      <Card>
        <CardContent className="py-4 text-center text-destructive">{error}</CardContent>
      </Card>
    );
  }

  if (lands.length === 0) {
    return (
      <EmptyState
        className="min-h-[60dvh]"
        icon={LandPlot}
        title="No Lands Yet!"
        description="Go to the Mint tab to get your first plot of land."
      />
    );
  }

  return (
    <div className="space-y-4 tablet:mx-auto tablet:max-w-[44rem] xl:max-w-none">
      {selectedLand && (
        <div className="space-y-4 xl:mx-auto xl:grid xl:w-full xl:max-w-[1368px] xl:items-start xl:justify-center xl:gap-5 xl:space-y-0 xl:grid-cols-[minmax(320px,420px)_minmax(760px,928px)]">
          <div className="space-y-4 xl:sticky xl:top-0">
          {lands.length > 1 && (
            <TabCard>
              <CardHeader><CardTitle>Select Land</CardTitle></CardHeader>
              <CardContent>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="outline" className="w-full justify-between">
                      {selectedLand ? (
                        <div className="flex min-w-0 items-center space-x-2">
                          <LandPlot className="h-4 w-4 shrink-0" />
                          <span className="truncate font-pixel">{selectedLand.name || `Land #${selectedLand.tokenId}`}</span>
                        </div>
                      ) : "Select a Land"}
                      <ChevronDown className="h-4 w-4 shrink-0" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] max-h-60 overflow-y-auto">
                    {lands.map((land) => (
                      <DropdownMenuItem key={land.tokenId.toString()} onSelect={() => setSelectedLand(land)}>
                        <div className="flex min-w-0 items-center space-x-2">
                          <LandPlot className="h-4 w-4 shrink-0" />
                          <span className="truncate"><span className="font-pixel">{land.name || `Land #${land.tokenId}`}</span> (XP {formatXP(land.experiencePoints)})</span>
                        </div>
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              </CardContent>
            </TabCard>
          )}
          <TabCard>
            <CardContent className="space-y-3">
              <div className="relative w-full aspect-square overflow-hidden rounded-[var(--radius-panel)] border border-border/45 bg-card bg-[image:var(--gradient-creature-stage)] surface-shadow-raised">
                <div className="pointer-events-none absolute inset-x-8 bottom-8 h-10 rounded-[50%] bg-[hsl(var(--scene-floor)/0.46)] blur-xl" />
                <div className="absolute top-3 left-3 right-3 grid grid-cols-2 gap-2 text-sm font-bold text-foreground/80 z-20">
                  <div className="flex justify-start">
                    <div className="flex items-center gap-1 rounded-full border border-border/35 bg-card/75 px-2 py-0.5 shadow-[var(--shadow-hairline)] backdrop-blur-md">
                      <Image src="/icons/pts.svg" alt="XP" width={16} height={16} className="w-4 h-4" />
                      <span>{formatXP(selectedLand.experiencePoints)} XP</span>
                    </div>
                  </div>
                  <div className="flex justify-end">
                    <div
                      className="flex items-center gap-1 rounded-full border border-border/35 bg-card/75 px-2 py-0.5 shadow-[var(--shadow-hairline)] backdrop-blur-md"
                    >
                      <Image src="/icons/location.svg" alt="Coordinates" width={16} height={16} className="w-4 h-4" />
                      <span>({selectedLand.coordinateX.toString()}, {selectedLand.coordinateY.toString()})</span>
                    </div>
                  </div>
                </div>

                <div className="absolute bottom-3 left-3 z-20">
                  <Button
                    onClick={() => setIsMapOpen(true)}
                    variant="default"
                    size="default"
                    className="h-11 min-h-11 px-3 text-xs"
                    aria-label="Open map"
                  >
                    MAP
                  </Button>
                </div>

                <div
                  className="absolute inset-0 md:inset-8 flex items-center justify-center z-10"
                >
                  <LandImage
                    selectedLand={selectedLand}
                    buildingType={buildingType}
                    villageBuildings={villageBuildings}
                    townBuildings={townBuildings}
                    priority={true}
                  />
                </div>

                {/* Next/Previous controls for multiple lands */}
                {lands.length > 1 && (
                  <>
                    <AssetCarouselButton
                      onClick={() => {
                        const idx = selectedLand ? lands.findIndex(l => l.tokenId === selectedLand.tokenId) : -1;
                        if (idx >= 0) {
                          const prevIndex = (idx - 1 + lands.length) % lands.length;
                          setSelectedLand(lands[prevIndex]);
                        }
                      }}
                      direction="previous"
                      label="Previous land"
                      title="Previous"
                    />
                    <AssetCarouselButton
                      onClick={() => {
                        const idx = selectedLand ? lands.findIndex(l => l.tokenId === selectedLand.tokenId) : -1;
                        if (idx >= 0) {
                          const nextIndex = (idx + 1) % lands.length;
                          setSelectedLand(lands[nextIndex]);
                        }
                      }}
                      direction="next"
                      label="Next land"
                      title="Next"
                    />
                  </>
                )}
              </div>

              <div className="text-center">
                <div className="inline-flex max-w-full items-center justify-center gap-1">
                  <span className="w-7 shrink-0" aria-hidden="true" />
                  <h3 className="min-w-0 truncate font-pixel text-lg">{selectedLand.name || `Land #${selectedLand.tokenId}`}</h3>
                  <EditLandName
                    land={selectedLand}
                    onNameChanged={(landId, newName) => {
                      setSelectedLand(prev => prev ? { ...prev, name: newName } : null);
                      // update any cached arrays if present
                    }}
                    iconSize={18}
                    className="h-11 min-h-11 w-11 min-w-11 shrink-0"
                  />
                </div>
                <p className="text-sm text-muted-foreground">Token ID: {selectedLand.tokenId.toString()}</p>
              </div>
            </CardContent>
          </TabCard>

          </div>

          <div className="min-w-0 space-y-4">
          {/* Building Management Section */}
          <TabCard className="xl:h-fit xl:w-full">
            <CardHeader>
              <div className="flex justify-between items-center">
                <CardTitle>Buildings</CardTitle>
                <div className="xl:hidden">
                  <ToggleGroup
                    ariaLabel="Land area"
                    value={buildingType}
                    onValueChange={(v) => {
                      const newType = v as 'village' | 'town';
                      setSelectedUtilityPanel(null);
                      setBuildingType(newType);
                      setSelectedBuilding((newType === 'village' ? villageBuildings[0] : townBuildings[0]) || null);
                    }}
                    options={[
                      { value: 'village', label: 'Village' },
                      { value: 'town', label: 'Town' },
                    ]}
                  />
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(250px,360px)_minmax(360px,520px)] xl:items-start xl:justify-center">
                {/* Building Grid */}
                <div className="space-y-4">
                  {buildingsLoading && (!villageBuildings.length && !townBuildings.length) ? (
                    <div className="text-center text-muted-foreground p-6">
                      Loading buildings...
                    </div>
                  ) : (
                    <>
                      {!isDesktopLand && (
                      <div className="xl:hidden">
                        <BuildingGrid
                          buildings={buildingType === 'village' ? villageBuildings : townBuildings}
                          buildingType={buildingType}
                          selectedBuilding={selectedUtilityPanel ? null : selectedBuilding}
                          selectedBuildingType={buildingType}
                          onBuildingSelect={(building) => handleBuildingSelect(buildingType, building)}
                          currentBlock={currentBlock}
                          landId={selectedLand.tokenId}
                          extraItems={lands.length > 0 ? (
                            buildingType === 'village' ? (
                              <UtilityBuildingTile
                                ariaLabel="Open batch claim"
                                glyph="BC"
                                label="Batch Claim"
                                onSelect={handleBatchClaimUtilitySelect}
                                selected={selectedUtilityPanel === 'batch-claim'}
                                sublabel="All lands"
                              />
                            ) : (
                              <UtilityBuildingTile
                                ariaLabel="Open batch quests"
                                glyph="BQ"
                                label="Batch Quests"
                                onSelect={handleBatchQuestUtilitySelect}
                                selected={selectedUtilityPanel === 'batch-quests'}
                                sublabel="All lands"
                              />
                            )
                          ) : null}
                        />
                      </div>
                      )}

                      {isDesktopLand && (
                      <div className="hidden xl:block space-y-4">
                        <section
                          className={`rounded-[var(--radius-panel)] border p-3 transition-colors ${buildingType === 'village' ? 'border-primary/60 bg-primary/5' : 'border-border bg-background/40'
                            }`}
                        >
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold">Village</h3>
                            <span className="text-xs text-muted-foreground">{villageBuildings.length} buildings</span>
                          </div>
                          <BuildingGrid
                            buildings={villageBuildings}
                            buildingType="village"
                            selectedBuilding={selectedUtilityPanel ? null : selectedBuilding}
                            selectedBuildingType={buildingType}
                            onBuildingSelect={(building) => handleBuildingSelect('village', building)}
                            currentBlock={currentBlock}
                            landId={selectedLand.tokenId}
                            gridClassName="grid grid-cols-3 gap-x-3 gap-y-5 justify-items-center"
                            denseLabels
                            extraItems={lands.length > 0 ? (
                              <UtilityBuildingTile
                                ariaLabel="Open batch claim"
                                denseLabels
                                glyph="BC"
                                label="Batch Claim"
                                onSelect={handleBatchClaimUtilitySelect}
                                selected={selectedUtilityPanel === 'batch-claim'}
                                sublabel="All lands"
                              />
                            ) : null}
                          />
                        </section>

                        <section
                          className={`rounded-[var(--radius-panel)] border p-3 transition-colors ${buildingType === 'town' ? 'border-primary/60 bg-primary/5' : 'border-border bg-background/40'
                            }`}
                        >
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <h3 className="text-sm font-semibold">Town</h3>
                            <span className="text-xs text-muted-foreground">{townBuildings.length} buildings</span>
                          </div>
                          <BuildingGrid
                            buildings={townBuildings}
                            buildingType="town"
                            selectedBuilding={selectedUtilityPanel ? null : selectedBuilding}
                            selectedBuildingType={buildingType}
                            onBuildingSelect={(building) => handleBuildingSelect('town', building)}
                            currentBlock={currentBlock}
                            landId={selectedLand.tokenId}
                            gridClassName="grid grid-cols-3 gap-x-3 gap-y-5 justify-items-center"
                            denseLabels
                            extraItems={lands.length > 0 ? (
                              <UtilityBuildingTile
                                ariaLabel="Open batch quests"
                                denseLabels
                                glyph="BQ"
                                label="Batch Quests"
                                onSelect={handleBatchQuestUtilitySelect}
                                selected={selectedUtilityPanel === 'batch-quests'}
                                sublabel="All lands"
                              />
                            ) : null}
                          />
                        </section>
                      </div>
                      )}
                    </>
                  )}
                </div>

                {/* Building Details Panel */}
                {selectedUtilityPanel === 'batch-claim' ? (
                  <BatchClaimCard
                    lands={lands}
                    onSuccess={handleBatchClaimSuccess}
                    variant="embedded"
                    showWhenEmpty
                  />
                ) : selectedUtilityPanel === 'batch-quests' ? (
                  <BatchQuestStartCard
                    lands={lands}
                    onSuccess={handleBatchQuestSuccess}
                    variant="embedded"
                    showWhenEmpty
                  />
                ) : selectedBuilding && (
                  <BuildingDetailsPanel
                    selectedBuilding={selectedBuilding}
                    landId={selectedLand.tokenId}
                    buildingType={buildingType}
                    onUpgradeSuccess={handleBuildingTransactionSuccess}
                    currentBlock={currentBlock}
                    leafAllowance={leafAllowance}
                    onLeafApprovalSuccess={fetchApprovalStatus}
                    seedAllowance={seedAllowance}
                    onSeedApprovalSuccess={fetchApprovalStatus}
                    warehousePoints={selectedLand.accumulatedPlantPoints}
                    warehouseLifetime={selectedLand.accumulatedPlantLifetime}
                    villageBuildings={villageBuildings}
                  />
                )}
              </div>
            </CardContent>
          </TabCard>
          </div>
        </div>
      )}
      {/* Map Modal */}
      {selectedLand && isMapOpen && (
        <LandMapModal
          isOpen={isMapOpen}
          onClose={() => setIsMapOpen(false)}
          userLands={lands}
          selectedLand={selectedLand}
          onSelectLand={(land) => {
            setSelectedLand(land);
            setIsMapOpen(false);
          }}
          totalSupply={totalSupply}
          neighborData={neighborData}
        />
      )}
    </div>
  );
}
