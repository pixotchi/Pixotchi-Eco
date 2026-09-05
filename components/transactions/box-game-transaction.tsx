"use client";

import { getBoxResult, type BoxResult } from "@/lib/box-result";
import type { LifecycleStatus, TransactionProof } from "./transaction-kit";
import React from 'react';
import GameTransaction from './game-transaction';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import { toast } from 'react-hot-toast';
import { formatDuration, formatScore } from '@/lib/utils';
import { useAccount } from 'wagmi';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { postMissionProgress } from '@/lib/mission-tracking';
import type { TransactionFeedbackMode } from './transaction-kit';

const BOX_GAME_ABI = [
  {
    inputs: [{ name: 'nftID', type: 'uint256' }],
    name: 'boxGameGetCoolDownTimePerNFT',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'nftID', type: 'uint256' }],
    name: 'boxGameGetCoolDownTimeWithStar',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'nftID', type: 'uint256' },
      { name: 'seed', type: 'uint256' },
    ],
    name: 'boxGamePlay',
    outputs: [
      { name: 'points', type: 'uint256' },
      { name: 'timeExtension', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'nftID', type: 'uint256' },
      { name: 'seed', type: 'uint256' },
    ],
    name: 'boxGamePlayWithStar',
    outputs: [
      { name: 'points', type: 'uint256' },
      { name: 'timeExtension', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

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
        if (status.statusName === 'success') {
          const result = getBoxResult(status.statusData.transactionReceipts, plantId, PIXOTCHI_NFT_ADDRESS);
          onResult?.(result);
          if (!result) {
            toast('Play confirmed. Check Activity for the reward.', { id: 'box-result' });
          } else if (!onResult) {
            const points = formatScore(Math.abs(result.pointsDelta));
            const lifetime = result.timeAdded ? ' and ' + (result.timeAdded > 0 ? '+' : '-') + formatDuration(Math.abs(result.timeAdded)) + ' lifetime' : '';
            toast.success('You got ' + (result.pointsDelta < 0 ? '-' : '+') + points + ' PTS' + lifetime, { id: 'box-result' });
          }
        }
      }}
    />
  );
}
