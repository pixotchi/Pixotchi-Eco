"use client";
import { getAttackOutcome } from "@/lib/ranking-outcome";
import { isTransactionActionPending } from "@/lib/transaction-lifecycle";
import { parseTransactionHash, type TransactionReceiptLike } from "@/lib/transaction-utils";
import type { LifecycleStatus } from "@/components/transactions/transaction-kit";
import { PIXOTCHI_NFT_ADDRESS } from "@/lib/contracts";
import { useStakeLeaderboard, useRocksLeaderboard } from "@/hooks/useApiLeaderboards";
import type { StakeLeaderboardEntry, RocksLeaderboardEntry } from "@/lib/ranking-response";
import { useLandLeaderboard } from "@/hooks/useLandLeaderboard";
import type { LandLeaderboardRow } from "@/lib/land-ranking";
import { ResourceState } from "@/components/ui/resource-state";
import { RankingPlantSummary } from "@/components/ranking-plant-summary";
import { RankingColumns } from "@/components/ranking-columns";
import { getTotalPages, getBoundedPage, getPageRows, DESKTOP_ITEMS_PER_PAGE, type RankedRow } from "@/lib/ranking-pagination";

import { SponsoredBadge } from "@/components/paymaster-toggle";
import { EmptyState } from "@/components/ui/empty-state";
import { EfpTransactionBoundary } from "@/components/efp-transaction-boundary";
import PlantProfileDialog from "@/components/plant-profile-dialog";
import PlantImage from "@/components/PlantImage";
import { SolanaNotSupported,useIsSolanaWallet,useTwinAddress } from "@/components/solana";
import AttackTransaction from "@/components/transactions/attack-transaction";
import KillTransaction from "@/components/transactions/kill-transaction";
import ReviveTransaction from "@/components/transactions/revive-transaction";

