"use client";
import { getBalanceShortfallMessage } from '@/lib/balance-shortfall';
import { ResourceValue } from '@/components/ui/resource-value';
import { ResourceState } from "@/components/ui/resource-state";
import { parseSpinMetadata, parseSpinCommit, type SpinMetadata, type SpinRewardPreview } from "@/lib/spin-metadata";
import { readSafeUint } from "@/lib/contract-value";
import { getSpinReadState } from "@/lib/spin-read-state";
import { getSpinRevealState } from "@/lib/spin-reveal-state";
import { readExpiredSpin, storeExpiredSpin, type ExpiredSpin } from "@/lib/spin-expired-storage";
import { SpinLeafWheel } from "./spin-leaf-wheel";
import { useSpinLeafWheel } from "@/hooks/useSpinLeafWheel";
import { useArcadeCountdowns } from "@/hooks/useArcadeCountdowns";
import { isGameTransactionFailure } from "@/lib/game-transaction-status";
import { ArcadeStatLine } from "./arcade-stat-line";

import { SolanaNotSupported,useIsSolanaWallet } from "@/components/solana";
import BoxGameTransaction from "@/components/transactions/box-game-transaction";
import SpinGameTransaction, { type SpinCompletion } from "@/components/transactions/spin-game-transaction";
import type { LifecycleStatus } from "@/components/transactions/transaction-kit";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { DisabledReason, InlineBalanceNotice, RewardResultPanel } from "@/components/ui/premium";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { ScrollArea } from "@/components/ui/scroll-area";
import { clearSpinResultRecovery, formatSignedSpinValue, readSpinResultRecovery, type SpinResultRecovery } from "@/lib/spin-result-recovery";
import { getBaseLogClient, getBaseTransactionReceipt } from "@/lib/base-rpc";
import { BOX_GAME_ABI,PIXOTCHI_NFT_ADDRESS,SPIN_GAME_ABI } from "@/lib/contracts";
import {
invalidateOwnerResources,
isAbortError,
retryOwnerRead,
} from "@/lib/owner-resource-invalidation";
import {
extractBestSpinRewardFromLogs,
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
import { useCallback,useEffect,useMemo,useRef,useState } from "react";
import { toast } from "react-hot-toast";
import { encodePacked,hexToBytes,keccak256,toHex } from "viem";
import { useAccount,usePublicClient,useSignMessage } from "wagmi";

type ArcadeDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  plant: Plant;
};

type GameId = "box" | "spin";

interface PendingCommit {
  player: string;
  commitBlock: number;
  commitment: `0x${string}`;
  secretHex?: `0x${string}`;
}

type PendingReconciliation = {
  pending: PendingCommit | null;
  terminal: "forfeited" | "played" | null;
  completed?: PendingCommit;
};

type PendingHydration = {
  pending: PendingCommit | null;
  stored: StoredSpinPending | null;
};

type SpinState = SpinMetadata & {
  pending: PendingCommit | null;
};

const LOG_LOOKBACK_BLOCKS = 1000;
const LOG_LOOKBACK_BUFFER_BLOCKS = 64;
const LOG_CHUNK_SIZE = BigInt(500);
const BLOCK_POLL_INTERVAL_MS = 3000;

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

export default function ArcadeDialog(props: ArcadeDialogProps) {
  const { address } = useAccount();
  return <ScopedArcadeDialog key={`${address?.toLowerCase() ?? ''}:${props.plant.id}`} {...props} />;
}

