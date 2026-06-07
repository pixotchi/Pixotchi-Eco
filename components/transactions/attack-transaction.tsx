"use client";

import React from 'react';
import SponsoredTransaction from './sponsored-transaction';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import type { TransactionFeedbackMode } from './transaction-kit';

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
  onSuccess?: (tx: UntypedValue) => void;
  onError?: (error: UntypedValue) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  feedbackMode?: TransactionFeedbackMode;
  showToast?: boolean;
  onStatusUpdate?: (status: UntypedValue) => void;
}

export default function AttackTransaction({
  attackerId,
  targetId,
  onSuccess,
  onError,
  buttonText = "Attack",
  buttonClassName,
  disabled = false,
  feedbackMode,
  showToast = true,
  onStatusUpdate,
}: AttackTransactionProps) {
  const calls = [{
    address: PIXOTCHI_NFT_ADDRESS,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'attack',
    args: [BigInt(attackerId), BigInt(targetId)],
  }];

  return (
    <SponsoredTransaction
      calls={calls}
      onSuccess={(tx) => {
        onSuccess?.(tx);
      }}
      onError={onError}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      disabled={disabled}
      feedbackMode={feedbackMode}
      showToast={showToast}
      onStatusUpdate={onStatusUpdate}
    />
  );
}
