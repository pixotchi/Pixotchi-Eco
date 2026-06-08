"use client";

import React from 'react';
import SponsoredTransaction from './sponsored-transaction';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import type { TransactionCall } from '@/lib/types';

const PIXOTCHI_NFT_ABI = [
  {
    inputs: [{ name: 'strain', type: 'uint256' }],
    name: 'mint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export const getPlantMintCall = (strain: number): TransactionCall => ({
  address: PIXOTCHI_NFT_ADDRESS,
  abi: PIXOTCHI_NFT_ABI,
  functionName: 'mint',
  args: [BigInt(strain)],
});

interface MintTransactionProps {
  strain: number;
  onSuccess?: (tx: UntypedValue) => void;
  onError?: (error: UntypedValue) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  showToast?: boolean;
}

export default function MintTransaction({
  strain,
  onSuccess,
  onError,
  buttonText = "Mint Plant",
  buttonClassName,
  disabled = false,
  showToast = true,
}: MintTransactionProps) {

  return (
    <SponsoredTransaction
      calls={[getPlantMintCall(strain)]}
      onSuccess={onSuccess}
      onError={onError}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      disabled={disabled}
      showToast={showToast}
    />
  );
}