import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { CardContent, CardHeader, CardTitle, TabCard } from "@/components/ui/card";
import { Dialog,DialogBody,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { BaseExpandedLoadingPageLoader } from "@/components/ui/loading";
import { PaginationFooter } from "@/components/ui/pagination-footer";
import { DisabledReason, InlineBalanceNotice } from "@/components/ui/premium";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { WalletAvatar } from "@/components/ui/wallet-avatar";
import { useWebQueryState } from "@/hooks/useWebQueryState";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { getBaseTransactionReceipt } from "@/lib/base-rpc";
import { getAliveTokenIds,getKillCooldown,getPlantsByOwner,getPlantsInfoExtended,getRevivePrice,getTokenBalance } from "@/lib/contracts";
import { CLIENT_ENV } from "@/lib/env-config";
import { useFrameContext } from "@/lib/frame-context";
import { getClientGamificationPolicy } from "@/lib/gamification-client";
import { postMissionProgress } from "@/lib/mission-tracking";
import { usePaymaster } from "@/lib/paymaster-context";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { useTabVisibility } from "@/lib/tab-visibility-context";
import { Plant } from "@/lib/types";
import { cn,formatAddress,formatEthShort,formatScoreShort,formatTokenAmount,getFenceStatus } from "@/lib/utils";
import { ChevronDown,Skull,Terminal,Flower2,LandPlot,Coins } from "lucide-react";
import Image from "next/image";
import React,{ useCallback,useEffect,useMemo,useRef,useState } from "react";
import dynamic from "next/dynamic";
import toast from "react-hot-toast";
import { useAccount } from "wagmi";

// Dynamic (matching plants-view): a static import dragged @solana/web3.js into
// this chunk for every user via the bridge button's PublicKey import.
const SolanaBridgeButton = dynamic(() => import("@/components/transactions/solana-bridge-button"), {
  loading: () => <Button className="w-full" disabled>Loading...</Button>,
  ssr: false,
});

type LeaderboardPlant = Plant & {
  rank: number;
  isDead: boolean;
};

const ITEMS_PER_PAGE = 12;

// Client-side cache duration for stake data (24 hours since cron runs once at midnight)
const DEFAULT_REVIVE_PRICE = BigInt(100) * (BigInt(10) ** BigInt(18));
const ATTACK_SCORE_TRANSFER_RATE = 0.005; // on-chain pct=5 means 0.5% of the loser score
const ATTACK_WIN_CHANCE_PERCENT = 31; // random 0..99 wins when <= 30
const ATTACK_LOSS_CHANCE_PERCENT = 100 - ATTACK_WIN_CHANCE_PERCENT;
const RANKING_ACTION_BUTTON_CLASS =
  "flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] border border-border/60 bg-transparent p-0 text-foreground shadow-none hover:bg-muted hover:text-primary";
const RANKING_ACTION_ICON_CLASS = "h-6 w-6 object-contain";

function formatAttackScoreDelta(score: number, direction: "gain" | "loss") {
  const formatted = formatScoreShort(score);
  if (score <= 0 || formatted === "0") return formatted;
  return `${direction === "gain" ? "+" : "-"}${formatted}`;
}

function hasActiveFence(plant: LeaderboardPlant) {
  const fenceInfo = getFenceStatus(plant);
  return fenceInfo.hasActiveFence;
}

function isDead(p: { status: number }) {
  return p.status === 4;
}

function nowSec() {
  return Math.floor(Date.now() / 1000);
}

export default function LeaderboardTab() {
  const gamificationDisabled = CLIENT_ENV.GAMIFICATION_DISABLED;
  const gamificationDisabledMessage = CLIENT_ENV.GAMIFICATION_DISABLED_MESSAGE;
  const frame = useFrameContext();
  const gamificationPolicy = getClientGamificationPolicy();
  const showRocksBoard = gamificationPolicy.visible;
  const { address: evmAddress } = useAccount();
  const { isSponsored } = usePaymaster();
  const { isSmartWallet } = useSmartWallet();
  const isSolana = useIsSolanaWallet();
  const twinAddress = useTwinAddress();
  const { isTabVisible } = useTabVisibility();
  const isVisible = isTabVisible('leaderboard');
  const usesCompactPageScroll = useMediaQuery("(max-width: 53.99rem) and (max-height: 700px)");
  // See the 30s freshness guard on the visibility refetch effect below.
  const lastVisibleFetchRef = useRef(0);

  // Use Twin address for Solana users, EVM address otherwise
  // Memoize to prevent unnecessary re-renders when dependencies haven't actually changed
  const address = useMemo(() => {
    return isSolana && twinAddress ? twinAddress as `0x${string}` : evmAddress;
  }, [isSolana, twinAddress, evmAddress]);
  const [plants, setPlants] = useState<LeaderboardPlant[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Render one layout, not both. renderResponsiveRows used to emit the 12-row
  // mobile list AND the 20-row desktop grid (plus two paginations) and let CSS hide
  // one, so every page change built 32 rows to paint at most 20. Each row is ~240
  // lines of JSX with ~14 <Image> children.
  //
  // The CSS tablet classes below are deliberately kept: during the first frame
  // after a resize (before the change event lands) they prevent both sets showing.
  const [isDesktopBoard, setIsDesktopBoard] = useState(
    () => typeof window !== 'undefined' && Boolean(window.matchMedia?.('(min-width: 54rem)').matches),
  );
  // Total rows on the currently-selected board, kept in a ref so the resize handler
  // can clamp the shared page index without re-subscribing on every data change.
  const activeTotalItemsRef = useRef(0);
  const [currentPage, setCurrentPage] = useWebQueryState<number>({
    key: "leaderboardPage",
    defaultValue: 1,
    enabled: !frame?.isInMiniApp,
    parse: (rawValue) => {
      if (!rawValue) return null;
      const parsed = Number.parseInt(rawValue, 10);
      return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    },
    serialize: (value) => (value <= 1 ? null : value.toString()),
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mq = window.matchMedia('(min-width: 54rem)');

    // Adopt the current breakpoint without clamping. Clamping here would run before
    // the row data has loaded, when activeTotalItemsRef is still 0 — and
    // getTotalPages(0, n) is 1, so a deep-linked or refreshed ?leaderboardPage=3
    // would be rewritten to page 1 (and the param dropped from the URL) before the
    // page it names could ever render.
    setIsDesktopBoard(mq.matches);

    const handleChange = (event: MediaQueryListEvent) => {
      setIsDesktopBoard(event.matches);
      // Page size changes with the breakpoint (12 <-> 20) while currentPage is
      // shared, so clamp or a user on page 3 of 12 rotates into an empty page.
      // Only meaningful once rows exist; before that there is nothing to clamp to.
      const totalItemsForBoard = activeTotalItemsRef.current;
      if (totalItemsForBoard === 0) return;
      const nextSize = event.matches ? DESKTOP_ITEMS_PER_PAGE : ITEMS_PER_PAGE;
      setCurrentPage((page) => Math.max(1, Math.min(page, getTotalPages(totalItemsForBoard, nextSize))));
    };

    if (typeof mq.addEventListener === 'function') {
      mq.addEventListener('change', handleChange);
      return () => mq.removeEventListener('change', handleChange);
    }

    mq.addListener(handleChange);
    return () => mq.removeListener(handleChange);
  }, [setCurrentPage]);

  const [myPlants, setMyPlants] = useState<Plant[]>([]);
  const [attackDialogOpen, setAttackDialogOpen] = useState(false);
  const [targetPlant, setTargetPlant] = useState<LeaderboardPlant | null>(null);
  const [selectedAttackerId, setSelectedAttackerId] = useState<number | null>(null);
  const [attackMenuPortalContainer, setAttackMenuPortalContainer] = useState<HTMLElement | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingHash, setPendingHash] = useState<string | null>(null);
  const [killDialogOpen, setKillDialogOpen] = useState(false);
  const [killMenuPortalContainer, setKillMenuPortalContainer] = useState<HTMLElement | null>(null);
  const [reviveDialogOpen, setReviveDialogOpen] = useState(false);
  const [selectedKillerId, setSelectedKillerId] = useState<number | null>(null);
  const [seedBalance, setSeedBalance] = useState<bigint>(BigInt(0));
  const [revivePrice, setRevivePrice] = useState<bigint>(DEFAULT_REVIVE_PRICE);
  const [filterMode, setFilterMode] = useWebQueryState<'all' | 'attackable' | 'dead'>({
    key: 'leaderboardFilter',
    defaultValue: 'all',
    enabled: !frame?.isInMiniApp,
    parse: (rawValue) =>
      rawValue === 'all' || rawValue === 'attackable' || rawValue === 'dead' ? rawValue : null,
    serialize: (value) => (value === 'all' ? null : value),
  });
  const [showOnlyMyPlants, setShowOnlyMyPlants] = useWebQueryState<boolean>({
    key: 'leaderboardMine',
    defaultValue: false,
    enabled: !frame?.isInMiniApp,
    parse: (rawValue) => {
      if (rawValue === '1') return true;
      if (rawValue === '0' || rawValue === null) return false;
      return null;
    },
    serialize: (value) => (value ? '1' : null),
  });
  const [boardType, setBoardType] = useWebQueryState<'plants' | 'lands' | 'stake' | 'rocks'>({
    key: 'leaderboardBoard',
    defaultValue: 'plants',
    enabled: !frame?.isInMiniApp,
    parse: (rawValue) =>
      rawValue === 'plants' ||
      rawValue === 'lands' ||
      rawValue === 'stake' ||
      rawValue === 'rocks'
        ? rawValue
        : null,
    serialize: (value) => (value === 'plants' ? null : value),
  });
  const stakeRanking = useStakeLeaderboard({ enabled: boardType === 'stake' && isVisible });
  const rocksRanking = useRocksLeaderboard({ enabled: boardType === 'rocks' && showRocksBoard && isVisible,
    disabledMessage: gamificationDisabled ? gamificationDisabledMessage : undefined });
  const { rows: stakeRows, loading: stakeLoading, error: stakeError, refresh: fetchStakeLeaderboard } = stakeRanking;
  const { rows: rocksRows, loading: rocksLoading, error: rocksError, disabledNotice: rocksDisabledNotice, refresh: fetchRocksLeaderboard } = rocksRanking;
  const landRanking = useLandLeaderboard({ enabled: boardType === "lands" });
  const landRows = landRanking.rows;
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [selectedPlantForProfile, setSelectedPlantForProfile] = useState<LeaderboardPlant | null>(null);
  const handleAttackDialogFrameRef = useCallback((node: HTMLDivElement | null) => {
    setAttackMenuPortalContainer(node);
  }, []);
  const handleKillDialogFrameRef = useCallback((node: HTMLDivElement | null) => {
    setKillMenuPortalContainer(node);
  }, []);

  // Kill cooldown state (1 kill per hour per wallet)
  const [killCooldown, setKillCooldown] = useState<{ canKill: boolean; remainingSeconds: number }>({ canKill: true, remainingSeconds: 0 });
  const [cooldownDialogOpen, setCooldownDialogOpen] = useState(false);

  // Timer for cooldown countdown
  useEffect(() => {
    if (killCooldown.remainingSeconds <= 0) return;
    const interval = setInterval(() => {
      setKillCooldown(prev => {
        const next = prev.remainingSeconds - 1;
        if (next <= 0) {
          return { canKill: true, remainingSeconds: 0 };
        }
        return { ...prev, remainingSeconds: next };
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [killCooldown.remainingSeconds]);

  // Request deduplication refs to prevent multiple simultaneous calls
  const fetchLeaderboardDataPendingRef = useRef<boolean>(false);
  const fetchMyPlantsPendingRef = useRef<string | null>(null);
  const leaderboardDataLoadedRef = useRef(false);

  const showAttackOutcomeFromLogs = useCallback((logs: NonNullable<TransactionReceiptLike['logs']>) => {
    const outcome = getAttackOutcome(logs, PIXOTCHI_NFT_ADDRESS);
    if (!outcome) return false;
    (outcome.didWin ? toast.success : toast.error)(outcome.message, { id: 'attack-result' });
    return true;
  }, []);
  const showAttackOutcomeFromHash = useCallback(async (value?: string | null) => {
    const hash = parseTransactionHash(value);
    if (!hash) return false;
    try { return showAttackOutcomeFromLogs((await getBaseTransactionReceipt(hash)).logs); }
    catch { return false; }
  }, [showAttackOutcomeFromLogs]);

  const fetchLeaderboardData = useCallback(async () => {
    // Prevent duplicate simultaneous calls
    if (fetchLeaderboardDataPendingRef.current) {
      return;
    }

    fetchLeaderboardDataPendingRef.current = true;

    // Only show loader on initial data fetch
    if (!leaderboardDataLoadedRef.current) {
      setLoading(true);
    }
    setError(null);

    try {
      // Get all alive token IDs
      const aliveTokenIds = await getAliveTokenIds();

      // Get detailed plant info for all alive plants
      const plantsData = await getPlantsInfoExtended(aliveTokenIds);

      // Sort by score (highest first) and add ranking
      const sortedPlants = plantsData
        .sort((a, b) => b.score - a.score)
        .map((plant, index) => ({
          ...plant,
          rank: index + 1,
          isDead: plant.status === 4 // Assuming status 4 is dead
        }));

      setPlants(sortedPlants);
      leaderboardDataLoadedRef.current = true;

    } catch (err) {
      console.error('Error fetching leaderboard data:', err);
      setError('Failed to load leaderboard data. Please try again.');
    } finally {
      setLoading(false);
      fetchLeaderboardDataPendingRef.current = false;
    }
  }, []);

  useEffect(() => {
    fetchLeaderboardData();
  }, [fetchLeaderboardData]);

  useEffect(() => {
    if (showRocksBoard || boardType !== 'rocks') return;
    setCurrentPage(1);
    setBoardType('plants');
  }, [boardType, setBoardType, setCurrentPage, showRocksBoard]);

  // Fetch user's plants for attack selection
  const fetchMyPlants = useCallback(async () => {
    if (!address) {
      setMyPlants([]);
      fetchMyPlantsPendingRef.current = null;
      return;
    }

    // Prevent duplicate calls for the same address
    if (fetchMyPlantsPendingRef.current === address) {
      return;
    }

    fetchMyPlantsPendingRef.current = address;

    try {
      const owned = await getPlantsByOwner(address);
      // Only update if address hasn't changed during the fetch
      if (fetchMyPlantsPendingRef.current === address) {
        setMyPlants(owned);
      }
    } catch {
      // ignore
    } finally {
      // Clear pending flag only if address hasn't changed
      if (fetchMyPlantsPendingRef.current === address) {
        fetchMyPlantsPendingRef.current = null;
      }
    }
  }, [address]);

  useEffect(() => { void fetchMyPlants(); }, [fetchMyPlants]);

  // Kill cooldown functions - reads from onchain KillCooldown extension
  const fetchKillCooldown = useCallback(async () => {
    if (!address) return;
    try {
      const data = await getKillCooldown(address);
      setKillCooldown({ canKill: data.canKill, remainingSeconds: data.remainingSeconds });
    } catch (error) {
      console.error('Failed to fetch kill cooldown from contract:', error);
      // On error, allow kills (graceful degradation)
      setKillCooldown({ canKill: true, remainingSeconds: 0 });
    }
  }, [address]);

  // Fetch kill cooldown on mount and when address changes
  useEffect(() => {
    fetchKillCooldown();
  }, [fetchKillCooldown]);

  // Also fetch when kill dialog opens
  useEffect(() => {
    if (killDialogOpen) {
      fetchKillCooldown();
    }
  }, [killDialogOpen, fetchKillCooldown]);

  // Refresh data when tab becomes visible
  useEffect(() => {
    if (isVisible && Date.now() - lastVisibleFetchRef.current > 30_000) {
      lastVisibleFetchRef.current = Date.now();
      fetchLeaderboardData();
      void fetchMyPlants();

    }
  }, [isVisible, fetchLeaderboardData, fetchMyPlants]);

  // Refresh SEED balance when opening revive dialog
  useEffect(() => {
    (async () => {
      if (reviveDialogOpen && address) {
        try {
          const [bal, price] = await Promise.all([
            getTokenBalance(address),
            getRevivePrice().catch(() => DEFAULT_REVIVE_PRICE),
          ]);
          setSeedBalance(bal || BigInt(0));
          setRevivePrice(price || DEFAULT_REVIVE_PRICE);
        } catch { }
      }
    })();
  }, [reviveDialogOpen, address]);

  const getRankIcon = (rank: number) => {
    switch (rank) {
      case 1:
        return <Image src="/icons/1st.svg" alt="1st Place" width={20} height={20} />;
      case 2:
        return <Image src="/icons/2nd.svg" alt="2nd Place" width={20} height={20} />;
      case 3:
        return <Image src="/icons/3rd.svg" alt="3rd Place" width={20} height={20} />;
      default:
        return null; // No icon for ranks beyond 3rd
    }
  };

  const getRankColor = (rank: number) => {
    switch (rank) {
      case 1:
        return "text-yellow-500 font-bold";
      case 2:
        return "text-gray-400 font-bold";
      case 3:
        return "text-amber-600 font-bold";
      default:
        return "text-foreground";
    }
  };

  // Precomputed once per myPlants change; the old .some() scan ran twice per
  // row per render, including on every tick of the 1Hz kill-cooldown timer.
  const myPlantIds = useMemo(() => new Set(myPlants.map((p) => p.id)), [myPlants]);
  const isUserPlant = useCallback((plant: LeaderboardPlant) => {
    // Robust ownership detection: compare owner to connected address and fall back to myPlants list
    const addr = address ? address.toLowerCase() : null;
    const ownerMatches = addr ? plant.owner?.toLowerCase() === addr : false;
    return ownerMatches || myPlantIds.has(plant.id);
  }, [address, myPlantIds]);

  // Eligibility checks (client-side guardrails based on app rules)
  const attackerCooldownOver = useCallback((attacker: Plant) => {
    const last = Number(attacker.lastAttackUsed || '0');
    return nowSec() >= last + 30 * 60; // 30 minutes
  }, []);
  const targetCooldownOver = useCallback((target: LeaderboardPlant) => {
    const last = Number(target.lastAttacked || '0');
    return nowSec() >= last + 60 * 60; // 60 minutes
  }, []);
  const canAttackWith = useCallback((attacker: Plant, target: LeaderboardPlant) => {
    if (!attacker || !target) return false;
    if (isDead(attacker) || isDead(target)) return false;
    if (attacker.id === target.id) return false;
    if (attacker.level >= target.level) return false;
    if (!attackerCooldownOver(attacker)) return false;
    if (!targetCooldownOver(target)) return false;
    if (hasActiveFence(target)) return false;
    return true;
  }, [attackerCooldownOver, targetCooldownOver]);
  const eligibleAttackers = useCallback((target: LeaderboardPlant): Plant[] => myPlants.filter((p) => canAttackWith(p, target)), [canAttackWith, myPlants]);
  const attackDialogAttackers = useMemo(
    () => (targetPlant ? eligibleAttackers(targetPlant) : []),
    [eligibleAttackers, targetPlant]
  );
  const selectedAttacker = useMemo(
    () => attackDialogAttackers.find((plant) => plant.id === selectedAttackerId) ?? null,
    [attackDialogAttackers, selectedAttackerId]
  );
  const attackOutcomePreview = useMemo(() => {
    if (!selectedAttacker || !targetPlant) return null;

    return {
      winScore: Math.max(0, Math.floor(targetPlant.score * ATTACK_SCORE_TRANSFER_RATE)),
      loseScore: Math.max(0, Math.floor(selectedAttacker.score * ATTACK_SCORE_TRANSFER_RATE)),
    };
  }, [selectedAttacker, targetPlant]);
  const livingKillerPlants = useMemo(
    () => myPlants.filter((plant) => plant.status !== 4),
    [myPlants]
  );
  const selectedKillerPlant = useMemo(
    () => livingKillerPlants.find((plant) => plant.id === selectedKillerId) ?? null,
    [livingKillerPlants, selectedKillerId]
  );

  useEffect(() => {
    if (!attackDialogOpen || !targetPlant) return;

    if (attackDialogAttackers.length === 0) {
      setSelectedAttackerId(null);
      return;
    }

    if (!attackDialogAttackers.some((plant) => plant.id === selectedAttackerId)) {
      setSelectedAttackerId(attackDialogAttackers[0]?.id ?? null);
    }
  }, [attackDialogAttackers, attackDialogOpen, selectedAttackerId, targetPlant]);

  useEffect(() => {
    if (!killDialogOpen || !targetPlant) return;

    if (livingKillerPlants.length === 0) {
      setSelectedKillerId(null);
      return;
    }

    if (!livingKillerPlants.some((plant) => plant.id === selectedKillerId)) {
      setSelectedKillerId(livingKillerPlants[0]?.id ?? null);
    }
  }, [killDialogOpen, livingKillerPlants, selectedKillerId, targetPlant]);

  const handlePlantImageClick = (plant: LeaderboardPlant) => {
    setSelectedPlantForProfile(plant);
    setProfileDialogOpen(true);
    if (!address) return;
    postMissionProgress({ address, taskId: 's2_visit_profile' }).catch(() => { });
  };

  const isAttackable = useCallback((plant: LeaderboardPlant) => !isUserPlant(plant) && !plant.isDead && eligibleAttackers(plant).length > 0 && !hasActiveFence(plant), [eligibleAttackers, isUserPlant]);

  // Apply filters: My Plants filter takes priority, then All/Attackable mode
  const filteredPlants = useMemo(() => {
    let filtered = plants;

    // Filter by ownership if "My Plants" is checked
    if (showOnlyMyPlants) {
      filtered = filtered.filter(isUserPlant);
    }

    // Then apply filter based on mode
    if (filterMode === 'attackable') {
      filtered = filtered.filter(isAttackable);
    } else if (filterMode === 'dead') {
      filtered = filtered.filter(plant => plant.isDead);
    }

    return filtered;
  }, [plants, showOnlyMyPlants, filterMode, isUserPlant, isAttackable]);

  const totalItems = filteredPlants.length;
  const totalPages = getTotalPages(totalItems, ITEMS_PER_PAGE);
  const desktopTotalPages = getTotalPages(totalItems, DESKTOP_ITEMS_PER_PAGE);
  const currentPlants = getPageRows(filteredPlants, currentPage, ITEMS_PER_PAGE);
  const desktopPlants = getPageRows(filteredPlants, currentPage, DESKTOP_ITEMS_PER_PAGE);

  // Lands pagination
  const totalLandItems = landRows.length;
  const totalLandPages = getTotalPages(totalLandItems, ITEMS_PER_PAGE);
  const desktopLandPages = getTotalPages(totalLandItems, DESKTOP_ITEMS_PER_PAGE);
  const currentLands = getPageRows(landRows, currentPage, ITEMS_PER_PAGE);
  const desktopLands = getPageRows(landRows, currentPage, DESKTOP_ITEMS_PER_PAGE);

  // Stake pagination
  const totalStakeItems = stakeRows.length;
  const totalStakePages = getTotalPages(totalStakeItems, ITEMS_PER_PAGE);
  const desktopStakePages = getTotalPages(totalStakeItems, DESKTOP_ITEMS_PER_PAGE);
  const currentStakes = getPageRows(stakeRows, currentPage, ITEMS_PER_PAGE);
  const desktopStakes = getPageRows(stakeRows, currentPage, DESKTOP_ITEMS_PER_PAGE);

  const totalRockItems = rocksRows.length;

  activeTotalItemsRef.current =
    boardType === 'plants' ? totalItems
    : boardType === 'lands' ? totalLandItems
    : boardType === 'stake' ? totalStakeItems
    : totalRockItems;
  const totalRockPages = getTotalPages(totalRockItems, ITEMS_PER_PAGE);
  const desktopRockPages = getTotalPages(totalRockItems, DESKTOP_ITEMS_PER_PAGE);
  const currentRocks = getPageRows(rocksRows, currentPage, ITEMS_PER_PAGE);
  const desktopRocks = getPageRows(rocksRows, currentPage, DESKTOP_ITEMS_PER_PAGE);

  function scrollLeaderboardToTop() {
    window.requestAnimationFrame(() => {
      const rankingScroll = document.querySelector<HTMLElement>('[data-ranking-scroll]');
      const contentShell = document.querySelector<HTMLElement>('[data-viewport-shell="content"]');
      const scrollOwner = usesCompactPageScroll ? contentShell : (rankingScroll ?? contentShell);
      scrollOwner?.scrollTo({
        top: 0,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
      });
    });
  }

  function renderPagination(totalPageCount: number, className?: string) {
    if (totalPageCount <= 1) return null;

    const activePage = getBoundedPage(currentPage, totalPageCount, 1);

    return (
      <PaginationFooter
        currentPage={activePage}
        totalPages={totalPageCount}
        onPrevious={() => {
          setCurrentPage(Math.max(activePage - 1, 1));
          scrollLeaderboardToTop();
        }}
        onNext={() => {
          setCurrentPage(Math.min(activePage + 1, totalPageCount));
          scrollLeaderboardToTop();
        }}
        className={className}
      />
    );
  }

  function renderResponsiveRows<T extends RankedRow>(
    mobileRows: T[],
    desktopRows: T[],
    mobilePageCount: number,
    desktopPageCount: number,
    renderRow: (row: T, compact?: boolean) => React.ReactNode,
    fillDesktop = false
  ) {
    const usePageScroll = usesCompactPageScroll && !isDesktopBoard;

    return (
      <div className={cn(
        "flex min-h-0 flex-col gap-3",
        usePageScroll ? "h-auto" : "h-full",
        // Desktop pages are a fixed row count, so the panel hugs its content
        // instead of stretching to the viewport and leaving a dead band above
        // the pagination. Mobile keeps its fill-and-scroll behaviour.
        fillDesktop && "tablet:flex tablet:h-auto tablet:min-h-0 tablet:flex-col",
      )}>
        {!isDesktopBoard && (
          <div
            data-ranking-scroll
            className={cn(
              "surface-scroll-area min-h-0 space-y-2 divide-y divide-[hsl(var(--divider)/0.62)] rounded-[var(--radius-panel)] px-3 pb-3 pt-2 tablet:hidden",
              usePageScroll ? "flex-none overflow-visible" : "flex-1 overflow-y-auto",
            )}
          >
            {mobileRows.map((row) => renderRow(row))}
          </div>
        )}

        {isDesktopBoard && <RankingColumns rows={desktopRows} renderRow={renderRow} />}

        {!isDesktopBoard && renderPagination(mobilePageCount, "tablet:hidden")}
        {isDesktopBoard && renderPagination(desktopPageCount, "hidden tablet:flex")}
      </div>
    );
  }

  function renderRankingState(content: React.ReactNode) {
    const usePageScroll = usesCompactPageScroll && !isDesktopBoard;

    return (
      <div className={cn("flex min-h-0 flex-col", usePageScroll ? "h-auto" : "h-full")}>
        <div
          data-ranking-scroll
          className={cn(
            "surface-scroll-area min-h-0 rounded-[var(--radius-panel)] px-3 pb-3 pt-2 tablet:pr-3",
            usePageScroll ? "flex-none overflow-visible" : "flex-1 overflow-y-auto",
          )}
        >
          <div className="flex min-h-full items-center justify-center py-8">
            {content}
          </div>
        </div>
      </div>
    );
  }

  const renderPlantRow = (plant: LeaderboardPlant, compact = false) => {
    const canShowAttack =
      !isUserPlant(plant) &&
      !plant.isDead &&
      eligibleAttackers(plant).length > 0 &&
      !hasActiveFence(plant);
    const isMine = isUserPlant(plant);
    const canShowKill = !isMine && plant.isDead;
    const canShowRevive = isMine && plant.isDead;
    const plantImageSize = compact ? 28 : 48;

    return (
      <div
        key={plant.id}
        className={cn(
          compact ? "py-0.5" : "py-3",
          isMine && "bg-primary/5 rounded-[var(--radius-control)] px-2 tablet:px-3",
          plant.isDead && "text-muted-foreground"
        )}
      >
        <div className={cn("flex items-center space-x-2", compact && "min-h-11")}>
          <div className={cn("flex items-center justify-center", compact ? "w-6" : "w-8")}>
            <div className={`flex items-center ${getRankColor(plant.rank)}`}>
              {plant.rank <= 3 ? (
                getRankIcon(plant.rank)
              ) : (
                <span className="text-sm font-semibold">#{plant.rank}</span>
              )}
            </div>
          </div>

          <div
            className={cn(
              "relative flex-shrink-0 cursor-pointer rounded-[var(--radius-control)] transition-opacity hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              compact && "flex h-11 w-11 items-center justify-center"
            )}
            onClick={() => handlePlantImageClick(plant)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handlePlantImageClick(plant);
              }
            }}
            aria-label="View plant profile"
          >
            <PlantImage
              selectedPlant={plant}
              width={plantImageSize}
              height={plantImageSize}
              className={compact ? "h-7 w-7" : ""}
            />
            {hasActiveFence(plant) && (
              <div className={cn("absolute z-10", compact ? "right-0 top-0" : "-top-1 -right-1")}>
                <Image src="/icons/Shield.png" alt="Protected" width={12} height={12} className="h-3 w-3" />
              </div>
            )}
            {plant.isDead && (
              <div className={cn("absolute z-10", compact ? "right-0 top-0" : "-top-1 -right-1")}>
                <Skull className="w-3 h-3 text-destructive" />
              </div>
            )}
          </div>

          <div
            className={cn(
              "flex-1 min-w-0",
              // At >=520px the stats sit beside the name instead of under it. This
              // replaces a second copy of the same three figures that used to live in
              // the trailing column and be swapped in by CSS.
              !compact && "min-[520px]:flex min-[520px]:items-center min-[520px]:justify-between min-[520px]:gap-2",
            )}
          >
            {compact ? (
              <RankingPlantSummary name={plant.name || `Plant #${plant.id}`} level={plant.level} isMine={isMine}
                points={formatScoreShort(plant.score)} stars={plant.stars} rewards={formatEthShort(plant.rewards)} />
            ) : (
              <>
                <div className="min-w-0 min-[520px]:flex-1">
                  <div className="flex items-center space-x-2">
                    <div className="relative min-w-0">
                      <h4 className="truncate pr-2 font-pixel text-base">
                        {plant.name || `Plant #${plant.id}`}
                        {isMine && (
                          <span className="ml-2 text-xs text-primary font-medium">(You)</span>
                        )}
                      </h4>
                    </div>
                  </div>
                  <div className="flex items-center space-x-4 text-sm text-muted-foreground mt-1">
                    <span>LvL {plant.level}</span>
                  </div>
                </div>
                {/*
                  One stat block, not two. This used to be rendered twice per row —
                  here for <520px and again in the trailing column for >=520px — with
                  CSS hiding one. Every row therefore built six next/image components
                  to paint three. The two copies only ever differed in icon size, text
                  size and stack direction, all of which a min-[520px]: variant covers.
                */}
                <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground min-[520px]:mt-0 min-[520px]:shrink-0 min-[520px]:flex-col min-[520px]:items-end min-[520px]:gap-1 min-[520px]:text-sm">
                  <div className="flex items-center gap-1 text-foreground min-[520px]:gap-1">
                    <Image
                      src="/icons/pts.svg"
                      alt="Points"
                      width={16}
                      height={16}
                      className="h-[13px] w-[13px] min-[520px]:h-4 min-[520px]:w-4"
                    />
                    <span className="font-bold min-[520px]:text-base">{formatScoreShort(plant.score)}</span>
                  </div>
                  <div className="flex items-center gap-x-3 gap-y-1">
                    <div className="flex items-center gap-1">
                      <Image
                        src="/icons/Star.svg"
                        alt="Stars"
                        width={14}
                        height={14}
                        className="h-3 w-3 min-[520px]:h-3.5 min-[520px]:w-3.5"
                      />
                      <span>{plant.stars}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Image
                        src="/icons/ethlogo.svg"
                        alt="ETH"
                        width={14}
                        height={14}
                        className="h-3 w-3 min-[520px]:h-3.5 min-[520px]:w-3.5"
                      />
                      <span>{formatEthShort(plant.rewards)}</span>
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>

          {(canShowAttack || canShowKill || canShowRevive) && (
          <div className="flex items-center space-x-2 text-right">
            {canShowAttack && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  setTargetPlant(plant);
                  setSelectedAttackerId(eligibleAttackers(plant)[0]?.id ?? null);
                  setAttackDialogOpen(true);
                }}
                aria-label="Attack this plant"
                title="Attack"
                className={RANKING_ACTION_BUTTON_CLASS}
              >
                <Image
                  src="/icons/Attackwon.png"
                  alt=""
                  width={24}
                  height={24}
                  className={RANKING_ACTION_ICON_CLASS}
                  aria-hidden="true"
                />
              </Button>
            )}
            {canShowKill && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className={cn(
                  RANKING_ACTION_BUTTON_CLASS,
                  !killCooldown.canKill && "opacity-55"
                )}
                onClick={() => {
                  if (!killCooldown.canKill) {
                    setCooldownDialogOpen(true);
                  } else {
                    setTargetPlant(plant);
                    setSelectedKillerId(myPlants.find(p => p.status !== 4)?.id ?? null);
                    setKillDialogOpen(true);
                  }
                }}
                aria-label="Kill dead plant to collect star"
                title={killCooldown.canKill ? "Kill to collect star" : "Kill available soon"}
              >
                <Image
                  src="/icons/skull.png"
                  alt=""
                  width={24}
                  height={24}
                  className={RANKING_ACTION_ICON_CLASS}
                  aria-hidden="true"
                />
              </Button>
            )}
            {canShowRevive && (
              compact ? (
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className="rounded-[var(--radius-control)]"
                  onClick={() => { setTargetPlant(plant); setReviveDialogOpen(true); }}
                  aria-label="Revive your plant"
                  title="Revive"
                >
                  <Image
                    src="/icons/skull.png"
                    alt="Revive plant"
                    width={16}
                    height={16}
                    className="h-4 w-4 object-contain"
                  />
                </Button>
              ) : (
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-[var(--radius-control)]"
                  onClick={() => { setTargetPlant(plant); setReviveDialogOpen(true); }}
                  aria-label="Revive your plant"
                  title="Revive"
                >
                  <Image
                    src="/icons/skull.png"
                    alt="Revive plant"
                    width={16}
                    height={16}
                    className="h-4 w-4 object-contain"
                  />
                </Button>
              )
            )}
          </div>
          )}
        </div>
      </div>
    );
  };

  const renderLandRow = (row: LandLeaderboardRow, compact = false) => (
    <div key={row.landId} className={compact ? "py-2" : "py-3"}>
      <div className="flex items-center space-x-2">
        <div className={cn("flex items-center justify-center", compact ? "w-7" : "w-8")}>
          <div className={`flex items-center ${getRankColor(row.rank)}`}>
            {row.rank <= 3 ? (
              getRankIcon(row.rank)
            ) : (
              <span className="text-sm font-semibold">#{row.rank}</span>
            )}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center space-x-2">
            <h4 className={cn("font-semibold truncate pr-6", compact ? "text-sm" : "text-base")}>
              {row.name}
            </h4>
          </div>
        </div>
        <div className="flex items-center space-x-2 text-right">
          <div className="flex flex-col items-end space-y-1">
            <div className="flex items-center space-x-1">
              <Image src="/icons/pts.svg" alt="EXP" width={compact ? 14 : 16} height={compact ? 14 : 16} />
              <span className={cn("font-bold", compact ? "text-sm" : "text-base")}>{row.exp.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderStakeRow = (row: StakeLeaderboardEntry, compact = false) => {
    const formattedStake = (Number(row.stakedAmount) / 1e18).toLocaleString(undefined, {
      maximumFractionDigits: 2
    });
    const isCurrentUser = address && row.address.toLowerCase() === address.toLowerCase();

    return (
      <div
        key={row.address}
        className={cn(compact ? "py-2" : "py-3", isCurrentUser && "bg-primary/5 rounded-[var(--radius-control)] px-2 tablet:px-3")}
      >
        <div className="flex items-center space-x-2">
          <div className={cn("flex items-center justify-center", compact ? "w-7" : "w-8")}>
            <div className={`flex items-center ${getRankColor(row.rank)}`}>
              {row.rank <= 3 ? (
                getRankIcon(row.rank)
              ) : (
                <span className="text-sm font-semibold">#{row.rank}</span>
              )}
            </div>
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex flex-col">
              {row.ensName ? (
                <>
                  <h4 className={cn("font-semibold truncate pr-6", compact ? "text-sm" : "text-base")}>
                    {row.ensName}
                    {isCurrentUser && (
                      <span className="ml-2 text-xs text-primary font-medium">(You)</span>
                    )}
                  </h4>
                  <span className="text-xs text-muted-foreground font-mono truncate">
                    {formatAddress(row.address)}
                  </span>
                </>
              ) : compact ? (
                <>
                  <h4 className="font-semibold text-sm font-mono truncate pr-6">
                    {formatAddress(row.address)}
                    {isCurrentUser && (
                      <span className="ml-2 text-xs text-primary font-medium">(You)</span>
                    )}
                  </h4>
                  <span className="block h-4" aria-hidden="true" />
                </>
              ) : (
                <h4 className={cn("font-semibold font-mono truncate pr-6", compact ? "text-sm" : "text-base")}>
                  {formatAddress(row.address)}
                  {isCurrentUser && (
                    <span className="ml-2 text-xs text-primary font-medium">(You)</span>
                  )}
                </h4>
              )}
            </div>
          </div>
          <div className="flex items-center space-x-2 text-right">
            <div className="flex flex-col items-end space-y-1">
              <div className="flex items-center space-x-1">
                <Image src="/PixotchiKit/COIN.svg" alt="Staked SEED" width={compact ? 14 : 16} height={compact ? 14 : 16} />
                <span className={cn("font-bold", compact ? "text-sm" : "text-base")}>{formattedStake}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderRockRow = (row: RocksLeaderboardEntry, compact = false) => {
    const isCurrentUser = address && row.address?.toLowerCase() === address.toLowerCase();

    return (
      <div
        key={row.address || `rock-${row.rank}`}
        className={cn(compact ? "py-2" : "py-3", isCurrentUser && "bg-primary/5 rounded-[var(--radius-control)] px-2 tablet:px-3")}
      >
        <div className="flex items-center space-x-2">
          <div className={cn("flex items-center justify-center", compact ? "w-7" : "w-8")}>
            <div className={`flex items-center ${getRankColor(row.rank)}`}>
              {row.rank <= 3 ? (
                getRankIcon(row.rank)
              ) : (
                <span className="text-sm font-semibold">#{row.rank}</span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            {row.address ? (
              <WalletAvatar
                address={row.address as `0x${string}`}
                className={cn("rounded-full", compact ? "w-8 h-8" : "w-10 h-10")}
              />
            ) : (
              <div className={cn("rounded-full bg-muted", compact ? "w-8 h-8" : "w-10 h-10")} />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <h4 className={cn("font-semibold truncate pr-6", compact ? "text-sm" : "text-base")}>
              {row.name || (row.address ? formatAddress(row.address) : 'Unknown')}
              {isCurrentUser && (
                <span className="ml-2 text-xs text-primary font-medium">(You)</span>
              )}
            </h4>
            {row.name && row.address && (
              <span className="text-xs text-muted-foreground font-mono">
                {formatAddress(row.address)}
              </span>
            )}
          </div>
          <div className="flex items-center space-x-2 text-right">
            <div className="flex items-center space-x-1">
              <Image src="/icons/Volcanic_Rock.svg" alt="" width={compact ? 16 : 18} height={compact ? 16 : 18} aria-hidden="true" />
              <span className={cn("font-bold", compact ? "text-sm" : "text-base")}>{row.rocks.toLocaleString()}</span>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderContent = () => {
    // Only show full page loader if we have NO plants data and are loading
    if (loading && totalItems === 0) {
      return renderRankingState(
        <div className="text-center">
          <BaseExpandedLoadingPageLoader text="Loading Ranking..." />
        </div>
      );
    }

    if (error) {
      return renderRankingState(
        <ResourceState status="error" title="Ranking unavailable" description={error} onRetry={() => { void fetchLeaderboardData(); }} className="w-full" />
      );
    }

    if (totalItems === 0) {
      // Check if user is in attackable mode and has no plants
      if (filterMode === 'attackable' && address && myPlants.length === 0) {
        return renderRankingState(
          <EmptyState
            icon={Flower2}
            title="No plants to attack with"
            description="Mint a plant first to attack other plants with it. Go to the Mint tab to get started."
          />
        );
      }

      // Check if user is in attackable mode but has plants (just no attackable targets)
      if (filterMode === 'attackable' && address && myPlants.length > 0) {
        return renderRankingState(
          <div className="text-center text-muted-foreground">
            <p>No attackable plants found. All plants are either yours, dead, or protected by fences.</p>
          </div>
        );
      }

      // Check if user is in dead mode but no dead plants exist
      if (filterMode === 'dead') {
        return renderRankingState(
          <div className="text-center text-muted-foreground">
            <p>No dead plants found. All plants are currently alive!</p>
          </div>
        );
      }

      // Default message for 'all' mode or when not connected
      return renderRankingState(
        <EmptyState
          icon={Flower2}
          title="No plants ranked yet"
          description="Plants appear here once they have earned points. Go to the Mint tab to grow your first one."
        />
      );
    }

    return renderResponsiveRows(currentPlants, desktopPlants, totalPages, desktopTotalPages, renderPlantRow, true);
  };

  return (
    <div className={cn("min-h-0 space-y-4 tablet:mx-auto tablet:h-auto tablet:max-w-7xl", usesCompactPageScroll ? "h-auto" : "h-full")}>
      <TabCard className={cn(
        "flex flex-col",
        usesCompactPageScroll
          ? "h-auto min-h-0 overflow-visible"
          // `overflow-hidden` must stay: the pagination footer bleeds to the
          // card edges (-mx-4 -mb-4) with square bottom corners and relies on
          // this clip to inherit the card's radius. The desktop panel is sized
          // to its content, so nothing needs to escape the card anyway — a
          // window too short for it scrolls in the shell's own scroller.
          : "h-full min-h-[26rem] overflow-hidden tablet:h-auto",
      )}>
        <CardHeader className="flex-none">
          <div className="flex flex-col items-start gap-3 min-[380px]:flex-row min-[380px]:items-center min-[380px]:justify-between tablet:grid tablet:grid-cols-[auto_minmax(0,1fr)_auto]">
            <CardTitle>
              Ranking
            </CardTitle>
            {boardType === 'plants' && isDesktopBoard && (
              <div className="hidden items-center justify-center gap-4 tablet:flex">
                <ToggleGroup
                  ariaLabel="Filter plants by status"
                  value={filterMode}
                  onValueChange={(v) => {
                    if (v !== 'all' && v !== 'attackable' && v !== 'dead') {
                      return;
                    }

                    setCurrentPage(1);
                    setFilterMode(v);
                    if (v === 'attackable' || v === 'dead') {
                      setShowOnlyMyPlants(false);
                    }
                  }}
                  options={[
                    { value: 'all', label: 'All' },
                    { value: 'attackable', label: 'Attackable' },
                    { value: 'dead', label: 'Dead' },
                  ]}
                />
                {address && myPlants.length > 0 && (filterMode === 'all' || filterMode === 'dead') && (
                  <label className="flex min-h-11 items-center gap-2 cursor-pointer rounded-[var(--radius-control)] px-1 text-sm">
                    <input
                      type="checkbox"
                      checked={showOnlyMyPlants}
                      onChange={(e) => {
                        setShowOnlyMyPlants(e.target.checked);
                        setCurrentPage(1);
                      }}
                      className="h-5 w-5 rounded accent-primary"
                    />
                    <span className="text-muted-foreground">My Plants</span>
                  </label>
                )}
              </div>
            )}
            <div className="w-full min-[380px]:w-auto tablet:col-start-3 tablet:justify-self-end">
              <ToggleGroup
                ariaLabel="Ranking board"
                value={boardType}
                onValueChange={(nextValue) => {
                  setCurrentPage(1);
                  setBoardType((nextValue as typeof boardType) || 'plants');
                }}
                className="w-full min-[380px]:w-auto"
                getButtonClassName={() => "min-w-0 flex-1 px-2 max-[340px]:px-1.5 max-[340px]:text-[11px] min-[380px]:flex-none"}
                options={[
                  { value: 'plants', label: 'Plants' },
                  { value: 'lands', label: 'Lands' },
                  { value: 'stake', label: 'Stake' },
                  ...(showRocksBoard ? [{ value: 'rocks', label: 'Rocks' }] : []),
                ]}
              />
            </div>
          </div>
          {boardType === 'plants' && !isDesktopBoard && (
            <div className="mt-2 flex items-center justify-between gap-2 flex-wrap tablet:hidden">
              <ToggleGroup
                ariaLabel="Filter plants by status"
                value={filterMode}
                onValueChange={(v) => {
                  setCurrentPage(1);
                  if (v === 'all' || v === 'attackable' || v === 'dead') setFilterMode(v);
                  // Auto-uncheck "My Plants" when switching to attackable or dead
                  if (v === 'attackable' || v === 'dead') {
                    setShowOnlyMyPlants(false);
                  }
                }}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'attackable', label: 'Attackable' },
                  { value: 'dead', label: 'Dead' },
                ]}
              />
              {address && myPlants.length > 0 && (filterMode === 'all' || filterMode === 'dead') && (
                <label className="flex min-h-11 items-center gap-2 cursor-pointer rounded-[var(--radius-control)] px-1 text-sm">
                  <input
                    type="checkbox"
                    checked={showOnlyMyPlants}
                    onChange={(e) => {
                      setShowOnlyMyPlants(e.target.checked);
                      setCurrentPage(1);
                    }}
                    className="h-5 w-5 rounded accent-primary"
                  />
                  <span className="text-muted-foreground">My Plants</span>
                </label>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className={cn("min-h-0 overflow-visible", usesCompactPageScroll ? "flex-none" : "flex-1")}>
          {boardType === 'plants' ? (
            renderContent()
          ) : boardType === 'lands' ? (
            landRanking.loading && totalLandItems === 0 ? (
              renderRankingState(
                <div className="text-center">
                  <BaseExpandedLoadingPageLoader text="Loading lands leaderboard..." />
                </div>
              )
            ) : landRanking.error ? (
              renderRankingState(<ResourceState status="error" title="Land ranking unavailable" description={landRanking.error} onRetry={() => { void landRanking.refresh(); }} />)
            ) : totalLandItems === 0 ? (
              renderRankingState(
                <EmptyState
                  icon={LandPlot}
                  title="No lands ranked yet"
                  description="Lands appear here once they have been minted and scored."
                />
              )
            ) : (
              renderResponsiveRows(currentLands, desktopLands, totalLandPages, desktopLandPages, renderLandRow, true)
            )
          ) : boardType === 'stake' ? (
            stakeLoading && totalStakeItems === 0 ? (
              renderRankingState(
                <div className="text-center">
                  <BaseExpandedLoadingPageLoader text="Loading stake leaderboard..." />
                </div>
              )
            ) : stakeError && totalStakeItems === 0 ? (
              renderRankingState(
                <ResourceState status="error" title="Stake ranking unavailable" description={stakeError} onRetry={() => { void fetchStakeLeaderboard(); }} className="w-full" />
              )
            ) : totalStakeItems === 0 ? (
              renderRankingState(
                <EmptyState
                  icon={Coins}
                  title="No stakers yet"
                  description="Stake SEED from the Stake House to appear on this board."
                />
              )
            ) : (
              renderResponsiveRows(currentStakes, desktopStakes, totalStakePages, desktopStakePages, renderStakeRow, true)
            )
          ) : rocksDisabledNotice ? (
            renderRankingState(
              <Alert className="w-full">
                <Terminal className="h-4 w-4" />
                <AlertTitle>Temporarily Disabled</AlertTitle>
                <AlertDescription>{rocksDisabledNotice}</AlertDescription>
              </Alert>
            )
          ) : (
            rocksLoading && totalRockItems === 0 ? (
              renderRankingState(
                <div className="text-center">
                  <BaseExpandedLoadingPageLoader text="Loading Rocks leaderboard..." />
                </div>
              )
            ) : rocksError ? (
              renderRankingState(
                <ResourceState status="error" title="Rocks ranking unavailable" description={rocksError} onRetry={() => { void fetchRocksLeaderboard(); }} className="w-full" />
              )
            ) : totalRockItems === 0 ? (
              renderRankingState(
                <div className="text-center text-muted-foreground">No rock earners found.</div>
              )
            ) : (
              renderResponsiveRows(currentRocks, desktopRocks, totalRockPages, desktopRockPages, renderRockRow, true)
            )
          )}
        </CardContent>
      </TabCard>

      {/* Attack dialog */}
      <Dialog open={attackDialogOpen} onOpenChange={setAttackDialogOpen}>
        <DialogContent ref={handleAttackDialogFrameRef} mobileMode="center" surface="soft" className="max-w-md w-[min(94vw,28rem)]">
          <DialogHeader className="pb-1">
            <DialogTitle className="leading-tight">Attack plant</DialogTitle>
            <DialogDescription className="leading-relaxed">
              Choose one eligible lower-level plant. We will check cooldowns and protection before submitting.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4 pb-4 pr-1">
            {targetPlant && (
              <div className="flex items-center justify-between gap-3 rounded-[var(--radius-panel)] bg-muted/30 p-3">
                <div className="flex min-w-0 items-center gap-3">
                  <PlantImage selectedPlant={targetPlant} width={34} height={34} />
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                      Target
                    </div>
                    <div className="truncate font-pixel text-sm">
                      {targetPlant.name || `Plant #${targetPlant.id}`}
                    </div>
                    <div className="text-xs text-muted-foreground">Level {targetPlant.level}</div>
                  </div>
                </div>
                {attackOutcomePreview && (
                  <div className="ml-auto shrink-0 space-y-1 text-right">
                    <div className="rounded-[var(--radius-control)] border border-primary/25 bg-primary/10 px-2 py-1">
                      <div className="text-xs font-semibold uppercase leading-none tracking-wide text-muted-foreground">
                        If you win
                      </div>
                      <div className="mt-0.5 flex items-center justify-end gap-1 text-xs font-bold text-primary">
                        <span>{formatAttackScoreDelta(attackOutcomePreview.winScore, "gain")}</span>
                        <span className="text-xs font-semibold text-muted-foreground">PTS</span>
                      </div>
                    </div>
                    <div className="rounded-[var(--radius-control)] border border-destructive/25 bg-destructive/10 px-2 py-1">
                      <div className="text-xs font-semibold uppercase leading-none tracking-wide text-muted-foreground">
                        If you lose
                      </div>
                      <div className="mt-0.5 flex items-center justify-end gap-1 text-xs font-bold text-destructive">
                        <span>{formatAttackScoreDelta(attackOutcomePreview.loseScore, "loss")}</span>
                        <span className="text-xs font-semibold text-muted-foreground">PTS</span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="rounded-[var(--radius-panel)] border border-border/70 bg-muted/35 p-3 text-xs leading-relaxed text-muted-foreground">
              <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-foreground">
                Attack rules
              </div>
              <ul className="list-disc space-y-1 pl-4">
                <li>Each plant can attack once every 30 minutes.</li>
                <li>Target can be attacked again after 60 minutes.</li>
                <li>Attacker must be alive and a lower level than the target.</li>
                <li>Your attacker has a {ATTACK_WIN_CHANCE_PERCENT}% win chance and a {ATTACK_LOSS_CHANCE_PERCENT}% loss chance.</li>
                <li>Targets with an active fence cannot be attacked.</li>
                <li>You cannot attack your own plant.</li>
              </ul>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">Eligible attackers</div>
                {targetPlant && (
                  <span className="text-xs text-muted-foreground">
                    {attackDialogAttackers.length} available
                  </span>
                )}
              </div>

              {attackDialogAttackers.length === 0 ? (
                <DisabledReason>
                  No eligible plants to attack with right now. Each plant can attack once every 30 minutes.
                </DisabledReason>
              ) : (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-auto min-h-11 w-full justify-between px-3 py-2 text-left"
                    >
                      {selectedAttacker ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <PlantImage selectedPlant={selectedAttacker} width={30} height={30} />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {selectedAttacker.name || `Plant #${selectedAttacker.id}`}
                            </div>
                            <div className="text-xs font-normal text-muted-foreground">
                              Level {selectedAttacker.level}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <span>Select an attacker</span>
                      )}
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    portalContainer={attackMenuPortalContainer ?? undefined}
                    side="top"
                    align="start"
                    sideOffset={8}
                    className="surface-scroll-fade z-[var(--z-modal-nested)] w-[var(--radix-dropdown-menu-trigger-width)] max-h-60 overflow-y-auto"
                  >
                    {attackDialogAttackers.map((attacker) => {
                      const selected = selectedAttackerId === attacker.id;
                      return (
                        <DropdownMenuItem
                          key={attacker.id}
                          onSelect={() => setSelectedAttackerId(attacker.id)}
                          className="min-h-12"
                        >
                          <div className="flex w-full min-w-0 items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <PlantImage selectedPlant={attacker} width={28} height={28} />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">
                                  {attacker.name || `Plant #${attacker.id}`}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  Level {attacker.level}
                                </div>
                              </div>
                            </div>
                            {selected ? (
                              <span className="shrink-0 text-xs font-semibold text-primary">Selected</span>
                            ) : null}
                          </div>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </DialogBody>

          <DialogFooter sticky className="block flex-none">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Confirm Attack</span>
                <SponsoredBadge show={isSponsored && isSmartWallet && !isSolana} />
              </div>
              {targetPlant && selectedAttackerId !== null ? (
                (() => {
                  const attacker = myPlants.find(p => p.id === selectedAttackerId) as Plant | undefined;
                  const eligible = attacker && targetPlant ? canAttackWith(attacker, targetPlant) : false;
                  return isSolana ? (
                    <SolanaBridgeButton
                      actionType="attack"
                      plantId={selectedAttackerId}
                      targetId={targetPlant.id}
                      buttonText={isSubmitting ? "Attacking..." : "Confirm Attack"}
                      buttonClassName="w-full"
                      disabled={isSubmitting || !eligible}
                      onSuccess={() => {
                        setIsSubmitting(false);
                        setPendingHash(null);
                        setAttackDialogOpen(false);
                        setSelectedAttackerId(null);
                        fetchLeaderboardData();
                        void fetchMyPlants();
                      }}
                      onError={() => {
                        setIsSubmitting(false);
                        toast.error('Attack failed');
                      }}
                    />
                  ) : (
                    <AttackTransaction
                      attackerId={selectedAttackerId}
                      targetId={targetPlant.id}
                      onSuccess={() => {
                        setIsSubmitting(false);
                        setPendingHash(null);
                        setAttackDialogOpen(false);
                        setSelectedAttackerId(null);
                        fetchLeaderboardData();
                        void fetchMyPlants();
                      }}
                      onError={() => { }}
                      buttonText={isSubmitting ? "Attacking..." : "Confirm Attack"}
                      buttonClassName="w-full"
                      disabled={isSubmitting || !eligible}
                      onStatusUpdate={(status: LifecycleStatus) => {
                        setIsSubmitting(isTransactionActionPending(status.statusName));
                        if (isTransactionActionPending(status.statusName)) {
                          setIsSubmitting(true);
                          try {
                            const h = status.statusData?.transactionHash || status.statusData?.transactionReceipts?.[0]?.transactionHash;
                            if (h) setPendingHash(h);
                          } catch { }
                        }
                        if (status.statusName === 'success') {
                          setIsSubmitting(false);
                          try {
                            const receipt = status.statusData?.transactionReceipts?.[0];
                            const logs = receipt?.logs || [];
                            const shown = showAttackOutcomeFromLogs(logs);
                            if (!shown) {
                              const h = receipt?.transactionHash || status.statusData?.transactionHash || pendingHash;
                              void showAttackOutcomeFromHash(h).then((hashShown) => {
                                if (!hashShown) {
                                  toast('Attack confirmed. Check Activity for the result.', { id: 'attack-result' });
                                }
                              });
                            }
                          } catch {
                            toast('Attack confirmed. Check Activity for the result.', { id: 'attack-result' });
                          }
                          // After a successful attack, refresh lists
                          fetchLeaderboardData();
                          void fetchMyPlants();
                        }
                      }}
                    />
                  );
                })()
              ) : (
                <Button className="w-full" disabled>
                  Select an attacker
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Kill dialog */}
      <Dialog open={killDialogOpen} onOpenChange={setKillDialogOpen}>
        <DialogContent ref={handleKillDialogFrameRef} mobileMode="center" surface="soft" className="max-w-md w-[min(94vw,28rem)]">
          <DialogHeader className="pb-1">
            <DialogTitle className="leading-tight">Kill a plant</DialogTitle>
            <DialogDescription className="leading-relaxed">
              Select one living plant to collect a star from the dead target. This action has a wallet cooldown.
            </DialogDescription>
          </DialogHeader>

          <DialogBody className="space-y-4 pb-4 pr-1">
            {targetPlant && (
              <div className="flex items-center gap-3 rounded-[var(--radius-panel)] border border-border/70 bg-background/60 p-3">
                <PlantImage selectedPlant={targetPlant} width={34} height={34} />
                <div className="min-w-0">
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                    Dead target
                  </div>
                  <div className="truncate font-pixel text-sm">
                    {targetPlant.name || `Plant #${targetPlant.id}`}
                  </div>
                  <div className="text-xs text-muted-foreground">Collects 1 star</div>
                </div>
              </div>
            )}

            <div className="rounded-[var(--radius-panel)] border border-border/70 bg-muted/35 p-3 text-xs leading-relaxed text-muted-foreground">
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-foreground">
                Kill rules
              </div>
              Target must already be dead. You can only kill once per hour.
            </div>

            {!killCooldown.canKill && (
              <DisabledReason>
                Cooldown active. Close this dialog to see the timer.
              </DisabledReason>
            )}

            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="text-sm font-semibold">Living plants</div>
                <span className="text-xs text-muted-foreground">
                  {livingKillerPlants.length} available
                </span>
              </div>

              {livingKillerPlants.length === 0 ? (
                <DisabledReason>
                  You need a living plant to collect a star.
                </DisabledReason>
              ) : (
                <DropdownMenu modal={false}>
                  <DropdownMenuTrigger asChild>
                    <Button
                      type="button"
                      variant="outline"
                      className="h-auto min-h-11 w-full justify-between px-3 py-2 text-left"
                    >
                      {selectedKillerPlant ? (
                        <div className="flex min-w-0 items-center gap-2">
                          <PlantImage selectedPlant={selectedKillerPlant} width={30} height={30} />
                          <div className="min-w-0">
                            <div className="truncate text-sm font-medium">
                              {selectedKillerPlant.name || `Plant #${selectedKillerPlant.id}`}
                            </div>
                            <div className="text-xs font-normal text-muted-foreground">
                              Level {selectedKillerPlant.level}
                            </div>
                          </div>
                        </div>
                      ) : (
                        <span>Select your plant</span>
                      )}
                      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent
                    portalContainer={killMenuPortalContainer ?? undefined}
                    side="top"
                    align="start"
                    sideOffset={8}
                    className="surface-scroll-fade z-[var(--z-modal-nested)] w-[var(--radix-dropdown-menu-trigger-width)] max-h-60 overflow-y-auto"
                  >
                    {livingKillerPlants.map((plant) => {
                      const selected = selectedKillerId === plant.id;
                      return (
                        <DropdownMenuItem
                          key={plant.id}
                          onSelect={() => setSelectedKillerId(plant.id)}
                          className="min-h-12"
                        >
                          <div className="flex w-full min-w-0 items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-2">
                              <PlantImage selectedPlant={plant} width={28} height={28} />
                              <div className="min-w-0">
                                <div className="truncate text-sm font-medium">
                                  {plant.name || `Plant #${plant.id}`}
                                </div>
                                <div className="text-xs text-muted-foreground">
                                  Level {plant.level}
                                </div>
                              </div>
                            </div>
                            {selected ? (
                              <span className="shrink-0 text-xs font-semibold text-primary">Selected</span>
                            ) : null}
                          </div>
                        </DropdownMenuItem>
                      );
                    })}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </DialogBody>

          <DialogFooter sticky className="block flex-none">
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Confirm kill and earn one star</span>
                <SponsoredBadge show={isSponsored && isSmartWallet && !isSolana} />
              </div>
              {isSolana ? (
                <SolanaNotSupported feature="Kill action" />
              ) : targetPlant && selectedKillerId !== null ? (
                <KillTransaction
                  deadId={targetPlant.id}
                  tokenId={selectedKillerId}
                  buttonText="Confirm Kill"
                  buttonClassName="w-full"
                  onSuccess={() => {
                    // Close kill dialog and show cooldown dialog
                    setKillDialogOpen(false);
                    setSelectedKillerId(null);
                    fetchLeaderboardData();
                    void fetchMyPlants();
                    fetchKillCooldown(); // Refresh cooldown state from contract
                    // Open the cooldown dialog to show the user the timer
                    setCooldownDialogOpen(true);
                  }}
                />
              ) : (
                <Button className="w-full" disabled>
                  Select your plant
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Revive dialog */}
      <Dialog open={reviveDialogOpen} onOpenChange={setReviveDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revive your plant</DialogTitle>
            <DialogDescription>
              Confirm the revive cost before restoring this plant to active play.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            {targetPlant && (
              <div className="text-sm text-muted-foreground">
                You are reviving <span className="font-medium">{targetPlant.name || `Plant #${targetPlant.id}`}</span>. Cost: {formatTokenAmount(revivePrice)} SEED.
              </div>
            )}
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Confirm Revive</span>
                <SponsoredBadge show={isSponsored && isSmartWallet && !isSolana} />
              </div>
              {isSolana ? (
                <SolanaNotSupported feature="Revive action" />
              ) : (() => {
                const hasEnough = seedBalance >= revivePrice;
                return (
                  <>
                    <ReviveTransaction
                      plantId={targetPlant?.id || 0}
                      buttonText="Confirm Revive"
                      buttonClassName="w-full"
                      showToast={true}
                      disabled={!targetPlant || !hasEnough}
                      onSuccess={() => {
                        setReviveDialogOpen(false);
                        fetchLeaderboardData();
                        void fetchMyPlants();
                      }}
                    />
                    {!hasEnough && (
                      <InlineBalanceNotice>
                        Not enough SEED. Balance: {formatTokenAmount(seedBalance)} • Required: {formatTokenAmount(revivePrice)}
                      </InlineBalanceNotice>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Plant Profile Dialog */}
      <EfpTransactionBoundary open={profileDialogOpen}>
        <PlantProfileDialog
          open={profileDialogOpen}
          onOpenChange={setProfileDialogOpen}
          plant={selectedPlantForProfile}
        />
      </EfpTransactionBoundary>

      {/* Kill Cooldown Dialog */}
      <Dialog open={cooldownDialogOpen} onOpenChange={setCooldownDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cooldown Active</DialogTitle>
            <DialogDescription>
              Your attack action is cooling down. Wait until the timer reaches zero before attacking again.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="flex flex-col items-center justify-center p-6 bg-muted/30 rounded-lg space-y-3">
              <Skull className="w-10 h-10 text-muted-foreground opacity-50" />
              <p className="text-center font-medium">You can only kill 1 plant per hour.</p>
              <div className="text-2xl font-bold font-mono text-primary">
                {Math.floor(killCooldown.remainingSeconds / 60)}m {killCooldown.remainingSeconds % 60}s
              </div>
              <p className="text-xs text-muted-foreground text-center">
                Wait for the cooldown to reset before killing another plant.
              </p>
            </div>
            <Button className="w-full" onClick={() => setCooldownDialogOpen(false)}>
              Understood
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
