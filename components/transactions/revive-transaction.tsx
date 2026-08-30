"use client";

import React from "react";
import SponsoredTransaction from "./sponsored-transaction";
import { PIXOTCHI_NFT_ADDRESS } from "@/lib/contracts";

const PIXOTCHI_NFT_ABI = [
  {
    inputs: [{ name: "_Id", type: "uint256" }],
    name: "Revive",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

interface ReviveTransactionProps {
  plantId: number;
  onSuccess?: (tx: UntypedValue) => void;
  onError?: (error: UntypedValue) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  showToast?: boolean;
  onStatusUpdate?: (status: UntypedValue) => void;
}

export default function ReviveTransaction({
  plantId,
  onSuccess,
  onError,
  buttonText = "Revive",
  buttonClassName,
  disabled = false,
  showToast = true,
  onStatusUpdate,
}: ReviveTransactionProps) {
  const calls = [
    {
      address: PIXOTCHI_NFT_ADDRESS,
      abi: PIXOTCHI_NFT_ABI,
      functionName: "Revive",
      args: [BigInt(plantId)],
    },
  ];

  return (
    <SponsoredTransaction
      intentKey={`plant:revive:${plantId}`}
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

