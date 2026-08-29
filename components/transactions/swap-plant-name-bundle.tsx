"use client";

import React, { useMemo } from 'react';
import { useAccount } from 'wagmi';
import SmartWalletTransaction from './smart-wallet-transaction';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import { buildSwapAndApproveCalls, useSwapDeadline } from "@/lib/swap/bundle-calls";

const PIXOTCHI_NFT_ABI = [
    {
        inputs: [
            { name: '_id', type: 'uint256' },
            { name: '_name', type: 'string' }
        ],
        name: 'setPlantName',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
] as const;

interface SwapPlantNameBundleProps {
    plantId: number;
    newName: string;
    ethAmount: bigint; // ETH amount with buffer already applied
    minSeedOut: bigint; // Minimum SEED to receive (350 SEED for name change)
    onSuccess?: (tx: UntypedValue) => void;
    onError?: (error: UntypedValue) => void;
    buttonText?: string;
    buttonClassName?: string;
    disabled?: boolean;
}

/**
 * SwapPlantNameBundle - Atomic batch transaction for ETH mode plant name change
 * 
 * Executes calls in a single transaction:
 * 1. swapExactETHForTokens - Swap ETH → SEED via BaseSwap
 * 2. approve - Approve SEED spending by NFT contract
 * 3. setPlantName - Change plant name
 * 
 * Requires smart wallet with EIP-5792 support for atomic batching.
 */
export default function SwapPlantNameBundle({
    plantId,
    newName,
    ethAmount,
    minSeedOut,
    onSuccess,
    onError,
    buttonText = 'Change Name with ETH',
    buttonClassName = 'w-full',
    disabled = false,
}: SwapPlantNameBundleProps) {
    const { address } = useAccount();

    const hasQuote = Boolean(address) && ethAmount > BigInt(0) && minSeedOut > BigInt(0);
    const deadline = useSwapDeadline(hasQuote);

    // Build the batch calls
    const calls = useMemo(() => {
        if (!address || !hasQuote || !newName.trim()) {
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
            // Call 3: Change plant name
            {
                address: PIXOTCHI_NFT_ADDRESS as `0x${string}`,
                abi: PIXOTCHI_NFT_ABI,
                functionName: 'setPlantName' as const,
                args: [BigInt(plantId), newName.trim()],
            },
        ];
    }, [address, deadline, ethAmount, hasQuote, minSeedOut, plantId, newName]);

    const isValid = calls.length === 3;

    return (
        <SmartWalletTransaction
            calls={calls}
            onSuccess={onSuccess}
            onError={onError}
            buttonText={buttonText}
            buttonClassName={buttonClassName}
            disabled={disabled || !isValid}
            showToast={true}
        />
    );
}
