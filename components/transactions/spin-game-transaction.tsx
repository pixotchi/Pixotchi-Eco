"use client";

import { useMemo } from "react";
import SponsoredTransaction from "./sponsored-transaction";
import { PIXOTCHI_NFT_ADDRESS, SPIN_GAME_ABI } from "@/lib/contracts";
import { toast } from "react-hot-toast";
import { AbiEventSignatureNotFoundError, decodeEventLog } from "viem";
import PixotchiNFT from "@/public/abi/PixotchiNFT.json";
import type { LifecycleStatus } from "@coinbase/onchainkit/transaction";
import { formatDuration, formatScore, formatTokenAmount } from "@/lib/utils";
import { useAccount } from "wagmi";

const FUNCTION_MAP = {
  commit: "spinGameV2Commit",
  reveal: "spinGameV2Play",
} as const;

interface SpinGameTransactionProps {
  mode: "commit" | "reveal";
  plantId: number;
  commitment?: `0x${string}`;
  secret?: `0x${string}`;
  disabled?: boolean;
  buttonText?: string;
  buttonClassName?: string;
  onStatusUpdate?: (status: LifecycleStatus) => void;
  onComplete?: (result?: {
    rewardIndex?: number;
    pointsDelta?: number;
    timeAdded?: number;
    leafAmount?: bigint;
  }) => void;
  onButtonClick?: () => void;
  onRewardConfigUpdate?: (index: number, reward: {
    pointDelta: bigint;
    timeExtension: bigint;
    leafAmount: bigint;
  }) => void;
}

export default function SpinGameTransaction({
  mode,
  plantId,
  commitment,
  secret,
  disabled = false,
  buttonText,
  buttonClassName,
  onStatusUpdate,
  onComplete,
  onButtonClick,
  onRewardConfigUpdate,
}: SpinGameTransactionProps) {
  const { address } = useAccount();
  const calls = useMemo(() => {
    const fn = FUNCTION_MAP[mode];

    if (mode === "commit") {
      if (!commitment) return [];
      return [
        {
          address: PIXOTCHI_NFT_ADDRESS,
          abi: SPIN_GAME_ABI,
          functionName: fn,
          args: [BigInt(plantId), commitment],
        },
      ];
    }

    if (mode === "reveal") {
      if (!secret) return [];
      return [
        {
          address: PIXOTCHI_NFT_ADDRESS,
          abi: SPIN_GAME_ABI,
          functionName: fn,
          args: [BigInt(plantId), secret],
        },
      ];
    }

    return [];
  }, [mode, plantId, commitment, secret]);

  const handleStatus = (status: LifecycleStatus) => {
    onStatusUpdate?.(status);

    if (status.statusName !== "success") return;

    if (mode === "commit") {
      toast.success("Spin committed! Reveal after the next block.", {
        id: "spin-leaf-commit",
      });
    } else if (mode === "reveal") {
      const receipts: any[] = (status?.statusData?.transactionReceipts as any[]) || [];
      if (address) {
        const txHash = receipts?.[0]?.transactionHash ?? receipts?.[0]?.transaction?.hash;
        if (txHash) {
          try {
            fetch('/api/gamification/missions', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                address,
                taskId: 's4_play_arcade',
                proof: { txHash },
              }),
            }).catch((err) => console.warn('Gamification tracking failed (non-critical):', err));
          } catch (error) {
            console.warn('Failed to dispatch gamification mission (spin arcade):', error);
          }
        } else {
          console.warn('Spin reveal completed without transaction hash; skipping mission update');
        }
      }
      const abi = (PixotchiNFT as any).abi || PixotchiNFT;
      let summaryShown = false;
      let revealResult: {
        rewardIndex?: number;
        pointsDelta?: number;
        timeAdded?: number;
        leafAmount?: bigint;
      } | undefined;

      for (const receipt of receipts) {
        const logs = receipt?.logs || [];
        for (const log of logs) {
          try {
            const decoded: any = decodeEventLog({
              abi,
              data: log.data as `0x${string}`,
              topics: log.topics as any,
            });

            if (
              decoded.eventName === "SpinGameV2Played" ||
              decoded.eventName === "SpinGameV2Reveal" ||
              decoded.eventName === "Played" ||
              decoded.eventName === "PlayedV2"
            ) {
              const points = Number(
                decoded.args.pointsDelta ?? decoded.args.points ?? decoded.args.pointsAdjustment ?? 0,
              );
              const time = Number(
                decoded.args.timeAdded ?? decoded.args.timeExtension ?? decoded.args.timeAdjustment ?? 0,
              );
              const leafRaw = decoded.args.leafAmount ?? decoded.args.leaf ?? 0;
              const rewardIndex = decoded.args.rewardIndex ?? undefined;

              revealResult = {
                rewardIndex: rewardIndex !== undefined ? Number(rewardIndex) : undefined,
                pointsDelta: points,
                timeAdded: time,
                leafAmount: typeof leafRaw === "bigint" ? leafRaw : BigInt(leafRaw ?? 0),
              };

              const parts: string[] = [];

              if (points !== 0) {
                parts.push(`${points > 0 ? "+" : ""}${formatScore(Math.abs(points))} PTS`);
              }
              if (time !== 0) {
                parts.push(`${time > 0 ? "+" : ""}${formatDuration(Math.abs(time))} TOD`);
              }
              if (leafRaw && BigInt(leafRaw) !== BigInt("0")) {
                const leafFormatted = formatTokenAmount(BigInt(leafRaw));
                parts.push(`${BigInt(leafRaw) > BigInt("0") ? "+" : ""}${leafFormatted} LEAF`);
              }

              toast.success(parts.length ? `Spin result: ${parts.join(" • ")}` : "Spin result: no reward this time", {
                id: "spin-leaf-result",
              });
              summaryShown = true;
              break;
            }

            if (decoded.eventName === "SpinGameV2RewardUpdated") {
              try {
                const indexRaw = decoded.args.index ?? decoded.args[0];
                const pointDelta = decoded.args.pointDelta ?? decoded.args[1];
                const timeExtension = decoded.args.timeExtension ?? decoded.args[2];
                const leafAmount = decoded.args.leafAmount ?? decoded.args[3];
                const index = Number(indexRaw ?? 0);
                if (!Number.isNaN(index) && onRewardConfigUpdate) {
                  onRewardConfigUpdate(index, {
                    pointDelta: BigInt(pointDelta ?? 0),
                    timeExtension: BigInt(timeExtension ?? 0),
                    leafAmount: BigInt(leafAmount ?? 0),
                  });
                }
              } catch (updateError) {
                console.warn("Failed to process reward update event", updateError);
              }
              continue;
            }
          } catch (error) {
            if (error instanceof AbiEventSignatureNotFoundError) {
              continue;
            }
            console.warn("Failed to decode spin event", error);
          }
        }
        if (summaryShown) break;
      }

      if (!summaryShown) {
        toast.success("Spin complete!", { id: "spin-leaf-result" });
      }

      try {
        onComplete?.(revealResult);
      } catch (error) {
        console.warn("Spin transaction completion callback failed", error);
      }

      return;
    }
  };

  let defaultText = "Submit";
  if (mode === "commit") defaultText = "Commit Spin";
  if (mode === "reveal") defaultText = "Reveal Spin";

  const finalDisabled = disabled || calls.length === 0;

  return (
    <SponsoredTransaction
      calls={calls as any}
      buttonText={buttonText ?? defaultText}
      buttonClassName={buttonClassName}
      disabled={finalDisabled}
      onStatusUpdate={handleStatus as any}
      onButtonClick={onButtonClick}
    />
  );
}
