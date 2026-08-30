"use client";

import React, { useMemo } from 'react';
import { useAccount } from 'wagmi';
import SmartWalletTransaction from './smart-wallet-transaction';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import { buildSwapAndApproveCalls, useSwapDeadline } from "@/lib/swap/bundle-calls";
import type { ShopItem, GardenItem, Plant } from '@/lib/types';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { postMissionProgress } from '@/lib/mission-tracking';

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

interface SwapBuyItemBundleProps {
    item: ShopItem | GardenItem;
    plant: Plant;
    itemType: 'shop' | 'garden';
    quantity: number;
    ethAmount: bigint; // ETH amount with buffer already applied
    minSeedOut: bigint; // Minimum SEED to receive (total cost, acts as slippage protection)
    onSuccess?: (tx: UntypedValue) => void;
    onError?: (error: UntypedValue) => void;
    buttonText?: string;
    buttonClassName?: string;
    disabled?: boolean;
}

/**
 * SwapBuyItemBundle - Atomic batch transaction for ETH mode item purchases
 * 
 * Executes calls in a single transaction:
 * 1. swapExactETHForTokens - Swap ETH → SEED via BaseSwap
 * 2. approve - Approve SEED spending by NFT contract
 * 3-N. shopBuyItem / buyAccessory - Purchase item(s)
 * 
 * Supports single items and bundles (quantity > 1).
 * Requires smart wallet with EIP-5792 support for atomic batching.
 */
export default function SwapBuyItemBundle({
    item,
    plant,
    itemType,
    quantity,
    ethAmount,
    minSeedOut,
    onSuccess,
    onError,
    buttonText,
    buttonClassName = 'w-full',
    disabled = false,
}: SwapBuyItemBundleProps) {
    const { address } = useAccount();

    const hasQuote = Boolean(address) && ethAmount > BigInt(0) && minSeedOut > BigInt(0);
    const deadline = useSwapDeadline(hasQuote);

    // Build the batch calls
    const calls = useMemo(() => {
        if (!address || !hasQuote || quantity <= 0) {
            return [];
        }

        const functionName = itemType === 'shop' ? 'shopBuyItem' : 'buyAccessory';

        const callList: UntypedValue[] = [
            ...buildSwapAndApproveCalls({
                address,
                deadline,
                ethAmount,
                minSeedOut,
                spender: PIXOTCHI_NFT_ADDRESS,
            }),
        ];

        // Call 3-N: Purchase item(s)
        for (let i = 0; i < quantity; i++) {
            callList.push({
                address: PIXOTCHI_NFT_ADDRESS as `0x${string}`,
                abi: PIXOTCHI_NFT_ABI,
                functionName,
                args: [BigInt(plant.id), BigInt(item.id)],
            });
        }

        return callList;
    }, [address, deadline, ethAmount, hasQuote, minSeedOut, quantity, item.id, plant.id, itemType]);

    // Minimum 3 calls: swap + approve + at least 1 buy
    const isValid = calls.length >= 3;

    const defaultButtonText = quantity === 1
        ? `Buy ${item.name} with ETH`
        : `Buy ${quantity}x ${item.name} with ETH`;

    const handleSuccess = (tx: UntypedValue) => {
        // Track gamification for garden items
        if (address && itemType === 'garden') {
            const post = async (currentTx: UntypedValue, attempt = 0) => {
                try {
                    const payload: Record<string, UntypedValue> = {
                        address,
                        taskId: 's4_buy10_elements',
                        count: quantity,
                    };
                    const txHash = extractTransactionHash(currentTx);
                    if (txHash) {
                        payload.proof = { txHash };
                    }
                    const res = await postMissionProgress(payload);
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
        onSuccess?.(tx);
    };

    return (
        <SmartWalletTransaction
            calls={calls}
            intentKey={`swap:purchase:${itemType}:${plant.id}:${item.id}:${quantity}`}
            onSuccess={handleSuccess}
            onError={onError}
            buttonText={buttonText || defaultButtonText}
            buttonClassName={buttonClassName}
            disabled={disabled || !isValid}
            showToast={true}
        />
    );
}
