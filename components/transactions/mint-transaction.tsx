"use client";

import React from 'react';
import SponsoredTransaction from './sponsored-transaction';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';

const PIXOTCHI_NFT_ABI = [
  {
    inputs: [{ name: 'strain', type: 'uint256' }],
    name: 'mint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

interface MintTransactionProps {
  strain: number;
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export default function MintTransaction({
  strain,
  onSuccess,
  onError,
  buttonText = "Mint Plant",
  buttonClassName,
  disabled = false
}: MintTransactionProps) {
  
  const calls = [{
    address: PIXOTCHI_NFT_ADDRESS as `0x${string}`,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'mint',
    args: [BigInt(strain)], 
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