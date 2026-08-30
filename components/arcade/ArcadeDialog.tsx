"use client";

import { SponsoredBadge } from "@/components/paymaster-toggle";
import { SolanaNotSupported,useIsSolanaWallet } from "@/components/solana";
import BoxGameTransaction from "@/components/transactions/box-game-transaction";
import SpinGameTransaction from "@/components/transactions/spin-game-transaction";
import type { LifecycleStatus } from "@/components/transactions/transaction-kit";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { DisabledReason, InlineBalanceNotice, RewardResultPanel } from "@/components/ui/premium";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { getBaseLogClient } from "@/lib/base-rpc";
import { BOX_GAME_ABI,PIXOTCHI_NFT_ADDRESS,SPIN_GAME_ABI } from "@/lib/contracts";
import { usePaymaster } from "@/lib/paymaster-context";
import {
invalidateOwnerResources,
isAbortError,
retryOwnerRead,
} from "@/lib/owner-resource-invalidation";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import {
SPIN_GAME_V2_COMMITTED_EVENT,
SPIN_GAME_V2_FORFEITED_EVENT,
SPIN_GAME_V2_PLAYED_EVENT,
} from "@/lib/spin-game-events";
import {
  migrateLegacySpinPending,
  readStoredSpinPending,
  removeStoredSpinPending,
  SPIN_PENDING_STORAGE_VERSION,
  type StoredSpinPending,
  writeStoredSpinPending,
} from "@/lib/spin-pending-storage";
import { Plant } from "@/lib/types";
import { cn,formatDuration,formatScore,formatTokenAmount } from "@/lib/utils";
import Image from "next/image";
import { type ReactNode,useCallback,useEffect,useMemo,useRef,useState } from "react";
import { toast } from "react-hot-toast";
import { encodePacked,hexToBytes,keccak256,toHex } from "viem";
import { useAccount,usePublicClient,useSignMessage } from "wagmi";

type ArcadeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plant: Plant;
};

type GameId = "box" | "spin";

interface RewardPreview {
  index: number;
  pointsDelta: number;
  timeExtension: number;
  leafAmount: bigint;
}

interface PendingCommit {
  player: string;
  commitBlock: number;
  commitment: `0x${string}`;
  secretHex?: `0x${string}`;
}

type PendingReconciliation = {
  pending: PendingCommit | null;
  terminal: "forfeited" | "played" | null;
};

type PendingHydration = {
  pending: PendingCommit | null;
  stored: StoredSpinPending | null;
};

interface SpinState {
  cooldown: number;
  starCost: number;
  rewards: RewardPreview[];
  pending: PendingCommit | null;
}

const LOG_LOOKBACK_BLOCKS = 1000;
const LOG_LOOKBACK_BUFFER_BLOCKS = 64;
const LOG_CHUNK_SIZE = BigInt(500);
const BLOCK_TIME_SECONDS = 4;
const BLOCK_POLL_INTERVAL_MS = 3000;
const MIN_REVEAL_DELAY_SECONDS = 4;

const WHEEL_SEGMENTS = 6;
const SPIN_EXTRA_TURNS = 4;
const FINAL_SPIN_DURATION_MS = 2200;
const TRANSACTION_FAILURE_STATUSES = new Set([
  "error",
  "failed",
  "reverted",
  "cancelled",
  "canceled",
  "rejected",
  "transactionRejected",
  "userRejected",
  "buildError",
]);

function buildCommitStateMessage(address: string, plantId: number, block: number): string {
  return `Pixotchi spin commit state\nAddress: ${address.toLowerCase()}\nPlant ID: ${plantId}\nBlock: ${block}`;
}

function createCommitment(secret: Uint8Array, plantId: number, address: string): `0x${string}` {
  const encoded = encodePacked(
    ["address", "uint256", "bytes32"],
    [address as `0x${string}`, BigInt(plantId), toHex(secret) as `0x${string}`]
  );
  return keccak256(encoded);
}

function getSpinStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

const GameSelector = ({
  selected,
  onSelect,
  className,
  disabled = false,
}: {
  selected: GameId;
  onSelect: (game: GameId) => void;
  className?: string;
  disabled?: boolean;
}) => (
  <div
    className={cn("flex justify-center", disabled && "pointer-events-none opacity-60", className)}
    aria-disabled={disabled || undefined}
    inert={disabled ? true : undefined}
  >
    <ToggleGroup
      ariaLabel="Arcade game"
      value={selected}
      onValueChange={(value) => onSelect(value as GameId)}
      options={[
        {
          value: "box",
          ariaLabel: "Box Game",
          label: (
            <span className="flex min-w-0 items-center gap-1.5">
              <Image src="/icons/box.png" alt="" width={16} height={16} className="h-4 w-4 shrink-0 object-contain" aria-hidden />
              <span className="truncate">Box Game</span>
            </span>
          ),
        },
        {
          value: "spin",
          ariaLabel: "SpinLeaf",
          label: (
            <span className="flex min-w-0 items-center gap-1.5">
              <Image src="/icons/spinleaf.png" alt="" width={16} height={16} className="h-4 w-4 shrink-0 object-contain" aria-hidden />
              <span className="truncate">SpinLeaf</span>
            </span>
          ),
        },
      ]}
      size="default"
    />
  </div>
);

type ArcadeTone = "default" | "primary" | "success" | "warning" | "danger";

function getArcadeToneClassName(tone: ArcadeTone) {
  return {
    danger: "text-destructive",
    default: "text-foreground",
    primary: "text-primary",
    success: "text-[hsl(var(--success-strong))]",
    warning: "text-[hsl(var(--warning-strong))]",
  }[tone];
}

function ArcadeStatLine({
  label,
  value,
  tone = "default",
}: {
  label: ReactNode;
  value: ReactNode;
  tone?: ArcadeTone;
}) {
  return (
    <div className="flex min-h-8 items-center justify-between gap-3 py-1.5">
      <span className="min-w-0 text-muted-foreground">{label}</span>
      <span className={cn("shrink-0 text-right font-semibold tabular-nums", getArcadeToneClassName(tone))}>
        {value}
      </span>
    </div>
  );
}

