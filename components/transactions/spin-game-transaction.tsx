"use client";

import { useMemo } from "react";
import SponsoredTransaction from "./sponsored-transaction";
import { PIXOTCHI_NFT_ADDRESS, SPIN_GAME_ABI } from "@/lib/contracts";
import { toast } from "react-hot-toast";
import type { LifecycleStatus } from "@coinbase/onchainkit/transaction";
import { formatDuration, formatScore, formatTokenAmount } from "@/lib/utils";
import { useAccount } from "wagmi";
import { extractTransactionHash } from '@/lib/transaction-utils';
import { extractBestSpinRewardFromLogs } from "@/lib/spin-game-events";
import { postMissionProgress } from "@/lib/mission-tracking";

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

    // Parent already handles reveal failures through onStatusUpdate. Calling
    // onComplete on failure clears the pending secret and prevents a retry.
    const failureStatuses = new Set([
      "error", "failed", "reverted", "cancelled", "canceled", "rejected",
      "transactionRejected", "userRejected", "buildError"
    ]);
    if (failureStatuses.has(status.statusName ?? "")) {
      return;
    }

    if (status.statusName !== "success") return;

    if (mode === "commit") {
      toast.success("Spin committed! Reveal after the next block.", {
        id: "spin-leaf-commit",
      });
      } else if (mode === "reveal") {
        const receipts: any[] = (status?.statusData?.transactionReceipts as any[]) || [];
        if (address) {
        const txHash = extractTransactionHash(receipts[0]);
        if (txHash) {
          try {
            postMissionProgress({
              address,
              taskId: 's4_play_arcade',
              proof: { txHash },
            }).catch((err) => console.warn('Gamification tracking failed (non-critical):', err));
          } catch (error) {
            console.warn('Failed to dispatch gamification mission (spin arcade):', error);
          }
        } else {
            console.warn('Spin reveal completed without transaction hash; skipping mission update');
          }
        }
      let revealResult:
        | {
            rewardIndex?: number;
            pointsDelta?: number;
            timeAdded?: number;
            leafAmount?: bigint;
          }
        | undefined;

      try {
        const rewardLogs = receipts.flatMap((receipt) => receipt?.logs || []);
        revealResult = extractBestSpinRewardFromLogs(rewardLogs);
      } catch (error) {
        console.warn("Failed to decode spin event", error);
      }

      if (revealResult) {
        const parts: string[] = [];

        if ((revealResult.pointsDelta ?? 0) !== 0) {
          parts.push(
            `${revealResult.pointsDelta! > 0 ? "+" : ""}${formatScore(
              Math.abs(revealResult.pointsDelta!),
            )} PTS`,
          );
        }
        if ((revealResult.timeAdded ?? 0) !== 0) {
          parts.push(
            `${revealResult.timeAdded! > 0 ? "+" : ""}${formatDuration(
              Math.abs(revealResult.timeAdded!),
            )} TOD`,
          );
        }
        if ((revealResult.leafAmount ?? BigInt(0)) !== BigInt(0)) {
          const leafFormatted = formatTokenAmount(revealResult.leafAmount!);
          parts.push(
            `${revealResult.leafAmount! > BigInt(0) ? "+" : ""}${leafFormatted} LEAF`,
          );
        }

        toast.success(
          parts.length
            ? `Spin result: ${parts.join(" • ")}`
            : "Spin result: no reward this time",
          {
            id: "spin-leaf-result",
          },
        );
      } else {
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
