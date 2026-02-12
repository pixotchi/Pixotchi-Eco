"use client";

import React, { useMemo } from 'react';
import { useAccount } from 'wagmi';
import SmartWalletTransaction from './smart-wallet-transaction';
import { PIXOTCHI_TOKEN_ADDRESS, PIXOTCHI_NFT_ADDRESS, UNISWAP_ROUTER_ADDRESS, WETH_ADDRESS } from '@/lib/contracts';
import { extractTransactionHash } from '@/lib/transaction-utils';

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
    onSuccess?: (tx: any) => void;
    onError?: (error: any) => void;
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

    // Unlimited approval for SEED → NFT contract
    const maxApproval = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');

    // Build the batch calls
    const calls = useMemo(() => {
        if (!address || ethAmount <= BigInt(0) || minSeedOut <= BigInt(0) || days <= 0) {
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
            // Call 2: Approve SEED for NFT contract
            {
                address: PIXOTCHI_TOKEN_ADDRESS as `0x${string}`,
                abi: ERC20_ABI,
                functionName: 'approve' as const,
                args: [PIXOTCHI_NFT_ADDRESS, maxApproval],
            },
            // Call 3: Purchase fence protection
            {
                address: PIXOTCHI_NFT_ADDRESS as `0x${string}`,
                abi: FENCE_V2_ABI,
                functionName: 'fenceV2Purchase' as const,
                args: [BigInt(plantId), BigInt(days)],
            },
        ];
    }, [address, ethAmount, minSeedOut, plantId, days, maxApproval]);

    const isValid = calls.length === 3;
    const defaultButtonText = `Buy ${days} Day${days === 1 ? '' : 's'} Fence with ETH`;

    const handleSuccess = (tx: any) => {
        // Track gamification for fence purchases
        if (address) {
            const post = async (currentTx: any, attempt = 0) => {
                try {
                    const payload: Record<string, unknown> = {
                        address,
                        taskId: 's4_buy_shield',
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
        onSuccess?.(tx);
    };

    return (
        <SmartWalletTransaction
            calls={calls}
            onSuccess={handleSuccess}
            onError={onError}
            buttonText={buttonText || defaultButtonText}
            buttonClassName={buttonClassName}
            disabled={disabled || !isValid}
            showToast={true}
        />
    );
}
