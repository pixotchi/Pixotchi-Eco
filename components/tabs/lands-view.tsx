"use client";

import { Button } from "@/components/ui/button";
import { useQueryClient } from "@tanstack/react-query";
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
import {
invalidateOwnerResources,
isAbortError,
onOwnerResourceInvalidation,
ownerInvalidationMatches,
retryOwnerRead,
} from "@/lib/owner-resource-invalidation";
import { queryKeys } from "@/lib/query-keys";
import { BuildingData,BuildingType,Land } from "@/lib/types";
import { formatXP } from "@/lib/utils";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback,useEffect,useLayoutEffect,useRef,useState } from "react";
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
type LandInvariant = (lands: Land[]) => boolean;
type QueuedLandFetch = { force: boolean; invariants: LandInvariant[] };
type ApprovalFetchIdentity = { generation: number; ownerKey: string };
type BuildingFetchIdentity = {
  buildingType: BuildingType;
  generation: number;
  landId: bigint;
  ownerKey: string;
  requestGeneration: number;
};

function approvalFetchIdentityMatches(
  left: ApprovalFetchIdentity | null,
  right: ApprovalFetchIdentity,
): boolean {
  return Boolean(
    left
    && left.generation === right.generation
    && left.ownerKey === right.ownerKey,
  );
}

function buildingFetchIdentityMatches(
  left: BuildingFetchIdentity | null,
  right: BuildingFetchIdentity,
): boolean {
  return Boolean(
    left
    && left.buildingType === right.buildingType
    && left.generation === right.generation
    && left.landId === right.landId
    && left.ownerKey === right.ownerKey
    && left.requestGeneration === right.requestGeneration,
  );
}

function readLocalStorage(key: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Storage may be disabled in private or embedded wallet browsers. The
    // current in-memory selection remains authoritative for this session.
  }
}

function didLandSnapshotChange(before: Land, after: Land | undefined): boolean {
  if (!after) return true;
  return (
    before.accumulatedPlantLifetime !== after.accumulatedPlantLifetime ||
    before.accumulatedPlantPoints !== after.accumulatedPlantPoints ||
    before.experiencePoints !== after.experiencePoints ||
    before.farmerAvatar !== after.farmerAvatar ||
    before.name !== after.name ||
    before.owner.toLowerCase() !== after.owner.toLowerCase()
  );
}

function readStoredBigInt(key: string): bigint | null {
  const value = readLocalStorage(key);
  if (!value) return null;
  try {
    return BigInt(value);
  } catch {
    return null;
  }
}

