"use client";

import React from 'react';
import SponsoredTransaction from './sponsored-transaction';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import PixotchiNFT from '@/public/abi/PixotchiNFT.json';
import { decodeEventLog } from 'viem';
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
  onSuccess?: (tx: UntypedValue) => void;
  onError?: (error: UntypedValue) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  feedbackMode?: TransactionFeedbackMode;
  showToast?: boolean;
  onStatusUpdate?: (status: UntypedValue) => void;
  onResult?: (result: { pointsDelta: number; timeAdded: number }) => void;
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

  const handleSuccess = (tx: UntypedValue) => {
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
    <SponsoredTransaction
      calls={calls as UntypedValue}
      onSuccess={handleSuccess}
      onError={onError}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      disabled={disabled}
      feedbackMode={feedbackMode}
      showToast={showToast}
      onStatusUpdate={(status: UntypedValue) => {
        try { onStatusUpdate?.(status); } catch {}
        if (status?.statusName === 'success') {
          try {
            const receipts: UntypedValue[] = (status?.statusData?.transactionReceipts as UntypedValue[]) || [];
            const abi = (PixotchiNFT as UntypedValue).abi || PixotchiNFT;
            let shown = false;
            for (const r of receipts) {
              const logs = r?.logs || [];
              for (const log of logs) {
                try {
                  const decoded: UntypedValue = decodeEventLog({ abi, data: log.data as `0x${string}`, topics: log.topics as UntypedValue });
                  if (decoded.eventName === 'Played' || decoded.eventName === 'PlayedV2') {
                    const rawPoints = Number(decoded.args.points ?? decoded.args.pointsAdjustment ?? 0);
                    const rawTime = Number(decoded.args.timeExtension ?? decoded.args.timeAdjustment ?? 0);
                    onResult?.({ pointsDelta: rawPoints, timeAdded: rawTime });
                    const ptsText = formatScore(rawPoints);
                    const timeText = rawTime !== 0 ? `${rawTime > 0 ? '+' : '-'}${formatDuration(Math.abs(rawTime))} TOD` : '';
                    const msg = timeText ? `You got +${ptsText} PTS and ${timeText}` : `You got +${ptsText} PTS`;
                    if (!onResult) {
                      toast.success(msg, { id: 'box-result' });
                    }
                    shown = true;
                    break;
                  }
                } catch {}
              }
              if (shown) break;
            }
            if (!shown) {
              onResult?.({ pointsDelta: 0, timeAdded: 0 });
              if (!onResult) toast.success('Play confirmed!', { id: 'box-result' });
            }
          } catch {
            onResult?.({ pointsDelta: 0, timeAdded: 0 });
            if (!onResult) toast.success('Play confirmed!', { id: 'box-result' });
          }
        }
      }}
    />
  );
}
