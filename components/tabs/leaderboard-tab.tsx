"use client";

import { SponsoredBadge } from "@/components/paymaster-toggle";
import PlantProfileDialog from "@/components/plant-profile-dialog";
import PlantImage from "@/components/PlantImage";
import { SolanaNotSupported,useIsSolanaWallet,useTwinAddress } from "@/components/solana";
import AttackTransaction from "@/components/transactions/attack-transaction";
import KillTransaction from "@/components/transactions/kill-transaction";
import ReviveTransaction from "@/components/transactions/revive-transaction";
import SolanaBridgeButton from "@/components/transactions/solana-bridge-button";
import { Alert,AlertDescription,AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card,CardContent,CardHeader,CardTitle } from "@/components/ui/card";
import { Dialog,DialogContent,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { BaseExpandedLoadingPageLoader } from "@/components/ui/loading";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { WalletAvatar } from "@/components/ui/wallet-avatar";
import { useWebQueryState } from "@/hooks/useWebQueryState";
import { getBaseTransactionReceipt } from "@/lib/base-rpc";
import { getAliveTokenIds,getKillCooldown,getLandLeaderboard,getPlantsByOwner,getPlantsInfoExtended,getRevivePrice,getTokenBalance } from "@/lib/contracts";
import { CLIENT_ENV } from "@/lib/env-config";
import { useFrameContext } from "@/lib/frame-context";
import { getClientGamificationPolicy } from "@/lib/gamification-client";
import { postMissionProgress } from "@/lib/mission-tracking";
import { usePaymaster } from "@/lib/paymaster-context";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { useTabVisibility } from "@/lib/tab-visibility-context";
import { Plant } from "@/lib/types";
import { cn,formatAddress,formatEthShort,formatScoreShort,formatTokenAmount,getFenceStatus } from "@/lib/utils";
import PixotchiNFT from "@/public/abi/PixotchiNFT.json";
import { Skull,Sword,Terminal } from "lucide-react";
import Image from "next/image";
import React,{ useCallback,useEffect,useMemo,useRef,useState } from "react";
import toast from "react-hot-toast";
import { decodeEventLog } from "viem";
import { useAccount,usePublicClient } from "wagmi";

type LeaderboardPlant = Plant & {
  rank: number;
  isDead: boolean;
};

type StakeLeaderboardEntry = {
  rank: number;
  address: string;
  stakedAmount: bigint;
  ensName?: string;
};

type RocksLeaderboardEntry = {
  rank: number;
  address: string;
  rocks: number;
  name?: string | null;
};

type LandLeaderboardRow = {
  rank: number;
  landId: number;
  name: string;
  exp: number;
};

type RankedRow = {
  rank: number;
};

const ITEMS_PER_PAGE = 12;
const DESKTOP_ITEMS_PER_PAGE = 20;
const DESKTOP_COLUMN_SIZE = 10;

// Client-side cache duration for stake data (24 hours since cron runs once at midnight)
const STAKE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const ROCKS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const LAND_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
const DEFAULT_REVIVE_PRICE = BigInt(100) * (BigInt(10) ** BigInt(18));

function getTotalPages(itemCount: number, pageSize: number) {
  return Math.ceil(itemCount / pageSize) || 1;
}

function getBoundedPage(page: number, itemCount: number, pageSize: number) {
  return Math.min(Math.max(page, 1), getTotalPages(itemCount, pageSize));
}

function getPageRows<T>(rows: T[], page: number, pageSize: number) {
  const activePage = getBoundedPage(page, rows.length, pageSize);
  const start = (activePage - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

function splitDesktopRows<T>(rows: T[]) {
  return [
    rows.slice(0, DESKTOP_COLUMN_SIZE),
    rows.slice(DESKTOP_COLUMN_SIZE, DESKTOP_ITEMS_PER_PAGE),
  ];
}

function getRankRangeLabel(rows: RankedRow[]) {
  if (rows.length === 0) return "No entries";
  const firstRank = rows[0]?.rank;
  const lastRank = rows[rows.length - 1]?.rank;
  return firstRank === lastRank ? `Rank #${firstRank}` : `Ranks #${firstRank}-${lastRank}`;
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

  // Use Twin address for Solana users, EVM address otherwise
  // Memoize to prevent unnecessary re-renders when dependencies haven't actually changed
  const address = useMemo(() => {
    return isSolana && twinAddress ? twinAddress as `0x${string}` : evmAddress;
  }, [isSolana, twinAddress, evmAddress]);
  const [plants, setPlants] = useState<LeaderboardPlant[]>([]);
  const [landRows, setLandRows] = useState<LandLeaderboardRow[]>([]);
  const [stakeRows, setStakeRows] = useState<StakeLeaderboardEntry[]>([]);
  const [rocksRows, setRocksRows] = useState<RocksLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [stakeLoading, setStakeLoading] = useState(false);
  const [rocksLoading, setRocksLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rocksError, setRocksError] = useState<string | null>(null);
  const [rocksDisabledNotice, setRocksDisabledNotice] = useState<string | null>(
    gamificationDisabled ? gamificationDisabledMessage : null,
  );
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
  const [myPlants, setMyPlants] = useState<Plant[]>([]);
  const [attackDialogOpen, setAttackDialogOpen] = useState(false);
  const [targetPlant, setTargetPlant] = useState<LeaderboardPlant | null>(null);
  const [selectedAttackerId, setSelectedAttackerId] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingHash, setPendingHash] = useState<string | null>(null);
  const [killDialogOpen, setKillDialogOpen] = useState(false);
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
  const publicClient = usePublicClient();
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
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [selectedPlantForProfile, setSelectedPlantForProfile] = useState<LeaderboardPlant | null>(null);

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

  // Client-side cache for stake data to avoid re-fetches on tab toggles
  const stakeDataCacheRef = useRef<{
    data: StakeLeaderboardEntry[] | null;
    timestamp: number;
  }>({ data: null, timestamp: 0 });

  const rocksDataCacheRef = useRef<{
    data: RocksLeaderboardEntry[] | null;
    timestamp: number;
  }>({ data: null, timestamp: 0 });

  // Cache for land leaderboard data (5 minutes)
  const landDataCacheRef = useRef<{
    data: LandLeaderboardRow[] | null;
    timestamp: number;
  }>({ data: null, timestamp: 0 });

  // Request deduplication refs to prevent multiple simultaneous calls
  const fetchLeaderboardDataPendingRef = useRef<boolean>(false);
  const fetchMyPlantsPendingRef = useRef<string | null>(null);
  const leaderboardDataLoadedRef = useRef(false);
  const stakeDataLoadedRef = useRef(false);

  const showAttackOutcomeFromHash = useCallback(async (hash?: string | null) => {
    if (!hash) return;
    try {
      const receipt = await getBaseTransactionReceipt(hash as `0x${string}`);
      const abi = (PixotchiNFT as any).abi || PixotchiNFT;
      for (const log of receipt.logs) {
        try {
          const decoded: any = decodeEventLog({ abi, data: log.data as `0x${string}`, topics: log.topics as any });
          if (decoded.eventName === 'Attack') {
            const attacker = Number(decoded.args.attacker);
            const winner = Number(decoded.args.winner);
            const scoresWon = Number(decoded.args.scoresWon) / 1e12;
            const didWin = attacker === winner;
            toast.success(`${didWin ? 'WON' : 'LOST'} ${scoresWon.toLocaleString(undefined, { maximumFractionDigits: 2 })} PTS`, { id: 'attack-result' });
            return;
          }
        } catch { }
      }
      // Fallback
      toast.success('Attack confirmed', { id: 'attack-result' });
    } catch {
      // Swallow decoding errors; keep UX smooth
    }
  }, []);

  const showAttackOutcomeFromLogs = (logs: any[]) => {
    try {
      const abi = (PixotchiNFT as any).abi || PixotchiNFT;
      for (const log of logs) {
        try {
          const decoded: any = decodeEventLog({ abi, data: log.data as `0x${string}`, topics: log.topics as any });
          if (decoded.eventName === 'Attack') {
            const attacker = Number(decoded.args.attacker);
            const winner = Number(decoded.args.winner);
            const scoresWon = Number(decoded.args.scoresWon) / 1e12;
            const didWin = attacker === winner;
            toast.success(`${didWin ? 'WON' : 'LOST'} ${scoresWon.toLocaleString(undefined, { maximumFractionDigits: 2 })} PTS`, { id: 'attack-result' });
            return true;
          }
        } catch { }
      }
    } catch { }
    return false;
  };

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
      // Fetch lands leaderboard as well (with caching)
      try {
        const now = Date.now();
        const cacheAge = now - landDataCacheRef.current.timestamp;

        if (landDataCacheRef.current.data && cacheAge < LAND_CACHE_DURATION) {
          setLandRows(landDataCacheRef.current.data);
        } else {
          const lands = await getLandLeaderboard();
          const sortedLands = [...lands]
            .sort((a, b) => Number(b.experiencePoints - a.experiencePoints))
            .map((l, idx) => ({
              rank: idx + 1,
              landId: Number((l as any).landId ?? 0),
              name: (l as any).name || `Land #${Number((l as any).landId ?? 0)}`,
              exp: Number((l as any).experiencePoints ?? 0) / 1e18,
            }));
          landDataCacheRef.current = { data: sortedLands, timestamp: now };
          setLandRows(sortedLands);
        }
      } catch { }

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

  // Fetch stake leaderboard separately when stake tab is selected
  const fetchStakeLeaderboard = useCallback(async () => {
    const now = Date.now();
    const cacheAge = now - stakeDataCacheRef.current.timestamp;

    // ✅ Return cached data if still valid (within 24-hour window since cron runs once at midnight)
    if (
      stakeDataCacheRef.current.data &&
      cacheAge < STAKE_CACHE_DURATION
    ) {
      console.log(`📊 [Stake] Using cached data (age: ${Math.round(cacheAge / 1000)}s)`);
      setStakeRows(stakeDataCacheRef.current.data);
      stakeDataLoadedRef.current = true;
      return;
    }

    // Fetch fresh data if cache expired or first load
    // Only show loading spinner if we have no existing data
    if (!stakeDataLoadedRef.current) {
      setStakeLoading(true);
    }
    try {
      console.log(`📊 [Stake] Fetching fresh data from API...`);
      const stakeResponse = await fetch('/api/leaderboard/stake');
      if (stakeResponse.ok) {
        const stakeData = await stakeResponse.json();
        const sortedStakes = stakeData.leaderboard.map((entry: any) => ({
          rank: entry.rank,
          address: entry.address,
          stakedAmount: BigInt(entry.stakedAmount),
          ensName: entry.ensName || undefined
        }));

        // ✅ Update cache with fresh data
        stakeDataCacheRef.current = {
          data: sortedStakes,
          timestamp: now
        };

        setStakeRows(sortedStakes);
        stakeDataLoadedRef.current = true;
        console.log(`📊 [Stake] Cached fresh data (${sortedStakes.length} stakers)`);
      }
    } catch (error) {
      console.error('❌ [Stake] Error fetching stake leaderboard:', error);
    } finally {
      setStakeLoading(false);
    }
  }, []);

  const fetchRocksLeaderboard = useCallback(async () => {
    if (!showRocksBoard) {
      setRocksDisabledNotice(null);
      setRocksRows([]);
      setRocksError(null);
      setRocksLoading(false);
      return;
    }

    if (gamificationDisabled) {
      setRocksDisabledNotice(gamificationDisabledMessage);
      setRocksRows([]);
      setRocksError(null);
      setRocksLoading(false);
      return;
    }

    const now = Date.now();
    const cacheAge = now - rocksDataCacheRef.current.timestamp;

    if (rocksDataCacheRef.current.data && cacheAge < ROCKS_CACHE_DURATION) {
      setRocksRows(rocksDataCacheRef.current.data);
      return;
    }

    // Only show loading spinner if we have no existing data
    if (rocksRows.length === 0) {
      setRocksLoading(true);
    }
    setRocksDisabledNotice(null);
    setRocksError(null);
    try {
      const res = await fetch('/api/leaderboard/rocks');
      if (!res.ok) {
        throw new Error(`Failed to fetch rocks leaderboard (${res.status})`);
      }
      const payload = await res.json();
      if (payload?.disabled) {
        const message = typeof payload?.message === 'string' && payload.message.trim().length > 0
          ? payload.message
          : gamificationDisabledMessage;
        setRocksDisabledNotice(message);
        setRocksRows([]);
        rocksDataCacheRef.current = { data: [], timestamp: now };
        return;
      }
      const entries = Array.isArray(payload.leaderboard) ? payload.leaderboard : [];
      const mapped: RocksLeaderboardEntry[] = entries.map((entry: any, index: number) => ({
        rank: typeof entry.rank === 'number' ? entry.rank : index + 1,
        address: entry.address,
        rocks: Number(entry.rocks) || 0,
        name: entry.name ?? null,
      }));
      rocksDataCacheRef.current = { data: mapped, timestamp: now };
      setRocksRows(mapped);
    } catch (fetchError) {
      console.error('❌ [Rocks] Error fetching rocks leaderboard:', fetchError);
      setRocksDisabledNotice(null);
      setRocksError('Failed to load Rocks leaderboard. Please try again.');
    } finally {
      setRocksLoading(false);
    }
  }, [gamificationDisabled, gamificationDisabledMessage, showRocksBoard, rocksRows.length]);

  // Fetch stake data when switching to stake tab
  useEffect(() => {
    if (boardType === 'stake') {
      fetchStakeLeaderboard();
    } else if (boardType === 'rocks') {
      fetchRocksLeaderboard();
    }
  }, [boardType, fetchStakeLeaderboard, fetchRocksLeaderboard]);

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
    if (isVisible) {
      fetchLeaderboardData();
      void fetchMyPlants();
      if (boardType === 'stake') {
        fetchStakeLeaderboard();
      } else if (boardType === 'rocks') {
        fetchRocksLeaderboard();
      }
    }
  }, [isVisible, fetchLeaderboardData, fetchMyPlants, fetchStakeLeaderboard, fetchRocksLeaderboard, boardType]);

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

  const isUserPlant = useCallback((plant: LeaderboardPlant) => {
    // Robust ownership detection: compare owner to connected address and fall back to myPlants list
    const addr = address ? address.toLowerCase() : null;
    const ownerMatches = addr ? plant.owner?.toLowerCase() === addr : false;
    const listedAsMine = myPlants.some((p) => p.id === plant.id);
    return ownerMatches || listedAsMine;
  }, [address, myPlants]);

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
  const totalRockPages = getTotalPages(totalRockItems, ITEMS_PER_PAGE);
  const desktopRockPages = getTotalPages(totalRockItems, DESKTOP_ITEMS_PER_PAGE);
  const currentRocks = getPageRows(rocksRows, currentPage, ITEMS_PER_PAGE);
  const desktopRocks = getPageRows(rocksRows, currentPage, DESKTOP_ITEMS_PER_PAGE);

  function renderPagination(totalPageCount: number, className?: string) {
    if (totalPageCount <= 1) return null;

    const activePage = getBoundedPage(currentPage, totalPageCount, 1);

    return (
      <div className={cn("flex justify-center items-center pt-4", className)}>
        <div className="flex space-x-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(Math.max(activePage - 1, 1))}
            disabled={activePage === 1}
          >
            Back
          </Button>
          <span className="flex items-center px-3 text-sm">
            Page {activePage} of {totalPageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setCurrentPage(Math.min(activePage + 1, totalPageCount))}
            disabled={activePage === totalPageCount}
          >
            Next
          </Button>
        </div>
      </div>
    );
  }

  function renderDesktopColumns<T extends RankedRow>(
    rows: T[],
    renderRow: (row: T, compact?: boolean) => React.ReactNode,
    fillHeight = false
  ) {
    const columns = splitDesktopRows(rows);

    return (
      <div className={cn("hidden xl:grid xl:grid-cols-2 xl:gap-4", fillHeight && "xl:min-h-0 xl:flex-1")}>
        {columns.map((column, columnIndex) => (
          <div
            key={columnIndex}
            className={cn(
              "xl:flex xl:flex-col xl:rounded-md xl:border xl:border-border/70 xl:bg-background/10 xl:px-3 xl:py-2",
              fillHeight && "xl:min-h-0"
            )}
          >
            <div className="flex h-8 flex-none items-center justify-between border-b border-border/60 text-xs font-semibold text-muted-foreground">
              <span>{getRankRangeLabel(column)}</span>
            </div>
            <div className={cn(
              "divide-y divide-border",
              fillHeight
                ? "min-h-0 flex-1 overflow-y-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
                : "overflow-visible"
            )}>
              {column.length > 0 ? (
                column.map((row) => renderRow(row, true))
              ) : (
                <div className="flex min-h-[160px] items-center justify-center text-sm text-muted-foreground">
                  No more entries
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
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
    return (
      <div className={cn("space-y-4", fillDesktop && "xl:flex xl:h-full xl:min-h-0 xl:flex-col xl:space-y-0")}>
        <div className="space-y-2 divide-y divide-border -mx-4 px-4 xl:hidden">
          {mobileRows.map((row) => renderRow(row))}
        </div>

        {renderDesktopColumns(desktopRows, renderRow, fillDesktop)}

        {renderPagination(mobilePageCount, "xl:hidden")}
        {renderPagination(desktopPageCount, "hidden xl:flex xl:mt-3 xl:flex-none xl:border-t xl:border-border/60 xl:pt-3")}
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
          compact ? "py-0.5 transition-all" : "py-3 transition-all",
          isMine && "bg-primary/5 -mx-6 px-6 rounded-lg xl:mx-0 xl:px-3",
          plant.isDead && "opacity-60"
        )}
      >
        <div className={cn("flex items-center space-x-2", compact && "min-h-10")}>
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
              "relative flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity",
              compact && "flex h-8 w-8 items-center justify-center"
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
                <Image src="/icons/Shield.svg" alt="Protected" width={12} height={12} />
              </div>
            )}
            {plant.isDead && (
              <div className={cn("absolute z-10", compact ? "right-0 top-0" : "-top-1 -right-1")}>
                <Skull className="w-3 h-3 text-red-500" />
              </div>
            )}
          </div>

          <div className="flex-1 min-w-0">
            {compact ? (
              <div className="flex min-w-0 items-baseline gap-2">
                <h4 className="min-w-0 truncate pr-2 text-sm font-semibold">
                  {plant.name || `Plant #${plant.id}`}
                  {isMine && <span className="ml-1 text-xs text-primary font-medium">(You)</span>}
                </h4>
                <span className="flex-none text-xs text-muted-foreground">LvL {plant.level}</span>
              </div>
            ) : (
              <>
                <div className="flex items-center space-x-2">
                  <div className="relative min-w-0">
                    <h4 className="font-semibold text-base truncate pr-6">
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
              </>
            )}
          </div>

          <div className="flex items-center space-x-2 text-right">
            {compact ? (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-1 text-foreground">
                  <Image src="/icons/pts.svg" alt="Points" width={12} height={12} />
                  <span className="text-sm font-bold">{formatScoreShort(plant.score)}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Image src="/icons/Star.svg" alt="Stars" width={11} height={11} />
                  <span>{plant.stars}</span>
                </div>
                <div className="flex items-center gap-1">
                  <Image src="/icons/ethlogo.svg" alt="ETH" width={11} height={11} />
                  <span>{formatEthShort(plant.rewards)}</span>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-end space-y-1">
                <div className="flex items-center space-x-1">
                  <Image src="/icons/pts.svg" alt="Points" width={16} height={16} />
                  <span className="text-base font-bold">{formatScoreShort(plant.score)}</span>
                </div>
                <div className="flex items-center space-x-3 text-sm text-muted-foreground">
                  <div className="flex items-center space-x-1">
                    <Image src="/icons/Star.svg" alt="Stars" width={14} height={14} />
                    <span>{plant.stars}</span>
                  </div>
                  <div className="flex items-center space-x-1">
                    <Image src="/icons/ethlogo.svg" alt="ETH" width={14} height={14} />
                    <span>{formatEthShort(plant.rewards)}</span>
                  </div>
                </div>
              </div>
            )}
            {canShowAttack && (
              compact ? (
                <button
                  type="button"
                  className="btn-compact inline-flex h-6 w-11 items-center justify-center rounded-md border border-input bg-background text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                  onClick={() => { setTargetPlant(plant); setSelectedAttackerId(null); setAttackDialogOpen(true); }}
                  aria-label="Attack this plant"
                  title="Attack"
                >
                  <Sword className="w-4 h-4" />
                </button>
              ) : (
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-md"
                  onClick={() => { setTargetPlant(plant); setSelectedAttackerId(null); setAttackDialogOpen(true); }}
                  aria-label="Attack this plant"
                  title="Attack"
                >
                  <Sword className="w-4 h-4" />
                </Button>
              )
            )}
            {canShowKill && (
              compact ? (
                <button
                  type="button"
                  className={cn(
                    "btn-compact inline-flex h-6 w-11 items-center justify-center rounded-md border border-input bg-background text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                    !killCooldown.canKill && "opacity-50"
                  )}
                  onClick={() => {
                    if (!killCooldown.canKill) {
                      setCooldownDialogOpen(true);
                    } else {
                      setTargetPlant(plant);
                      setSelectedKillerId(null);
                      setKillDialogOpen(true);
                    }
                  }}
                  aria-label="Kill dead plant to collect star"
                  title={killCooldown.canKill ? "Kill to collect star" : "Kill available soon"}
                >
                  <Skull className="w-4 h-4" />
                </button>
              ) : (
                <Button
                  variant="outline"
                  size="icon"
                  className={cn("rounded-md", !killCooldown.canKill && "opacity-50")}
                  onClick={() => {
                    if (!killCooldown.canKill) {
                      setCooldownDialogOpen(true);
                    } else {
                      setTargetPlant(plant);
                      setSelectedKillerId(null);
                      setKillDialogOpen(true);
                    }
                  }}
                  aria-label="Kill dead plant to collect star"
                  title={killCooldown.canKill ? "Kill to collect star" : "Kill available soon"}
                >
                  <Skull className="w-4 h-4" />
                </Button>
              )
            )}
            {canShowRevive && (
              compact ? (
                <button
                  type="button"
                  className="btn-compact inline-flex h-6 w-11 items-center justify-center rounded-md border border-input bg-background text-sm font-medium transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
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
                </button>
              ) : (
                <Button
                  variant="outline"
                  size="icon"
                  className="rounded-md"
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
        className={cn(compact ? "py-2" : "py-3", isCurrentUser && "bg-primary/5 -mx-6 px-6 rounded-lg xl:mx-0 xl:px-3")}
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
                    {row.address.slice(0, 6)}...{row.address.slice(-4)}
                  </span>
                </>
              ) : compact ? (
                <>
                  <h4 className="font-semibold text-sm font-mono truncate pr-6">
                    {row.address.slice(0, 6)}...{row.address.slice(-4)}
                    {isCurrentUser && (
                      <span className="ml-2 text-xs text-primary font-medium">(You)</span>
                    )}
                  </h4>
                  <span className="block h-4" aria-hidden="true" />
                </>
              ) : (
                <h4 className={cn("font-semibold font-mono truncate pr-6", compact ? "text-sm" : "text-base")}>
                  {row.address.slice(0, 6)}...{row.address.slice(-4)}
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
        className={cn(compact ? "py-2" : "py-3", isCurrentUser && "bg-primary/5 -mx-6 px-6 rounded-lg xl:mx-0 xl:px-3")}
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
              <Image src="/icons/Volcanic_Rock.svg" alt="Rocks" width={compact ? 14 : 16} height={compact ? 14 : 16} />
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
      return (
        <div className="flex items-center justify-center py-8">
          <BaseExpandedLoadingPageLoader text="Loading leaderboard..." />
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

    if (totalItems === 0) {
      // Check if user is in attackable mode and has no plants
      if (filterMode === 'attackable' && address && myPlants.length === 0) {
        return (
          <div className="text-center py-8 space-y-2">
            <p className="text-muted-foreground">Mint a plant first to attack other plants with it.</p>
            <p className="text-sm text-muted-foreground">Go to the Mint tab to get started.</p>
          </div>
        );
      }

      // Check if user is in attackable mode but has plants (just no attackable targets)
      if (filterMode === 'attackable' && address && myPlants.length > 0) {
        return (
          <div className="text-center py-8 text-muted-foreground">
            <p>No attackable plants found. All plants are either yours, dead, or protected by fences.</p>
          </div>
        );
      }

      // Check if user is in dead mode but no dead plants exist
      if (filterMode === 'dead') {
        return (
          <div className="text-center py-8 text-muted-foreground">
            <p>No dead plants found. All plants are currently alive!</p>
          </div>
        );
      }

      // Default message for 'all' mode or when not connected
      return (
        <div className="text-center py-8 text-muted-foreground">
          <p>No plants found in the leaderboard.</p>
        </div>
      );
    }

    return renderResponsiveRows(currentPlants, desktopPlants, totalPages, desktopTotalPages, renderPlantRow, true);
  };

  return (
    <div className="space-y-4 xl:mx-auto xl:max-w-7xl">
      <Card className={cn("xl:flex xl:flex-col", boardType === 'plants' && "xl:h-[calc(100dvh-8rem)]")}>
        <CardHeader className="xl:flex-none">
          <div className="flex justify-between items-center gap-3 xl:grid xl:grid-cols-[auto_minmax(0,1fr)_auto]">
            <CardTitle>
              Ranking
            </CardTitle>
            {boardType === 'plants' && (
              <div className="hidden items-center justify-center gap-4 xl:flex">
                <ToggleGroup
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
                  <label className="flex items-center gap-2 cursor-pointer text-sm">
                    <input
                      type="checkbox"
                      checked={showOnlyMyPlants}
                      onChange={(e) => {
                        setShowOnlyMyPlants(e.target.checked);
                        setCurrentPage(1);
                      }}
                      className="w-4 h-4 rounded border-border accent-primary"
                    />
                    <span className="text-muted-foreground">My Plants</span>
                  </label>
                )}
              </div>
            )}
            <div className="xl:col-start-3 xl:justify-self-end">
              <ToggleGroup
                value={boardType}
                onValueChange={(nextValue) => {
                  setCurrentPage(1);
                  setBoardType((nextValue as typeof boardType) || 'plants');
                }}
                options={[
                  { value: 'plants', label: 'Plants' },
                  { value: 'lands', label: 'Lands' },
                  { value: 'stake', label: 'Stake' },
                  ...(showRocksBoard ? [{ value: 'rocks', label: 'Rocks' }] : []),
                ]}
              />
            </div>
          </div>
          {boardType === 'plants' && (
            <div className="mt-2 flex items-center justify-between gap-2 flex-wrap xl:hidden">
              <ToggleGroup
                value={filterMode}
                onValueChange={(v) => {
                  setCurrentPage(1);
                  setFilterMode(v as any);
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
                <label className="flex items-center gap-2 cursor-pointer text-sm">
                  <input
                    type="checkbox"
                    checked={showOnlyMyPlants}
                    onChange={(e) => {
                      setShowOnlyMyPlants(e.target.checked);
                      setCurrentPage(1);
                    }}
                    className="w-4 h-4 rounded border-border accent-primary"
                  />
                  <span className="text-muted-foreground">My Plants</span>
                </label>
              )}
            </div>
          )}
        </CardHeader>
        <CardContent className={cn("xl:min-h-0", boardType === 'plants' && "xl:flex-1")}>
          {boardType === 'plants' ? (
            renderContent()
          ) : boardType === 'lands' ? (
            loading && totalLandItems === 0 ? (
              <div className="flex items-center justify-center py-8">
                <BaseExpandedLoadingPageLoader text="Loading lands leaderboard..." />
              </div>
            ) : totalLandItems === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No lands found.</div>
            ) : (
              renderResponsiveRows(currentLands, desktopLands, totalLandPages, desktopLandPages, renderLandRow)
            )
          ) : boardType === 'stake' ? (
            stakeLoading && totalStakeItems === 0 ? (
              <div className="flex items-center justify-center py-8">
                <BaseExpandedLoadingPageLoader text="Loading stake leaderboard..." />
              </div>
            ) : totalStakeItems === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No stakers found.</div>
            ) : (
              renderResponsiveRows(currentStakes, desktopStakes, totalStakePages, desktopStakePages, renderStakeRow)
            )
          ) : rocksDisabledNotice ? (
            <Alert className="mt-4">
              <Terminal className="h-4 w-4" />
              <AlertTitle>Temporarily Disabled</AlertTitle>
              <AlertDescription>{rocksDisabledNotice}</AlertDescription>
            </Alert>
          ) : (
            rocksLoading && totalRockItems === 0 ? (
              <div className="flex items-center justify-center py-8">
                <BaseExpandedLoadingPageLoader text="Loading Rocks leaderboard..." />
              </div>
            ) : rocksError ? (
              <Alert variant="destructive" className="mt-4">
                <Terminal className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{rocksError}</AlertDescription>
              </Alert>
            ) : totalRockItems === 0 ? (
              <div className="text-center py-8 text-muted-foreground">No rock earners found.</div>
            ) : (
              renderResponsiveRows(currentRocks, desktopRocks, totalRockPages, desktopRockPages, renderRockRow)
            )
          )}
        </CardContent>
      </Card>

      {/* Attack dialog */}
      <Dialog open={attackDialogOpen} onOpenChange={setAttackDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Select your attacker</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {/* Brief rules/eligibility panel */}
            <div className="text-xs text-muted-foreground bg-muted/40 border rounded-md p-2">
              <ul className="list-disc pl-5 space-y-1">
                <li>Each plant can attack once every 30 minutes.</li>
                <li>Target can be attacked again after 60 minutes.</li>
                <li>Attacker must be alive and a lower level than the target.</li>
                <li>Targets with an active fence cannot be attacked.</li>
                <li>You cannot attack your own plant.</li>
              </ul>
            </div>
            {targetPlant && (
              <div className="text-sm text-muted-foreground">
                Target: <span className="font-medium">{targetPlant.name || `Plant #${targetPlant.id}`}</span> (Lvl {targetPlant.level})
              </div>
            )}

            <div className="space-y-2 max-h-64 overflow-y-auto">
              {targetPlant && eligibleAttackers(targetPlant).length === 0 && (
                <div className="text-sm text-muted-foreground">
                  No eligible plants to attack with right now. Each plant can attack once every 30 minutes.
                </div>
              )}
              {targetPlant && eligibleAttackers(targetPlant).map((p) => (
                <label key={p.id} className={`flex items-center justify-between p-2 rounded-md border ${selectedAttackerId === p.id ? 'bg-accent' : 'bg-card'}`}>
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="attacker"
                      className="accent-primary"
                      checked={selectedAttackerId === p.id}
                      onChange={() => setSelectedAttackerId(p.id)}
                    />
                    <PlantImage selectedPlant={p as any} width={28} height={28} />
                    <div className="text-sm">
                      <div className="font-medium">{p.name || `Plant #${p.id}`}</div>
                      <div className="text-xs text-muted-foreground">Lvl {p.level}</div>
                    </div>
                  </div>
                </label>
              ))}
            </div>

            <div className="pt-2 space-y-2">
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
                        toast.success('Attack submitted via bridge!');
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
                      showToast={true}
                      disabled={isSubmitting || !eligible}
                      onStatusUpdate={(status: any) => {
                        if (status.statusName === 'pending') {
                          setIsSubmitting(true);
                          try {
                            const h = status.statusData?.transactionReceipts?.[0]?.transactionHash || status.statusData?.transactions?.[0]?.hash;
                            if (h) setPendingHash(h);
                          } catch { }
                          toast.loading('Submitting attack...', { id: 'attack-tx' });
                        }
                        if (status.statusName === 'success') {
                          setIsSubmitting(false);
                          toast.success('Attack confirmed!', { id: 'attack-tx' });
                          try {
                            const receipt = status.statusData?.transactionReceipts?.[0];
                            const logs = receipt?.logs || [];
                            const shown = showAttackOutcomeFromLogs(logs);
                            if (!shown) {
                              const h = receipt?.transactionHash || pendingHash;
                              void showAttackOutcomeFromHash(h);
                            }
                          } catch { }
                          // After a successful attack, refresh lists
                          fetchLeaderboardData();
                          void fetchMyPlants();
                        }
                        if (status.statusName === 'error') {
                          setIsSubmitting(false);
                          setPendingHash(null);
                          toast.error('Attack failed', { id: 'attack-tx' });
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
          </div>
        </DialogContent>
      </Dialog>

      {/* Kill dialog */}
      <Dialog open={killDialogOpen} onOpenChange={setKillDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Collect a star by killing a dead plant</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div className="text-xs text-muted-foreground bg-muted/40 border rounded-md p-2">
              Select one of your living plants to perform the kill. Target must be dead.
              <br /><span className="text-xs">Note: You can only kill once per hour.</span>
            </div>
            {!killCooldown.canKill && (
              <div className="text-sm text-amber-600 bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-md p-2">
                ⏳ Cooldown active. Close this dialog to see the timer.
              </div>
            )}
            {targetPlant && (
              <div className="text-sm text-muted-foreground">
                Dead target: <span className="font-medium">{targetPlant.name || `Plant #${targetPlant.id}`}</span>
              </div>
            )}
            <div className="space-y-2 max-h-64 overflow-y-auto">
              {myPlants.filter(p => p.status !== 4).map((p) => (
                <label key={p.id} className={`flex items-center justify-between p-2 rounded-md border ${selectedKillerId === p.id ? 'bg-accent' : 'bg-card'}`}>
                  <div className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="killer"
                      className="accent-primary"
                      checked={selectedKillerId === p.id}
                      onChange={() => setSelectedKillerId(p.id)}
                    />
                    <PlantImage selectedPlant={p as any} width={28} height={28} />
                    <div className="text-sm">
                      <div className="font-medium">{p.name || `Plant #${p.id}`}</div>
                      <div className="text-xs text-muted-foreground">Lvl {p.level}</div>
                    </div>
                  </div>
                </label>
              ))}
            </div>
            <div className="pt-2 space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">Confirm Kill</span>
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
                  showToast={true}
                  onStatusUpdate={(status: any) => {
                    if (status.statusName === 'pending') {
                      toast.loading('Submitting kill...', { id: 'kill-tx' });
                    }
                    if (status.statusName === 'success') {
                      toast.success('Kill successful! You earned 1 star.', { id: 'kill-tx' });
                    }
                    if (status.statusName === 'error') {
                      toast.error('Kill failed', { id: 'kill-tx' });
                    }
                  }}
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
          </div>
        </DialogContent>
      </Dialog>

      {/* Revive dialog */}
      <Dialog open={reviveDialogOpen} onOpenChange={setReviveDialogOpen}>
        {/* ... existing revive dialog content ... */}
        {/* WE DO NOT EDIT REVIVE DIALOG HERE, JUST MATCHING CONTEXT IS HARD SO I WILL APPEND AT END OF FILE */}
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revive your plant</DialogTitle>
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
                      onStatusUpdate={(status: any) => {
                        if (status.statusName === 'pending') {
                          toast.loading('Submitting revive...', { id: 'revive-tx' });
                        }
                        if (status.statusName === 'success') {
                          toast.success('You revived your plant.', { id: 'revive-tx' });
                        }
                        if (status.statusName === 'error') {
                          toast.error('Revive failed', { id: 'revive-tx' });
                        }
                      }}
                      onSuccess={() => {
                        setReviveDialogOpen(false);
                        fetchLeaderboardData();
                        void fetchMyPlants();
                      }}
                    />
                    {!hasEnough && (
                      <div className="text-xs text-red-500">Insufficient SEED balance (requires {formatTokenAmount(revivePrice)} SEED)</div>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Plant Profile Dialog */}
      <PlantProfileDialog
        open={profileDialogOpen}
        onOpenChange={setProfileDialogOpen}
        plant={selectedPlantForProfile}
      />

      {/* Kill Cooldown Dialog */}
      <Dialog open={cooldownDialogOpen} onOpenChange={setCooldownDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cooldown Active</DialogTitle>
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
