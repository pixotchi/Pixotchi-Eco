"use client";

import { Button } from "@/components/ui/button";
import { LandResourceBadges } from '@/components/land-resource-badges';
import { useLandQuestSlots } from '@/hooks/useLandQuestSlots';
import { ResourceState } from '@/components/ui/resource-state';
import { useQueryClient } from "@tanstack/react-query";
import { EmptyFarm } from '@/components/empty-farm';
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
onOwnerResourceInvalidation,
ownerInvalidationMatches,
type OwnerResourceInvalidationDetail,
} from "@/lib/owner-resource-invalidation";
import { readMatchingLandBuildings } from '@/lib/land-building-snapshot';
import { clearMissionLandForOwner, consumeMissionLand, getPendingMissionLand, getServerMissionLand, subscribeMissionLand } from '@/lib/mission-navigation';
import { queryKeys } from "@/lib/query-keys";
import { BuildingData,BuildingType,Land } from "@/lib/types";
import { formatXP } from "@/lib/utils";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useCallback,useEffect,useLayoutEffect,useMemo,useRef,useState,useSyncExternalStore } from "react";
import { useAccount,useBlockNumber } from "wagmi";
// Removed BalanceCard from tabs; status bar now shows balances globally
import BuildingGrid, { BuildingTile } from "@/components/building-grid";
import { EditLandName } from "@/components/edit-land-name";
import { AssetTitle } from '@/components/asset-title';
import { SolanaNotSupported,useIsSolanaWallet } from "@/components/solana";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { useLandMap } from "@/hooks/useLandMap";
import { useOwnerResourceList } from "@/hooks/useOwnerResourceList";
import { ArrowLeft,ChevronDown,LandPlot } from "lucide-react";
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

