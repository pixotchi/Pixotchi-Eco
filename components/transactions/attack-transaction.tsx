"use client";

import React from 'react';
import { useAccount } from 'wagmi';
import SponsoredTransaction from './sponsored-transaction';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';

const PIXOTCHI_NFT_ABI = [
  {
    inputs: [
      { name: 'fromId', type: 'uint256' },
      { name: 'toId', type: 'uint256' }
    ],
    name: 'attack',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

interface AttackTransactionProps {
  attackerId: number;
  targetId: number;
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  showToast?: boolean;
  onStatusUpdate?: (status: any) => void;
}

export default function AttackTransaction({
  attackerId,
  targetId,
  onSuccess,
  onError,
  buttonText = "Attack",
  buttonClassName,
  disabled = false,
  showToast = false,
  onStatusUpdate,
}: AttackTransactionProps) {
  const { address } = useAccount();
  const calls = [{
    address: PIXOTCHI_NFT_ADDRESS as `0x${string}`,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'attack',
    args: [BigInt(attackerId), BigInt(targetId)],
  }];

  return (
    <SponsoredTransaction
      calls={calls}
      onSuccess={(tx) => { 
        if (address) { 
          fetch('/api/gamification/missions', { 
            method: 'POST', 
            headers: { 'Content-Type': 'application/json' }, 
            body: JSON.stringify({ address, taskId: 's2_attack_plant', proof: { txHash: tx?.transactionHash } }) 
          }).catch(err => console.warn('Gamification tracking failed (non-critical):', err)); 
        }
        onSuccess?.(tx); 
      }}
      onError={onError}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      disabled={disabled}
      showToast={showToast}
      onStatusUpdate={onStatusUpdate}
    />
  );
}


