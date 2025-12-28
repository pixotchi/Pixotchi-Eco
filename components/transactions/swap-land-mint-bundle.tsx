"use client";

import React, { useMemo } from 'react';
import { useAccount } from 'wagmi';
import SmartWalletTransaction from './smart-wallet-transaction';
import { PIXOTCHI_TOKEN_ADDRESS, LAND_CONTRACT_ADDRESS, UNISWAP_ROUTER_ADDRESS, WETH_ADDRESS } from '@/lib/contracts';
import { landAbi as LAND_ABI } from '@/public/abi/pixotchi-v3-abi';

// UniswapV2 Router ABI for swapExactETHForTokens
const UNISWAP_ROUTER_ABI = [
    {
        inputs: [
            { name: 'amountOutMin', type: 'uint256' },
            { name: 'path', type: 'address[]' },
            { name: 'to', type: 'address' },
            { name: 'deadline', type: 'uint256' }
        ],
        name: 'swapExactETHForTokens',
        outputs: [{ name: 'amounts', type: 'uint256[]' }],
        stateMutability: 'payable',
        type: 'function',
    },
] as const;

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

interface SwapLandMintBundleProps {
    ethAmount: bigint; // ETH amount with 6% buffer already applied
    minSeedOut: bigint; // Minimum SEED to receive (land mint price)
    onSuccess?: (tx: any) => void;
    onError?: (error: any) => void;
    buttonText?: string;
    buttonClassName?: string;
    disabled?: boolean;
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
}: SwapLandMintBundleProps) {
    const { address } = useAccount();

    // Unlimited approval for SEED → Land contract
    const maxApproval = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');

    // Build the batch calls
    const calls = useMemo(() => {
        if (!address || ethAmount <= BigInt(0) || minSeedOut <= BigInt(0)) {
            return [];
        }

        // Deadline: 10 minutes from now
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 10);

        return [
            // Call 1: Swap ETH → SEED
            {
                address: UNISWAP_ROUTER_ADDRESS as `0x${string}`,
                abi: UNISWAP_ROUTER_ABI,
                functionName: 'swapExactETHForTokens' as const,
                args: [
                    minSeedOut,
                    [WETH_ADDRESS, PIXOTCHI_TOKEN_ADDRESS],
                    address,
                    deadline,
                ],
                value: ethAmount,
            },
            // Call 2: Approve SEED for Land contract
            {
                address: PIXOTCHI_TOKEN_ADDRESS as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'approve' as const,
                args: [LAND_CONTRACT_ADDRESS, maxApproval],
            },
            // Call 3: Mint land
            {
                address: LAND_CONTRACT_ADDRESS as `0x${string}`,
                abi: LAND_ABI,
                functionName: 'mint' as const,
                args: [],
            },
        ];
    }, [address, ethAmount, minSeedOut, maxApproval]);

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
