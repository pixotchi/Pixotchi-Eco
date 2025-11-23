"use client";

import React from 'react';
import SponsoredTransaction from './sponsored-transaction';
import { PIXOTCHI_TOKEN_ADDRESS } from '@/lib/contracts';

const PIXOTCHI_TOKEN_ABI = [
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

interface ApproveTransactionProps {
  spenderAddress: `0x${string}`;
  tokenAddress?: `0x${string}`;
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export default function ApproveTransaction({
  spenderAddress,
  tokenAddress,
  onSuccess,
  onError,
  buttonText = "Approve SEED",
  buttonClassName,
  disabled = false
}: ApproveTransactionProps) {
  
  // Max approval amount
  const maxApproval = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');

  const approvalToken = tokenAddress ?? PIXOTCHI_TOKEN_ADDRESS;
  
  const calls = [{
    address: approvalToken,
    abi: PIXOTCHI_TOKEN_ABI,
    functionName: 'approve',
    args: [spenderAddress, maxApproval], 
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