"use client";

import React from "react";
import SponsoredTransaction from "./sponsored-transaction";
import { PIXOTCHI_NFT_ADDRESS } from "@/lib/contracts";
import { useAccount } from "wagmi";
import { extractTransactionHash } from '@/lib/transaction-utils';
import { postMissionProgress } from '@/lib/mission-tracking';
import type { TransactionFeedbackMode } from "./transaction-kit";

const PIXOTCHI_NFT_ABI = [
  {
    inputs: [
      { name: "_deadId", type: "uint256" },
      { name: "_tokenId", type: "uint256" },
    ],
    name: "kill",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

interface KillTransactionProps {
  deadId: number; // target dead plant id
  tokenId: number; // your alive plant id
  onSuccess?: (tx: UntypedValue) => void;
  onError?: (error: UntypedValue) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  feedbackMode?: TransactionFeedbackMode;
  showToast?: boolean;
  onStatusUpdate?: (status: UntypedValue) => void;
}

export default function KillTransaction({
  deadId,
  tokenId,
  onSuccess,
  onError,
  buttonText = "Confirm Kill",
  buttonClassName,
  disabled = false,
  feedbackMode,
  showToast = true,
  onStatusUpdate,
}: KillTransactionProps) {
  const { address } = useAccount();
  const calls = [
    {
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: "kill",
      args: [BigInt(deadId), BigInt(tokenId)],
    },
  ];

  const handleSuccess = (tx: UntypedValue) => {
    const txHash = extractTransactionHash(tx);
    if (address && txHash) {
      try {
        postMissionProgress({
          address,
          taskId: 's4_collect_star',
          proof: { txHash },
        }).catch((err) => console.warn('Gamification tracking failed (non-critical):', err));
      } catch (error) {
        console.warn('Failed to dispatch gamification mission (collect star):', error);
      }
    }
    onSuccess?.(tx);
  };

  return (
    <SponsoredTransaction
      calls={calls}
      onSuccess={handleSuccess}
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
