"use client";

import React, { useMemo } from 'react';
import SmartWalletTransaction from './smart-wallet-transaction';
import EthPaymentTransaction from './eth-payment-transaction';
import { useAccount } from 'wagmi';
import { ShopItem, GardenItem, Plant } from '@/lib/types';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { useEthMode } from '@/lib/eth-mode-context';
import { useEthQuote } from '@/components/eth-quote-display';
import { parseUnits } from 'viem';

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
  const { isEthModeEnabled, canUseEthMode } = useEthMode();

  // Calculate total SEED cost for ETH quote (price * quantity)
  const itemPriceWei = useMemo(() => {
    // Item price is in SEED (18 decimals)
    const priceNum = typeof item.price === 'bigint'
      ? item.price
      : BigInt(item.price?.toString() || '0');
    return priceNum;
  }, [item.price]);

  const totalSeedCost = itemPriceWei * BigInt(quantity);

  // Get ETH quote for the total cost
  const { quote, isLoading: isQuoteLoading } = useEthQuote(itemPriceWei, quantity);

  // Generate multiple calls for bundle transaction
  const generateBundleCalls = () => {
    const calls = [];
    const functionName = itemType === 'shop' ? 'shopBuyItem' : 'buyAccessory';

    for (let i = 0; i < quantity; i++) {
      calls.push({
        address: PIXOTCHI_NFT_ADDRESS as `0x${string}`,
        abi: PIXOTCHI_NFT_ABI,
        functionName,
        args: [BigInt(plant.id), BigInt(item.id)],
      });
    }

    return calls;
  };

  const handleSuccess = (tx: any) => {
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
    } catch { }
    onSuccess?.(tx);
  };

  // Build button text with ETH or SEED price
  const buttonText = useMemo(() => {
    const itemName = quantity === 1
      ? `Buy ${item.name}`
      : `Buy ${quantity}x ${item.name}`;

    // If ETH Mode enabled and we have a quote, show ETH price
    if (isEthModeEnabled && canUseEthMode && quote) {
      return `${itemName} (${quote.ethAmountFormatted} ETH)`;
    }

    // Otherwise show as bundle if quantity > 1
    return quantity === 1 ? itemName : `${itemName} (Bundle)`;
  }, [quantity, item.name, isEthModeEnabled, canUseEthMode, quote]);

  // Use ETH Payment when ETH Mode is enabled
  if (isEthModeEnabled && canUseEthMode) {
    return (
      <EthPaymentTransaction
        actionCalls={generateBundleCalls()}
        seedAmountRequired={totalSeedCost}
        onSuccess={handleSuccess}
        onError={onError}
        buttonText={buttonText}
        buttonClassName="w-full"
        disabled={disabled || isQuoteLoading}
      />
    );
  }

  // Default: use SmartWalletTransaction with SEED payment
  return (
    <SmartWalletTransaction
      calls={generateBundleCalls()}
      onSuccess={handleSuccess}
      onError={onError}
      buttonText={buttonText}
      buttonClassName="w-full"
      disabled={disabled}
      showToast={true}
    />
  );
} 