"use client";

import React from "react";
import SponsoredTransaction from "./sponsored-transaction";
import { BuildingData, BuildingType } from "@/lib/types";
import { landAbi } from "../../public/abi/pixotchi-v3-abi";
import { LAND_CONTRACT_ADDRESS } from '@/lib/contracts';

interface BuildingSpeedUpTransactionProps {
  building: BuildingData;
  landId: bigint;
  buildingType: BuildingType;
  onSuccess?: () => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export default function BuildingSpeedUpTransaction({
  building,
  landId,
  buildingType,
  onSuccess,
  onError,
  buttonText = "Speed Up with SEED",
  buttonClassName = "",
  disabled = false
}: BuildingSpeedUpTransactionProps) {
  
  const functionName = buildingType === 'village' ? 'villageSpeedUpWithSeed' : 'townSpeedUpWithSeed';
  
  const calls = [{
    address: LAND_CONTRACT_ADDRESS,
    abi: landAbi,
    functionName,
    args: [landId, building.id],
  }];

  return (
    <SponsoredTransaction
      calls={calls}
      onSuccess={onSuccess}
      onError={onError}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      disabled={disabled || !building.isUpgrading}
    />
  );
} 