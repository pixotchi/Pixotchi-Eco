"use client";

import React, { useMemo } from 'react';
import { useAccount } from 'wagmi';
import SmartWalletTransaction from './smart-wallet-transaction';
import { LAND_CONTRACT_ADDRESS } from '@/lib/contracts';
import { buildSwapAndApproveCalls, useSwapDeadline } from "@/lib/swap/bundle-calls";
import { landAbi as LAND_ABI } from '@/public/abi/pixotchi-v3-abi';

interface SwapLandMintBundleProps {
    ethAmount: bigint; // ETH amount with 6% buffer already applied
    minSeedOut: bigint; // Minimum SEED to receive (land mint price)
    onSuccess?: (tx: UntypedValue) => void;
    onError?: (error: UntypedValue) => void;
    buttonText?: string;
    buttonClassName?: string;
    disabled?: boolean;
    showToast?: boolean;
}

/**
 * SwapLandMintBundle - Atomic batch transaction for ETH mode land minting
 *
 * Executes 3 calls in a single transaction:
 * 1. swapExactETHForTokens - Swap ETH → SEED via BaseSwap
 * 2. approve - Approve SEED spending by Land contract
 * 3. mint - Mint the land
 *
 * Requires smart wallet with EIP-5792 support for atomic batching.
 */
export default function SwapLandMintBundle({
    ethAmount,
    minSeedOut,
    onSuccess,
    onError,
    buttonText = 'Mint Land with ETH',
    buttonClassName = 'w-full',
    disabled = false,
    showToast = true,
}: SwapLandMintBundleProps) {
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
                spender: LAND_CONTRACT_ADDRESS,
            }),
            // Call 3: Mint land
            {
                address: LAND_CONTRACT_ADDRESS as `0x${string}`,
                abi: LAND_ABI,
                functionName: 'mint' as const,
                args: [],
            },
        ];
    }, [address, deadline, ethAmount, hasQuote, minSeedOut]);

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
