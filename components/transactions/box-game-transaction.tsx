"use client";

import React from 'react';
import SponsoredTransaction from './sponsored-transaction';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import PixotchiNFT from '@/public/abi/PixotchiNFT.json';
import { decodeEventLog } from 'viem';
import { toast } from 'react-hot-toast';
import { formatDuration, formatScore } from '@/lib/utils';

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
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  showToast?: boolean;
  onStatusUpdate?: (status: any) => void;
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
  showToast = true,
  onStatusUpdate,
}: BoxGameTransactionProps) {
  const functionName = withStar ? 'boxGamePlayWithStar' : 'boxGamePlay';
  const calls = [{
    address: PIXOTCHI_NFT_ADDRESS,
    abi: BOX_GAME_ABI,
    functionName,
    args: [BigInt(plantId), BigInt(seed)],
  }];

  return (
    <SponsoredTransaction
      calls={calls as any}
      onSuccess={onSuccess}
      onError={onError}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      disabled={disabled}
      showToast={showToast}
      onStatusUpdate={(status: any) => {
        try { onStatusUpdate?.(status); } catch {}
        if (status?.statusName === 'success') {
          try {
            const receipts: any[] = (status?.statusData?.transactionReceipts as any[]) || [];
            const abi = (PixotchiNFT as any).abi || PixotchiNFT;
            let shown = false;
            for (const r of receipts) {
              const logs = r?.logs || [];
              for (const log of logs) {
                try {
                  const decoded: any = decodeEventLog({ abi, data: log.data as `0x${string}`, topics: log.topics as any });
                  if (decoded.eventName === 'Played' || decoded.eventName === 'PlayedV2') {
                    const rawPoints = Number(decoded.args.points ?? decoded.args.pointsAdjustment ?? 0);
                    const rawTime = Number(decoded.args.timeExtension ?? decoded.args.timeAdjustment ?? 0);
                    const ptsText = formatScore(rawPoints);
                    const timeText = rawTime !== 0 ? `${rawTime > 0 ? '+' : '-'}${formatDuration(Math.abs(rawTime))} TOD` : '';
                    const msg = timeText ? `You got +${ptsText} PTS and ${timeText}` : `You got +${ptsText} PTS`;
                    toast.success(msg, { id: 'box-result' });
                    shown = true;
                    break;
                  }
                } catch {}
              }
              if (shown) break;
            }
            if (!shown) toast.success('Play confirmed!', { id: 'box-result' });
          } catch {
            toast.success('Play confirmed!', { id: 'box-result' });
          }
        }
      }}
    />
  );
}


