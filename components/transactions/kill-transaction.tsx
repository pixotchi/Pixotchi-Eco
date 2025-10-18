"use client";

import React from "react";
import SponsoredTransaction from "./sponsored-transaction";
import { PIXOTCHI_NFT_ADDRESS } from "@/lib/contracts";

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
  const calls = [
    {
      address: PIXOTCHI_NFT_ADDRESS as `0x${string}`,
      abi: PIXOTCHI_NFT_ABI,
      functionName: "kill",
      args: [BigInt(deadId), BigInt(tokenId)],
    },
  ];

  return (
    <SponsoredTransaction
      calls={calls}
      onSuccess={onSuccess}
      onError={onError}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      disabled={disabled}
      showToast={showToast}
      onStatusUpdate={onStatusUpdate}
    />
  );
}