function readStoredNumber(key: string): number | null {
  const value = readLocalStorage(key);
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function readStoredBuildingType(): BuildingType {
  return readLocalStorage(BUILDING_TYPE_STORAGE_KEY) === 'town' ? 'town' : 'village';
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
  const ownerKey = address?.toLowerCase() ?? null;
  const queryClient = useQueryClient();
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

  // Owner generation guards every async path. In-flight invalidations are
  // coalesced into one queued pass instead of being discarded.
  const ownerKeyRef = useRef<string | null>(ownerKey);
  const ownerGenerationRef = useRef(0);
  const activeLandFetchAbortRef = useRef<AbortController | null>(null);
  const selectedLandIdRef = useRef<bigint | null>(null);
  const buildingTypeRef = useRef(buildingType);
  const buildingFetchRequestGenerationRef = useRef(0);
  const fetchDataPendingRef = useRef<{ generation: number; ownerKey: string } | null>(null);
  const fetchDataQueuedRef = useRef<QueuedLandFetch | null>(null);
  const fetchApprovalStatusPendingRef = useRef<ApprovalFetchIdentity | null>(null);
  const fetchApprovalStatusQueuedRef = useRef<ApprovalFetchIdentity | null>(null);
  const fetchBuildingDataPendingRef = useRef<BuildingFetchIdentity | null>(null);
  const fetchBuildingDataQueuedRef = useRef<BuildingFetchIdentity | null>(null);

  // Token approval state for land interactions
  const [leafAllowance, setLeafAllowance] = useState<bigint>(BigInt(0));
  const [seedAllowance, setSeedAllowance] = useState<bigint>(BigInt(0));

  // Fetch land contract approval status (LEAF + SEED)
  const fetchApprovalStatus = useCallback(async () => {
    if (!address || !ownerKey) {
      setLeafAllowance(BigInt(0));
      setSeedAllowance(BigInt(0));
      fetchApprovalStatusPendingRef.current = null;
      fetchApprovalStatusQueuedRef.current = null;
      return;
    }

    const requestIdentity: ApprovalFetchIdentity = {
      generation: ownerGenerationRef.current,
      ownerKey,
    };

    // A confirmed approval can arrive while the initial allowance read is in
    // flight. Preserve one exact-owner trailing pass instead of dropping it.
    if (approvalFetchIdentityMatches(fetchApprovalStatusPendingRef.current, requestIdentity)) {
      fetchApprovalStatusQueuedRef.current = requestIdentity;
      return;
    }

    fetchApprovalStatusQueuedRef.current = null;
    fetchApprovalStatusPendingRef.current = requestIdentity;

    try {
      const [currentLeafAllowance, currentSeedAllowance] = await Promise.all([
        checkLeafTokenApproval(address),
        checkLandSpeedUpApproval(address),
      ]);
      if (
        approvalFetchIdentityMatches(fetchApprovalStatusPendingRef.current, requestIdentity)
        && ownerGenerationRef.current === requestIdentity.generation
        && ownerKeyRef.current === requestIdentity.ownerKey
      ) {
        setLeafAllowance(currentLeafAllowance);
        setSeedAllowance(currentSeedAllowance);
      }
    } catch (error) {
      console.error("Failed to fetch land token approval status:", error);
      if (
        approvalFetchIdentityMatches(fetchApprovalStatusPendingRef.current, requestIdentity)
        && ownerGenerationRef.current === requestIdentity.generation
        && ownerKeyRef.current === requestIdentity.ownerKey
      ) {
        setLeafAllowance(BigInt(0));
        setSeedAllowance(BigInt(0));
      }
    } finally {
      const ownsPendingSlot = approvalFetchIdentityMatches(
        fetchApprovalStatusPendingRef.current,
        requestIdentity,
      );
      if (ownsPendingSlot) {
        fetchApprovalStatusPendingRef.current = null;
        const queuedIdentity = fetchApprovalStatusQueuedRef.current;
        fetchApprovalStatusQueuedRef.current = null;
        if (
          approvalFetchIdentityMatches(queuedIdentity, requestIdentity)
          && ownerGenerationRef.current === requestIdentity.generation
          && ownerKeyRef.current === requestIdentity.ownerKey
        ) {
          queueMicrotask(() => {
            if (
              ownerGenerationRef.current === requestIdentity.generation
              && ownerKeyRef.current === requestIdentity.ownerKey
            ) {
              void fetchApprovalStatus();
            }
          });
        }
      }
    }
  }, [address, ownerKey]);

  const fetchData = useCallback(async (
    { force = false, until }: { force?: boolean; until?: LandInvariant } = {},
  ) => {
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
    const controller = new AbortController();
    activeLandFetchAbortRef.current?.abort();
    activeLandFetchAbortRef.current = controller;
    fetchDataPendingRef.current = { generation, ownerKey };
    if (lands.length === 0) setLoading(true);
    setError(null);

    try {
      const landsQueryKey = queryKeys.landsByOwner(ownerKey);
      const readLands = async () => {
        if (force || until) {
          await queryClient.invalidateQueries({
            exact: true,
            queryKey: landsQueryKey,
            refetchType: "none",
          });
        }
        return queryClient.fetchQuery({
          queryKey: landsQueryKey,
          queryFn: () => getLandsByOwner(address),
          staleTime: force || until ? 0 : 30_000,
        });
      };
      const landsData = until
        ? await retryOwnerRead(readLands, { accept: until, signal: controller.signal })
        : await readLands();
      const isCurrentOwner =
        !controller.signal.aborted &&
        ownerKeyRef.current === ownerKey &&
        ownerGenerationRef.current === generation &&
        fetchDataPendingRef.current?.generation === generation;
      if (!isCurrentOwner) return;

      setLands(landsData);
      if (landsData.length > 0) {
        const preferredSelectedId = selectedLandIdRef.current ?? readStoredBigInt(LAND_SELECTION_STORAGE_KEY);
        const freshSelection = landsData.find((land) => land.tokenId === preferredSelectedId);
        const landToSelect = freshSelection ?? landsData[0];
        selectedLandIdRef.current = landToSelect.tokenId;
        setSelectedLand(landToSelect);
      } else {
        selectedLandIdRef.current = null;
        setSelectedLand(null);
      }
    } catch (err) {
      if (!isAbortError(err)) {
        console.error("Error fetching lands data:", err);
        if (ownerKeyRef.current === ownerKey && ownerGenerationRef.current === generation) {
          setError("Failed to load your lands. Please try again.");
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
            ? (nextLands: Land[]) => queued.invariants.every((invariant) => invariant(nextLands))
            : undefined;
          queueMicrotask(() => {
            void fetchData({ force: queued.force, until: queuedInvariant });
          });
        }
      }
    }
  }, [address, lands.length, ownerKey, queryClient]);

  useLayoutEffect(() => {
    if (ownerKeyRef.current === ownerKey) return;
    const previousOwner = ownerKeyRef.current;
    ownerKeyRef.current = ownerKey;
    ownerGenerationRef.current += 1;
    activeLandFetchAbortRef.current?.abort();
    activeLandFetchAbortRef.current = null;
    fetchDataPendingRef.current = null;
    fetchDataQueuedRef.current = null;
    lastVisibleFetchRef.current = 0;
    fetchApprovalStatusPendingRef.current = null;
    fetchApprovalStatusQueuedRef.current = null;
    fetchBuildingDataPendingRef.current = null;
    fetchBuildingDataQueuedRef.current = null;
    selectedLandIdRef.current = null;
    setLands([]);
    setSelectedLand(null);
    setVillageBuildings([]);
    setTownBuildings([]);
    setSelectedBuilding(null);
    setSelectedUtilityPanel(null);
    setLeafAllowance(BigInt(0));
    setSeedAllowance(BigInt(0));
    setError(null);
    setLoading(Boolean(ownerKey));
    setBuildingsLoading(false);
    setIsMapOpen(false);
    if (previousOwner) {
      void queryClient.cancelQueries({ queryKey: queryKeys.landsByOwner(previousOwner) });
    }
  }, [ownerKey, queryClient]);

  useEffect(() => () => activeLandFetchAbortRef.current?.abort(), []);

  useLayoutEffect(() => {
    selectedLandIdRef.current = selectedLandId;
    buildingTypeRef.current = buildingType;
  }, [buildingType, selectedLandId]);

  const fetchBuildingData = useCallback(async () => {
    if (selectedLandId == null || !ownerKey) {
      setVillageBuildings([]);
      setTownBuildings([]);
      setSelectedBuilding(null);
      setSelectedUtilityPanel(null);
      setBuildingsLoading(false);
      fetchBuildingDataPendingRef.current = null;
      fetchBuildingDataQueuedRef.current = null;
      return;
    }

    const landId = selectedLandId;
    const generation = ownerGenerationRef.current;
    // Preserve one follow-up only for the exact request already in flight. A
    // different land/owner/generation/type starts a new authoritative request
    // and invalidates any queued work owned by the older identity.
    const pendingIdentity = fetchBuildingDataPendingRef.current;
    if (
      pendingIdentity
      && pendingIdentity.buildingType === buildingType
      && pendingIdentity.generation === generation
      && pendingIdentity.landId === landId
      && pendingIdentity.ownerKey === ownerKey
    ) {
      fetchBuildingDataQueuedRef.current = pendingIdentity;
      return;
    }

    const requestIdentity: BuildingFetchIdentity = {
      buildingType,
      generation,
      landId,
      ownerKey,
      requestGeneration: ++buildingFetchRequestGenerationRef.current,
    };
    fetchBuildingDataQueuedRef.current = null;
    fetchBuildingDataPendingRef.current = requestIdentity;
    setBuildingsLoading(true);

    try {
      const [villageData, townData, barracksState, casinoBuilt] = await Promise.all([
        getVillageBuildingsByLandId(landId),
        getTownBuildingsByLandId(landId),
        BARRACKS_ENABLED ? barracksGetLandStateV2(landId) : Promise.resolve(null),
        CASINO_ENABLED ? casinoIsBuilt(landId) : Promise.resolve(false),
      ]);

      // Only update if land hasn't changed during the fetch
      if (
        buildingFetchIdentityMatches(fetchBuildingDataPendingRef.current, requestIdentity) &&
        ownerGenerationRef.current === generation &&
        ownerKeyRef.current === ownerKey &&
        selectedLandIdRef.current === landId &&
        buildingTypeRef.current === buildingType
      ) {
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
      if (
        buildingFetchIdentityMatches(fetchBuildingDataPendingRef.current, requestIdentity) &&
        ownerGenerationRef.current === generation &&
        ownerKeyRef.current === ownerKey &&
        selectedLandIdRef.current === landId &&
        buildingTypeRef.current === buildingType
      ) {
        setVillageBuildings([]);
        setTownBuildings([]);
      }
    } finally {
      const ownsPendingSlot = buildingFetchIdentityMatches(
        fetchBuildingDataPendingRef.current,
        requestIdentity,
      );
      // Only the request that still owns the pending slot may clear loading or
      // consume its queued follow-up. An older land finishing cannot drain work
      // queued for the currently selected land.
      if (ownsPendingSlot) {
        setBuildingsLoading(false);
        fetchBuildingDataPendingRef.current = null;
        const queuedIdentity = fetchBuildingDataQueuedRef.current;
        fetchBuildingDataQueuedRef.current = null;
        if (
          buildingFetchIdentityMatches(queuedIdentity, requestIdentity)
          && ownerGenerationRef.current === generation
          && ownerKeyRef.current === ownerKey
          && selectedLandIdRef.current === landId
          && buildingTypeRef.current === buildingType
        ) {
          setTimeout(() => {
            if (
              ownerGenerationRef.current === generation
              && ownerKeyRef.current === ownerKey
              && selectedLandIdRef.current === landId
              && buildingTypeRef.current === buildingType
            ) {
              void fetchBuildingData();
            }
          }, 0);
        }
      }
    }
  }, [selectedLandId, buildingType, ownerKey]); // Selection persistence is tracked through lastSelectedBuildingIdRef.

  // When switching back to Warehouse, refresh the land summary to get latest warehouse balances
  useEffect(() => {
    const refreshWarehouseOnSelect = async () => {
      if (selectedLandId == null || buildingType !== 'town' || selectedBuildingId !== 3) return;
      const generation = ownerGenerationRef.current;
      const requestedOwner = ownerKey;
      const requestedLandId = selectedLandId;
      try {
        const latest = await getLandById(requestedLandId);
        if (
          latest &&
          requestedOwner &&
          ownerGenerationRef.current === generation &&
          ownerKeyRef.current === requestedOwner &&
          selectedLandIdRef.current === requestedLandId
        ) {
          // Update only the selected land info (keeping array intact to avoid extra renders)
          setSelectedLand(latest);
        }
      } catch {
        // noop
      }
    };
    refreshWarehouseOnSelect();
  }, [selectedBuildingId, buildingType, selectedLandId, ownerKey]);

  const refreshBuildingSnapshot = useCallback(() => {
    const generation = ownerGenerationRef.current;
    const requestedOwner = ownerKey;
    const requestedLandId = selectedLandId;
    void fetchBuildingData();
    (async () => {
      try {
        if (requestedLandId != null && requestedOwner) {
          const latest = await getLandById(requestedLandId);
          if (
            latest &&
            ownerGenerationRef.current === generation &&
            ownerKeyRef.current === requestedOwner &&
            selectedLandIdRef.current === requestedLandId
          ) {
            setSelectedLand(latest);
          }
        }
      } catch { }
    })();
  }, [fetchBuildingData, ownerKey, selectedLandId]);

  // One mutation signal owns reconciliation. Child panels may still emit the
  // legacy buildings event while migrating; the listener below coalesces it.
  const handleBuildingTransactionSuccess = useCallback(() => {
    invalidateOwnerResources({
      address: ownerKey,
      domains: ["buildings", "lands", "balances"],
      source: "lands-view:building-transaction",
    });
  }, [ownerKey]);

  const handleBatchClaimSuccess = useCallback(() => {
    invalidateOwnerResources({
      address: ownerKey,
      domains: ["buildings", "lands", "balances"],
      source: "lands-view:batch-claim",
    });
  }, [ownerKey]);

  // Refresh when dashboard becomes visible
  useEffect(() => {
    if (isVisible && Date.now() - lastVisibleFetchRef.current > 30_000) {
      lastVisibleFetchRef.current = Date.now();
      void fetchData();
    }
  }, [isVisible, fetchData]);

  useEffect(() => {
    if (address) {
      fetchApprovalStatus();
    }
  }, [address, fetchApprovalStatus]);

  const lastOwnerBuildingInvalidationRef = useRef(0);
  useEffect(() => onOwnerResourceInvalidation((detail) => {
    if (ownerInvalidationMatches(detail, ownerKey, "lands")) {
      if (detail.clear) {
        ownerGenerationRef.current += 1;
        activeLandFetchAbortRef.current?.abort();
        activeLandFetchAbortRef.current = null;
        fetchDataPendingRef.current = null;
        fetchDataQueuedRef.current = null;
        fetchApprovalStatusPendingRef.current = null;
        fetchApprovalStatusQueuedRef.current = null;
        fetchBuildingDataPendingRef.current = null;
        fetchBuildingDataQueuedRef.current = null;
        selectedLandIdRef.current = null;
        setLands([]);
        setSelectedLand(null);
        setVillageBuildings([]);
        setTownBuildings([]);
        setSelectedBuilding(null);
        setSelectedUtilityPanel(null);
        setLoading(false);
        setBuildingsLoading(false);
        setError(null);
        return;
      }
      const baseline = [...lands];
      const baselineById = new Map(baseline.map((land) => [land.tokenId.toString(), land]));
      const expected = detail.expected;
      const hasExpectation = Boolean(
        expected?.landCountAtLeast !== undefined ||
        expected?.landIdsAbsent?.length ||
        expected?.landIdsPresent?.length
      );
      const shouldObserveMutation = Boolean(
        detail.transactionHash ||
        detail.source?.includes("claim") ||
        detail.source?.includes("transfer") ||
        detail.source?.includes("mint")
      );
      const until = hasExpectation || shouldObserveMutation
        ? (nextLands: Land[]) => {
            const ids = new Set(nextLands.map((land) => land.tokenId.toString()));
            if (expected?.landCountAtLeast !== undefined && nextLands.length < expected.landCountAtLeast) return false;
            if (expected?.landIdsPresent?.some((id) => !ids.has(id.toString()))) return false;
            if (expected?.landIdsAbsent?.some((id) => ids.has(id.toString()))) return false;
            if (hasExpectation) return true;
            if (nextLands.length !== baseline.length) return true;
            if (baseline.some((land) => !ids.has(land.tokenId.toString()))) return true;
            return nextLands.some((land) => {
              const before = baselineById.get(land.tokenId.toString());
              return before ? didLandSnapshotChange(before, land) : true;
            });
          }
        : undefined;
      void fetchData({ force: detail.force, until });
    }

    if (ownerInvalidationMatches(detail, ownerKey, "buildings")) {
      lastOwnerBuildingInvalidationRef.current = Date.now();
      refreshBuildingSnapshot();
    }
  }), [fetchData, lands, ownerKey, refreshBuildingSnapshot]);

  // Backward compatibility for panels not yet migrated to the owner-domain API.
  useEffect(() => {
    const handler = () => {
      if (Date.now() - lastOwnerBuildingInvalidationRef.current < 500) return;
      refreshBuildingSnapshot();
    };
    window.addEventListener('buildings:refresh', handler as EventListener);
    return () => window.removeEventListener('buildings:refresh', handler as EventListener);
  }, [refreshBuildingSnapshot]);

  const lastLifecycleReconcileRef = useRef(0);
  useEffect(() => {
    if (!address || !isVisible) return;
    const reconcile = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      const now = Date.now();
      if (now - lastLifecycleReconcileRef.current < 15_000) return;
      lastLifecycleReconcileRef.current = now;
      void fetchData({ force: true });
      if (selectedLandIdRef.current !== null) refreshBuildingSnapshot();
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
  }, [address, fetchData, isVisible, refreshBuildingSnapshot]);

  // Remove aggressive image preloads; Next/Image will handle efficient lazy-loading

  useEffect(() => {
    fetchBuildingData();
  }, [fetchBuildingData]);

  // When switching lands, refresh the selected land summary and reset visible building
  useEffect(() => {
    if (selectedLandId == null) return;
    const generation = ownerGenerationRef.current;
    const requestedOwner = ownerKey;
    const requestedLandId = selectedLandId;
    let cancelled = false;
    // Reset selected building so fetchBuildingData will pick first of new land
    setSelectedBuilding(null);
    setSelectedUtilityPanel(null);
    (async () => {
      try {
        const latest = await getLandById(requestedLandId);
        if (
          !cancelled &&
          latest &&
          requestedOwner &&
          ownerGenerationRef.current === generation &&
          ownerKeyRef.current === requestedOwner &&
          selectedLandIdRef.current === requestedLandId
        ) {
          setSelectedLand(latest);
        }
      } catch { }
    })();
    return () => { cancelled = true; };
  }, [selectedLandId, ownerKey]);

  // Track last selected building id to persist across land switches
  useEffect(() => {
    if (selectedBuildingId !== null && typeof selectedBuildingId !== 'undefined') {
      lastSelectedBuildingIdRef.current = Number(selectedBuildingId);
      writeLocalStorage(BUILDING_ID_STORAGE_KEY, String(selectedBuildingId));
    }
  }, [selectedBuildingId]);

  useEffect(() => {
    writeLocalStorage(BUILDING_TYPE_STORAGE_KEY, buildingType);
  }, [buildingType]);

  useEffect(() => {
    if (selectedLandId == null) return;
    writeLocalStorage(LAND_SELECTION_STORAGE_KEY, selectedLandId.toString());
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
    invalidateOwnerResources({
      address: ownerKey,
      domains: ["buildings", "lands", "balances"],
      source: "lands-view:batch-quest",
    });
  }, [ownerKey]);


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
