"use client";

import React from 'react';
import SmartWalletTransaction from './smart-wallet-transaction';
import { useAccount } from 'wagmi';
import { ShopItem, GardenItem, Plant } from '@/lib/types';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import { extractTransactionHash } from '@/lib/transaction-utils';

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

interface BundleBuyTransactionProps {
  item: ShopItem | GardenItem;
  plant: Plant;
  itemType: 'shop' | 'garden';
  quantity: number;
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  disabled?: boolean;
}

export default function BundleBuyTransaction({
  item,
  plant,
  itemType,
  quantity,
  onSuccess,
  onError,
  disabled = false
}: BundleBuyTransactionProps) {
  const { address } = useAccount();

  // Generate multiple calls for bundle transaction
  const generateBundleCalls = () => {
    const calls = [];
    const functionName = itemType === 'shop' ? 'shopBuyItem' : 'buyAccessory';
    
    for (let i = 0; i < quantity; i++) {
      calls.push({
        address: PIXOTCHI_NFT_ADDRESS,
        abi: PIXOTCHI_NFT_ABI,
        functionName,
        args: [BigInt(plant.id), BigInt(item.id)],
      });
    }
    
    // console.log('🎯 Bundle Transaction Calls Generated:', {
    //   quantity,
    //   callsCount: calls.length,
    //   functionName,
    //   plantId: plant.id,
    //   itemId: item.id,
    //   itemType,
    //   calls: calls.map((call, i) => ({ index: i, fn: call.functionName, args: call.args }))
    // });
    
    return calls;
  };

  return (
    <SmartWalletTransaction
      calls={generateBundleCalls()}
      onSuccess={(tx: any) => {
        try {
          if (address && itemType === 'garden') {
            const post = async (currentTx: any, attempt = 0) => {
              try {
                const payload: Record<string, unknown> = {
                  address,
                  taskId: 's1_buy5_elements',
                  count: quantity,
                };
                const txHash = extractTransactionHash(currentTx);
                if (txHash) {
                  payload.proof = { txHash };
                }
                const res = await fetch('/api/gamification/missions', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(payload)
                });
                if (!res.ok) throw new Error('missions post failed');
              } catch (e) {
                if (attempt < 2) {
                  const delay = 400 * Math.pow(2, attempt);
                  setTimeout(() => post(currentTx, attempt + 1), delay);
                } else {
                  console.warn('Gamification tracking failed after 3 attempts (non-critical):', e);
                }
              }
            };
            post(tx);
          }
        } catch {}
        onSuccess?.(tx);
      }}
      onError={onError}
      buttonText={
        quantity === 1 
          ? `Buy ${item.name}` 
          : `Buy ${quantity}x ${item.name} (Bundle)`
      }
      buttonClassName="w-full"
      disabled={disabled}
      showToast={true}
    />
  );
} 