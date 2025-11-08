"use client";

import React from "react";
import SponsoredTransaction from "./sponsored-transaction";
import { PIXOTCHI_NFT_ADDRESS } from "@/lib/contracts";
import { useAccount } from "wagmi";
import { extractTransactionHash } from '@/lib/transaction-utils';

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
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  showToast?: boolean;
  onStatusUpdate?: (status: any) => void;
}

export default function KillTransaction({
  deadId,
  tokenId,
  onSuccess,
  onError,
  buttonText = "Confirm Kill",
  buttonClassName,
  disabled = false,
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

  const handleSuccess = (tx: any) => {
    const txHash = extractTransactionHash(tx);
    if (address && txHash) {
      try {
        fetch('/api/gamification/missions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            address,
            taskId: 's4_collect_star',
            proof: { txHash },
          }),
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
      showToast={showToast}
      onStatusUpdate={onStatusUpdate}
    />
  );
}


