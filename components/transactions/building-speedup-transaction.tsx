"use client";

import { formatTokenAmount } from '@/lib/utils';
import { toast } from 'react-hot-toast';
import { useAccount } from 'wagmi';
import SponsoredTransaction from './sponsored-transaction';
import { LAND_CONTRACT_ADDRESS } from '@/lib/contracts';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';
import { BuildingData } from '@/lib/types';

interface BuildingSpeedUpTransactionProps {
  building: BuildingData;
  landId: bigint;
  buildingType: 'village' | 'town';
  onSuccess?: (tx: any) => void;
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
  buttonText = "Speed Up with PIXOTCHI",
  buttonClassName = "",
  disabled = false
}: BuildingSpeedUpTransactionProps) {
  
  // Note: Contract logic changed to use PIXOTCHI (Creator Token) instead of SEED
  // The function names in the contract might still be `*SpeedUpWithSeed` if the ABI wasn't renamed,
  // but the logic inside consumes PIXOTCHI.
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