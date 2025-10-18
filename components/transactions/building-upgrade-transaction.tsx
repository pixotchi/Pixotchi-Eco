"use client";

import React from "react";
import SponsoredTransaction from "./sponsored-transaction";
import { BuildingData, BuildingType } from "@/lib/types";
import { landAbi } from "../../public/abi/pixotchi-v3-abi";
import { LAND_CONTRACT_ADDRESS } from '@/lib/constants';

interface BuildingUpgradeTransactionProps {
  building: BuildingData;
  landId: bigint;
  buildingType: BuildingType;
  onSuccess?: () => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export default function BuildingUpgradeTransaction({
  building,
  landId,
  buildingType,
  onSuccess,
  onError,
  buttonText = "Upgrade with LEAF",
  buttonClassName = "",
  disabled = false
}: BuildingUpgradeTransactionProps) {
  
  const functionName = buildingType === 'village' ? 'villageUpgradeWithLeaf' : 'townUpgradeWithLeaf';
  
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
      disabled={disabled || building.level >= building.maxLevel}
    />
  );
} 