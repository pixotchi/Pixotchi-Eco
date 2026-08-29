"use client";

import React, { useMemo } from 'react';
import { useAccount } from 'wagmi';
import SmartWalletTransaction from './smart-wallet-transaction';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import { buildSwapAndApproveCalls, useSwapDeadline } from "@/lib/swap/bundle-calls";

const NFT_ABI = [
    {
        inputs: [{ name: 'strain', type: 'uint256' }],
        name: 'mint',
        outputs: [],
        stateMutability: 'nonpayable',
        type: 'function',
    },
] as const;

interface SwapMintBundleProps {
    strain: number;
    ethAmount: bigint; // ETH amount with 6% buffer already applied
    minSeedOut: bigint; // Minimum SEED to receive (mint price, acts as slippage protection)
    onSuccess?: (tx: UntypedValue) => void;
    onError?: (error: UntypedValue) => void;
    buttonText?: string;
    buttonClassName?: string;
    disabled?: boolean;
    showToast?: boolean;
}

/**
 * SwapMintBundle - Atomic batch transaction for ETH mode minting
 *
 * Executes 3 calls in a single transaction:
 * 1. swapExactETHForTokens - Swap ETH → SEED via BaseSwap
 * 2. approve - Approve SEED spending by NFT contract
 * 3. mint - Mint the plant
 *
 * Requires smart wallet with EIP-5792 support for atomic batching.
 */
export default function SwapMintBundle({
    strain,
    ethAmount,
    minSeedOut,
    onSuccess,
    onError,
    buttonText = 'Mint with ETH',
    buttonClassName = 'w-full',
    disabled = false,
    showToast = true,
}: SwapMintBundleProps) {
    const { address } = useAccount();

    const hasQuote = Boolean(address) && ethAmount > BigInt(0) && minSeedOut > BigInt(0);
    const deadline = useSwapDeadline(hasQuote);

    // Build the batch calls
    const calls = useMemo(() => {
        if (!address || !hasQuote) {
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
            // Call 3: Mint plant
            {
                address: PIXOTCHI_NFT_ADDRESS as `0x${string}`,
                abi: NFT_ABI,
                functionName: 'mint' as const,
                args: [BigInt(strain)],
            },
        ];
    }, [address, deadline, ethAmount, hasQuote, minSeedOut, strain]);

    const isValid = calls.length === 3;

    return (
        <SmartWalletTransaction
            calls={calls}
            onSuccess={onSuccess}
            onError={onError}
            buttonText={buttonText}
            buttonClassName={buttonClassName}
            disabled={disabled || !isValid}
            showToast={showToast}
        />
    );
}
