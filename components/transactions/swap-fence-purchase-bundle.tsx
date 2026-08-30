"use client";

import React, { useMemo } from 'react';
import { useAccount } from 'wagmi';
import SmartWalletTransaction from './smart-wallet-transaction';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import { buildSwapAndApproveCalls, useSwapDeadline } from "@/lib/swap/bundle-calls";
import { extractTransactionHash } from '@/lib/transaction-utils';
import { postMissionProgress } from '@/lib/mission-tracking';

const FENCE_V2_ABI = [
    {
        inputs: [
            { name: 'plantId', type: 'uint256' },
            { name: 'durationDays', type: 'uint256' }
        ],
        name: 'fenceV2Purchase',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
] as const;

interface SwapFencePurchaseBundleProps {
    plantId: number;
    days: number;
    ethAmount: bigint; // ETH amount with buffer already applied
    minSeedOut: bigint; // Minimum SEED to receive (fence quote, acts as slippage protection)
    onSuccess?: (tx: UntypedValue) => void;
    onError?: (error: UntypedValue) => void;
    buttonText?: string;
    buttonClassName?: string;
    disabled?: boolean;
}

/**
 * SwapFencePurchaseBundle - Atomic batch transaction for ETH mode fence purchases
 * 
 * Executes calls in a single transaction:
 * 1. swapExactETHForTokens - Swap ETH → SEED via BaseSwap
 * 2. approve - Approve SEED spending by NFT contract
 * 3. fenceV2Purchase - Purchase fence protection
 * 
 * Requires smart wallet with EIP-5792 support for atomic batching.
 */
export default function SwapFencePurchaseBundle({
    plantId,
    days,
    ethAmount,
    minSeedOut,
    onSuccess,
    onError,
    buttonText,
    buttonClassName = 'w-full',
    disabled = false,
}: SwapFencePurchaseBundleProps) {
    const { address } = useAccount();

    const hasQuote = Boolean(address) && ethAmount > BigInt(0) && minSeedOut > BigInt(0);
    const deadline = useSwapDeadline(hasQuote);

    // Build the batch calls
    const calls = useMemo(() => {
        if (!address || !hasQuote || days <= 0) {
            return [];
        }

        return [
            ...buildSwapAndApproveCalls({
                address,
                deadline,
                ethAmount,
                minSeedOut,
                spender: PIXOTCHI_NFT_ADDRESS,
            }),
            // Call 3: Purchase fence protection
            {
                address: PIXOTCHI_NFT_ADDRESS as `0x${string}`,
                abi: FENCE_V2_ABI,
                functionName: 'fenceV2Purchase' as const,
                args: [BigInt(plantId), BigInt(days)],
            },
        ];
    }, [address, deadline, ethAmount, hasQuote, minSeedOut, plantId, days]);

    const isValid = calls.length === 3;
    const defaultButtonText = `Buy ${days} Day${days === 1 ? '' : 's'} Fence with ETH`;

    const handleSuccess = (tx: UntypedValue) => {
        // Track gamification for fence purchases
        if (address) {
            const post = async (currentTx: UntypedValue, attempt = 0) => {
                try {
                    const payload: Record<string, UntypedValue> = {
                        address,
                        taskId: 's4_buy_shield',
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
            intentKey={`swap:fence:${plantId}:${days}`}
            onSuccess={handleSuccess}
            onError={onError}
            buttonText={buttonText || defaultButtonText}
            buttonClassName={buttonClassName}
            disabled={disabled || !isValid}
            showToast={true}
        />
    );
}