function ScopedArcadeDialog({ open, onOpenChange, plant }: ArcadeDialogProps) {
  const { address } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const publicClient = usePublicClient();
  const baseLogClient = useMemo(() => getBaseLogClient(), []);
  const isSolana = useIsSolanaWallet();
  const plantId = plant.id;
  const [selectedGame, setSelectedGame] = useState<GameId>("box");
  const [seed, setSeed] = useState<number | null>(null);
  const [withStar, setWithStar] = useState(false);
  const [boxDeadlines, setBoxDeadlines] = useState({ normal: 0, star: 0 });
  const boxIntentRef = useRef<{ seed: number; withStar: boolean } | null>(null);
  const [resultRecovery, setResultRecovery] = useState<SpinResultRecovery | null>(null);
  const latestSpinRoundRef = useRef<string | null>(null);
  const resultAttemptRef = useRef(0);
  const [checkingResult, setCheckingResult] = useState(false);
  const [resultRecoveryError, setResultRecoveryError] = useState(false);
  const [boxReadStatus, setBoxReadStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [spinBlock, setSpinBlock] = useState<number | null>(null);
  const [spinBlockError, setSpinBlockError] = useState(false);
  const [expiredSpin, setExpiredSpin] = useState<ExpiredSpin | null>(null);
  const [boxReconcilePending, setBoxReconcilePending] = useState(false);
  const [arcadeTransactionPending, setArcadeTransactionPending] = useState(false);
  const [starsAvailable, setStarsAvailable] = useState(plant.stars ?? 0);
  const [spinMeta, setSpinMeta] = useState<SpinState | null>(null);
  // Rendered now (skeleton line while metadata loads) — it used to be a
  // write-only state slot, so the panel showed made-up defaults ("Ready to
  // spin", cost 1) before the reads resolved.
  const [loadingSpinMeta, setLoadingSpinMeta] = useState(false);
  const [spinMetaError, setSpinMetaError] = useState(false);
  const [pendingSecret, setPendingSecret] = useState<Uint8Array | null>(null);
  const [spinStorageHydratedFor, setSpinStorageHydratedFor] = useState<string | null>(null);
  const [persistedSpinCommitment, setPersistedSpinCommitment] = useState<`0x${string}` | null>(null);
  const [spinStorageUnavailable, setSpinStorageUnavailable] = useState(false);
  const [spinRefreshKey, setSpinRefreshKey] = useState(0);
  const [boxResultDetails, setBoxResultDetails] = useState<{
    pointsDelta: number;
    timeAdded: number;
    seed: number;
    withStar: boolean;
  } | null>(null);
  const wheel = useSpinLeafWheel({ active: open && selectedGame === "spin", pending: Boolean(spinMeta?.pending) });
  const { start: startWheelSpin, finish: finishWheelSpin, stop: stopWheelSpin } = wheel;
  const [resultDetails, setResultDetails] = useState<{
    pointsDelta?: number;
    timeAdded?: number;
    leafAmount?: bigint;
    transactionHash?: string | null;
  } | null>(null);
  const [lastSeenCommitBlock, setLastSeenCommitBlock] = useState<number | null>(null);
  const [cooldownDeadline, setCooldownDeadline] = useState<number | null>(null);
  const [revealUnlockedAt, setRevealUnlockedAt] = useState<number | null>(null); // 3s delay after commit
  const countdowns = useArcadeCountdowns({ ...boxDeadlines, spin: cooldownDeadline, reveal: revealUnlockedAt }, open);
  const lastHandledCommitRef = useRef<string | null>(null);
  const lastHandledRevealRef = useRef<string | null>(null);
  const lastHandledBoxRef = useRef<string | null>(null);
  const lastPlantIdRef = useRef(plantId);
  const starMutationPendingRef = useRef(false);
  const starMutationBaselineRef = useRef<number | null>(null);
  const boxCooldownAbortRef = useRef<AbortController | null>(null);
  const lastSeenCommitBlockRef = useRef<number | null>(null);
  const spinStorageIdentity = address ? `${address.toLowerCase()}:${plantId}` : null;

  useEffect(() => {
    if (spinMeta?.pending) latestSpinRoundRef.current = spinMeta.pending.commitment;
  }, [spinMeta?.pending]);

  useEffect(() => {
    lastSeenCommitBlockRef.current = lastSeenCommitBlock;
  }, [lastSeenCommitBlock]);

  useEffect(() => {
    setPendingSecret(null);
    setPersistedSpinCommitment(null);
    setSpinStorageHydratedFor(null);
    setSpinStorageUnavailable(false);
    setSpinMeta(null);
    setSpinMetaError(false);
    setExpiredSpin(address ? readExpiredSpin(getSpinStorage(), address, plantId) : null);
    setResultRecovery(address ? readSpinResultRecovery(address, plantId) : null);
  }, [address, plantId, spinStorageIdentity]);

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

  const rewardsAreEqual = useCallback((a: SpinRewardPreview[], b: SpinRewardPreview[]) => {
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
      if (address && readStoredSpinPending(getSpinStorage(), address, plantId)?.commitBlock) setSelectedGame('spin');
    }
  }, [address, open, plantId]);

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
    if (!publicClient) {
      setBoxReadStatus('error');
      return;
    }
    const currentPlantId = plantId;
    const controller = new AbortController();
    boxCooldownAbortRef.current?.abort();
    boxCooldownAbortRef.current = controller;
    setBoxReadStatus('loading');

    try {
      const readCooldown = async () => {
        const [normal, star] = await Promise.all([
          publicClient.readContract({
            address: PIXOTCHI_NFT_ADDRESS,
            abi: BOX_GAME_ABI,
            functionName: 'boxGameGetCoolDownTimePerNFT',
            args: [BigInt(currentPlantId)],
          }),
          publicClient.readContract({
            address: PIXOTCHI_NFT_ADDRESS,
            abi: BOX_GAME_ABI,
            functionName: 'boxGameGetCoolDownTimeWithStar',
            args: [BigInt(currentPlantId)],
          }),
        ]);
        return { normal: readSafeUint(normal), star: readSafeUint(star) };
      };
      const next = expectActive
        ? await retryOwnerRead(readCooldown, {
            accept: (value) => (starMode ? value.star : value.normal) > 0,
            signal: controller.signal,
          })
        : await readCooldown();
      if (!controller.signal.aborted && currentPlantId === lastPlantIdRef.current) {
        const now = Date.now();
        setBoxDeadlines({ normal: now + next.normal * 1000, star: now + next.star * 1000 });
        setBoxReadStatus('ready');
      }
    } catch (error) {
      if (!isAbortError(error)) {
        console.warn("Failed to reconcile box cooldown", error);
        if (!controller.signal.aborted) setBoxReadStatus('error');
      }
    } finally {
      if (boxCooldownAbortRef.current === controller) {
        boxCooldownAbortRef.current = null;
        setBoxReconcilePending(false);
      }
    }
  }, [plantId, publicClient]);

  // Fetch cooldowns when dialog opens or when plant changes.
  useEffect(() => {
    if (!open) return;
    void refreshBoxCooldown();
    const onResume = () => { if (document.visibilityState === 'visible') void refreshBoxCooldown(); };
    document.addEventListener('visibilitychange', onResume);
    return () => {
      boxCooldownAbortRef.current?.abort();
      document.removeEventListener('visibilitychange', onResume);
    };
  }, [open, publicClient, refreshBoxCooldown]);

  const enrichPendingFromLogs = useCallback(async (): Promise<PendingReconciliation | null> => {
    if (!address) return null;

    try {
      const currentBlock = await baseLogClient.getBlockNumber();
      const lookback = BigInt(LOG_LOOKBACK_BLOCKS);
      const fallbackFrom = currentBlock > lookback ? currentBlock - lookback : BigInt("0");
      const lastSeen = lastSeenCommitBlockRef.current != null
        ? BigInt(Math.max(0, lastSeenCommitBlockRef.current - LOG_LOOKBACK_BUFFER_BLOCKS))
        : null;
      // The persisted commit hint is an optimization, not authority over the
      // scan window. A stale/corrupt 48-hour record must never widen this read
      // beyond the bounded fallback window (or point beyond the current head).
      const boundedLastSeen = lastSeen !== null && lastSeen <= currentBlock
        ? lastSeen
        : fallbackFrom;
      const fromBlock = boundedLastSeen > fallbackFrom ? boundedLastSeen : fallbackFrom;
      const filterBase = {
        address: PIXOTCHI_NFT_ADDRESS,
        fromBlock,
        toBlock: currentBlock,
      } as const;

      const isRangeTooLargeError = (err: unknown) => {
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

        // The bounded window creates at most three initial chunks. Fetch them
        // concurrently so one slow provider response does not serialize the
        // entire reconciliation path.
        const chunkResults = await Promise.all(
          ranges.map(([start, end]) => fetchChunk(start, end)),
        );
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

      const commitData: PendingCommit = parseSpinCommit(lastCommit, address, plantId);
      const commitBlock = BigInt(commitData.commitBlock);

      if (Number(commitBlock) > 0) {
        noteLastSeenBlock(Number(commitBlock));
      }

      const lastPlay = playedLogs.find((log) => (log.blockNumber ?? BigInt("0")) >= commitBlock);
      const lastForfeit = forfeitedLogs.find((log) => (log.blockNumber ?? BigInt("0")) >= commitBlock);

      if (lastPlay || lastForfeit) {
        return {
          pending: null,
          terminal: lastForfeit ? "forfeited" : "played",
          completed: commitData,
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
      if (reconciliation.terminal === 'forfeited' && reconciliation.completed) {
        storeExpiredSpin(storage, { account: address, plantId, commitment: reconciliation.completed.commitment, commitBlock: reconciliation.completed.commitBlock, starsSpent: null });
      }
      removeStoredSpinPending(storage, address, plantId);
      return { pending: null, stored: null };
    }

    if (reconciliation?.pending) {
      const archived = readExpiredSpin(storage, address, plantId);
      if (archived?.commitment.toLowerCase() === reconciliation.pending.commitment.toLowerCase()) {
        // A newer prepared/submitted round can coexist with stale logs for the
        // archived round. Preserve its key so proof-only recovery still matches.
        const newerStored = stored?.commitment.toLowerCase() !== archived.commitment.toLowerCase() ? stored : null;
        return {
          pending: newerStored?.commitBlock ? { player: newerStored.account, commitment: newerStored.commitment, commitBlock: newerStored.commitBlock, secretHex: newerStored.secretHex } : null,
          stored: newerStored,
        };
      }
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
    setSpinMetaError(false);

    (async () => {
      try {
        const [globalCooldown, starCost, perNftCooldown, rewards, hydration] = await Promise.all([
          publicClient.readContract({
            address: PIXOTCHI_NFT_ADDRESS,
            abi: SPIN_GAME_ABI,
            functionName: "getCoolDownTime",
          }),
          publicClient.readContract({
            address: PIXOTCHI_NFT_ADDRESS,
            abi: SPIN_GAME_ABI,
            functionName: "getStarCost",
          }),
          publicClient.readContract({
            address: PIXOTCHI_NFT_ADDRESS,
            abi: SPIN_GAME_ABI,
            functionName: "spinGameV2GetCoolDownTimePerNFT",
            args: [BigInt(plantId)],
          }),
          Promise.all(
            Array.from({ length: 6 }, (_, i) =>
              publicClient.readContract({
                address: PIXOTCHI_NFT_ADDRESS,
                abi: SPIN_GAME_ABI,
                functionName: "getReward",
                args: [BigInt(i)],
              })
            )
          ),
          hydratePendingState(),
        ]);

        if (cancelled) return;

        const metadata = parseSpinMetadata(globalCooldown, starCost, perNftCooldown, rewards);

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
        if (address) setExpiredSpin(readExpiredSpin(getSpinStorage(), address, plantId));

        const nextMeta: SpinState = {
          ...metadata,
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
        const cooldownSeconds = metadata.cooldown;
        setCooldownDeadline(cooldownSeconds > 0 ? Date.now() + cooldownSeconds * 1000 : null);
      } catch (error) {
        if (!cancelled) {
          console.error("Failed to load SpinLeaf metadata", error);
          setSpinMetaError(true); // Preserve any known pending spin and its recovery controller.
        }
      } finally {
        if (!cancelled) setLoadingSpinMeta(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, hydratePendingState, open, selectedGame, pendingEquals, plantId, publicClient, rewardsAreEqual, spinRefreshKey, spinStorageIdentity]);

  useEffect(() => {
    if (!open || !publicClient || !spinMeta?.pending) return;

    let cancelled = false;

    const updateCountdown = async () => {
      try {
        const blockNumber = Number(await publicClient.getBlockNumber());
        if (cancelled) return;
        setSpinBlock(blockNumber);
        setSpinBlockError(false);

        if (spinMeta?.pending) {
          if (spinMeta.pending.commitBlock <= 0) {
            // A calls-status success can arrive without an enriched receipt.
            // Keep the reveal key and provisional pending state while log
            // reconciliation discovers the authoritative commit block.
            return;
          }
          if (getSpinRevealState(spinMeta.pending.commitBlock, blockNumber).status === 'expired' && address) {
            // Another tab/device may already have revealed this round. Resolve
            // logs before describing a missed reveal as a forfeiture.
            const reconciliation = await enrichPendingFromLogs();
            if (cancelled) return;
            if (!reconciliation) {
              setSpinBlock(null);
              setSpinBlockError(true);
              return;
            }
            if (reconciliation.terminal === 'played') {
              removeStoredSpinPending(getSpinStorage(), address, plantId);
              setPendingSecret(null);
              setPersistedSpinCommitment(null);
              setSpinMeta(prev => prev ? { ...prev, pending: null } : prev);
              setSpinRefreshKey(value => value + 1);
              return;
            }
            if (reconciliation.pending && reconciliation.pending.commitment.toLowerCase() !== spinMeta.pending.commitment.toLowerCase()) {
              setSpinRefreshKey(value => value + 1);
              return;
            }
            const expired = { account: address, plantId, commitment: spinMeta.pending.commitment, commitBlock: spinMeta.pending.commitBlock, starsSpent: null };
            setExpiredSpin(expired);
            // Do not discard the only durable round reference on a storage failure.
            if (storeExpiredSpin(getSpinStorage(), expired)) {
              removeStoredSpinPending(getSpinStorage(), address, plantId);
              setPendingSecret(null);
              setPersistedSpinCommitment(null);
              setSpinMeta(prev => prev ? { ...prev, pending: null } : prev);
              setLoadingSpinMeta(true);
              setSpinRefreshKey(value => value + 1);
            }
          }
        }
      } catch (error) {
        console.warn("Failed to refresh spin countdown", error);
        if (!cancelled) {
          setSpinBlock(null);
          setSpinBlockError(true);
        }
      }
    };

    updateCountdown();
    const interval = setInterval(updateCountdown, BLOCK_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [address, enrichPendingFromLogs, open, publicClient, spinMeta, plantId]);

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

  const handleRevealSuccess = useCallback(() => {
    setPendingSecret(null);
    setPersistedSpinCommitment(null);
    setSpinMeta((prev) => (prev ? { ...prev, pending: null } : prev));
    setRevealUnlockedAt(null);
  }, []);

  const handleSpinCompletion = useCallback((result: SpinCompletion, roundCommitment: string) => {
    // A canonical receipt may return after the player has started another round.
    // Its public recovery record is managed by the transaction adapter; never
    // clear the new round's secret or animate its wheel from an older callback.
    if (latestSpinRoundRef.current && latestSpinRoundRef.current !== roundCommitment) return;
    resultAttemptRef.current += 1;
    setCheckingResult(false);
    if (result.state === 'resolved') {
      setResultDetails({ ...result.reward, transactionHash: result.transactionHash });
      finishWheelSpin(result.reward.rewardIndex);
      setResultRecovery(null);
      setResultRecoveryError(false);
      if (address) clearSpinResultRecovery(address, plantId, result.transactionHash);
    } else {
      finishWheelSpin();
      setResultDetails(null);
      if (address) {
        const recovery = { account: address, plantId, transactionHash: result.transactionHash };
        setResultRecovery(recovery);
      }
    }
  }, [address, finishWheelSpin, plantId]);

  const recheckSpinResult = useCallback(async () => {
    if (!resultRecovery?.transactionHash || checkingResult) return;
    const attempt = ++resultAttemptRef.current;
    setCheckingResult(true);
    setResultRecoveryError(false);
    try {
      const receipt = await getBaseTransactionReceipt(resultRecovery.transactionHash);
      if (attempt !== resultAttemptRef.current) return;
      const reward = extractBestSpinRewardFromLogs(receipt.logs, { contract: PIXOTCHI_NFT_ADDRESS, player: resultRecovery.account, plantId: resultRecovery.plantId });
      if (!reward) throw new Error('Matching reward is not available yet');
      // This retry reads an already completed round and must not clear a newer pending spin.
      setResultDetails({ ...reward, transactionHash: resultRecovery.transactionHash });
      setResultRecovery(null);
      clearSpinResultRecovery(resultRecovery.account, resultRecovery.plantId, resultRecovery.transactionHash);
      if (!spinMeta?.pending) finishWheelSpin(reward.rewardIndex);
    } catch { if (attempt === resultAttemptRef.current) setResultRecoveryError(true); }
    finally { if (attempt === resultAttemptRef.current) setCheckingResult(false); }
  }, [checkingResult, finishWheelSpin, resultRecovery, spinMeta?.pending]);

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
    const persisted = persistPreparedSpin();
    if (!persisted) {
      setPersistedSpinCommitment(null);
      setSpinStorageUnavailable(true);
      toast.error("SpinLeaf could not secure the reveal key. No transaction was prepared.");
      return false;
    }

    latestSpinRoundRef.current = commitmentHex;
    resultAttemptRef.current += 1;
    setCheckingResult(false);
    if (commitmentHex) setPersistedSpinCommitment(commitmentHex);
    setSpinStorageUnavailable(false);
    setResultDetails(null);
    startWheelSpin();
  }, [commitmentHex, persistPreparedSpin, startWheelSpin]);

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

      if (isGameTransactionFailure(status.statusName)) {
        setArcadeTransactionPending(false);
        // Only reset wheel state on failure - DO NOT clear secret/pending!
        // The user needs the secret to retry the reveal transaction
        stopWheelSpin();
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
        setSpinBlock(null);
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
        // Cosmetic spin duration only; chain eligibility must also be ready.
        setRevealUnlockedAt(Date.now() + 3000);
        startWheelSpin();
      }
      if (mode === "reveal" && status.statusName === "success") {
        setArcadeTransactionPending(false);
        const proof = transactionProof ?? "unkeyed";
        if (lastHandledRevealRef.current === proof) return;
        lastHandledRevealRef.current = proof;
        handleRevealSuccess();
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
      handleRevealSuccess,
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
      stopWheelSpin,
    ],
  );

  const handleBoxStatus = useCallback((status: LifecycleStatus) => {
    if (status.statusName === "buildingTransaction" || status.statusName === "transactionPending") {
      if (!boxIntentRef.current) boxIntentRef.current = { seed: seed ?? 1, withStar };
      setArcadeTransactionPending(true);
      lastHandledBoxRef.current = null;
      return;
    }
    if (isGameTransactionFailure(status.statusName)) {
      setArcadeTransactionPending(false);
      boxIntentRef.current = null;
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

    const paidWithStar = boxIntentRef.current?.withStar ?? withStar;
    if (paidWithStar) debitStarsOptimistically(1);
    setBoxDeadlines(current => ({ ...current, [paidWithStar ? "star" : "normal"]: Date.now() + 1000 }));
    setBoxReconcilePending(true);
    invalidateOwnerResources({
      address,
      domains: ["plants"],
      receiptBlock: receipt?.blockNumber,
      source: "arcade:box",
      transactionHash: txHash,
      transactionId: status.statusData?.transactionId,
    });
    void refreshBoxCooldown({ expectActive: true, starMode: paidWithStar });
  }, [address, debitStarsOptimistically, refreshBoxCooldown, seed, withStar]);

  // Derived from the deadline + the 1s tick: spinMeta.cooldown is a snapshot
  // from fetch time, so displaying it directly froze the countdown and kept the
  // spin button dead until the dialog was reopened.
  const spinCooldown = countdowns.spin;
  const spinStarCost = spinMeta?.starCost ?? 1;
  const pending = spinMeta?.pending;
  const revealState = getSpinRevealState(pending?.commitBlock, spinBlock);
  const preparedSecretIsDurable = Boolean(
    commitmentHex
    && persistedSpinCommitment?.toLowerCase() === commitmentHex.toLowerCase(),
  );

  const spinRead = getSpinReadState({ hasMetadata: Boolean(spinMeta), loading: loadingSpinMeta, failed: spinMetaError });
  const canCommit = Boolean(
    spinRead.canStart && spinMeta &&
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
    revealState.status === 'ready' &&
    countdowns.reveal === 0,
  );

  const boxGrid = (
    <div className="grid grid-cols-3 gap-2.5">
      {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
        <Button
          key={n}
          type="button"
          variant="outline"
          disabled={arcadeTransactionPending || boxReconcilePending}
          onClick={() => {
            setSeed(n);
            setBoxResultDetails(null);
          }}
          className={cn(
            "group relative h-16 min-h-16 w-full overflow-hidden rounded-[var(--radius-panel)] p-0 sm:h-20 sm:min-h-20",
            "transition-[background-color,border-color,box-shadow,filter,transform] duration-[var(--motion-quick)] ease-[var(--ease-standard)]",
            seed === n
              ? "border-primary/45 bg-primary/10 text-primary ring-2 ring-primary/25"
              : "border-border/55 bg-card hover:border-primary/35 hover:bg-muted/50",
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

  const currentCooldown = withStar ? countdowns.star : countdowns.normal;
  const disabled = !seed || !address || currentCooldown > 0;
  const boxStarCost = 1;
  const boxPlayDisabled = disabled || boxReadStatus !== 'ready' || arcadeTransactionPending || boxReconcilePending || (withStar && starsAvailable <= 0);
  const spinPlayDisabled = arcadeTransactionPending || (pending ? !canReveal : !canCommit);
  const boxHasInsufficientStars = withStar && starsAvailable < boxStarCost;
  const spinHasInsufficientStars = spinRead.canStart && !pending && starsAvailable < spinStarCost;
  const boxDisabledReason = !address
    ? "Connect a wallet before opening a box."
    : !seed
      ? "Choose a box to play."
      : boxReconcilePending
        ? "Confirming the new cooldown."
      : boxReadStatus === 'error'
        ? 'Box cooldown could not be verified. Retry before playing.'
      : boxReadStatus !== 'ready'
        ? 'Checking the Box cooldown...'
      : currentCooldown > 0
        ? `Box cooldown clears in ${formatDuration(currentCooldown)}.`
        : null;
  const spinDisabledReason = pending
    ? canReveal
      ? null
      : !secretHex
        ? "This pending spin has no local reveal key. Recheck it or wait for the onchain expiry."
        : revealState.status === 'expired'
          ? 'The reveal window has elapsed. This spin can no longer earn a reward.'
          : revealState.status === 'waiting'
            ? `Reveal unlocks in ${revealState.blocksUntilReveal} block${revealState.blocksUntilReveal === 1 ? '' : 's'}.`
            : spinBlockError ? 'The current block could not be verified. Recheck before revealing.' : 'Checking the reveal block...'
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
  const spinStatusLabel = arcadeTransactionPending ? 'Transaction in progress'
    : pending ? canReveal ? 'Ready to reveal' : !secretHex ? 'Reveal key unavailable'
      : revealState.status === 'expired' ? 'Reveal window ended'
      : revealState.status === 'waiting' ? `Waiting ${revealState.blocksUntilReveal} blocks`
      : spinBlockError ? 'Block unavailable' : 'Checking reveal block'
    : !address ? 'Connect a wallet' : !spinRead.canStart ? spinRead.title
    : spinCooldown > 0 ? `${formatDuration(spinCooldown)} cooldown`
    : spinStorageUnavailable ? 'Reveal key storage unavailable'
    : spinHasInsufficientStars ? 'Not enough stars'
    : !canCommit ? 'Securing the reveal key' : 'Ready to spin';

  const hasSpinReward = resultDetails
    ? (resultDetails.pointsDelta ?? 0) > 0 ||
      (resultDetails.timeAdded ?? 0) > 0 ||
      (resultDetails.leafAmount !== undefined && resultDetails.leafAmount > BigInt("0"))
    : false;

  const handleDialogOpenChange = useCallback((nextOpen: boolean) => {
    if (!nextOpen && arcadeTransactionPending) {
      toast("Wait for the transaction to finish before closing the Arcade.", { icon: "⏳" });
      return;
    }
    if (!nextOpen && pending) toast('Your SpinLeaf round is still active. Return before the reveal window ends or the stars are forfeited.');
    onOpenChange(nextOpen);
  }, [arcadeTransactionPending, onOpenChange, pending]);

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
        <ScrollArea className="flex-1 overflow-y-auto py-3 pr-1">
          <div className="space-y-4">
            {pending && (
              <div className="rounded-[var(--radius-panel)] border border-warning/40 bg-warning/10 p-3 text-sm" role="status">
                <p className="font-medium">SpinLeaf round active for Plant #{plantId}</p>
                <p>{revealState.blocksUntilExpiry === null ? 'Checking the reveal window. Keep the saved reveal key on this device.' : revealState.blocksUntilExpiry === 1 ? 'Final reveal block. Reveal now; confirmation must arrive before the window ends.' : `Reveal within ${revealState.blocksUntilExpiry} blocks. Unrevealed stars are forfeited.`}</p>
                {selectedGame !== 'spin' && <Button variant="link" onClick={() => setSelectedGame('spin')}>Return to SpinLeaf</Button>}
              </div>
            )}
            {expiredSpin && (
              <RewardResultPanel title="Previous SpinLeaf round expired" tone="warning">
                <p>Plant #{expiredSpin.plantId}: the reveal window ended. {expiredSpin.starsSpent === null ? 'The stars spent on this round were forfeited.' : `${expiredSpin.starsSpent} star${expiredSpin.starsSpent === 1 ? '' : 's'} spent on this round were forfeited.`}</p>
                <a className="underline" href={`https://basescan.org/block/${expiredSpin.commitBlock}`} target="_blank" rel="noopener noreferrer">View commit block</a>
              </RewardResultPanel>
            )}
            {selectedGame === 'box' && (
              <div className="space-y-4">
                <div className="text-sm font-medium">Choose a box</div>
                {boxGrid}

                <div className="space-y-4 rounded-[var(--radius-panel)] bg-muted/25 p-4">
                  <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-center">
                    <div className="min-w-0">
                      <div className="text-sm font-medium text-foreground">Box play</div>
                      <p className="text-xs text-muted-foreground">Pick a box, then choose whether to spend a star.</p>
                    </div>
                    <div inert={arcadeTransactionPending || boxReconcilePending} aria-disabled={arcadeTransactionPending || boxReconcilePending}>
                      <ToggleGroup
                        value={withStar ? "star" : "none"}
                        onValueChange={value => setWithStar(value === "star")}
                        options={[{ value: "none", label: "No star" }, { value: "star", label: "Use star" }]}
                        size="lg"
                        ariaLabel="Star spending"
                      />
                    </div>
                  </div>

                  <div className="divide-y divide-border/60 text-sm">
                    <ArcadeStatLine label="Selected box" value={seed ? `Box ${seed}` : "None"} tone={seed ? "primary" : "warning"} />
                    <ArcadeStatLine label="Cooldown" value={boxReadStatus !== 'ready' ? boxReadStatus === 'error' ? 'Unavailable' : 'Checking...' : currentCooldown > 0 ? <ResourceValue resource="duration">{formatDuration(currentCooldown)}</ResourceValue> : "Ready"} tone={boxReadStatus !== 'ready' ? 'default' : currentCooldown > 0 ? "warning" : "success"} />
                    <ArcadeStatLine label="Stars available" value={<ResourceValue resource="stars">{starsAvailable}</ResourceValue>} tone={boxHasInsufficientStars ? "danger" : "default"} />
                  </div>

                  {boxDisabledReason && <DisabledReason>{boxDisabledReason}</DisabledReason>}
                  {boxReadStatus === 'error' && <Button variant="outline" onClick={() => void refreshBoxCooldown()}>Retry Box cooldown</Button>}
                </div>
                {boxResultDetails && (
                  <RewardResultPanel
                    title="Box result"
                    /* Tone follows the SIGN, not mere presence: a negative delta
                       used to render as "+N" in a green success panel. */
                    tone={(boxResultDetails.pointsDelta > 0 || boxResultDetails.timeAdded > 0) ? "success" : "warning"}
                  >
                    <p className="mb-2 text-xs text-muted-foreground">Box {boxResultDetails.seed} · {boxResultDetails.withStar ? "1 star spent" : "No star spent"}</p>
                    {(boxResultDetails.pointsDelta || boxResultDetails.timeAdded) ? (
                      <div className="space-y-1">
                        {boxResultDetails.pointsDelta !== 0 && (
                          <div>
                            PTS: <span className="font-semibold text-foreground">{`${boxResultDetails.pointsDelta > 0 ? "+" : "-"}${formatScore(Math.abs(boxResultDetails.pointsDelta))}`}</span>
                          </div>
                        )}
                        {boxResultDetails.timeAdded !== 0 && (
                          <div>
                            Lifetime: <span className="font-semibold text-foreground">{`${boxResultDetails.timeAdded > 0 ? "+" : "-"}${formatDuration(Math.abs(boxResultDetails.timeAdded))}`}</span>
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
                {spinMetaError && <ResourceState status="error" title={spinRead.title} description={spinRead.description} onRetry={() => setSpinRefreshKey(value => value + 1)} />}
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-medium">SpinLeaf</div>
                    <p className="text-xs text-muted-foreground">
                      Spin for PTS, lifetime, and LEAF rewards.
                    </p>
                  </div>
                </div>

                <SpinLeafWheel motion={wheel} pending={Boolean(pending)} rewards={spinRead.canStart ? spinMeta?.rewards ?? null : null} />

                <div className="space-y-4 rounded-[var(--radius-panel)] bg-muted/25 p-4">
                  <div>
                    <div className="text-sm font-medium">{spinRead.canStart ? `Start a spin with ${spinStarCost} ${spinStarCost === 1 ? "star" : "stars"}` : "Start a spin"}</div>
                    <p className="text-xs text-muted-foreground">
                      This game requires two transactions: spend the shown stars to start, then reveal the result. Reveal within 256 blocks after the next block or the stars are forfeited. Return to this device to use your saved reveal key.
                    </p>
                  </div>

                  <div className="divide-y divide-border/60 text-sm">
                    <ArcadeStatLine
                      label="Status"
                      value={spinStatusLabel}
                      tone={!arcadeTransactionPending && (canCommit || canReveal) ? "success" : spinHasInsufficientStars || spinStorageUnavailable ? "warning" : "default"}
                    />
                    <ArcadeStatLine label="Stars available" value={<ResourceValue resource="stars">{starsAvailable}</ResourceValue>} tone={spinHasInsufficientStars ? "danger" : "default"} />
                    <ArcadeStatLine
                      label="Cost per spin"
                      value={(
                        <span className="inline-flex items-center justify-end gap-1">
                          <Image src="/icons/Star.svg" alt="Stars" width={14} height={14} className="h-3.5 w-3.5 shrink-0" />
                          <span>{spinRead.canStart ? spinStarCost : "Unavailable"}</span>
                        </span>
                      )}
                      tone="primary"
                    />
                  </div>

                  {spinDisabledReason && (starsAvailable >= spinStarCost || Boolean(pending)) && (
                    <DisabledReason>{spinDisabledReason}</DisabledReason>
                  )}
                  {!pending && spinStorageUnavailable && (
                    <Button variant="outline" onClick={() => {
                      const persisted = persistPreparedSpin();
                      setPersistedSpinCommitment(persisted ? commitmentHex : null);
                      setSpinStorageUnavailable(!persisted);
                    }}>Retry reveal key storage</Button>
                  )}

                  <div className="space-y-2">
                    {pending && (!secretHex || spinBlockError) && (
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
            {resultRecovery && (
              <RewardResultPanel title="Spin confirmed · result unavailable" tone="warning">
                <p>The reveal succeeded, but its reward could not be read. Retry to retrieve the result.</p>
                {resultRecovery.transactionHash ? (
                  <div className="mt-3 flex flex-wrap items-center gap-3">
                    <Button variant="outline" disabled={checkingResult} onClick={() => void recheckSpinResult()}>{checkingResult ? "Checking result…" : "Retry SpinLeaf result"}</Button>
                    <a className="inline-flex min-h-11 items-center underline" href={`https://basescan.org/tx/${resultRecovery.transactionHash}`} target="_blank" rel="noopener noreferrer">View reveal receipt</a>
                  </div>
                ) : <p className="mt-2">The wallet did not return a receipt hash. Open Activity to inspect this plant’s completed spin.</p>}
                {resultRecoveryError && <p role="status" className="mt-2">The reward is still unavailable. Your receipt is saved; try again later.</p>}
              </RewardResultPanel>
            )}
            {selectedGame === "spin" && resultDetails && (
              <RewardResultPanel className="mt-4" title={pending ? "Previous spin result" : "Spin Reward"} tone={hasSpinReward ? "success" : "warning"}>
                <ul className="space-y-1">
                  {typeof resultDetails.pointsDelta === "number" && resultDetails.pointsDelta !== 0 && (
                    <li>
                      PTS: <span className="font-medium text-foreground">{formatSignedSpinValue(resultDetails.pointsDelta, formatScore)}</span>
                    </li>
                  )}
                  {typeof resultDetails.timeAdded === "number" && resultDetails.timeAdded !== 0 && (
                    <li>
                      Lifetime: <span className="font-medium text-foreground">{formatSignedSpinValue(resultDetails.timeAdded, formatDuration)}</span>
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
                {resultDetails.transactionHash && <a className="mt-2 inline-flex min-h-11 items-center underline" href={`https://basescan.org/tx/${resultDetails.transactionHash}`} target="_blank" rel="noopener noreferrer">View spin receipt</a>}
              </RewardResultPanel>
            )}
          </div>
        </ScrollArea>
        <DialogFooter sticky className="block space-y-3">
          <div className="flex items-center justify-between gap-3 text-xs text-muted-foreground">
            <div className="min-w-0">
              <div className="truncate font-semibold text-foreground">
                {selectedGame === "box" ? "Open a Box" : spinStatusLabel}
              </div>
              <div className="truncate">
                {selectedGame === "box"
                  ? seed ? `Box ${seed}${withStar ? " with star" : ""}` : "Choose a box to play"
                  : pending ? "Your submitted spin is saved on this device" : spinRead.canStart ? `${spinStarCost} star${spinStarCost === 1 ? "" : "s"} per spin` : "Cost and cooldown are not confirmed"}
              </div>
            </div>
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
              onStatusUpdate={(status: LifecycleStatus) => {
                if (status?.statusName === "transactionPending") {
                  setBoxResultDetails(null);
                }
                handleBoxStatus(status as LifecycleStatus);
              }}
              onResult={(result) => {
                setBoxResultDetails(result ? { ...result, ...(boxIntentRef.current ?? { seed: seed ?? 1, withStar }) } : null);
                boxIntentRef.current = null;
              }}
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
              buttonText={!canCommit ? spinStatusLabel : spinStarCost > 0 ? `Start SpinLeaf (${spinStarCost} ${spinStarCost === 1 ? "star" : "stars"})` : "Start SpinLeaf"}
              onStatusUpdate={handleSpinStatus("commit")}
              onButtonClick={handleCommitButtonClick}
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
                onStatusUpdate={handleSpinStatus("commit")}
              />
            </div>
          )}

          {selectedGame === "spin" && pending && (
            <SpinGameTransaction
              mode="reveal"
              plantId={plant.id}
              commitBlock={pending.commitBlock}
              commitment={pending.commitment}
              secret={secretHex}
              disabled={spinPlayDisabled}
              buttonClassName="w-full"
              feedbackMode="toast"
              buttonText="Reveal result"
              onStatusUpdate={handleSpinStatus("reveal")}
              onComplete={result => handleSpinCompletion(result, pending.commitment)}
              onButtonClick={wheel.reveal}
            />
          )}

          {selectedGame === "box" && boxHasInsufficientStars && (
            <InlineBalanceNotice>
              {getBalanceShortfallMessage(BigInt(starsAvailable), BigInt(boxStarCost), 'Stars', 0)}
            </InlineBalanceNotice>
          )}



          {selectedGame === "spin" && spinHasInsufficientStars && (
            <InlineBalanceNotice>
              {getBalanceShortfallMessage(BigInt(starsAvailable), BigInt(spinStarCost), 'Stars', 0)}
            </InlineBalanceNotice>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
