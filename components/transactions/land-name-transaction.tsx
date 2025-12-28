"use client";

import React from 'react';
import SponsoredTransaction from './sponsored-transaction';
import { landAbi } from '@/public/abi/pixotchi-v3-abi';
import { LAND_CONTRACT_ADDRESS } from '@/lib/contracts';

interface LandNameTransactionProps {
  landId: bigint;
  newName: string;
  onSuccess?: (data: any) => void;
  onError?: (error: Error) => void;
  disabled?: boolean;
  buttonText?: string;
  buttonClassName?: string;
  onButtonClick?: () => void;
}

export function LandNameTransaction({
  landId,
  newName,
  onSuccess,
  onError,
  disabled = false,
  buttonText = "Confirm Transaction",
  buttonClassName = "",
  onButtonClick
}: LandNameTransactionProps) {

  const calls = [{
    address: LAND_CONTRACT_ADDRESS,
    abi: landAbi,
    functionName: 'landSetName',
    args: [landId, newName],
  }];

  return (
    <SponsoredTransaction
      calls={calls}
      onSuccess={onSuccess}
      onError={onError}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      disabled={disabled}
      onButtonClick={onButtonClick}
    />
  );
}


