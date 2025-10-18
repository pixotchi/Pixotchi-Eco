"use client";

import React from 'react';
import SponsoredTransaction from './sponsored-transaction';
import { LEAF_CONTRACT_ADDRESS, LAND_CONTRACT_ADDRESS } from '@/lib/constants';

const LEAF_TOKEN_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

interface LeafApproveTransactionProps {
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export default function LeafApproveTransaction({
  onSuccess,
  onError,
  buttonText = "Approve LEAF",
  buttonClassName,
  disabled = false
}: LeafApproveTransactionProps) {
  
  // Max approval amount
  const maxApproval = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');
  
  const calls = [{
    address: LEAF_CONTRACT_ADDRESS,
    abi: LEAF_TOKEN_ABI,
    functionName: 'approve',
    args: [LAND_CONTRACT_ADDRESS, maxApproval], 
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