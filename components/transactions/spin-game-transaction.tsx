"use client";

import { useMemo, useRef } from "react";
import GameTransaction from "./game-transaction";
import { PIXOTCHI_NFT_ADDRESS, SPIN_GAME_ABI } from "@/lib/contracts";
import { toast } from "react-hot-toast";
import type { LifecycleStatus, TransactionFeedbackMode } from "./transaction-kit";
import { formatDuration, formatScore, formatTokenAmount } from "@/lib/utils";
import { useAccount, usePublicClient } from "wagmi";
import { verifySpinReveal } from '@/lib/spin-reveal-state';
import type { TransactionPreflight } from './transaction-kit';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { extractBestSpinRewardFromLogs, type SpinRewardResult } from "@/lib/spin-game-events";
import { getBaseTransactionReceipt } from "@/lib/base-rpc";
import { formatSignedSpinValue, storeSpinResultRecovery, clearSpinResultRecovery } from "@/lib/spin-result-recovery";
import type { Hex } from "viem";

export type SpinCompletion = { state: "resolved"; reward: SpinRewardResult; transactionHash: Hex | null } | { state: "unavailable"; transactionHash: Hex | null };
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
  commitBlock?: number;
  disabled?: boolean;
  buttonText?: string;
  buttonClassName?: string;
  feedbackMode?: TransactionFeedbackMode;
  onStatusUpdate?: (status: LifecycleStatus) => void;
  onComplete?: (result: SpinCompletion) => void;
  /** Awaited preflight: returning false or throwing prevents wallet execution. */
  onButtonClick?: TransactionPreflight;
  /** @deprecated Reward configuration is read by ArcadeDialog; retained for source compatibility. */
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
  commitBlock,
  disabled = false,
  buttonText,
  buttonClassName,
  feedbackMode,
  onStatusUpdate,
  onComplete,
  onButtonClick,
}: SpinGameTransactionProps) {
  const { address } = useAccount();
  const publicClient = usePublicClient();
  const preflight: TransactionPreflight = async () => {
    if (mode === 'reveal') {
      if (!publicClient || !address || !secret) throw new Error('Reconnect the wallet and reload the spin before revealing.');
      // The contract is the final authority: never send a premature/invalid reveal
      // merely because a local timer or previously observed head advanced.
      await verifySpinReveal({
        commitBlock,
        readBlock: () => publicClient.getBlockNumber({ cacheTime: 0 }),
        simulate: () => publicClient.simulateContract({ account: address, address: PIXOTCHI_NFT_ADDRESS, abi: SPIN_GAME_ABI, functionName: 'spinGameV2Play', args: [BigInt(plantId), secret] }),
      });
    }
    return onButtonClick?.();
  };
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

  const handledProof = useRef<string | null>(null);
  const handleStatus = async (status: LifecycleStatus) => {
    onStatusUpdate?.(status);

    // Parent already handles reveal failures through onStatusUpdate. Calling
    // onComplete on failure clears the pending secret and prevents a retry.
    if (status.statusName !== "success") return;

    if (mode === "commit") {
      toast.success("Spin committed! Reveal after the next block.", {
        id: "spin-leaf-commit",
      });
    } else if (mode === "reveal") {
      const receipts = status.statusData?.transactionReceipts ?? [];
      const txHash = (receipts.map(extractTransactionHash).find(Boolean) ?? extractTransactionHash(status.statusData)) as Hex | undefined;
      const proof = txHash ?? status.statusData?.transactionId ?? "confirmed";
      if (handledProof.current === proof) return;
      handledProof.current = proof;
      if (address && txHash) {
        void postMissionProgress({ address, taskId: 's4_play_arcade', proof: { txHash } })
          .catch(error => console.warn('Gamification tracking failed (non-critical):', error));
      }
      if (address) storeSpinResultRecovery({ account: address, plantId, transactionHash: txHash ?? null });
      const subject = address ? { player: address, plantId, contract: PIXOTCHI_NFT_ADDRESS } : null;
      let reward = subject ? extractBestSpinRewardFromLogs(receipts.flatMap(receipt => Array.isArray(receipt?.logs) ? receipt.logs : []), subject) : undefined;
      if (!reward && txHash && subject) {
        try {
          const receipt = await getBaseTransactionReceipt(txHash);
          reward = extractBestSpinRewardFromLogs(receipt.logs, subject);
        } catch { /* Confirmed transaction remains recoverable through its public receipt. */ }
      }
      if (reward) {
        const parts: string[] = [];
        if (reward.pointsDelta !== 0) parts.push(`${formatSignedSpinValue(reward.pointsDelta, formatScore)} PTS`);
        if (reward.timeAdded !== 0) parts.push(`${formatSignedSpinValue(reward.timeAdded, formatDuration)} lifetime`);
        if (reward.leafAmount !== BigInt(0)) parts.push(`${reward.leafAmount > BigInt(0) ? '+' : ''}${formatTokenAmount(reward.leafAmount)} LEAF`);
        const message = parts.length ? `Spin result: ${parts.join(' • ')}` : 'Spin result: no reward this time';
        if (reward.pointsDelta > 0 || reward.timeAdded > 0 || reward.leafAmount > BigInt(0)) toast.success(message, { id: 'spin-leaf-result' });
        else toast(message, { id: 'spin-leaf-result' });
        if (address) clearSpinResultRecovery(address, plantId, txHash ?? null);
        onComplete?.({ state: 'resolved', reward, transactionHash: txHash ?? null });
      } else {
        toast('Spin confirmed. The reward is not available yet; retry the receipt below.', { id: 'spin-leaf-result' });
        onComplete?.({ state: 'unavailable', transactionHash: txHash ?? null });
      }

      return;
    }
  };

  let defaultText = "Submit";
  if (mode === "commit") defaultText = "Start SpinLeaf";
  if (mode === "reveal") defaultText = "Reveal result";

  const finalDisabled = disabled || calls.length === 0;
  // Commit and reveal are distinct transaction intents. Scope recovery by the
  // prepared commitment so a stale commit cannot collide with a new spin, but
  // never include the reveal secret in the durable identity.
  const intentKey = commitment
    ? `spin:${mode}:${plantId}:${commitment.toLowerCase()}`
    : `spin:${mode}:${plantId}`;

  return (
    <GameTransaction
      successFeedback="feature"
      effects={{ domains: ["arcade", "balances"] }}
      calls={calls}
      intentKey={intentKey}
      buttonText={buttonText ?? defaultText}
      buttonClassName={buttonClassName}
      disabled={finalDisabled}
      feedbackMode={feedbackMode}
      onStatusUpdate={handleStatus}
      onButtonClick={preflight}
    />
  );
}