function UtilityBuildingTile({ ariaLabel, glyph, label, onSelect, selected, sublabel }: {
  ariaLabel: string; denseLabels?: boolean; glyph: string; label: string;
  onSelect: () => void; selected: boolean; sublabel: string;
}) {
  return <BuildingTile ariaLabel={ariaLabel} label={label} subtitle={sublabel} selected={selected} onSelect={onSelect}
    icon={<span className="font-pixel text-3xl" aria-hidden="true">{glyph}</span>} />;
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
  const missionLandRequest = useSyncExternalStore(subscribeMissionLand, getPendingMissionLand, getServerMissionLand);
  const queryClient = useQueryClient();
  useSmartWallet();
  const { isTabVisible } = useTabVisibility();
  const isVisible = isTabVisible('dashboard');
  const isDocumentVisible = useDocumentVisible();
  // Real gate for the duplicated grids below (the CSS classes remain as the
  // first-frame guard between a resize and this state syncing).
  const isDesktopLand = useMediaQuery(DESKTOP_MEDIA_QUERY);
  const [isMapOpen, setIsMapOpen] = useState(false);

  // Building management state
  const [buildingType, setBuildingType] = useState<BuildingType>(() => readStoredBuildingType());
  const [rawVillageBuildings, setVillageBuildings] = useState<BuildingData[]>([]);
  const [rawBuildingsError, setBuildingsError] = useState<string | null>(null);
  const [rawTownBuildings, setTownBuildings] = useState<BuildingData[]>([]);
  const [preferredBuildingId, setPreferredBuildingId] = useState<number | null>(null);
  const setSelectedBuilding = useCallback((building: BuildingData | null) => setPreferredBuildingId(building?.id ?? null), []);
  const [snapshotIdentity, setSnapshotIdentity] = useState<string | null>(null);
  const [buildingReadIdentity, setBuildingReadIdentity] = useState<string | null>(null);
  const [detailRequest, setDetailRequest] = useState(0);
  const [missionDetailFocus, setMissionDetailFocus] = useState(false);
  const detailRef = useRef<HTMLElement>(null);
  const buildingGridRef = useRef<HTMLDivElement>(null);
  const buildingReturnRef = useRef<{ trigger: HTMLButtonElement; scroller: HTMLElement | null; scrollTop: number } | null>(null);
  const [selectedUtilityPanel, setSelectedUtilityPanel] = useState<LandUtilityPanel | null>(null);
  const [rawBuildingsLoading, setBuildingsLoading] = useState(false);
  // Remember last selected building id to persist across land switches
  const lastSelectedBuildingIdRef = useRef<number | null>(readStoredNumber(BUILDING_ID_STORAGE_KEY));

  // Owner generation still guards the per-land building and approval reads,
  // which stay imperative because they are keyed on a transient selection.
  // The land list itself is owned by React Query (see useOwnerResourceList).
  const ownerKeyRef = useRef<string | null>(ownerKey);
  const ownerGenerationRef = useRef(0);
  const selectedLandIdRef = useRef<bigint | null>(null);
  const buildingTypeRef = useRef(buildingType);
  const buildingFetchRequestGenerationRef = useRef(0);
  const fetchApprovalStatusPendingRef = useRef<ApprovalFetchIdentity | null>(null);
  const fetchApprovalStatusQueuedRef = useRef<ApprovalFetchIdentity | null>(null);
  const fetchBuildingDataPendingRef = useRef<BuildingFetchIdentity | null>(null);
  const fetchBuildingDataQueuedRef = useRef<BuildingFetchIdentity | null>(null);

  // Token approval state for land interactions
  const [leafAllowance, setLeafAllowance] = useState<bigint>(BigInt(0));
  const [seedAllowance, setSeedAllowance] = useState<bigint>(BigInt(0));
  const [approvalRead, setApprovalRead] = useState<{ owner: string | null; status: 'loading' | 'ready' | 'error' }>({ owner: null, status: 'loading' });
  const allowancesReady = approvalRead.owner === ownerKey && approvalRead.status === 'ready';
  const allowancesError = approvalRead.owner === ownerKey && approvalRead.status === 'error'
    ? 'LEAF and PIXOTCHI spending permissions could not be verified. Retry before upgrading.' : null;

  // Only the selected token id is local. `selectedLand` is derived from the
  // query cache so the dropdown, the stage and the warehouse panel can never
  // disagree about the same land.
  const [preferredLandId, setPreferredLandId] = useState<bigint | null>(
    () => readStoredBigInt(LAND_SELECTION_STORAGE_KEY),
  );

  const landsQueryKey = useMemo(() => queryKeys.landsByOwner(ownerKey), [ownerKey]);
  const readLands = useCallback(async (options?: { blockNumber?: bigint }) => {
    if (!address) return [];
    return getLandsByOwner(address, undefined, options?.blockNumber);
  }, [address]);

  const handleLandsCleared = useCallback(() => {
    selectedLandIdRef.current = null;
    setPreferredLandId(null);
    setVillageBuildings([]);
    setTownBuildings([]);
    setSelectedBuilding(null);
    setSelectedUtilityPanel(null);
    setBuildingsLoading(false);
    setBuildingsError(null);
    setIsMapOpen(false);
  }, [setSelectedBuilding]);

  const buildLandsInvariant = useCallback(
    (detail: OwnerResourceInvalidationDetail, baseline: Land[]): LandInvariant | undefined => {
      const baselineById = new Map(baseline.map((land) => [land.tokenId.toString(), land]));
      const expected = detail.expected;
      const hasExpectation = Boolean(
        expected?.landCountAtLeast !== undefined ||
        expected?.landIdsAbsent?.length ||
        expected?.landIdsPresent?.length
      );
      const shouldObserveMutation = Boolean(
        detail.source?.includes("claim") ||
        detail.source?.includes("transfer") ||
        detail.source?.includes("mint")
      );
      if (!hasExpectation && !shouldObserveMutation) return undefined;

      return (nextLands: Land[]) => {
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
      };
    },
    [],
  );

  const {
    isError: landsFailed,
    isLoading: landsLoading,
    items: lands,
    reconcile: reconcileLands,
  } = useOwnerResourceList<Land>({
    buildInvariant: buildLandsInvariant,
    domain: "lands",
    isVisible,
    onClear: handleLandsCleared,
    ownerKey,
    queryFn: readLands,
    queryKey: landsQueryKey,
  });

  const selectedLand = useMemo(() => {
    if (lands.length === 0) return null;
    if (missionLandRequest?.owner === ownerKey) {
      const target = lands.find(land => land.tokenId.toString() === missionLandRequest.landId && land.owner.toLowerCase() === ownerKey);
      if (target) return target;
    }
    return lands.find((land) => land.tokenId === preferredLandId) ?? lands[0];
  }, [lands, missionLandRequest, ownerKey, preferredLandId]);
  const selectedLandId = selectedLand?.tokenId ?? null;
  const currentBuildingIdentity = ownerKey && selectedLandId !== null ? `${ownerKey}:${selectedLandId}` : null;
  const { matches: snapshotMatches, villageBuildings, townBuildings, selectedBuilding } = readMatchingLandBuildings(
    currentBuildingIdentity, snapshotIdentity, rawVillageBuildings, rawTownBuildings, buildingType, preferredBuildingId);
  const selectedBuildingId = selectedBuilding?.id ?? null;
  const buildingsError = buildingReadIdentity === currentBuildingIdentity ? rawBuildingsError : null;
  const buildingsLoading = rawBuildingsLoading || (!snapshotMatches && !buildingsError);
  const hasFarmerHouse = townBuildings.some(building => building.id === 7 && building.level > 0);
  const quests = useLandQuestSlots({ owner: ownerKey, chainId: 8453, landId: selectedLandId,
    enabled: hasFarmerHouse && !buildingsError, poll: isVisible && isDocumentVisible });
  const refreshQuests = quests.refresh;

  /**
   * Merges a freshly read single land back into the owner's cached list.
   *
   * The Warehouse and building flows read `landGetById` for up-to-the-second
   * production values. That snapshot used to be written to a separate
   * `selectedLand` state, so the dropdown and the map kept rendering the older
   * copy of the very same land. Writing it into the list keeps one truth.
   */
  const patchLandInCache = useCallback((next: Land) => {
    queryClient.setQueryData<Land[]>(landsQueryKey, (current) =>
      current?.map((land) => (land.tokenId === next.tokenId ? next : land)),
    );
  }, [landsQueryKey, queryClient]);

  // Map data hook. The full-range leaderboard read only happens once the map is
  // actually opened; the plot count stays eager so the header never shows 0.
  const { totalSupply, neighborData, supplyStatus, neighborStatus, isRefreshing, retryMapData } = useLandMap(lands, { enabled: isMapOpen });

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
    setApprovalRead({ owner: ownerKey, status: 'loading' });

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
        setApprovalRead({ owner: ownerKey, status: 'ready' });
      }
    } catch (error) {
      console.error("Failed to fetch land token approval status:", error);
      if (
        approvalFetchIdentityMatches(fetchApprovalStatusPendingRef.current, requestIdentity)
        && ownerGenerationRef.current === requestIdentity.generation
        && ownerKeyRef.current === requestIdentity.ownerKey
      ) {
        setApprovalRead({ owner: ownerKey, status: 'error' });
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

  useLayoutEffect(() => {
    if (ownerKeyRef.current === ownerKey) return;
    const previousOwner = ownerKeyRef.current;
    ownerKeyRef.current = ownerKey;
    ownerGenerationRef.current += 1;
    fetchApprovalStatusPendingRef.current = null;
    fetchApprovalStatusQueuedRef.current = null;
    fetchBuildingDataPendingRef.current = null;
    fetchBuildingDataQueuedRef.current = null;
    selectedLandIdRef.current = null;
    setPreferredLandId(null);
    setVillageBuildings([]);
    setTownBuildings([]);
    setSelectedBuilding(null);
    setSelectedUtilityPanel(null);
    setLeafAllowance(BigInt(0));
    setSeedAllowance(BigInt(0));
    setBuildingsLoading(false);
    setIsMapOpen(false);
    // The land list itself needs no clearing: its query key carries the owner,
    // so wallet B can never observe wallet A's entry.
    if (previousOwner) {
      void queryClient.cancelQueries({ queryKey: queryKeys.landsByOwner(previousOwner) });
    }
  }, [ownerKey, queryClient, setSelectedBuilding]);

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
      setBuildingsError(null);
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
    setBuildingReadIdentity(`${ownerKey}:${landId}`);
    setBuildingsError(null);

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
        setSnapshotIdentity(`${ownerKey}:${landId}`);
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
          const mission = getPendingMissionLand();
          const preferredId = mission?.owner === ownerKey && mission.landId === landId.toString() && mission.buildingType === buildingType
            ? mission.buildingId : lastSelectedBuildingIdRef.current;

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
        setSelectedBuilding(null);
        setBuildingsError('We could not verify this land’s buildings. Retry to load its actions.');
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
  }, [selectedLandId, buildingType, ownerKey, setSelectedBuilding]); // Selection persistence is tracked through lastSelectedBuildingIdRef.

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
          patchLandInCache(latest);
        }
      } catch {
        // noop
      }
    };
    refreshWarehouseOnSelect();
  }, [buildingType, ownerKey, patchLandInCache, selectedBuildingId, selectedLandId]);

  const refreshBuildingSnapshot = useCallback(() => {
    const generation = ownerGenerationRef.current;
    const requestedOwner = ownerKey;
    const requestedLandId = selectedLandId;
    void fetchBuildingData();
    if (hasFarmerHouse) void refreshQuests(false);
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
            patchLandInCache(latest);
          }
        }
      } catch { }
    })();
  }, [fetchBuildingData, hasFarmerHouse, ownerKey, patchLandInCache, refreshQuests, selectedLandId]);

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

  useEffect(() => {
    if (address) {
      fetchApprovalStatus();
    }
  }, [address, fetchApprovalStatus]);

  // The land list reconciles itself inside useOwnerResourceList. This listener
  // owns only the per-land building snapshot, which is keyed on the transient
  // selection and therefore cannot live in the owner-scoped query.
  const lastOwnerBuildingInvalidationRef = useRef(0);
  useEffect(() => onOwnerResourceInvalidation((detail) => {
    if (!ownerInvalidationMatches(detail, ownerKey, "buildings")) return;

    if (detail.clear) {
      ownerGenerationRef.current += 1;
      fetchApprovalStatusPendingRef.current = null;
      fetchApprovalStatusQueuedRef.current = null;
      fetchBuildingDataPendingRef.current = null;
      fetchBuildingDataQueuedRef.current = null;
      setVillageBuildings([]);
      setTownBuildings([]);
      setSelectedBuilding(null);
      setSelectedUtilityPanel(null);
      setBuildingsLoading(false);
      return;
    }

    lastOwnerBuildingInvalidationRef.current = Date.now();
    refreshBuildingSnapshot();
  }), [ownerKey, refreshBuildingSnapshot, setSelectedBuilding]);

  // Backward compatibility for panels not yet migrated to the owner-domain API.
  useEffect(() => {
    const handler = () => {
      if (Date.now() - lastOwnerBuildingInvalidationRef.current < 500) return;
      refreshBuildingSnapshot();
    };
    window.addEventListener('buildings:refresh', handler as EventListener);
    return () => window.removeEventListener('buildings:refresh', handler as EventListener);
  }, [refreshBuildingSnapshot]);

  // The land list refetches through React Query's focus and reconnect managers.
  // Buildings are read per selected land, so they still need their own hook.
  const lastLifecycleReconcileRef = useRef(0);
  useEffect(() => {
    if (!address || !isVisible) return;
    const reconcile = () => {
      if (document.visibilityState !== "visible" || !navigator.onLine) return;
      if (selectedLandIdRef.current === null) return;
      const now = Date.now();
      if (now - lastLifecycleReconcileRef.current < 15_000) return;
      lastLifecycleReconcileRef.current = now;
      refreshBuildingSnapshot();
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
  }, [address, isVisible, refreshBuildingSnapshot, setSelectedBuilding]);

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
    setDetailRequest(0);
    buildingReturnRef.current = null;
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
          patchLandInCache(latest);
        }
      } catch { }
    })();
    return () => { cancelled = true; };
  }, [ownerKey, patchLandInCache, selectedLandId, setSelectedBuilding]);

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

  // A mission can arrive before this lazy view mounts or while Activity has
  // suspended its effects. Keep it pending until the owner's land and building
  // snapshots agree, then consume only this request (a newer click wins).
  useEffect(() => {
    clearMissionLandForOwner(ownerKey);
    if (!missionLandRequest || missionLandRequest.owner !== ownerKey || landsLoading) return;
    const targetLand = lands.find(land => land.tokenId.toString() === missionLandRequest.landId && land.owner.toLowerCase() === ownerKey);
    if (!targetLand) {
      if (!landsFailed) consumeMissionLand(missionLandRequest.requestId);
      return;
    }
    setPreferredLandId(targetLand.tokenId);
    setSelectedUtilityPanel(null);
    setIsMapOpen(false);
    if (buildingType !== missionLandRequest.buildingType) {
      setBuildingType(missionLandRequest.buildingType);
      return;
    }
    if (!snapshotMatches || buildingsLoading || buildingsError) return;
    const targetBuilding = (buildingType === 'town' ? townBuildings : villageBuildings)
      .find(building => building.id === missionLandRequest.buildingId);
    if (targetBuilding) {
      lastSelectedBuildingIdRef.current = targetBuilding.id;
      setSelectedBuilding(targetBuilding);
      setMissionDetailFocus(true);
      setDetailRequest(value => value + 1);
    }
    consumeMissionLand(missionLandRequest.requestId);
  }, [buildingType, buildingsError, buildingsLoading, lands, landsFailed, landsLoading, missionLandRequest,
    ownerKey, setSelectedBuilding, snapshotMatches, townBuildings, villageBuildings]);

  // One shared Base block query drives both construction and quest deadlines.
  const hasUpgradingBuildings = [...villageBuildings, ...townBuildings].some(building => building.isUpgrading);

  const { data: liveBlock } = useBlockNumber({ chainId: 8453,
    watch: (hasUpgradingBuildings || hasFarmerHouse) && isVisible && isDocumentVisible });
  const currentBlock = liveBlock ?? BigInt(0);

  const cancelMissionReveal = useCallback(() => {
    const request = getPendingMissionLand();
    if (request) consumeMissionLand(request.requestId);
  }, []);

  const handleLandSelect = useCallback((landId: bigint) => {
    cancelMissionReveal();
    setPreferredLandId(landId);
  }, [cancelMissionReveal]);

  const handleBuildingSelect = useCallback((type: BuildingType, building: BuildingData) => {
    cancelMissionReveal();
    setMissionDetailFocus(false);
    setSelectedUtilityPanel(null);
    setBuildingType(type);
    setSelectedBuilding(building);
    setDetailRequest(value => value + 1);
  }, [cancelMissionReveal, setSelectedBuilding]);

  const handleBatchClaimUtilitySelect = useCallback(() => {
    cancelMissionReveal();
    setMissionDetailFocus(false);
    setBuildingType('village');
    setSelectedUtilityPanel('batch-claim');
    setDetailRequest(value => value + 1);
  }, [cancelMissionReveal]);

  const handleBatchQuestUtilitySelect = useCallback(() => {
    cancelMissionReveal();
    setMissionDetailFocus(false);
    setBuildingType('town');
    setSelectedUtilityPanel('batch-quests');
    setDetailRequest(value => value + 1);
  }, [cancelMissionReveal]);

  const returnToBuildings = useCallback(() => {
    // Returning is navigation only: retain the selected panel and its mounted
    // transaction controller, drafts and pending receipt state.
    setDetailRequest(0);
    setMissionDetailFocus(false);
    const previous = buildingReturnRef.current;
    const grid = buildingGridRef.current;
    const trigger = previous?.trigger.isConnected && grid?.contains(previous.trigger)
      ? previous.trigger
      : grid?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? grid;
    trigger?.focus({ preventScroll: true });
    if (previous?.scroller?.isConnected && trigger === previous.trigger) {
      previous.scroller.scrollTo({ top: previous.scrollTop, behavior: 'instant' });
    } else {
      trigger?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }, []);

  useEffect(() => {
    if (!detailRequest || (isDesktopLand && !missionDetailFocus)) return;
    const frame = requestAnimationFrame(() => {
      detailRef.current?.focus({ preventScroll: true });
      detailRef.current?.scrollIntoView({ block: 'start', behavior: 'instant' });
    });
    return () => cancelAnimationFrame(frame);
  }, [detailRequest, isDesktopLand, missionDetailFocus]);

  const handleBatchQuestSuccess = useCallback(() => {
    invalidateOwnerResources({
      address: ownerKey,
      domains: ["buildings", "lands", "balances"],
      source: "lands-view:batch-quest",
    });
  }, [ownerKey]);


  // Only block render if we have NO lands data at all
  if (landsLoading) {
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

  // A failed background refresh keeps the last good snapshot on screen; only a
  // first read with nothing cached is allowed to surface as an error.
  if (landsFailed && lands.length === 0) {
    return (
      <Card>
        <CardContent className="space-y-3 py-4 text-center">
          <p className="text-destructive">Failed to load your lands.</p>
          <Button variant="outline" onClick={() => { void reconcileLands({ force: true }); }}>
            Retry
          </Button>
        </CardContent>
      </Card>
    );
  }

  if (lands.length === 0) {
    return (
      <EmptyFarm asset="land" />
    );
  }

  return (
    <div className="space-y-4 tablet:mx-auto tablet:max-w-[44rem] xl:max-w-none">
      {selectedLand && (
        <div className="space-y-4 xl:mx-auto xl:grid xl:w-full xl:max-w-[1368px] xl:items-start xl:justify-center xl:gap-5 xl:space-y-0 xl:grid-cols-[minmax(320px,420px)_minmax(760px,928px)]">
          <div className="mx-auto w-full max-w-[420px] space-y-4 xl:sticky xl:top-0">
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
                  <DropdownMenuContent matchTriggerWidth className=" [--menu-max-height:15rem] overflow-y-auto">
                    {lands.map((land) => (
                      <DropdownMenuItem key={land.tokenId.toString()} onSelect={() => handleLandSelect(land.tokenId)}>
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
              <div className="relative aspect-square w-full overflow-hidden rounded-[var(--radius-panel)] border border-border/45 bg-card bg-[image:var(--gradient-creature-stage)] surface-shadow-raised">
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

                <LandResourceBadges land={selectedLand} />

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
                          handleLandSelect(lands[prevIndex].tokenId);
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
                          handleLandSelect(lands[nextIndex].tokenId);
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
                <AssetTitle name={selectedLand.name || `Land #${selectedLand.tokenId}`} edit={<EditLandName
                    land={selectedLand}
                    onNameChanged={(landId, newName) => {
                      // Patch the shared cache entry so the selector, the map
                      // and the stage all pick the new name up at once.
                      queryClient.setQueryData<Land[]>(landsQueryKey, (current) =>
                        current?.map((land) => (land.tokenId === landId ? { ...land, name: newName } : land)),
                      );
                    }}
                    iconSize={18}
                    className="h-11 min-h-11 w-11 min-w-11 shrink-0"
                  />} />
                {selectedLand.name && <p className="text-sm text-muted-foreground">Land #{selectedLand.tokenId.toString()}</p>}
              </div>
            </CardContent>
          </TabCard>

          </div>

          <div className="min-w-0 space-y-4">
          {/* Building Management Section */}
          <TabCard className="xl:h-fit xl:w-full">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle>Buildings</CardTitle>
                <div className="max-w-full xl:hidden">
                  <ToggleGroup
                    ariaLabel="Land area"
                    className="max-w-full flex-wrap"
                    getButtonClassName={() => 'min-w-0 flex-1 whitespace-normal break-words'}
                    value={buildingType}
                    onValueChange={(v) => {
                      cancelMissionReveal();
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
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(360px,1fr)] xl:items-start">
                {/* Building Grid */}
                <div ref={buildingGridRef} tabIndex={-1} aria-label="Choose a building" className="space-y-4 scroll-mt-4 focus:outline-none"
                  onClickCapture={(event) => {
                    if (isDesktopLand || !(event.target instanceof Element)) return;
                    const trigger = event.target.closest<HTMLButtonElement>('button[aria-pressed]');
                    if (!trigger || !event.currentTarget.contains(trigger)) return;
                    const scroller = event.currentTarget.closest<HTMLElement>('[data-viewport-shell="content"]');
                    buildingReturnRef.current = { trigger, scroller, scrollTop: scroller?.scrollTop ?? 0 };
                  }}>
                  {buildingsLoading && snapshotMatches && <p role="status" className="text-xs text-muted-foreground">Refreshing this land’s buildings…</p>}
                  {buildingsError ? <ResourceState status="error" title="Buildings unavailable" description={buildingsError} onRetry={() => { void fetchBuildingData(); }} /> : buildingsLoading && (!villageBuildings.length && !townBuildings.length) ? (
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
                <section ref={detailRef} tabIndex={-1} aria-label="Selected building details" className="min-w-0 scroll-mt-4 space-y-3 focus:outline-none">
                {snapshotMatches && !buildingsError && (selectedBuilding || selectedUtilityPanel) && (
                  <Button type="button" variant="ghost" className="min-h-11 max-w-full justify-start whitespace-normal xl:hidden" onClick={returnToBuildings}>
                    <ArrowLeft className="h-4 w-4 shrink-0" aria-hidden="true" />
                    Back to buildings
                  </Button>
                )}
                {snapshotMatches && !buildingsError && (selectedUtilityPanel === 'batch-claim' ? (
                  <BatchClaimCard
                    lands={lands}
                    onSuccess={handleBatchClaimSuccess}
                    onOpenBuildings={villageBuildings.length ? () => {
                      const production = villageBuildings.filter(entry => [0, 3, 5].includes(entry.id));
                      const building = production.find(entry => entry.level > 0) ?? production[0] ?? villageBuildings[0];
                      handleBuildingSelect('village', building);
                    } : undefined}
                    variant="embedded"
                    showWhenEmpty
                  />
                ) : selectedUtilityPanel === 'batch-quests' ? (
                  <BatchQuestStartCard
                    lands={lands}
                    onSuccess={handleBatchQuestSuccess}
                    onOpenFarmerHouse={townBuildings.some(entry => entry.id === 7) ? () => {
                      const building = townBuildings.find(entry => entry.id === 7);
                      if (building) handleBuildingSelect('town', building);
                    } : undefined}
                    variant="embedded"
                    showWhenEmpty
                  />
                ) : selectedBuilding && (
                  <div className="scroll-mt-4"><BuildingDetailsPanel
                    selectedBuilding={selectedBuilding}
                    landId={selectedLand.tokenId}
                    buildingType={buildingType}
                    onUpgradeSuccess={handleBuildingTransactionSuccess}
                    currentBlock={currentBlock}
                    leafAllowance={leafAllowance}
                    onLeafApprovalSuccess={fetchApprovalStatus}
                    seedAllowance={seedAllowance}
                    allowancesReady={allowancesReady}
                    allowancesError={allowancesError}
                    onRetryAllowances={() => void fetchApprovalStatus()}
                    onSeedApprovalSuccess={fetchApprovalStatus}
                    warehousePoints={selectedLand.accumulatedPlantPoints}
                    warehouseLifetime={selectedLand.accumulatedPlantLifetime}
                    villageBuildings={villageBuildings}
                  /></div>
                ))}
                </section>
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
            handleLandSelect(land.tokenId);
            setIsMapOpen(false);
          }}
          totalSupply={totalSupply}
          neighborData={neighborData}
          supplyStatus={supplyStatus}
          neighborStatus={neighborStatus}
          isRefreshing={isRefreshing}
          onRetryMapData={retryMapData}
        />
      )}
    </div>
  );
}
