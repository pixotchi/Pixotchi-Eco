"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { useAccount, usePublicClient } from "wagmi";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BaseExpandedLoadingPageLoader } from "@/components/ui/loading";
import { Plant } from "@/lib/types";
import { getAliveTokenIds, getPlantsInfoExtended, getPlantsByOwner, getTokenBalance, getLandLeaderboard } from "@/lib/contracts";
import { formatScoreShort, formatEthShort, formatScore, formatAddress, cn, getFenceStatus } from "@/lib/utils";
import PlantImage from "@/components/PlantImage";
import { Trophy, Skull, Sword, HeartPulse } from "lucide-react";
import Image from "next/image";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Terminal } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import AttackTransaction from "@/components/transactions/attack-transaction";
import KillTransaction from "@/components/transactions/kill-transaction";
import ReviveTransaction from "@/components/transactions/revive-transaction";
import toast from "react-hot-toast";
import PixotchiNFT from "@/public/abi/PixotchiNFT.json";
import { decodeEventLog } from "viem";
import { usePaymaster } from "@/lib/paymaster-context";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { SponsoredBadge } from "@/components/paymaster-toggle";
import { ToggleGroup } from "@/components/ui/toggle-group";
import PlantProfileDialog from "@/components/plant-profile-dialog";
import { Avatar } from "@coinbase/onchainkit/identity";
import { base } from "viem/chains";
import { useIsSolanaWallet, useTwinAddress, SolanaNotSupported } from "@/components/solana";
import SolanaBridgeButton from "@/components/transactions/solana-bridge-button";

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

const ITEMS_PER_PAGE = 12;

// Client-side cache duration for stake data (24 hours since cron runs once at midnight)
const STAKE_CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
const ROCKS_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

