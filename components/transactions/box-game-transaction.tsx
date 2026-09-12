"use client";

import { getBoxResult, type BoxResult } from "@/lib/box-result";
import type { LifecycleStatus, TransactionProof } from "./transaction-kit";
import React, { useRef } from 'react';
import GameTransaction from './game-transaction';
import { BOX_GAME_ABI, PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import { toast } from 'react-hot-toast';
import { formatDuration, formatScore } from '@/lib/utils';
import { useAccount } from 'wagmi';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { postMissionProgress } from '@/lib/mission-tracking';
import type { TransactionFeedbackMode } from './transaction-kit';

interface BoxGameTransactionProps {
  plantId: number;
  seed: number;
  withStar: boolean;
  onSuccess?: (tx: TransactionProof) => void;
  onError?: (error: unknown) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  feedbackMode?: TransactionFeedbackMode;
  showToast?: boolean;
  onStatusUpdate?: (status: LifecycleStatus) => void;
  onResult?: (result: BoxResult | null) => void;
}

export default function BoxGameTransaction({
  plantId,
  seed,
  withStar,
  onSuccess,
  onError,
  buttonText = 'Play',
  buttonClassName,
  disabled = false,
  feedbackMode,
  showToast = true,
  onStatusUpdate,
  onResult,
}: BoxGameTransactionProps) {
  const { address } = useAccount();
  const handledResultRef = useRef<string | null>(null);
  const functionName = withStar ? 'boxGamePlayWithStar' : 'boxGamePlay';
  const calls = [{
    address: PIXOTCHI_NFT_ADDRESS,
    abi: BOX_GAME_ABI,
    functionName,
    args: [BigInt(plantId), BigInt(seed)],
  }];

  const handleSuccess = (tx: TransactionProof) => {
    const txHash = extractTransactionHash(tx);
    if (address && txHash) {
      try {
        postMissionProgress({
          address,
          taskId: 's4_play_arcade',
          proof: { txHash },
        }).catch((err) => console.warn('Gamification tracking failed (non-critical):', err));
      } catch (error) {
        console.warn('Failed to dispatch gamification mission (arcade):', error);
      }
    }
    onSuccess?.(tx);
  };

  return (
    <GameTransaction
      successFeedback="feature"
      effects={{ domains: ["arcade", "balances"] }}
      intentKey={`box:${plantId}`}
      calls={calls}
      onSuccess={handleSuccess}
      onError={onError}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      disabled={disabled}
      feedbackMode={feedbackMode}
      showToast={showToast}
      onStatusUpdate={(status: LifecycleStatus) => {
        try { onStatusUpdate?.(status); } catch {}
        if (status.statusName === 'buildingTransaction') handledResultRef.current = null;
        if (status.statusName === 'success') {
          const proof = extractTransactionHash(status.statusData)
            ?? status.statusData.transactionReceipts.map(extractTransactionHash).find(Boolean)
            ?? status.statusData.transactionId
            ?? 'confirmed';
          if (handledResultRef.current === proof) return;
          handledResultRef.current = proof;
          const result = getBoxResult(status.statusData.transactionReceipts, plantId, PIXOTCHI_NFT_ADDRESS);

          // The persistent result can be below the fold. Its callback must not
          // suppress the visible notification or turn a loss into a success.
          if (showToast && feedbackMode !== 'inline' && feedbackMode !== 'none') {
            const options = { id: 'box-result', duration: 6000 };
            if (!result) {
              toast('Box play confirmed. The result is unavailable; check Activity.', options);
            } else {
              const parts: string[] = [];
              if (result.pointsDelta !== 0) parts.push(`${result.pointsDelta > 0 ? '+' : '−'}${formatScore(Math.abs(result.pointsDelta))} PTS`);
              if (result.timeAdded !== 0) parts.push(`${result.timeAdded > 0 ? '+' : '−'}${formatDuration(Math.abs(result.timeAdded))} lifetime`);
              const message = parts.length ? `Box result: ${parts.join(' • ')}` : 'Box result: no reward this time.';
              const gainedOnly = (result.pointsDelta > 0 || result.timeAdded > 0) && result.pointsDelta >= 0 && result.timeAdded >= 0;
              (gainedOnly ? toast.success : toast)(message, options);
            }
          }
          onResult?.(result);
        }
      }}
    />
  );
}
