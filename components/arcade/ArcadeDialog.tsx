"use client";

import { SponsoredBadge } from "@/components/paymaster-toggle";
import { SolanaNotSupported,useIsSolanaWallet } from "@/components/solana";
import BoxGameTransaction from "@/components/transactions/box-game-transaction";
import SpinGameTransaction from "@/components/transactions/spin-game-transaction";
import type { LifecycleStatus } from "@/components/transactions/transaction-kit";
import { Button } from "@/components/ui/button";
import { Dialog,DialogContent,DialogDescription,DialogFooter,DialogHeader,DialogTitle } from "@/components/ui/dialog";
import { RewardResultPanel } from "@/components/ui/premium";
import { ToggleGroup } from "@/components/ui/toggle-group";
import { getBaseLogClient } from "@/lib/base-rpc";
import { BOX_GAME_ABI,PIXOTCHI_NFT_ADDRESS,SPIN_GAME_ABI } from "@/lib/contracts";
import { usePaymaster } from "@/lib/paymaster-context";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import {
SPIN_GAME_V2_COMMITTED_EVENT,
SPIN_GAME_V2_FORFEITED_EVENT,
SPIN_GAME_V2_PLAYED_EVENT,
} from "@/lib/spin-game-events";
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

const GameSelector = ({
  selected,
  onSelect,
}: {
  selected: GameId;
  onSelect: (game: GameId) => void;
}) => (
  <div className="flex justify-center">
    <ToggleGroup
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
              <Image src="/icons/spinleaf.svg" alt="" width={16} height={16} className="h-4 w-4 shrink-0 object-contain" aria-hidden />
              <span className="truncate">SpinLeaf</span>
            </span>
          ),
        },
      ]}
      size="default"
    />
  </div>
);

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
  const [spinMeta, setSpinMeta] = useState<SpinState | null>(null);
  const [, setLoadingSpinMeta] = useState(false);
  const [pendingSecret, setPendingSecret] = useState<Uint8Array | null>(null);
  const [, setBlockCountdown] = useState(0);
  const [, setBlockSecondsRemaining] = useState(0);
  const [spinRefreshKey, setSpinRefreshKey] = useState(0);
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
  const lastSeenCommitBlockRef = useRef<number | null>(null);
  const revealDeadlineRef = useRef<number | null>(null);

  useEffect(() => {
    lastSeenCommitBlockRef.current = lastSeenCommitBlock;
  }, [lastSeenCommitBlock]);

  useEffect(() => {
    revealDeadlineRef.current = revealDeadline;
  }, [revealDeadline]);

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

  // Fetch cooldowns when dialog opens or when plant changes
  useEffect(() => {
    if (!open || !publicClient) return;
    const currentPlantId = plantId;
    let mounted = true;
    (async () => {
      try {
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
        if (mounted) setCooldown({ normal: Number(normal), star: Number(star) });
      } catch { }
    })();
    return () => { mounted = false; };
  }, [open, plantId, publicClient]);

  // Countdown tick
  useEffect(() => {
    if (!open) return;
    // Stop interval if both cooldowns are 0
    if (cooldown.normal === 0 && cooldown.star === 0) return;

    const id = setInterval(() => {
      setCooldown((prev: { normal: number; star: number }) => ({
        normal: Math.max(0, prev.normal - 1),
        star: Math.max(0, prev.star - 1),
      }));
    }, 1000);
    return () => clearInterval(id);
  }, [open, cooldown.normal, cooldown.star]);

  const enrichPendingFromLogs = useCallback(async () => {
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
        return null;
      }

      const commitBlock = lastCommit.blockNumber ?? BigInt("0");
      const commitArgs = (lastCommit as UntypedValue as { args?: { player?: string; commitHash?: `0x${string}` } }).args;
      const commitData: PendingCommit = {
        player: (commitArgs?.player ?? address) as string,
        commitment: (commitArgs?.commitHash ?? "0x") as `0x${string}`,
        commitBlock: Number(commitBlock),
      };

      if (Number(commitBlock) > 0) {
        persistLastSeenBlock(Number(commitBlock));
      }

      const lastPlay = playedLogs.find((log) => (log.blockNumber ?? BigInt("0")) >= commitBlock);
      const lastForfeit = forfeitedLogs.find((log) => (log.blockNumber ?? BigInt("0")) >= commitBlock);

      if (lastPlay || lastForfeit) {
        return null;
      }

      return commitData;
    } catch (error) {
      console.warn("Failed to reconcile spin logs", error);
      return null;
    }
  }, [address, baseLogClient, persistLastSeenBlock, plantId]);

  const hydratePendingState = useCallback(async () => {
    const localKey = `spinleaf:pending:${plantId}`;
    let pendingCommit: PendingCommit | null = null;

    if (typeof window !== "undefined") {
      const stored = localStorage.getItem(localKey);
      if (stored) {
        try {
          pendingCommit = JSON.parse(stored) as PendingCommit;
          if (pendingCommit?.secretHex) {
            setPendingSecret(() => {
              try {
                return hexToBytes(pendingCommit?.secretHex as `0x${string}`);
              } catch {
                return null;
              }
            });
          }
        } catch {
          pendingCommit = null;
        }
      }
    }

    const reconciled = await enrichPendingFromLogs();

    return reconciled ?? pendingCommit ?? null;
  }, [enrichPendingFromLogs, plantId]);

  useEffect(() => {
    if (!open || selectedGame !== "spin" || !publicClient) {
      return;
    }

    let cancelled = false;
    setLoadingSpinMeta(true);

    (async () => {
      try {
        const [globalCooldown, starCost, perNftCooldown, rewards] = await Promise.all([
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
        ]);

        if (cancelled) return;

        const formattedRewards = rewards.map(([pointsDelta, timeExtension, leafAmount], index) => ({
          index,
          pointsDelta: Number(pointsDelta),
          timeExtension: Number(timeExtension),
          leafAmount,
        }));

        const reconciledPending = await hydratePendingState();

        const nextMeta: SpinState = {
          cooldown: Number(perNftCooldown ?? globalCooldown),
          starCost: Number(starCost),
          rewards: formattedRewards,
          pending: reconciledPending ?? null,
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
  }, [hydratePendingState, open, selectedGame, pendingEquals, plantId, publicClient, rewardsAreEqual, spinRefreshKey]);

  useEffect(() => {
    if (!open || selectedGame !== "spin" || !publicClient) return;

    let cancelled = false;

    const updateCountdown = async () => {
      try {
        const blockNumber = Number(await publicClient.getBlockNumber());
        if (cancelled) return;

        if (spinMeta?.pending) {
          const revealUnlockBlocks = Math.max(0, spinMeta.pending.commitBlock + 2 - blockNumber);
          const expiryBlocks = Math.max(0, spinMeta.pending.commitBlock + 1 + 256 - blockNumber);

          // Only update blockCountdown from onchain data
          setBlockCountdown(revealUnlockBlocks);

          // Only set revealDeadline ONCE when blocks are ready (to prevent countdown resets)
          if (revealUnlockBlocks === 0 && revealDeadlineRef.current === null) {
            const secondsRemaining = MIN_REVEAL_DELAY_SECONDS;
            setBlockSecondsRemaining(secondsRemaining);
            setRevealDeadline(Date.now() + secondsRemaining * 1000);
          } else if (revealUnlockBlocks > 0) {
            // Still waiting for blocks - update time estimate
            const secondsRemaining = Math.max(
              MIN_REVEAL_DELAY_SECONDS,
              revealUnlockBlocks * BLOCK_TIME_SECONDS,
            );
            setBlockSecondsRemaining(secondsRemaining);
            // Reset deadline if we're still waiting for blocks
            setRevealDeadline(Date.now() + secondsRemaining * 1000);
          }

          if (expiryBlocks === 0) {
            const localKey = `spinleaf:pending:${plantId}`;
            try {
              localStorage.removeItem(localKey);
            } catch { }
            setPendingSecret(null);
            setSpinMeta((prev) => (prev ? { ...prev, pending: null } : prev));
            toast.error("Spin expired — stars forfeited.");
          }
        } else {
          setBlockCountdown(0);
          setBlockSecondsRemaining(0);
          setRevealDeadline(null);
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
  }, [open, selectedGame, publicClient, spinMeta, plantId]);

  useEffect(() => {
    if (!open || selectedGame !== "spin") return;

    const interval = setInterval(() => {
      setBlockSecondsRemaining((prev) => Math.max(0, prev - 1));

      if (revealDeadline !== null) {
        const remaining = Math.max(0, Math.ceil((revealDeadline - Date.now()) / 1000));
        setBlockSecondsRemaining(remaining);
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
    if (!open || selectedGame !== "spin") return;
    if (!pendingSecret && (!spinMeta || !spinMeta.pending)) {
      const secret = crypto.getRandomValues(new Uint8Array(32));
      setPendingSecret(secret);
    }
  }, [open, selectedGame, pendingSecret, spinMeta]);

  const commitmentHex = useMemo(() => {
    if (!pendingSecret || !address) return null;
    return createCommitment(pendingSecret, plantId, address);
  }, [pendingSecret, plantId, address]);

  const secretHex = useMemo(() => {
    if (!pendingSecret) return undefined;
    return toHex(pendingSecret) as `0x${string}`;
  }, [pendingSecret]);

  const syncAfterTx = useCallback(async () => {
    const pending = await hydratePendingState();
    setSpinMeta((prev) => (prev ? { ...prev, pending: pending ?? null } : prev));
    setSpinRefreshKey((key) => key + 1);
  }, [hydratePendingState]);

  const startWheelSpin = useCallback(() => {
    setWheelState({ spinning: true, revealReady: false, rewardIndex: undefined });
    setTargetRotation(null);
  }, []);

  const finishWheelSpin = useCallback((rewardIndex?: number | null) => {
    const index = rewardIndex ?? Math.floor(Math.random() * WHEEL_SEGMENTS);
    const segmentAngle = 360 / WHEEL_SEGMENTS;
    const target = SPIN_EXTRA_TURNS * 360 + (WHEEL_SEGMENTS - 1 - index) * segmentAngle + segmentAngle / 2;
    setWheelState({ spinning: false, revealReady: true, rewardIndex: index });
    setTargetRotation(target);
  }, []);

  const handleRevealSuccess = useCallback(() => {
    setPendingSecret(null);
    setSpinMeta((prev) => (prev ? { ...prev, pending: null } : prev));
    setRevealUnlockedAt(null);
    syncAfterTx();
  }, [syncAfterTx]);

  // Force reset for users stuck with lost secrets from bugged version
  const handleForceReset = useCallback(() => {
    const localKey = `spinleaf:pending:${plantId}`;
    try {
      localStorage.removeItem(localKey);
    } catch { }
    setPendingSecret(null);
    setSpinMeta((prev) => (prev ? { ...prev, pending: null } : prev));
    setWheelState({ spinning: false, revealReady: false, rewardIndex: undefined });
    setRevealUnlockedAt(null);
    // Generate new secret for next spin
    const secret = crypto.getRandomValues(new Uint8Array(32));
    setPendingSecret(secret);
    toast.success('Spin reset. You can start a new spin now.');
  }, [plantId]);

  const handleSpinStatus = useCallback(
    (mode: "commit" | "reveal") => (status: LifecycleStatus) => {
      const txHash = status.statusData?.transactionReceipts?.[0]?.transactionHash as string | undefined;

      if (TRANSACTION_FAILURE_STATUSES.has(status.statusName ?? "")) {
        // Only reset wheel state on failure - DO NOT clear secret/pending!
        // The user needs the secret to retry the reveal transaction
        setWheelState({ spinning: false, revealReady: false, rewardIndex: undefined });
        return;
      }

      if (mode === "commit" && status.statusName === "success" && spinMeta && commitmentHex) {
        if (txHash && lastHandledCommitRef.current === txHash) return;
        if (txHash) lastHandledCommitRef.current = txHash;
        const localKey = `spinleaf:pending:${plantId}`;
        const blockNumberValue = status.statusData?.transactionReceipts?.[0]?.blockNumber;
        const blockNumber = Number(blockNumberValue !== undefined ? blockNumberValue : BigInt("0"));
        const data: PendingCommit = {
          player: address ?? "",
          commitBlock: blockNumber,
          commitment: commitmentHex,
          secretHex,
        };
        try {
          localStorage.setItem(localKey, JSON.stringify(data));
        } catch { }
        if (blockNumber > 0) persistLastSeenBlock(blockNumber);
        setSpinMeta((prev) => {
          if (!prev) return prev;
          return { ...prev, pending: data };
        });
        if (secretHex) {
          try {
            setPendingSecret(hexToBytes(secretHex));
          } catch { }
        }
        const unlockBlock = blockNumber + 2;
        setBlockCountdown(Math.max(0, unlockBlock - blockNumber));
        setBlockSecondsRemaining(Math.max(0, (unlockBlock - blockNumber) * BLOCK_TIME_SECONDS));
        // Enable reveal button after 3 seconds
        setRevealUnlockedAt(Date.now() + 3000);
        startWheelSpin();
      }
      if (mode === "reveal" && status.statusName === "success") {
        if (txHash && lastHandledRevealRef.current === txHash) return;
        if (txHash) lastHandledRevealRef.current = txHash;
        const localKey = `spinleaf:pending:${plantId}`;
        try {
          localStorage.removeItem(localKey);
        } catch { }
      }
    },
    [address, commitmentHex, persistLastSeenBlock, plantId, secretHex, spinMeta, startWheelSpin],
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

  const onStatus = useCallback((status: LifecycleStatus) => {
    if (status.statusName === "success") {
      try {
        window.dispatchEvent(new Event("balances:refresh"));
      } catch { }
    }
  }, []);

  const spinCooldown = spinMeta?.cooldown ?? 0;
  const spinStarCost = spinMeta?.starCost ?? 1;
  const pending = spinMeta?.pending;

  const canCommit = Boolean(
    spinMeta &&
    !pending &&
    spinMeta.cooldown === 0 &&
    (plant?.stars ?? 0) >= spinStarCost &&
    commitmentHex,
  );

  const canReveal = Boolean(
    pending &&
    address &&
    pending.player.toLowerCase() === address.toLowerCase() &&
    secretHex &&
    (revealUnlockedAt === null || Date.now() >= revealUnlockedAt),
  );

  const BoxGrid = () => (
    <div className="grid grid-cols-3 gap-2">
      {Array.from({ length: 9 }, (_, i) => i + 1).map((n) => (
        <Button
          key={n}
          type="button"
          variant="outline"
          onClick={() => {
            setSeed(n);
            setBoxResultDetails(null);
          }}
          className={`h-16 min-h-16 w-full rounded-[var(--radius-control)] p-0 sm:h-20 sm:min-h-20 ${seed === n ? "border-primary bg-primary/10 ring-2 ring-primary/30" : "border-border bg-card hover:bg-[hsl(var(--nav-hover-bg))]"
            }`}
          aria-label={`Select box ${n}`}
          aria-pressed={seed === n}
        >
          <Image src="/icons/box.png" alt={`Box ${n}`} width={32} height={32} className="w-8 h-8 object-contain" />
        </Button>
      ))}
    </div>
  );

  const currentCooldown = withStar ? cooldown.star : cooldown.normal;
  const disabled = !seed || !address || currentCooldown > 0;
  const starsAvailable = plant?.stars ?? 0;
  const boxPlayDisabled = disabled || (withStar && starsAvailable <= 0);
  const spinPlayDisabled = pending ? !canReveal : !(commitmentHex && canCommit);

  // Gate arcade games for Solana users
  if (isSolana) {
    return (
      <Dialog open={open} onOpenChange={onOpenChange}>
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
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent surface="soft" className="max-w-md w-[min(94vw,28rem)]">
        <DialogHeader>
          <DialogTitle>Arcade</DialogTitle>
          <DialogDescription>
            Pick a game, choose how you want to play, and use the bottom action when you are ready.
          </DialogDescription>
        </DialogHeader>
        <div className="surface-scroll-fade flex-1 overflow-y-auto py-3 pr-1">
          <div className="space-y-4">
            <GameSelector selected={selectedGame} onSelect={setSelectedGame} />

            {selectedGame === 'box' && (
              <div className="space-y-4">
                <div className="text-sm font-medium">Choose a box</div>
                <BoxGrid />

                <div className="space-y-3 rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <div className="font-medium text-foreground">
                      {withStar ? 'Playing with Stars' : 'Playing without Stars'}
                    </div>
                    <div className="grid grid-cols-2 gap-1 rounded-[var(--radius-control)] border border-border/55 bg-card/85 p-1">
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
                        aria-pressed={!withStar}
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
                        aria-pressed={withStar}
                      >
                        Use star
                      </Button>
                    </div>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Cooldown: <span className="font-medium text-foreground">
                      {currentCooldown > 0 ? `${formatDuration(currentCooldown)} remaining` : 'Ready to play'}
                    </span>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Stars available: <span className="font-semibold text-foreground">{starsAvailable}</span>
                    {withStar && starsAvailable <= 0 && (
                      <span className="ml-2 text-destructive">Not enough stars</span>
                    )}
                  </div>
                </div>
                {boxResultDetails && (
                  <RewardResultPanel title="Box result" tone={(boxResultDetails.pointsDelta || boxResultDetails.timeAdded) ? "success" : "warning"}>
                    {(boxResultDetails.pointsDelta || boxResultDetails.timeAdded) ? (
                      <div className="space-y-1">
                        {boxResultDetails.pointsDelta !== 0 && (
                          <div>
                            PTS: <span className="font-semibold text-foreground">{`+${formatScore(Math.abs(boxResultDetails.pointsDelta))}`}</span>
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
                    <div className="text-sm font-medium">Leaf Wheel</div>
                    <p className="text-xs text-muted-foreground">
                      Spin for PTS, TOD, and LEAF rewards.
                    </p>
                  </div>
                </div>

                <div className="relative mx-auto mt-6 w-48 h-48 sm:w-56 sm:h-56">
                  <div className="absolute inset-0 flex items-center justify-center">
                    <div className="relative w-full h-full rounded-full bg-gradient-to-br from-primary/10 via-background to-card shadow-[0_20px_45px_-20px_rgba(0,0,0,0.35)]" aria-hidden>
                      <div
                        className={cn(
                          "absolute inset-4 rounded-full border border-primary/30 flex items-center justify-center",
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
                        <svg viewBox="0 0 200 200" className="w-full h-full">
                          {[...Array(6)].map((_, index) => {
                            const angle = index * 60;
                            const radius = 68;
                            const cx = 100 + Math.cos((angle * Math.PI) / 180) * radius;
                            const cy = 100 + Math.sin((angle * Math.PI) / 180) * radius;
                            const rotation = angle + 90;
                            return (
                              <g key={index} transform={`rotate(${rotation} ${cx} ${cy})`}>
                                <image
                                  href="/icons/spinleaf.svg"
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
                          <div className="w-4 h-4 bg-primary rounded-full shadow-inner" />
                        </div>
                      </div>
                      <div className="absolute inset-0 flex items-center justify-center">
                        <div className="w-24 h-24 rounded-full border border-primary/20 bg-card/70 backdrop-blur-[var(--blur-surface)] flex flex-col items-center justify-center space-y-1">
                          <span className="text-[10px] uppercase tracking-wide text-muted-foreground">SpinLeaf</span>
                          <span className="text-xs font-semibold text-primary">Good luck!</span>
                        </div>
                      </div>
                      <div className="absolute inset-0 rounded-full border border-white/10" />
                    </div>
                  </div>
                  <div className="absolute -top-6 left-1/2 -translate-x-1/2 flex flex-col items-center">
                    <div className="w-0 h-0 border-l-8 border-r-8 border-t-12 border-l-transparent border-r-transparent border-t-primary" />
                  </div>
                </div>

                <div className="space-y-3 rounded-[var(--radius-panel)] border border-border/60 bg-card/90 bg-[image:var(--gradient-surface)] p-3 shadow-[var(--shadow-hairline)]">
                  <div>
                    <div className="text-sm font-medium">Star Spin</div>
                    <p className="text-xs text-muted-foreground">
                      Use a star, wait for the wheel, then stop it to claim the result.
                    </p>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Status: <span className="font-medium text-foreground">
                      {pending ? (canReveal ? "Ready to stop" : "Wheel is spinning") : spinCooldown > 0 ? formatDuration(spinCooldown) + " cooldown" : "Ready to spin"}
                    </span>
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Stars available: <span className="font-semibold text-foreground">{starsAvailable}</span>
                    {spinStarCost > 0 && starsAvailable < spinStarCost && !pending && (
                      <span className="ml-2 text-destructive">Not enough stars to spin</span>
                    )}
                  </div>

                  <div className="text-xs text-muted-foreground">
                    Cost per spin: <span className="font-semibold text-foreground">{spinStarCost}</span>
                  </div>

                  <div className="space-y-2">
                    {/* Reset button for users stuck with lost secrets */}
                    {pending && !secretHex && (
                      <Button
                        type="button"
                        variant="link"
                        onClick={handleForceReset}
                        className="mt-2 h-auto min-h-0 w-full px-0 py-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Stuck? Reset and start new spin
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            )}
            {selectedGame === "spin" && resultDetails && (
              <div className="mt-4 rounded-lg border border-primary/20 bg-primary/5 p-4 text-sm">
                <div className="font-semibold text-primary">Spin Reward</div>
                <ul className="mt-2 space-y-1">
                  {typeof resultDetails.pointsDelta === "number" && resultDetails.pointsDelta !== 0 && (
                    <li>
                      PTS: <span className="font-medium text-foreground">{`${resultDetails.pointsDelta > 0 ? "+" : ""}${formatScore(Math.abs(resultDetails.pointsDelta))}`}</span>
                    </li>
                  )}
                  {typeof resultDetails.timeAdded === "number" && resultDetails.timeAdded !== 0 && (
                    <li>
                      TOD: <span className="font-medium text-foreground">{`${resultDetails.timeAdded > 0 ? "+" : ""}${formatDuration(Math.abs(resultDetails.timeAdded))}`}</span>
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
              </div>
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
                onStatus(status as LifecycleStatus);
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
              onButtonClick={() => {
                if (!(commitmentHex && canCommit)) return;
                setResultDetails(null);
                startWheelSpin();
              }}
              onRewardConfigUpdate={handleRewardUpdate}
            />
          )}

          {selectedGame === "spin" && pending && (
            <SpinGameTransaction
              mode="reveal"
              plantId={plant.id}
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
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
