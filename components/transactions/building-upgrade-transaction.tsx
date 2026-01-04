"use client";

import React from "react";
import SponsoredTransaction from "./sponsored-transaction";
import { BuildingData, BuildingType } from "@/lib/types";
import { landAbi } from "../../public/abi/pixotchi-v3-abi";
import { LAND_CONTRACT_ADDRESS } from '@/lib/contracts';

interface BuildingUpgradeTransactionProps {
  building: BuildingData;
  landId: bigint;
  buildingType: BuildingType;
  onSuccess?: () => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  functionName?: string;
}

export default function BuildingUpgradeTransaction({
  building,
  landId,
  buildingType,
  onSuccess,
  onError,
  buttonText = "Upgrade with LEAF",
  buttonClassName = "",
  disabled = false,
  functionName
}: BuildingUpgradeTransactionProps) {

  const finalFunctionName = functionName || (buildingType === 'village' ? 'villageUpgradeWithLeaf' : 'townUpgradeWithLeaf');

  // townBuildMarketPlace only takes landId, while upgrades take landId and buildingId
  const args = finalFunctionName === 'townBuildMarketPlace' ? [landId] : [landId, building.id];

  const calls = [{
    address: LAND_CONTRACT_ADDRESS,
    abi: landAbi,
    functionName: finalFunctionName,
    args: args,
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