export default function ArcadeDialog({ open, onOpenChange, plant }: ArcadeDialogProps) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const publicClient = usePublicClient();
  const baseLogClient = useMemo(() => getBaseLogClient(), []);
  const { isSponsored } = usePaymaster();
  const { isSmartWallet } = useSmartWallet();
  const isSolana = useIsSolanaWallet();
  const plantId = plant.id;
  const [selectedGame, setSelectedGame] = useState<GameId>("box");
  const [seed, setSeed] = useState<number | null>(null);
  const [withStar, setWithStar] = useState(false);
  const [cooldown, setCooldown] = useState({ normal: 0, star: 0 });
  const [boxReconcilePending, setBoxReconcilePending] = useState(false);
  const [arcadeTransactionPending, setArcadeTransactionPending] = useState(false);
  const [starsAvailable, setStarsAvailable] = useState(plant.stars ?? 0);
  const [spinMeta, setSpinMeta] = useState<SpinState | null>(null);
  // Rendered now (skeleton line while metadata loads) — it used to be a
  // write-only state slot, so the panel showed made-up defaults ("Ready to
  // spin", cost 1) before the reads resolved.
  const [loadingSpinMeta, setLoadingSpinMeta] = useState(false);
  const [pendingSecret, setPendingSecret] = useState<Uint8Array | null>(null);
  const [spinStorageHydratedFor, setSpinStorageHydratedFor] = useState<string | null>(null);
  const [persistedSpinCommitment, setPersistedSpinCommitment] = useState<`0x${string}` | null>(null);
  const [spinStorageUnavailable, setSpinStorageUnavailable] = useState(false);
  // Ticks once per second while the spin tab is open so cooldown/reveal
  // countdowns actually count down. (Two former write-only states drove
  // twice-a-second re-renders here for values nothing rendered.)
  const [nowTick, setNowTick] = useState(() => Date.now());
  const [spinRefreshKey, setSpinRefreshKey] = useState(0);
  const lastUnlockBlocksRef = useRef<number | null>(null);
  const wheelRotorRef = useRef<HTMLDivElement | null>(null);
  const [boxResultDetails, setBoxResultDetails] = useState<{
    pointsDelta: number;
    timeAdded: number;
  } | null>(null);
  const [wheelState, setWheelState] = useState<{
    spinning: boolean;
    revealReady: boolean;
    rewardIndex?: number;
  }>({ spinning: false, revealReady: false });
  const [resultDetails, setResultDetails] = useState<{
    pointsDelta?: number;
    timeAdded?: number;
    leafAmount?: bigint;
  } | null>(null);
  const [lastSeenCommitBlock, setLastSeenCommitBlock] = useState<number | null>(null);
  const wheelRotationRef = useRef(0);
  const [currentRotation, setCurrentRotation] = useState(0);
  const [targetRotation, setTargetRotation] = useState<number | null>(null);
  const [revealDeadline, setRevealDeadline] = useState<number | null>(null);
  const [cooldownDeadline, setCooldownDeadline] = useState<number | null>(null);
  const [revealUnlockedAt, setRevealUnlockedAt] = useState<number | null>(null); // 3s delay after commit
  const lastHandledCommitRef = useRef<string | null>(null);
  const lastHandledRevealRef = useRef<string | null>(null);
  const lastHandledBoxRef = useRef<string | null>(null);
  const lastPlantIdRef = useRef(plantId);
  const starMutationPendingRef = useRef(false);
  const starMutationBaselineRef = useRef<number | null>(null);
  const boxCooldownAbortRef = useRef<AbortController | null>(null);
  const lastSeenCommitBlockRef = useRef<number | null>(null);
  const revealDeadlineRef = useRef<number | null>(null);
  const spinStorageIdentity = address ? `${address.toLowerCase()}:${plantId}` : null;

  useEffect(() => {
    lastSeenCommitBlockRef.current = lastSeenCommitBlock;
  }, [lastSeenCommitBlock]);

  useEffect(() => {
    revealDeadlineRef.current = revealDeadline;
  }, [revealDeadline]);

  useEffect(() => {
    setPendingSecret(null);
    setPersistedSpinCommitment(null);
    setSpinStorageHydratedFor(null);
    setSpinStorageUnavailable(false);
    setSpinMeta(null);
  }, [spinStorageIdentity]);

  useEffect(() => {
    setStarsAvailable((current) => {
      if (lastPlantIdRef.current !== plantId) {
        lastPlantIdRef.current = plantId;
        starMutationPendingRef.current = false;
        starMutationBaselineRef.current = null;
        return plant.stars ?? 0;
      }
      // Preserve a confirmed optimistic debit while the parent still carries
      // the pre-transaction snapshot. Once its authoritative value catches up,
      // normal prop synchronization resumes.
      if (
        starMutationPendingRef.current &&
        starMutationBaselineRef.current === (plant.stars ?? 0)
      ) return current;
      starMutationPendingRef.current = false;
      starMutationBaselineRef.current = null;
      return plant.stars ?? 0;
    });
  }, [plant.stars, plantId]);

  const debitStarsOptimistically = useCallback((cost: number) => {
    if (cost <= 0) return;
    starMutationPendingRef.current = true;
    setStarsAvailable((current) => {
      starMutationBaselineRef.current = current;
      return Math.max(0, current - cost);
    });
  }, []);

  const handleRewardUpdate = useCallback(
    (index: number, reward: { pointDelta: bigint; timeExtension: bigint; leafAmount: bigint }) => {
      setSpinMeta((prev) => {
        if (!prev) return prev;
        const existing = prev.rewards[index];
        const nextReward = {
          index,
          pointsDelta: Number(reward.pointDelta),
          timeExtension: Number(reward.timeExtension),
          leafAmount: reward.leafAmount,
        };
        if (
          existing &&
          existing.pointsDelta === nextReward.pointsDelta &&
          existing.timeExtension === nextReward.timeExtension &&
          existing.leafAmount === nextReward.leafAmount
        ) {
          return prev;
        }
        const nextRewards = [...prev.rewards];
        nextRewards[index] = nextReward;
        return { ...prev, rewards: nextRewards };
      });
    },
    [],
  );

  const rewardsAreEqual = useCallback((a: RewardPreview[], b: RewardPreview[]) => {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i += 1) {
      const ra = a[i];
      const rb = b[i];
      if (
        ra.index !== rb.index ||
        ra.pointsDelta !== rb.pointsDelta ||
        ra.timeExtension !== rb.timeExtension ||
        ra.leafAmount !== rb.leafAmount
      ) {
        return false;
      }
    }
    return true;
  }, []);

  const pendingEquals = useCallback((a: PendingCommit | null, b: PendingCommit | null) => {
    if (!a && !b) return true;
    if (!a || !b) return false;
    return (
      a.commitBlock === b.commitBlock &&
      a.commitment === b.commitment &&
      a.player?.toLowerCase() === b.player?.toLowerCase()
    );
  }, []);

  // Local bookkeeping only — no wallet interaction.
  const noteLastSeenBlock = useCallback((block: number) => {
    if (Number.isNaN(block) || block <= 0) return;
    setLastSeenCommitBlock((prev) => (prev !== null ? Math.max(prev, block) : block));
  }, []);

  // Signs a message: only ever call from an explicit user action (the commit
  // path). Calling it from the passive log-sync used to pop an unsolicited
  // wallet signature request just for opening the SpinLeaf tab.
  const persistLastSeenBlock = useCallback(
    async (block: number) => {
      if (!address || Number.isNaN(block) || block <= 0) return;
      setLastSeenCommitBlock((prev) => (prev !== null ? Math.max(prev, block) : block));
      try {
        const message = buildCommitStateMessage(address, plantId, block);
        const signature = await signMessageAsync({ message });
        await fetch("/api/spin/commit-state", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ address, plantId, block, message, signature }),
        });
      } catch (error) {
        console.warn("Failed to persist spin commit block", error);
      }
    },
    [address, plantId, signMessageAsync]
  );

  // Generate a deterministic-ish default seed on open
  useEffect(() => {
    if (open) {
      const s = Math.max(1, (Date.now() % 9) + 1);
      setSeed(s);
    }
  }, [open]);

  useEffect(() => {
    if (!open || selectedGame !== "spin" || !address) return;

    let cancelled = false;
    (async () => {
      try {
        const params = new URLSearchParams({ address, plantId: String(plantId) });
        const res = await fetch(`/api/spin/commit-state?${params.toString()}`, { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const block = Number.isFinite(data?.block) ? Number(data.block) : null;
        if (!cancelled) {
          setLastSeenCommitBlock(block);
        }
      } catch (error) {
        console.warn("Failed to fetch last spin commit block", error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, selectedGame, address, plantId]);

  const refreshBoxCooldown = useCallback(async ({
    expectActive = false,
    starMode = false,
  }: {
    expectActive?: boolean;
    starMode?: boolean;
  } = {}) => {
    if (!publicClient) return;
    const currentPlantId = plantId;
    const controller = new AbortController();
    boxCooldownAbortRef.current?.abort();
    boxCooldownAbortRef.current = controller;

    try {
      const readCooldown = async () => {
        const [normal, star] = await Promise.all([
          publicClient.readContract({
            address: PIXOTCHI_NFT_ADDRESS,
            abi: BOX_GAME_ABI,
            functionName: 'boxGameGetCoolDownTimePerNFT',
            args: [BigInt(currentPlantId)],
          }) as Promise<bigint>,
          publicClient.readContract({
            address: PIXOTCHI_NFT_ADDRESS,
            abi: BOX_GAME_ABI,
            functionName: 'boxGameGetCoolDownTimeWithStar',
            args: [BigInt(currentPlantId)],
          }) as Promise<bigint>,
        ]);
        return { normal: Number(normal), star: Number(star) };
      };
      const next = expectActive
        ? await retryOwnerRead(readCooldown, {
            accept: (value) => (starMode ? value.star : value.normal) > 0,
            signal: controller.signal,
          })
        : await readCooldown();
      if (!controller.signal.aborted && currentPlantId === lastPlantIdRef.current) {
        setCooldown(next);
      }
    } catch (error) {
      if (!isAbortError(error)) console.warn("Failed to reconcile box cooldown", error);
    } finally {
      if (boxCooldownAbortRef.current === controller) {
        boxCooldownAbortRef.current = null;
        setBoxReconcilePending(false);
      }
    }
  }, [plantId, publicClient]);

  // Fetch cooldowns when dialog opens or when plant changes.
  useEffect(() => {
    if (!open || !publicClient) return;
    void refreshBoxCooldown();
    return () => boxCooldownAbortRef.current?.abort();
  }, [open, publicClient, refreshBoxCooldown]);

  // Countdown tick. Depends on a BOOLEAN, not the mutated values: the old dep
  // array made every tick tear the interval down and rebuild it, so the 1000ms
  // window restarted after each React commit and the countdown drifted.
  const hasActiveBoxCooldown = cooldown.normal > 0 || cooldown.star > 0;
  useEffect(() => {
    if (!open || !hasActiveBoxCooldown) return;

    const id = setInterval(() => {
      setCooldown((prev: { normal: number; star: number }) => ({
        normal: Math.max(0, prev.normal - 1),
        star: Math.max(0, prev.star - 1),
      }));
    }, 1000);
    return () => clearInterval(id);
  }, [open, hasActiveBoxCooldown]);

  const enrichPendingFromLogs = useCallback(async (): Promise<PendingReconciliation | null> => {
    if (!address) return null;

    try {
      const currentBlock = await baseLogClient.getBlockNumber();
      const lookback = BigInt(LOG_LOOKBACK_BLOCKS);
      const fallbackFrom = currentBlock > lookback ? currentBlock - lookback : BigInt("0");
      const lastSeen = lastSeenCommitBlockRef.current != null
        ? BigInt(Math.max(0, lastSeenCommitBlockRef.current - LOG_LOOKBACK_BUFFER_BLOCKS))
        : null;
      const fromBlock = lastSeen !== null && lastSeen < fallbackFrom ? lastSeen : fallbackFrom;
      const filterBase = {
        address: PIXOTCHI_NFT_ADDRESS,
        fromBlock,
        toBlock: currentBlock,
      } as const;

      const isRangeTooLargeError = (err: UntypedValue) => {
        if (!err) return false;
        const maybe = err as { shortMessage?: string; message?: string } | undefined;
        const msg = (maybe?.shortMessage ?? maybe?.message ?? "").toLowerCase();
        return msg.includes("block range") && msg.includes("large");
      };

        const fetchLogs = async (
          event:
          | typeof SPIN_GAME_V2_COMMITTED_EVENT
          | typeof SPIN_GAME_V2_PLAYED_EVENT
          | typeof SPIN_GAME_V2_FORFEITED_EVENT,
      ) => {
        const argsFilter = address
          ? { args: { nftId: BigInt(plantId), player: address as `0x${string}` } }
          : {};

        const baseFrom = filterBase.fromBlock ?? fromBlock;
        const baseTo = filterBase.toBlock ?? currentBlock;

        const execute = async (from: bigint, to: bigint) =>
          baseLogClient.getLogs({
            ...filterBase,
            fromBlock: from,
            toBlock: to,
            events: [event],
            ...argsFilter,
          } as Parameters<typeof baseLogClient.getLogs>[0]);

        const fetchChunk = async (
          from: bigint,
          to: bigint,
        ): Promise<Awaited<ReturnType<typeof baseLogClient.getLogs>>> => {
          try {
            return await execute(from, to);
          } catch (error) {
            if (!isRangeTooLargeError(error) || from === to) {
              throw error;
            }
            const mid = from + (to - from) / BigInt(2);
            const [first, second] = await Promise.all([
              fetchChunk(from, mid),
              fetchChunk(mid + BigInt(1), to),
            ]);
            return [...first, ...second];
          }
        };

        const ranges: Array<[bigint, bigint]> = [];
        let cursor = baseFrom;
        const upper = baseTo;
        while (cursor <= upper) {
          const chunkEnd = cursor + LOG_CHUNK_SIZE - BigInt(1);
          const to = chunkEnd > upper ? upper : chunkEnd;
          ranges.push([cursor, to]);
          cursor = to + BigInt(1);
        }

        const chunkResults: Awaited<ReturnType<typeof baseLogClient.getLogs>>[] = [];
        for (const [start, end] of ranges) {
          chunkResults.push(await fetchChunk(start, end));
        }
        return chunkResults.flat();
      };

      const [committedLogs, playedLogs, forfeitedLogs] = await Promise.all([
        fetchLogs(SPIN_GAME_V2_COMMITTED_EVENT),
        fetchLogs(SPIN_GAME_V2_PLAYED_EVENT),
        fetchLogs(SPIN_GAME_V2_FORFEITED_EVENT),
      ]);

      const lastCommit = committedLogs.at(-1);
      if (!lastCommit) {
        return { pending: null, terminal: null };
      }

      const commitBlock = lastCommit.blockNumber ?? BigInt("0");
      const commitArgs = (lastCommit as UntypedValue as { args?: { player?: string; commitHash?: `0x${string}` } }).args;
      const commitData: PendingCommit = {
        player: (commitArgs?.player ?? address) as string,
        commitment: (commitArgs?.commitHash ?? "0x") as `0x${string}`,
        commitBlock: Number(commitBlock),
      };

      if (Number(commitBlock) > 0) {
        noteLastSeenBlock(Number(commitBlock));
      }

      const lastPlay = playedLogs.find((log) => (log.blockNumber ?? BigInt("0")) >= commitBlock);
      const lastForfeit = forfeitedLogs.find((log) => (log.blockNumber ?? BigInt("0")) >= commitBlock);

      if (lastPlay || lastForfeit) {
        return {
          pending: null,
          terminal: lastForfeit ? "forfeited" : "played",
        };
      }

      return { pending: commitData, terminal: null };
    } catch (error) {
      console.warn("Failed to reconcile spin logs", error);
      return null;
    }
  }, [address, baseLogClient, noteLastSeenBlock, plantId]);

  const hydratePendingState = useCallback(async (): Promise<PendingHydration> => {
    if (!address) return { pending: null, stored: null };

    const storage = getSpinStorage();
    const stored = readStoredSpinPending(storage, address, plantId)
      ?? migrateLegacySpinPending(storage, address, plantId);
    const reconciliation = await enrichPendingFromLogs();

    if (reconciliation?.terminal) {
      removeStoredSpinPending(storage, address, plantId);
      return { pending: null, stored: null };
    }

    if (reconciliation?.pending) {
      const matchingStored = stored?.commitment.toLowerCase()
        === reconciliation.pending.commitment.toLowerCase()
        ? stored
        : null;
      let resolvedStored = matchingStored;
      const pending = matchingStored
        ? { ...reconciliation.pending, secretHex: matchingStored.secretHex }
        : reconciliation.pending;

      if (
        matchingStored
        && reconciliation.pending.commitBlock > 0
        && matchingStored.commitBlock !== reconciliation.pending.commitBlock
      ) {
        const enrichedStored: StoredSpinPending = {
          ...matchingStored,
          commitBlock: reconciliation.pending.commitBlock,
        };
        if (writeStoredSpinPending(storage, enrichedStored)) {
          resolvedStored = enrichedStored;
        }
      }

      return { pending, stored: resolvedStored };
    }

    // A confirmed local record remains a useful fallback when log providers
    // are temporarily unavailable. A prepared record is intentionally not an
    // onchain pending spin: it only restores the reveal secret for a retry.
    const pending = stored?.commitBlock
      ? {
          player: stored.account,
          commitment: stored.commitment,
          commitBlock: stored.commitBlock,
          secretHex: stored.secretHex,
        }
      : null;
    return { pending, stored };
  }, [address, enrichPendingFromLogs, plantId]);

  useEffect(() => {
    if (!open || selectedGame !== "spin" || !publicClient) {
      return;
    }

    let cancelled = false;
    setLoadingSpinMeta(true);

    (async () => {
      try {
        const [globalCooldown, starCost, perNftCooldown, rewards, hydration] = await Promise.all([
          publicClient.readContract({
            address: PIXOTCHI_NFT_ADDRESS,
            abi: SPIN_GAME_ABI,
            functionName: "getCoolDownTime",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: PIXOTCHI_NFT_ADDRESS,
            abi: SPIN_GAME_ABI,
            functionName: "getStarCost",
          }) as Promise<bigint>,
          publicClient.readContract({
            address: PIXOTCHI_NFT_ADDRESS,
            abi: SPIN_GAME_ABI,
            functionName: "spinGameV2GetCoolDownTimePerNFT",
            args: [BigInt(plantId)],
          }) as Promise<bigint>,
          Promise.all(
            Array.from({ length: 6 }, (_, i) =>
              publicClient.readContract({
                address: PIXOTCHI_NFT_ADDRESS,
                abi: SPIN_GAME_ABI,
                functionName: "getReward",
                args: [BigInt(i)],
              }) as Promise<[bigint, bigint, bigint]>
            )
          ),
          hydratePendingState(),
        ]);

        if (cancelled) return;

        const formattedRewards = rewards.map(([pointsDelta, timeExtension, leafAmount], index) => ({
          index,
          pointsDelta: Number(pointsDelta),
          timeExtension: Number(timeExtension),
          leafAmount,
        }));

        let restoredSecret: Uint8Array | null = null;
        if (hydration.stored?.secretHex) {
          try {
            restoredSecret = hexToBytes(hydration.stored.secretHex);
          } catch {
            restoredSecret = null;
          }
        }
        setPendingSecret(restoredSecret);
        setPersistedSpinCommitment(hydration.stored?.commitment ?? null);
        setSpinStorageUnavailable(false);
        setSpinStorageHydratedFor(spinStorageIdentity);

        const nextMeta: SpinState = {
          cooldown: Number(perNftCooldown ?? globalCooldown),
          starCost: Number(starCost),
          rewards: formattedRewards,
          pending: hydration.pending,
        };

        setSpinMeta((prev) => {
          if (
            prev &&
            prev.cooldown === nextMeta.cooldown &&
            prev.starCost === nextMeta.starCost &&
            pendingEquals(prev.pending, nextMeta.pending) &&
            rewardsAreEqual(prev.rewards, nextMeta.rewards)
          ) {
            return prev;
          }
          return nextMeta;
        });
        const cooldownSeconds = Number(perNftCooldown ?? globalCooldown);
        setCooldownDeadline(cooldownSeconds > 0 ? Date.now() + cooldownSeconds * 1000 : null);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load SpinLeaf metadata", error);
          toast.error("Unable to load SpinLeaf configuration");
          setSpinMeta(null);
        }
      } finally {
        if (!cancelled) setLoadingSpinMeta(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [hydratePendingState, open, selectedGame, pendingEquals, plantId, publicClient, rewardsAreEqual, spinRefreshKey, spinStorageIdentity]);

  useEffect(() => {
    if (!open || selectedGame !== "spin" || !publicClient) return;

    let cancelled = false;

    const updateCountdown = async () => {
      try {
        const blockNumber = Number(await publicClient.getBlockNumber());
        if (cancelled) return;

        if (spinMeta?.pending) {
          if (spinMeta.pending.commitBlock <= 0) {
            // A calls-status success can arrive without an enriched receipt.
            // Keep the reveal key and provisional pending state while log
            // reconciliation discovers the authoritative commit block.
            return;
          }
          const revealUnlockBlocks = Math.max(0, spinMeta.pending.commitBlock + 2 - blockNumber);
          const expiryBlocks = Math.max(0, spinMeta.pending.commitBlock + 1 + 256 - blockNumber);

          // Stamp the reveal deadline only when the BLOCK COUNT changes: the old
          // code re-stamped it on every 3s poll, so the waiting countdown
          // visibly jumped back up while the chain stood still.
          if (revealUnlockBlocks === 0 && revealDeadlineRef.current === null) {
            setRevealDeadline(Date.now() + MIN_REVEAL_DELAY_SECONDS * 1000);
            lastUnlockBlocksRef.current = 0;
          } else if (revealUnlockBlocks > 0 && lastUnlockBlocksRef.current !== revealUnlockBlocks) {
            lastUnlockBlocksRef.current = revealUnlockBlocks;
            const secondsRemaining = Math.max(
              MIN_REVEAL_DELAY_SECONDS,
              revealUnlockBlocks * BLOCK_TIME_SECONDS,
            );
            setRevealDeadline(Date.now() + secondsRemaining * 1000);
          }

          if (expiryBlocks === 0) {
            if (address) {
              removeStoredSpinPending(getSpinStorage(), address, plantId);
            }
            setPendingSecret(null);
            setPersistedSpinCommitment(null);
            setSpinMeta((prev) => (prev ? { ...prev, pending: null } : prev));
            toast.error("Spin expired — stars forfeited.");
          }
        } else {
          setRevealDeadline(null);
          lastUnlockBlocksRef.current = null;
        }
      } catch (error) {
        console.warn("Failed to refresh spin countdown", error);
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, BLOCK_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, open, selectedGame, publicClient, spinMeta, plantId]);

  useEffect(() => {
    if (!open || selectedGame !== "spin") return;

    const interval = setInterval(() => {
      setNowTick(Date.now());

      if (revealDeadline !== null) {
        const remaining = Math.max(0, Math.ceil((revealDeadline - Date.now()) / 1000));
        if (remaining === 0) {
          setRevealDeadline(null);
        }
      }

      if (!spinMeta?.pending && cooldownDeadline !== null) {
        const remaining = Math.max(0, Math.ceil((cooldownDeadline - Date.now()) / 1000));
        if (remaining === 0) {
          setCooldownDeadline(null);
        }
      }
      // Check if reveal unlock time has passed and clear it to trigger re-render
      if (revealUnlockedAt !== null && Date.now() >= revealUnlockedAt) {
        setRevealUnlockedAt(null);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [open, selectedGame, revealDeadline, cooldownDeadline, spinMeta?.pending, revealUnlockedAt]);

  useEffect(() => {
    if (
      !open
      || selectedGame !== "spin"
      || !address
      || !spinMeta
      || spinStorageHydratedFor !== spinStorageIdentity
    ) return;
    if (!pendingSecret && !spinMeta.pending) {
      const secret = crypto.getRandomValues(new Uint8Array(32));
      setPendingSecret(secret);
    }
  }, [address, open, pendingSecret, selectedGame, spinMeta, spinStorageHydratedFor, spinStorageIdentity]);

  const commitmentHex = useMemo(() => {
    if (!pendingSecret || !address) return null;
    return createCommitment(pendingSecret, plantId, address);
  }, [pendingSecret, plantId, address]);

  const secretHex = useMemo(() => {
    if (!pendingSecret) return undefined;
    return toHex(pendingSecret) as `0x${string}`;
  }, [pendingSecret]);

  const persistPreparedSpin = useCallback((commitBlock: number | null = null) => {
    if (!address || !commitmentHex || !secretHex) return false;

    const storage = getSpinStorage();
    const existing = readStoredSpinPending(storage, address, plantId);
    const matchingExistingBlock = existing?.commitment.toLowerCase() === commitmentHex.toLowerCase()
      ? existing.commitBlock
      : null;
    return writeStoredSpinPending(storage, {
      account: address,
      commitment: commitmentHex,
      commitBlock: commitBlock ?? matchingExistingBlock,
      plantId,
      secretHex,
      version: SPIN_PENDING_STORAGE_VERSION,
    });
  }, [address, commitmentHex, plantId, secretHex]);

  useEffect(() => {
    if (
      !open
      || selectedGame !== "spin"
      || spinMeta?.pending
      || !commitmentHex
      || !secretHex
      || spinStorageHydratedFor !== spinStorageIdentity
    ) return;

    const persisted = persistPreparedSpin();
    setPersistedSpinCommitment(persisted ? commitmentHex : null);
    setSpinStorageUnavailable(!persisted);
  }, [
    commitmentHex,
    open,
    persistPreparedSpin,
    secretHex,
    selectedGame,
    spinMeta?.pending,
    spinStorageHydratedFor,
    spinStorageIdentity,
  ]);

  const syncAfterTx = useCallback(async () => {
    const hydration = await hydratePendingState();
    let restoredSecret: Uint8Array | null = null;
    if (hydration.stored?.secretHex) {
      try {
        restoredSecret = hexToBytes(hydration.stored.secretHex);
      } catch {
        restoredSecret = null;
      }
    }
    setPendingSecret(restoredSecret);
    setPersistedSpinCommitment(hydration.stored?.commitment ?? null);
    setSpinStorageHydratedFor(spinStorageIdentity);
    setSpinMeta((prev) => (prev ? { ...prev, pending: hydration.pending } : prev));
    setSpinRefreshKey((key) => key + 1);
  }, [hydratePendingState, spinStorageIdentity]);

  const startWheelSpin = useCallback(() => {
    const rotor = wheelRotorRef.current;
    if (rotor) {
      // Clear the imperative overrides finishWheelSpin left behind so the idle
      // spin animation class can take effect again.
      rotor.style.animation = '';
      rotor.style.transform = '';
    }
    setWheelState({ spinning: true, revealReady: false, rewardIndex: undefined });
    setTargetRotation(null);
  }, []);

  const finishWheelSpin = useCallback((rewardIndex?: number | null) => {
    const index = rewardIndex ?? Math.floor(Math.random() * WHEEL_SEGMENTS);
    const segmentAngle = 360 / WHEEL_SEGMENTS;
    const target = SPIN_EXTRA_TURNS * 360 + (WHEEL_SEGMENTS - 1 - index) * segmentAngle + segmentAngle / 2;
    // Bake the animation's CURRENT angle into the base style before swapping to
    // the settle transition. A CSS transition's before-change style excludes
    // animation contributions, so without this the wheel visibly snapped back
    // to 0deg and then swept to the target. (Same approach as the roulette
    // wheel's RAF-continuation, see EuropeanRouletteWheel.tsx.)
    const rotor = wheelRotorRef.current;
    if (rotor) {
      const computed = getComputedStyle(rotor).transform;
      rotor.style.animation = 'none';
      rotor.style.transform = computed === 'none' ? 'rotate(0deg)' : computed;
      void rotor.offsetHeight; // commit the new base style before the transition arms
    }
    setWheelState({ spinning: false, revealReady: true, rewardIndex: index });
    setTargetRotation(target);
  }, []);

  const handleRevealSuccess = useCallback(() => {
    setPendingSecret(null);
    setPersistedSpinCommitment(null);
    setSpinMeta((prev) => (prev ? { ...prev, pending: null } : prev));
    setRevealUnlockedAt(null);
  }, []);

  const handleRecheckPending = useCallback(() => {
    void syncAfterTx()
      .then(() => {
        toast("Pending spin rechecked. If its reveal key is unavailable, wait for the onchain expiry.");
      })
      .catch((error) => {
        console.warn("Failed to recheck pending SpinLeaf state", error);
        toast.error("Could not recheck the pending spin yet.");
      });
  }, [syncAfterTx]);

  const handleCommitButtonClick = useCallback(() => {
    const wasAlreadyDurable = Boolean(
      commitmentHex
      && persistedSpinCommitment?.toLowerCase() === commitmentHex.toLowerCase(),
    );
    const persisted = persistPreparedSpin();
    if (!persisted && !wasAlreadyDurable) {
      setSpinStorageUnavailable(true);
      toast.error("SpinLeaf could not secure the reveal key. No transaction was prepared.");
      return;
    }

    if (commitmentHex) setPersistedSpinCommitment(commitmentHex);
    setSpinStorageUnavailable(false);
    setResultDetails(null);
    startWheelSpin();
  }, [commitmentHex, persistPreparedSpin, persistedSpinCommitment, startWheelSpin]);

  const handleSpinStatus = useCallback(
    (mode: "commit" | "reveal") => (status: LifecycleStatus) => {
      const receipt = status.statusData?.transactionReceipts?.[0];
      const txHash = (
        receipt?.transactionHash ??
        status.statusData?.transactionHash
      ) as string | undefined;
      const transactionProof = txHash ?? status.statusData?.transactionId;

      if (status.statusName === "buildingTransaction" || status.statusName === "transactionPending") {
        setArcadeTransactionPending(true);
        if (mode === "commit") lastHandledCommitRef.current = null;
        else lastHandledRevealRef.current = null;
        return;
      }

      if (TRANSACTION_FAILURE_STATUSES.has(status.statusName ?? "")) {
        setArcadeTransactionPending(false);
        // Only reset wheel state on failure - DO NOT clear secret/pending!
        // The user needs the secret to retry the reveal transaction
        setWheelState({ spinning: false, revealReady: false, rewardIndex: undefined });
        return;
      }

      if (mode === "commit" && status.statusName === "success" && spinMeta && commitmentHex) {
        setArcadeTransactionPending(false);
        const proof = transactionProof ?? "unkeyed";
        if (lastHandledCommitRef.current === proof) return;
        lastHandledCommitRef.current = proof;
        debitStarsOptimistically(spinMeta.starCost);
        invalidateOwnerResources({
          address,
          domains: ["plants"],
          receiptBlock: receipt?.blockNumber,
          source: "arcade:spin-commit",
          transactionHash: txHash,
          transactionId: status.statusData?.transactionId,
        });
        const blockNumberValue = receipt?.blockNumber;
        const blockNumber = Number(blockNumberValue !== undefined ? blockNumberValue : BigInt("0"));
        const data: PendingCommit = {
          player: address ?? "",
          commitBlock: blockNumber,
          commitment: commitmentHex,
          secretHex,
        };
        const persisted = persistPreparedSpin(blockNumber > 0 ? blockNumber : null);
        setPersistedSpinCommitment(persisted ? commitmentHex : persistedSpinCommitment);
        setSpinStorageUnavailable(!persisted && persistedSpinCommitment !== commitmentHex);
        if (blockNumber > 0) persistLastSeenBlock(blockNumber);
        setSpinMeta((prev) => {
          if (!prev) return prev;
          return { ...prev, pending: data };
        });
        if (blockNumber <= 0) {
          void retryOwnerRead(hydratePendingState, {
            accept: (hydration) => (hydration.pending?.commitBlock ?? 0) > 0,
          }).then((hydration) => {
            if (!hydration.pending) return;
            setSpinMeta((prev) => (prev ? { ...prev, pending: hydration.pending } : prev));
            setPersistedSpinCommitment(hydration.stored?.commitment ?? commitmentHex);
            if (hydration.stored?.secretHex) {
              try {
                setPendingSecret(hexToBytes(hydration.stored.secretHex));
              } catch { }
            }
          }).catch((error) => {
            if (!isAbortError(error)) {
              console.warn("Failed to enrich confirmed SpinLeaf commit block", error);
            }
          });
        }
        if (secretHex) {
          try {
            setPendingSecret(hexToBytes(secretHex));
          } catch { }
        }
        // Enable reveal button after 3 seconds
        setRevealUnlockedAt(Date.now() + 3000);
        startWheelSpin();
      }
      if (mode === "reveal" && status.statusName === "success") {
        setArcadeTransactionPending(false);
        const proof = transactionProof ?? "unkeyed";
        if (lastHandledRevealRef.current === proof) return;
        lastHandledRevealRef.current = proof;
        invalidateOwnerResources({
          address,
          domains: ["plants", "balances"],
          receiptBlock: receipt?.blockNumber,
          source: "arcade:spin-reveal",
          transactionHash: txHash,
          transactionId: status.statusData?.transactionId,
        });
        if (address) {
          removeStoredSpinPending(getSpinStorage(), address, plantId);
        }
        setPersistedSpinCommitment(null);
      }
    },
    [
      address,
      commitmentHex,
      debitStarsOptimistically,
      hydratePendingState,
      persistLastSeenBlock,
      persistPreparedSpin,
      persistedSpinCommitment,
      plantId,
      secretHex,
      spinMeta,
      startWheelSpin,
    ],
  );

  useEffect(() => {
    if (!open || selectedGame !== "spin") return;

    if (spinMeta?.pending) {
      setWheelState((prev) => (prev.spinning ? prev : { ...prev, spinning: true }));
    } else {
      setWheelState((prev) =>
        prev.spinning || prev.revealReady
          ? { spinning: false, revealReady: false, rewardIndex: undefined }
          : prev,
      );
    }
  }, [open, selectedGame, spinMeta?.pending]);

  useEffect(() => {
    if (targetRotation === null) return;

    const timeout = setTimeout(() => {
      const normalized = ((targetRotation % 360) + 360) % 360;
      wheelRotationRef.current = normalized;
      setCurrentRotation(normalized);
      setTargetRotation(null);
      if (!spinMeta?.pending) {
        setWheelState((prev) => ({ ...prev, spinning: false }));
      }
    }, FINAL_SPIN_DURATION_MS);

    return () => clearTimeout(timeout);
  }, [targetRotation, spinMeta?.pending]);

  // NOTE: Duplicate useEffect removed - race condition bug fix

  const handleBoxStatus = useCallback((status: LifecycleStatus) => {
    if (status.statusName === "buildingTransaction" || status.statusName === "transactionPending") {
      setArcadeTransactionPending(true);
      lastHandledBoxRef.current = null;
      return;
    }
    if (TRANSACTION_FAILURE_STATUSES.has(status.statusName ?? "")) {
      setArcadeTransactionPending(false);
      return;
    }
    if (status.statusName !== "success") return;
    setArcadeTransactionPending(false);
    const receipt = status.statusData?.transactionReceipts?.[0];
    const txHash = (
      receipt?.transactionHash ??
      status.statusData?.transactionHash
    ) as string | undefined;
    const transactionProof = txHash ?? status.statusData?.transactionId;
    const proof = transactionProof ?? "unkeyed";
    if (lastHandledBoxRef.current === proof) return;
    lastHandledBoxRef.current = proof;

    if (withStar) debitStarsOptimistically(1);
    setCooldown((current) => ({
      ...current,
      [withStar ? "star" : "normal"]: Math.max(1, current[withStar ? "star" : "normal"]),
    }));
    setBoxReconcilePending(true);
    invalidateOwnerResources({
      address,
      domains: ["plants"],
      receiptBlock: receipt?.blockNumber,
      source: "arcade:box",
      transactionHash: txHash,
      transactionId: status.statusData?.transactionId,
    });
    void refreshBoxCooldown({ expectActive: true, starMode: withStar });
  }, [address, debitStarsOptimistically, refreshBoxCooldown, withStar]);

  // Derived from the deadline + the 1s tick: spinMeta.cooldown is a snapshot
  // from fetch time, so displaying it directly froze the countdown and kept the
  // spin button dead until the dialog was reopened.
  const spinCooldown = cooldownDeadline !== null
    ? Math.max(0, Math.ceil((cooldownDeadline - nowTick) / 1000))
    : 0;
  const spinStarCost = spinMeta?.starCost ?? 1;
  const pending = spinMeta?.pending;
  const preparedSecretIsDurable = Boolean(
    commitmentHex
    && persistedSpinCommitment?.toLowerCase() === commitmentHex.toLowerCase(),
  );

  const canCommit = Boolean(
    spinMeta &&
    !pending &&
    spinCooldown === 0 &&
    starsAvailable >= spinStarCost &&
    commitmentHex &&
    preparedSecretIsDurable,
  );

  const canReveal = Boolean(
    pending &&
    address &&
    pending.player.toLowerCase() === address.toLowerCase() &&
    secretHex &&
    (revealUnlockedAt === null || Date.now() >= revealUnlockedAt),
  );

  const boxGrid = (
    <div className="grid grid-cols-3 gap-2.5">
      {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
        <Button
          key={n}
          type="button"
          variant="outline"
          onClick={() => {
            setSeed(n);
            setBoxResultDetails(null);
          }}
          className={cn(
            "group relative h-16 min-h-16 w-full overflow-hidden rounded-[var(--radius-panel)] p-0 sm:h-20 sm:min-h-20",
            "transition-[background-color,border-color,box-shadow,filter,transform] duration-[var(--motion-quick)] ease-[var(--ease-standard)]",
            seed === n
              ? "border-primary/45 bg-primary/10 bg-[image:var(--gradient-selection)] text-primary shadow-[var(--shadow-glow)] ring-2 ring-primary/25"
              : "border-border/55 bg-card/90 bg-[image:var(--gradient-surface)] shadow-[var(--shadow-hairline)] hover:-translate-y-0.5 hover:border-primary/35 hover:shadow-[var(--shadow-control)] hover:brightness-[1.02]",
          )}
          aria-label={`Select box ${n}`}
          aria-pressed={seed === n}
        >
          <span
            className={cn(
              "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-[var(--motion-standard)]",
              "bg-[radial-gradient(circle_at_34%_18%,hsl(var(--primary)/0.2)_0%,transparent_42%),linear-gradient(180deg,hsl(var(--card)/0.2),hsl(var(--primary)/0.06))]",
              seed === n ? "opacity-100" : "group-hover:opacity-80",
            )}
            aria-hidden="true"
          />
          <span className="relative flex h-11 w-11 items-center justify-center rounded-[var(--radius-control)] border border-border/40 bg-background/45 shadow-[var(--shadow-hairline)] sm:h-12 sm:w-12">
            <Image src="/icons/box.png" alt="" width={34} height={34} className="h-8 w-8 object-contain drop-shadow-sm" aria-hidden />
          </span>
          <span className="pointer-events-none absolute bottom-1.5 right-1.5 rounded-[calc(var(--radius-control)-0.25rem)] border border-border/40 bg-card/80 px-1.5 py-0.5 text-[10px] font-bold leading-none text-muted-foreground">
            {n}
          </span>
        </Button>
      ))}
    </div>
  );

  const currentCooldown = withStar ? cooldown.star : cooldown.normal;
  const disabled = !seed || !address || currentCooldown > 0;
  const boxStarCost = 1;
  const boxPlayDisabled = disabled || arcadeTransactionPending || boxReconcilePending || (withStar && starsAvailable <= 0);
  const spinPlayDisabled = pending ? !canReveal : !canCommit;
  const boxHasInsufficientStars = withStar && starsAvailable < boxStarCost;
  const spinHasInsufficientStars = !pending && starsAvailable < spinStarCost;
  const boxDisabledReason = !address
    ? "Connect a wallet before opening a box."
    : !seed
      ? "Choose a box to play."
      : boxReconcilePending
        ? "Confirming the new cooldown."
      : currentCooldown > 0
        ? `Box cooldown clears in ${formatDuration(currentCooldown)}.`
        : null;
  const spinDisabledReason = pending
    ? canReveal
      ? null
      : !secretHex
        ? "This pending spin has no local reveal key. Recheck it or wait for the onchain expiry."
        : "The wheel is still preparing the result."
    : !address
      ? "Connect a wallet before spinning."
      : spinCooldown > 0
        ? `SpinLeaf cooldown clears in ${formatDuration(spinCooldown)}.`
        : starsAvailable < spinStarCost
          ? null
          : !commitmentHex
            ? "Preparing the spin commitment."
            : spinStorageUnavailable
              ? "Secure browser storage is unavailable. SpinLeaf is paused so the reveal key cannot be lost."
              : spinStorageHydratedFor !== spinStorageIdentity || !preparedSecretIsDurable
                ? "Securing the spin reveal key..."
                : null;
  const hasSpinReward = resultDetails
    ? (resultDetails.pointsDelta ?? 0) !== 0 ||
      (resultDetails.timeAdded ?? 0) !== 0 ||
      (resultDetails.leafAmount !== undefined && resultDetails.leafAmount !== BigInt("0"))
    : false;

  const handleDialogOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && arcadeTransactionPending) {
      toast("Wait for the transaction to finish before closing the Arcade.", { icon: "⏳" });
      return;
    }
    onOpenChange(nextOpen);
  }, [arcadeTransactionPending, onOpenChange]);

  // Gate arcade games for Solana users
  if (isSolana) {
    return (
      <Dialog open={open} onOpenChange={handleDialogOpenChange}>
        <DialogContent className="max-w-md w-[min(92vw,28rem)]">
          <DialogHeader>
            <DialogTitle>Arcade</DialogTitle>
            <DialogDescription>
              Arcade games are not available for Solana bridge wallets.
            </DialogDescription>
          </DialogHeader>
          <div className="py-6">
            <SolanaNotSupported feature="Arcade games" />
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent surface="soft" className="max-w-md w-[min(94vw,28rem)]">
        <DialogHeader>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <DialogTitle>Arcade</DialogTitle>
            <GameSelector selected={selectedGame} onSelect={setSelectedGame} disabled={arcadeTransactionPending} className="justify-start sm:justify-end" />
          </div>
          <DialogDescription>
            Pick a game, choose how you want to play, and use the bottom action when you are ready.
          </DialogDescription>
        </DialogHeader>
        <div className="surface-scroll-fade flex-1 overflow-y-auto py-3 pr-1">
          <div className="space-y-4">
            {selectedGame === 'box' && (
              <div className="space-y-4">
                <div className="text-sm font-medium">Choose a box</div>
                {boxGrid}

                <div className="chromatic-white-surface space-y-3 rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3.5 shadow-[var(--shadow-hairline)]">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">Box play</div>
                      <p className="text-xs text-muted-foreground">Pick a box, then choose whether to spend a star.</p>
                    </div>
                    {/* Original compact track look, with real switch semantics. */}
                    <div
                      className="grid shrink-0 grid-cols-2 gap-1 rounded-[var(--radius-control)] border border-border/55 bg-card/85 bg-[image:var(--gradient-control-track)] p-1"
                      role="radiogroup"
                      aria-label="Star spending"
                    >
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                          "h-8 min-h-8 rounded-[calc(var(--radius-control)-0.25rem)] px-2 text-[11px]",
                          !withStar
                            ? "border-primary/35 bg-primary/10 bg-[image:var(--gradient-selection)] text-primary"
                            : "border-transparent bg-transparent shadow-none hover:bg-[hsl(var(--nav-hover-bg))]",
                        )}
                        onClick={() => setWithStar(false)}
                        disabled={arcadeTransactionPending || boxReconcilePending}
                        role="radio"
                        aria-checked={!withStar}
                      >
                        No star
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className={cn(
                          "h-8 min-h-8 rounded-[calc(var(--radius-control)-0.25rem)] px-2 text-[11px]",
                          withStar
                            ? "border-primary/35 bg-primary/10 bg-[image:var(--gradient-selection)] text-primary"
                            : "border-transparent bg-transparent shadow-none hover:bg-[hsl(var(--nav-hover-bg))]",
                        )}
                        onClick={() => setWithStar(true)}
                        disabled={arcadeTransactionPending || boxReconcilePending}
                        role="radio"
                        aria-checked={withStar}
                      >
                        Use star
                      </Button>
                    </div>
                  </div>

                  <div className="chromatic-white-surface divide-y divide-border/45 rounded-[var(--radius-control)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] px-3 py-1.5 text-xs shadow-[var(--shadow-hairline)]">
                    <ArcadeStatLine label="Selected box" value={seed ? `Box ${seed}` : "None"} tone={seed ? "primary" : "warning"} />
                    <ArcadeStatLine label="Cooldown" value={currentCooldown > 0 ? formatDuration(currentCooldown) : "Ready"} tone={currentCooldown > 0 ? "warning" : "success"} />
                    <ArcadeStatLine label="Stars available" value={starsAvailable} tone={boxHasInsufficientStars ? "danger" : "default"} />
                  </div>

                  {boxDisabledReason && <DisabledReason>{boxDisabledReason}</DisabledReason>}
                </div>
                {boxResultDetails && (
                  <RewardResultPanel
                    title="Box result"
                    /* Tone follows the SIGN, not mere presence: a negative delta
                       used to render as "+N" in a green success panel. */
                    tone={(boxResultDetails.pointsDelta > 0 || boxResultDetails.timeAdded > 0) ? "success" : "warning"}
                  >
                    {(boxResultDetails.pointsDelta || boxResultDetails.timeAdded) ? (
                      <div className="space-y-1">
                        {boxResultDetails.pointsDelta !== 0 && (
                          <div>
                            PTS: <span className="font-semibold text-foreground">{`${boxResultDetails.pointsDelta > 0 ? "+" : "-"}${formatScore(Math.abs(boxResultDetails.pointsDelta))}`}</span>
                          </div>
                        )}
                        {boxResultDetails.timeAdded !== 0 && (
                          <div>
                            TOD: <span className="font-semibold text-foreground">{`${boxResultDetails.timeAdded > 0 ? "+" : "-"}${formatDuration(Math.abs(boxResultDetails.timeAdded))}`}</span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <span>No reward this time. Pick another box when the cooldown clears.</span>
                    )}
                  </RewardResultPanel>
                )}
              </div>
            )}

            {selectedGame === "spin" && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">SpinLeaf</div>
                    <p className="text-xs text-muted-foreground">
                      Spin for PTS, TOD, and LEAF rewards.
                    </p>
                  </div>
                </div>

                <div className="relative mx-auto mt-6 flex h-56 w-56 items-center justify-center sm:h-60 sm:w-60">
                  <div className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_50%_32%,hsl(var(--scene-glow)/0.5)_0%,hsl(var(--scene-glow)/0.12)_48%,transparent_76%)] blur-xl" aria-hidden="true" />
                  <div className="absolute inset-3 rounded-full border border-primary/15 bg-[conic-gradient(from_0deg,hsl(var(--primary)/0.16),hsl(var(--accent)/0.34),hsl(var(--scene-glow)/0.24),hsl(var(--primary)/0.16))] opacity-80 shadow-[var(--shadow-glow)]" aria-hidden="true" />
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative h-48 w-48 rounded-full border border-border/55 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[0_24px_54px_-28px_hsl(var(--foreground)/0.5)] sm:h-56 sm:w-56" aria-hidden>
                      <div
                        ref={wheelRotorRef}
                        className={cn(
                          "absolute inset-4 flex items-center justify-center rounded-full border border-primary/35 bg-background/25 shadow-inner",
                          targetRotation !== null ? "transition-transform duration-[2200ms] ease-out" : "",
                          wheelState.spinning && targetRotation === null ? "animate-[spin-slow_1.5s_linear_infinite]" : "",
                        )}
                        style={
                          targetRotation !== null
                            ? { transform: `rotate(${targetRotation}deg)` }
                            : wheelState.spinning
                              ? undefined
                              : { transform: `rotate(${currentRotation}deg)` }
                        }
                      >
                        <svg viewBox="0 0 200 200" className="h-full w-full drop-shadow-sm">
                          <circle cx="100" cy="100" r="88" fill="none" stroke="hsl(var(--primary) / 0.18)" strokeWidth="7" />
                          <circle cx="100" cy="100" r="58" fill="none" stroke="hsl(var(--accent) / 0.22)" strokeWidth="2" />
                          {[...Array(6)].map((_, index) => {
                            const angle = index * 60;
                            const radius = 68;
                            const cx = 100 + Math.cos((angle * Math.PI) / 180) * radius;
                            const cy = 100 + Math.sin((angle * Math.PI) / 180) * radius;
                            const rotation = angle + 90;
                            return (
                              <g key={index} transform={`rotate(${rotation} ${cx} ${cy})`}>
                                <image
                                  href="/icons/spinleaf.png"
                                  x={cx - 18}
                                  y={cy - 18}
                                  width={36}
                                  height={36}
                                  className="drop-shadow-sm"
                                />
                              </g>
                            );
                          })}
                        </svg>
                        <div className="absolute inset-0 flex items-center justify-center">
                          <div className="h-5 w-5 rounded-full border border-primary/35 bg-primary shadow-[0_0_18px_hsl(var(--primary)/0.32)]" />
                        </div>
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="flex h-24 w-24 flex-col items-center justify-center space-y-1 rounded-full border border-primary/25 bg-card/80 bg-[image:var(--gradient-surface)] shadow-[var(--shadow-control)] backdrop-blur-[var(--blur-surface)]">
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">SpinLeaf</span>
                          <span className="text-xs font-bold text-primary">{pending ? "In motion" : "Good luck"}</span>
                        </div>
                      </div>
                      <div className="absolute inset-0 rounded-full border border-white/15 shadow-[inset_0_1px_0_hsl(0_0%_100%/0.25)]" />
                    </div>
                  </div>
                  <div className="absolute top-2 left-1/2 z-10 -translate-x-1/2 flex flex-col items-center">
                    <div className="h-4 w-5 rounded-b-[var(--radius-nav)] bg-primary shadow-[0_8px_18px_-10px_hsl(var(--primary)/0.8)]" />
                    <div className="h-0 w-0 border-l-[10px] border-r-[10px] border-t-[16px] border-l-transparent border-r-transparent border-t-primary drop-shadow-sm" />
                  </div>
                </div>

                <div className="chromatic-white-surface space-y-3 rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3.5 shadow-[var(--shadow-hairline)]">
                  <div>
                    <div className="text-sm font-medium">Get a spin with a Star</div>
                    <p className="text-xs text-muted-foreground">
                      Use a star, wait for the wheel, then stop it to claim the result.
                    </p>
                  </div>

                  <div className="chromatic-white-surface divide-y divide-border/45 rounded-[var(--radius-control)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] px-3 py-1.5 text-xs shadow-[var(--shadow-hairline)]">
                    <ArcadeStatLine
                      label="Status"
                      value={
                        loadingSpinMeta && !spinMeta
                          ? "Loading..."
                          : pending ? (canReveal ? "Ready to stop" : "Wheel spinning") : spinCooldown > 0 ? `${formatDuration(spinCooldown)} cooldown` : "Ready to spin"
                      }
                      tone={loadingSpinMeta && !spinMeta ? "default" : pending ? (canReveal ? "success" : "primary") : spinCooldown > 0 ? "warning" : "success"}
                    />
                    <ArcadeStatLine label="Stars available" value={starsAvailable} tone={starsAvailable < spinStarCost && !pending ? "danger" : "default"} />
                    <ArcadeStatLine
                      label="Cost per spin"
                      value={(
                        <span className="inline-flex items-center justify-end gap-1">
                          <Image src="/icons/Star.svg" alt="Stars" width={14} height={14} className="h-3.5 w-3.5 shrink-0" />
                          <span>{spinStarCost}</span>
                        </span>
                      )}
                      tone="primary"
                    />
                  </div>

                  {spinDisabledReason && (starsAvailable >= spinStarCost || Boolean(pending)) && (
                    <DisabledReason>{spinDisabledReason}</DisabledReason>
                  )}

                  <div className="space-y-2">
                    {pending && !secretHex && (
                      <Button
                        type="button"
                        variant="link"
                        onClick={handleRecheckPending}
                        className="mt-2 h-auto min-h-0 w-full px-0 py-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Recheck pending spin
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
            {selectedGame === "spin" && resultDetails && (
              <RewardResultPanel className="mt-4" title="Spin Reward" tone={hasSpinReward ? "success" : "warning"}>
                <ul className="space-y-1">
                  {typeof resultDetails.pointsDelta === "number" && resultDetails.pointsDelta !== 0 && (
                    <li>
                      PTS: <span className="font-medium text-foreground">{`${resultDetails.pointsDelta > 0 ? "+" : "-"}${formatScore(Math.abs(resultDetails.pointsDelta))}`}</span>
                    </li>
                  )}
                  {typeof resultDetails.timeAdded === "number" && resultDetails.timeAdded !== 0 && (
                    <li>
                      TOD: <span className="font-medium text-foreground">{`${resultDetails.timeAdded > 0 ? "+" : "-"}${formatDuration(Math.abs(resultDetails.timeAdded))}`}</span>
                    </li>
                  )}
                  {typeof resultDetails.leafAmount === "bigint" && resultDetails.leafAmount !== BigInt("0") && (
                    <li>
                      LEAF: <span className="font-medium text-foreground">{`${resultDetails.leafAmount > BigInt("0") ? "+" : ""}${formatTokenAmount(resultDetails.leafAmount)} LEAF`}</span>
                    </li>
                  )}
                  {(resultDetails.pointsDelta ?? 0) === 0 && (resultDetails.timeAdded ?? 0) === 0 &&
                    (!resultDetails.leafAmount || resultDetails.leafAmount === BigInt("0")) && (
                      <li className="text-muted-foreground">No reward this time. Better luck next spin!</li>
                    )}
                </ul>
              </RewardResultPanel>
            )}
          </div>
        </div>
        <DialogFooter sticky className="block space-y-3">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="min-w-0">
              <div className="truncate font-semibold text-foreground">
                {selectedGame === "box" ? "Open a Box" : pending ? "Stop the Wheel" : "Ready to Spin"}
              </div>
              <div className="truncate">
                {selectedGame === "box"
                  ? seed ? `Box ${seed}${withStar ? " with star" : ""}` : "Choose a box to play"
                  : pending ? canReveal ? "Ready to claim the result" : "Waiting for the result" : spinStarCost > 0 ? `${spinStarCost} star per spin` : "Ready to spin"}
              </div>
            </div>
            <SponsoredBadge show={isSponsored && isSmartWallet} />
          </div>

          {selectedGame === "box" && (
            <BoxGameTransaction
              plantId={plant.id}
              seed={seed ?? 1}
              withStar={withStar}
              buttonText={withStar ? "Play with star" : "Play box"}
              buttonClassName="w-full"
              disabled={boxPlayDisabled}
              feedbackMode="toast"
              onStatusUpdate={(status: UntypedValue) => {
                if (status?.statusName === "transactionPending") {
                  setBoxResultDetails(null);
                }
                handleBoxStatus(status as LifecycleStatus);
              }}
              onResult={(result) => setBoxResultDetails(result)}
            />
          )}

          {selectedGame === "spin" && !pending && (
            <SpinGameTransaction
              mode="commit"
              plantId={plant.id}
              commitment={commitmentHex ?? undefined}
              disabled={spinPlayDisabled}
              buttonClassName="w-full"
              feedbackMode="toast"
              buttonText={spinStarCost > 0 ? `Spin Leaf (${spinStarCost}★)` : "Spin Leaf"}
              onStatusUpdate={handleSpinStatus("commit") as UntypedValue}
              onButtonClick={handleCommitButtonClick}
              onRewardConfigUpdate={handleRewardUpdate}
            />
          )}

          {/* Keep the submitted commit controller mounted after onchain state
              advances to reveal. It can then finish proof-only recovery and
              release the wallet-wide transaction lock without exposing a
              second actionable button. */}
          {selectedGame === "spin" && pending && (
            <div className="hidden" aria-hidden="true">
              <SpinGameTransaction
                mode="commit"
                plantId={plant.id}
                commitment={pending.commitment}
                disabled
                buttonText="Recover SpinLeaf commit"
                feedbackMode="inline"
                onStatusUpdate={handleSpinStatus("commit") as UntypedValue}
              />
            </div>
          )}

          {selectedGame === "spin" && pending && (
            <SpinGameTransaction
              mode="reveal"
              plantId={plant.id}
              commitment={pending.commitment}
              secret={secretHex}
              disabled={spinPlayDisabled}
              buttonClassName="w-full"
              feedbackMode="toast"
              buttonText="Stop Wheel"
              onStatusUpdate={handleSpinStatus("reveal") as UntypedValue}
              onComplete={(result) => {
                handleRevealSuccess();
                finishWheelSpin(result?.rewardIndex);
                if (result) {
                  setResultDetails({
                    pointsDelta: result.pointsDelta,
                    timeAdded: result.timeAdded,
                    leafAmount: result.leafAmount,
                  });
                }
              }}
              onButtonClick={() => {
                setWheelState((prev) => ({ ...prev, spinning: false, revealReady: true }));
              }}
              onRewardConfigUpdate={handleRewardUpdate}
            />
          )}

          {selectedGame === "box" && boxHasInsufficientStars && (
            <InlineBalanceNotice>
              Not enough Stars. Balance: {starsAvailable} • Required: {boxStarCost}
            </InlineBalanceNotice>
          )}

          {selectedGame === "spin" && spinHasInsufficientStars && (
            <InlineBalanceNotice>
              Not enough Stars. Balance: {starsAvailable} • Required: {spinStarCost}
            </InlineBalanceNotice>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
