"use client";

import React from 'react';
import SponsoredTransaction from './sponsored-transaction';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';

const PIXOTCHI_NFT_ABI = [
  {
    inputs: [
      { name: 'plantId', type: 'uint256' },
      { name: 'itemId', type: 'uint256' }
    ],
    name: 'shopBuyItem',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'plantId', type: 'uint256' },
      { name: 'itemId', type: 'uint256' }
    ],
    name: 'buyAccessory',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

interface BuyShopItemTransactionProps {
  plantId: number;
  itemId: string;
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export function BuyShopItemTransaction({
  plantId,
  itemId,
  onSuccess,
  onError,
  buttonText = "Buy Item",
  buttonClassName,
  disabled = false
}: BuyShopItemTransactionProps) {
  
  const calls = [{
    address: PIXOTCHI_NFT_ADDRESS,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'shopBuyItem',
    args: [BigInt(plantId), BigInt(itemId)], 
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

interface BuyGardenItemTransactionProps {
  plantId: number;
  itemId: string;
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export function BuyGardenItemTransaction({
  plantId,
  itemId,
  onSuccess,
  onError,
  buttonText = "Buy Item",
  buttonClassName,
  disabled = false
}: BuyGardenItemTransactionProps) {
  
  const calls = [{
    address: PIXOTCHI_NFT_ADDRESS,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'buyAccessory',
    args: [BigInt(plantId), BigInt(itemId)], 
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