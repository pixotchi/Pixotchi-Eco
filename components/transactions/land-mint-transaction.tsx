"use client";

import React from 'react';
import SponsoredTransaction from './sponsored-transaction';
import { landAbi as LAND_ABI } from '@/public/abi/pixotchi-v3-abi';
import { LAND_CONTRACT_ADDRESS } from '@/lib/contracts';

interface LandMintTransactionProps {
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export default function LandMintTransaction({
  onSuccess,
  onError,
  buttonText = "Mint Land",
  buttonClassName,
  disabled = false
}: LandMintTransactionProps) {
  
  const calls = [{
    address: LAND_CONTRACT_ADDRESS,
    abi: LAND_ABI,
    functionName: 'mint',
    args: [], 
  }];

  return (
    <SponsoredTransaction
      calls={calls}
      onSuccess={onSuccess}
      onError={onError}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      disabled={disabled}
    />
  );
} 