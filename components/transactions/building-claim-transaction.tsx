"use client";

import React from "react";
import SponsoredTransaction from "./sponsored-transaction";
import { landAbi } from "@/public/abi/pixotchi-v3-abi";
import { LAND_CONTRACT_ADDRESS } from "@/lib/contracts";

interface BuildingClaimTransactionProps {
  landId: bigint;
  buildingId: number;
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export default function BuildingClaimTransaction({
  landId,
  buildingId,
  onSuccess,
  onError,
  buttonText = "Collect",
  buttonClassName = "h-9 px-3 text-sm",
  disabled = false,
}: BuildingClaimTransactionProps) {
  const calls = [
    {
      address: LAND_CONTRACT_ADDRESS,
      abi: landAbi,
      functionName: "villageClaimProduction",
      args: [landId, buildingId],
    },
  ];

  return (
    <SponsoredTransaction
      calls={calls}
      onSuccess={onSuccess}
      onError={onError}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      hideStatus={true}
      disabled={disabled}
    />
  );
}