export default function LeaderboardTab() {
  const { address: evmAddress } = useAccount();
  const { isSponsored } = usePaymaster();
  const { isSmartWallet } = useSmartWallet();
  const isSolana = useIsSolanaWallet();
  const twinAddress = useTwinAddress();

  // Use Twin address for Solana users, EVM address otherwise
  // Memoize to prevent unnecessary re-renders when dependencies haven't actually changed
  const address = useMemo(() => {
    return isSolana && twinAddress ? twinAddress as `0x${string}` : evmAddress;
  }, [isSolana, twinAddress, evmAddress]);
  const [plants, setPlants] = useState<LeaderboardPlant[]>([]);
  const [landRows, setLandRows] = useState<Array<{ rank: number; landId: number; name: string; exp: number }>>([]);
  const [stakeRows, setStakeRows] = useState<StakeLeaderboardEntry[]>([]);
  const [rocksRows, setRocksRows] = useState<RocksLeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [stakeLoading, setStakeLoading] = useState(false);
  const [rocksLoading, setRocksLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rocksError, setRocksError] = useState<string | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
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
  const [filterMode, setFilterMode] = useState<'all' | 'attackable'>('all');
  const [showOnlyMyPlants, setShowOnlyMyPlants] = useState(false);
  const publicClient = usePublicClient();
  const [boardType, setBoardType] = useState<'plants' | 'lands' | 'stake' | 'rocks'>('plants');
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [selectedPlantForProfile, setSelectedPlantForProfile] = useState<LeaderboardPlant | null>(null);

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
    data: Array<{ rank: number; landId: number; name: string; exp: number }> | null;
    timestamp: number;
  }>({ data: null, timestamp: 0 });
  const LAND_CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

  // Request deduplication refs to prevent multiple simultaneous calls
  const fetchLeaderboardDataPendingRef = useRef<boolean>(false);
  const fetchMyPlantsPendingRef = useRef<string | null>(null);

  const showAttackOutcomeFromHash = useCallback(async (hash?: string | null) => {
    if (!hash || !publicClient) return;
    try {
      const receipt = await publicClient.getTransactionReceipt({ hash: hash as `0x${string}` });
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
        } catch (e) { }
      }
      // Fallback
      toast.success('Attack confirmed', { id: 'attack-result' });
    } catch (e) {
      // Swallow decoding errors; keep UX smooth
    }
  }, [publicClient]);

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
        } catch (e) { }
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
    if (plants.length === 0) {
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

      setCurrentPage(1); // Reset to first page when data changes
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
      return;
    }

    // Fetch fresh data if cache expired or first load
    // Only show loading spinner if we have no existing data
    if (stakeRows.length === 0) {
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
        console.log(`📊 [Stake] Cached fresh data (${sortedStakes.length} stakers)`);
      }
    } catch (error) {
      console.error('❌ [Stake] Error fetching stake leaderboard:', error);
    } finally {
      setStakeLoading(false);
    }
  }, []);

  const fetchRocksLeaderboard = useCallback(async () => {
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
    setRocksError(null);
    try {
      const res = await fetch('/api/leaderboard/rocks');
      if (!res.ok) {
        throw new Error(`Failed to fetch rocks leaderboard (${res.status})`);
      }
      const payload = await res.json();
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
      setRocksError('Failed to load Rocks leaderboard. Please try again.');
    } finally {
      setRocksLoading(false);
    }
  }, []);

  // Fetch stake data when switching to stake tab
  useEffect(() => {
    if (boardType === 'stake') {
      fetchStakeLeaderboard();
    } else if (boardType === 'rocks') {
      fetchRocksLeaderboard();
    }
  }, [boardType, fetchStakeLeaderboard, fetchRocksLeaderboard]);

  // Reset pagination when switching board type
  useEffect(() => {
    setCurrentPage(1);
  }, [boardType]);

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
    } catch (e) {
      // ignore
    } finally {
      // Clear pending flag only if address hasn't changed
      if (fetchMyPlantsPendingRef.current === address) {
        fetchMyPlantsPendingRef.current = null;
      }
    }
  }, [address]);

  useEffect(() => { void fetchMyPlants(); }, [fetchMyPlants]);

  // Refresh SEED balance when opening revive dialog
  useEffect(() => {
    (async () => {
      if (reviveDialogOpen && address) {
        try {
          const bal = await getTokenBalance(address);
          setSeedBalance(bal || BigInt(0));
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

  const isUserPlant = (plant: LeaderboardPlant) => {
    // Robust ownership detection: compare owner to connected address and fall back to myPlants list
    const addr = address ? address.toLowerCase() : null;
    const ownerMatches = addr ? plant.owner?.toLowerCase() === addr : false;
    const listedAsMine = myPlants.some((p) => p.id === plant.id);
    return ownerMatches || listedAsMine;
  };

  const hasActiveFence = (plant: LeaderboardPlant) => {
    const fenceInfo = getFenceStatus(plant);
    return fenceInfo.hasActiveFence;
  };

  // Eligibility checks (client-side guardrails based on app rules)
  const isDead = (p: { status: number }) => p.status === 4;
  const nowSec = () => Math.floor(Date.now() / 1000);
  const attackerCooldownOver = (attacker: Plant) => {
    const last = Number(attacker.lastAttackUsed || '0');
    return nowSec() >= last + 30 * 60; // 30 minutes
  };
  const targetCooldownOver = (target: LeaderboardPlant) => {
    const last = Number(target.lastAttacked || '0');
    return nowSec() >= last + 60 * 60; // 60 minutes
  };
  const canAttackWith = (attacker: Plant, target: LeaderboardPlant) => {
    if (!attacker || !target) return false;
    if (isDead(attacker) || isDead(target)) return false;
    if (attacker.id === target.id) return false;
    if (attacker.level >= target.level) return false;
    if (!attackerCooldownOver(attacker)) return false;
    if (!targetCooldownOver(target)) return false;
    if (hasActiveFence(target)) return false;
    return true;
  };
  const eligibleAttackers = (target: LeaderboardPlant): Plant[] => myPlants.filter((p) => canAttackWith(p, target));

  const handlePlantImageClick = (plant: LeaderboardPlant) => {
    setSelectedPlantForProfile(plant);
    setProfileDialogOpen(true);
  };

  const isAttackable = (plant: LeaderboardPlant) => !isUserPlant(plant) && !plant.isDead && eligibleAttackers(plant).length > 0 && !hasActiveFence(plant);

  // Apply filters: My Plants filter takes priority, then All/Attackable mode
  const filteredPlants = useMemo(() => {
    let filtered = plants;

    // Filter by ownership if "My Plants" is checked
    if (showOnlyMyPlants) {
      filtered = filtered.filter(isUserPlant);
    }

    // Then apply attackable filter if in attackable mode
    if (filterMode === 'attackable') {
      filtered = filtered.filter(isAttackable);
    }

    return filtered;
  }, [plants, showOnlyMyPlants, filterMode, myPlants, address]);

  const totalItems = filteredPlants.length;
  const totalPages = Math.ceil(totalItems / ITEMS_PER_PAGE) || 1;
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const currentPlants = filteredPlants.slice(startIndex, endIndex);

  // Lands pagination
  const totalLandItems = landRows.length;
  const totalLandPages = Math.ceil(totalLandItems / ITEMS_PER_PAGE) || 1;
  const startLandIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endLandIndex = startLandIndex + ITEMS_PER_PAGE;
  const currentLands = landRows.slice(startLandIndex, endLandIndex);

  // Stake pagination
  const totalStakeItems = stakeRows.length;
  const totalStakePages = Math.ceil(totalStakeItems / ITEMS_PER_PAGE) || 1;
  const startStakeIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endStakeIndex = startStakeIndex + ITEMS_PER_PAGE;
  const currentStakes = stakeRows.slice(startStakeIndex, endStakeIndex);

  const totalRockItems = rocksRows.length;
  const totalRockPages = Math.ceil(totalRockItems / ITEMS_PER_PAGE) || 1;
  const startRockIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endRockIndex = startRockIndex + ITEMS_PER_PAGE;
  const currentRocks = rocksRows.slice(startRockIndex, endRockIndex);

  const renderContent = () => {
    if (loading) {
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

      // Default message for 'all' mode or when not connected
      return (
        <div className="text-center py-8 text-muted-foreground">
          <p>No plants found in the leaderboard.</p>
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="space-y-2 divide-y divide-border -mx-4 px-4">
          {currentPlants.map((plant) => {
            const canShowAttack =
              !isUserPlant(plant) &&
              !plant.isDead &&
              eligibleAttackers(plant).length > 0 &&
              !hasActiveFence(plant);
            const isMine = isUserPlant(plant);
            const canShowKill = !isMine && plant.isDead;
            const canShowRevive = isMine && plant.isDead;

            return (
              <div
                key={plant.id}
                className={`py-3 transition-all ${isUserPlant(plant) ? 'bg-primary/5 -mx-6 px-6 rounded-lg' : ''
                  } ${plant.isDead ? 'opacity-60' : ''}`}
              >
                <div className="flex items-center space-x-2">
                  {/* Rank */}
                  <div className="flex items-center justify-center w-8">
                    <div className={`flex items-center ${getRankColor(plant.rank)}`}>
                      {plant.rank <= 3 ? (
                        getRankIcon(plant.rank)
                      ) : (
                        <span className="text-sm font-semibold">#{plant.rank}</span>
                      )}
                    </div>
                  </div>

                  {/* Plant Image */}
                  <div
                    className="relative flex-shrink-0 cursor-pointer hover:opacity-80 transition-opacity"
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
                    <PlantImage selectedPlant={plant} width={48} height={48} />
                    {hasActiveFence(plant) && (
                      <div className="absolute -top-1 -right-1">
                        <Image src="/icons/Shield.svg" alt="Protected" width={12} height={12} />
                      </div>
                    )}
                    {plant.isDead && (
                      <div className="absolute -top-1 -right-1">
                        <Skull className="w-3 h-3 text-red-500" />
                      </div>
                    )}
                  </div>

                  {/* Plant Info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center space-x-2">
                      <div className="relative">
                        <h4 className="font-semibold text-base truncate pr-6">
                          {plant.name || `Plant #${plant.id}`}
                          {isUserPlant(plant) && (
                            <span className="ml-2 text-xs text-primary font-medium">(You)</span>
                          )}
                        </h4>
                        {/* Edit name removed for leaderboard view */}
                      </div>
                      {/* Dead label removed. Skull indicator is shown over image and actions show accordingly. */}
                    </div>
                    <div className="flex items-center space-x-4 text-sm text-muted-foreground mt-1">
                      <span>LvL {plant.level}</span>
                    </div>
                  </div>

                  {/* Stats with right-aligned action buttons */}
                  <div className="flex items-center space-x-2 text-right">
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
                    {canShowAttack && (
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
                    )}
                    {canShowKill && (
                      <Button
                        variant="outline"
                        size="icon"
                        className="rounded-md"
                        onClick={() => { setTargetPlant(plant); setSelectedKillerId(null); setKillDialogOpen(true); }}
                        aria-label="Kill dead plant to collect star"
                        title="Kill to collect star"
                      >
                        <Skull className="w-4 h-4" />
                      </Button>
                    )}
                    {canShowRevive && (
                      <Button
                        variant="outline"
                        size="icon"
                        className="rounded-md"
                        onClick={() => { setTargetPlant(plant); setReviveDialogOpen(true); }}
                        aria-label="Revive your plant"
                        title="Revive"
                      >
                        <HeartPulse className="w-4 h-4" />
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
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
            <CardTitle>
              Ranking
            </CardTitle>
            <ToggleGroup
              value={boardType}
              onValueChange={(v) => setBoardType((v as any) || 'plants')}
              options={[
                { value: 'plants', label: 'Plants' },
                { value: 'lands', label: 'Lands' },
                { value: 'stake', label: 'Stake' },
                { value: 'rocks', label: 'Rocks' },
              ]}
            />
          </div>
          {boardType === 'plants' && (
            <div className="mt-2 flex items-center justify-between gap-2 flex-wrap">
              <ToggleGroup
                value={filterMode}
                onValueChange={(v) => {
                  setCurrentPage(1);
                  setFilterMode(v as any);
                  // Auto-uncheck "My Plants" when switching to attackable (can't attack own plants)
                  if (v === 'attackable') {
                    setShowOnlyMyPlants(false);
                  }
                }}
                options={[
                  { value: 'all', label: 'All' },
                  { value: 'attackable', label: 'Attackable' },
                ]}
              />
              {address && myPlants.length > 0 && filterMode !== 'attackable' && (
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
        <CardContent>
          {boardType === 'plants' ? (
            renderContent()
          ) : boardType === 'lands' ? (
            loading ? (
              <div className="flex items-center justify-center py-8">
                <BaseExpandedLoadingPageLoader text="Loading lands leaderboard..." />
              </div>
            ) : (
              <div className="space-y-2 divide-y divide-border -mx-4 px-4">
                {totalLandItems === 0 && (
                  <div className="text-center py-8 text-muted-foreground">No lands found.</div>
                )}
                {currentLands.map((row) => (
                  <div key={row.landId} className="py-3">
                    <div className="flex items-center space-x-2">
                      <div className="flex items-center justify-center w-8">
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
                          <h4 className="font-semibold text-base truncate pr-6">
                            {row.name}
                          </h4>
                        </div>
                      </div>
                      <div className="flex items-center space-x-2 text-right">
                        <div className="flex flex-col items-end space-y-1">
                          <div className="flex items-center space-x-1">
                            <Image src="/icons/pts.svg" alt="EXP" width={16} height={16} />
                            <span className="text-base font-bold">{row.exp.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
                {totalLandPages > 1 && (
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
                        Page {currentPage} of {totalLandPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalLandPages))}
                        disabled={currentPage === totalLandPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          ) : boardType === 'stake' ? (
            stakeLoading ? (
              <div className="flex items-center justify-center py-8">
                <BaseExpandedLoadingPageLoader text="Loading stake leaderboard..." />
              </div>
            ) : (
              <div className="space-y-2 divide-y divide-border -mx-4 px-4">
                {totalStakeItems === 0 && (
                  <div className="text-center py-8 text-muted-foreground">No stakers found.</div>
                )}
                {currentStakes.map((row) => {
                  const formattedStake = (Number(row.stakedAmount) / 1e18).toLocaleString(undefined, {
                    maximumFractionDigits: 2
                  });
                  const isCurrentUser = address && row.address.toLowerCase() === address.toLowerCase();

                  return (
                    <div
                      key={row.address}
                      className={`py-3 ${isCurrentUser ? 'bg-primary/5 -mx-6 px-6 rounded-lg' : ''}`}
                    >
                      <div className="flex items-center space-x-2">
                        <div className="flex items-center justify-center w-8">
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
                                <h4 className="font-semibold text-base truncate pr-6">
                                  {row.ensName}
                                  {isCurrentUser && (
                                    <span className="ml-2 text-xs text-primary font-medium">(You)</span>
                                  )}
                                </h4>
                                <span className="text-xs text-muted-foreground font-mono truncate">
                                  {row.address.slice(0, 6)}...{row.address.slice(-4)}
                                </span>
                              </>
                            ) : (
                              <h4 className="font-semibold text-base font-mono truncate pr-6">
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
                              <Image src="/PixotchiKit/COIN.svg" alt="Staked SEED" width={16} height={16} />
                              <span className="text-base font-bold">{formattedStake}</span>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {totalStakePages > 1 && (
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
                        Page {currentPage} of {totalStakePages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalStakePages))}
                        disabled={currentPage === totalStakePages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )
          ) : (
            rocksLoading ? (
              <div className="flex items-center justify-center py-8">
                <BaseExpandedLoadingPageLoader text="Loading Rocks leaderboard..." />
              </div>
            ) : rocksError ? (
              <Alert variant="destructive" className="mt-4">
                <Terminal className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>{rocksError}</AlertDescription>
              </Alert>
            ) : (
              <div className="space-y-2 divide-y divide-border -mx-4 px-4">
                {totalRockItems === 0 && (
                  <div className="text-center py-8 text-muted-foreground">No rock earners found.</div>
                )}
                {currentRocks.map((row) => {
                  const isCurrentUser = address && row.address?.toLowerCase() === address.toLowerCase();
                  return (
                    <div
                      key={row.address || `rock-${row.rank}`}
                      className={`py-3 ${isCurrentUser ? 'bg-primary/5 -mx-6 px-6 rounded-lg' : ''}`}
                    >
                      <div className="flex items-center space-x-2">
                        <div className="flex items-center justify-center w-8">
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
                            <Avatar
                              address={row.address as `0x${string}`}
                              chain={base}
                              className="w-10 h-10 rounded-full"
                            />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-muted" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <h4 className="font-semibold text-base truncate pr-6">
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
                            <Image src="/icons/Volcanic_Rock.svg" alt="Rocks" width={16} height={16} />
                            <span className="text-base font-bold">{row.rocks.toLocaleString()}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
                {totalRockPages > 1 && (
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
                        Page {currentPage} of {totalRockPages}
                      </span>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalRockPages))}
                        disabled={currentPage === totalRockPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </div>
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
            </div>
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
                    setKillDialogOpen(false);
                    setSelectedKillerId(null);
                    fetchLeaderboardData();
                    void fetchMyPlants();
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Revive your plant</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            {targetPlant && (
              <div className="text-sm text-muted-foreground">
                You are reviving <span className="font-medium">{targetPlant.name || `Plant #${targetPlant.id}`}</span>. Cost: 100 SEED.
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
                const REVIVE_COST_WEI = BigInt(100) * (BigInt(10) ** BigInt(18));
                const hasEnough = seedBalance > REVIVE_COST_WEI;
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
                      <div className="text-xs text-red-500">Insufficient SEED balance (requires &gt; 100 SEED)</div>
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
    </div>
  );
}