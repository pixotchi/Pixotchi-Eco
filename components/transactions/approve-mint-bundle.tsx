"use client";

import React from 'react';
import SmartWalletTransaction from './smart-wallet-transaction';
import { PIXOTCHI_TOKEN_ADDRESS, PIXOTCHI_NFT_ADDRESS } from '@/lib/constants';

const ERC20_ABI = [
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

const NFT_ABI = [
  {
    inputs: [{ name: 'strain', type: 'uint256' }],
    name: 'mint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

export default function ApproveMintBundle({
  strain,
  onSuccess,
  onTransactionComplete,
  onError,
  buttonText = 'Approve + Mint',
  buttonClassName = 'w-full',
  disabled = false,
}: {
  strain: number;
  onSuccess?: (tx: any) => void;
  onTransactionComplete?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
}) {
  // Unlimited approval followed by mint call
  const maxApproval = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');

  const calls = [
    {
      address: PIXOTCHI_TOKEN_ADDRESS,
      abi: ERC20_ABI,
      functionName: 'approve',
      args: [PIXOTCHI_NFT_ADDRESS, maxApproval],
    },
    {
      address: PIXOTCHI_NFT_ADDRESS,
      abi: NFT_ABI,
      functionName: 'mint',
      args: [BigInt(strain)],
    },
  ];

  return (
    <SmartWalletTransaction
      calls={calls}
      onSuccess={(tx) => {
        onSuccess?.(tx);
        onTransactionComplete?.(tx);
      }}
      onError={onError}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      disabled={disabled}
      showToast={true}
    />
  );
}


