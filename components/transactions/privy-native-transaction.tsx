"use client";

/**
 * PrivyNativeTransaction - Transaction component for Privy embedded wallets
 * 
 * OnchainKit and even Privy's useSendTransaction both hit postMessage serialization
 * errors because viem/wagmi adds chain.formatters/serializers (functions) internally.
 * 
 * This component creates a viem WalletClient with a STRIPPED chain object (no formatters)
 * and sends transactions directly via the EIP1193 provider.
 */

import React, { useState, useCallback } from 'react';
import { useWallets } from '@privy-io/react-auth';
import { useAccount } from 'wagmi';
import { encodeFunctionData, createWalletClient, custom, type Hash } from 'viem';
import { Button } from '@/components/ui/button';
import { toast } from 'react-hot-toast';
import type { TransactionCall } from '@/lib/types';

interface PrivyNativeTransactionProps {
    calls: TransactionCall[];
    onSuccess?: (tx: any) => void;
    onError?: (error: any) => void;
    buttonText: string;
    buttonClassName?: string;
    disabled?: boolean;
    showToast?: boolean;
}

type TxStatus = 'idle' | 'pending' | 'success' | 'error';

// Create a minimal chain object without formatters/serializers
// This avoids the postMessage serialization error
const BASE_CHAIN_MINIMAL = {
    id: 8453,
    name: 'Base',
    nativeCurrency: { decimals: 18, name: 'Ether', symbol: 'ETH' },
    rpcUrls: {
        default: { http: ['https://mainnet.base.org'] },
    },
    // NO formatters - this is the key to avoiding the serialization error
    // NO serializers - these contain functions that can't be cloned
} as const;

export default function PrivyNativeTransaction({
    calls,
    onSuccess,
    onError,
    buttonText,
    buttonClassName = "",
    disabled = false,
    showToast = true,
}: PrivyNativeTransactionProps) {
    const { address } = useAccount();
    const { wallets } = useWallets();
    const [status, setStatus] = useState<TxStatus>('idle');
    const [txHash, setTxHash] = useState<string | null>(null);

    const handleTransaction = useCallback(async () => {
        if (!address || calls.length === 0) {
            console.error('[PrivyNative] Missing wallet or calls');
            return;
        }

        // Find the embedded wallet matching the current address
        const wallet = wallets.find(w => w.address?.toLowerCase() === address.toLowerCase());
        if (!wallet) {
            console.error('[PrivyNative] No matching wallet found');
            onError?.(new Error('No wallet found'));
            return;
        }

        setStatus('pending');
        if (showToast) {
            toast.loading('Submitting transaction...', { id: 'privy-tx' });
        }

        try {
            // Get the EIP1193 provider from the wallet
            const provider = await wallet.getEthereumProvider();

            // Create a viem WalletClient with the stripped chain (no formatters)
            const walletClient = createWalletClient({
                account: address,
                chain: BASE_CHAIN_MINIMAL as any,
                transport: custom(provider),
            });

            // Process each call sequentially
            let lastHash: Hash | null = null;

            for (let i = 0; i < calls.length; i++) {
                const call = calls[i];

                // Encode the function call
                let data: `0x${string}`;
                if ((call as any).abi && (call as any).functionName) {
                    data = encodeFunctionData({
                        abi: (call as any).abi,
                        functionName: (call as any).functionName,
                        args: (call as any).args || [],
                    });
                } else {
                    // Already encoded data
                    data = (call as any).data || '0x';
                }

                console.log('[PrivyNative] Sending transaction via viem WalletClient:', {
                    callIndex: i + 1,
                    totalCalls: calls.length,
                    to: call.address || (call as any).to,
                    dataLength: data?.length,
                    walletAddress: wallet.address,
                });

                // Send transaction via viem WalletClient
                // This uses the stripped chain object to avoid serialization issues
                const hash = await walletClient.sendTransaction({
                    to: (call.address || (call as any).to) as `0x${string}`,
                    data,
                    value: call.value,
                });

                lastHash = hash;
                setTxHash(hash);

                if (i < calls.length - 1) {
                    // Wait a bit between transactions
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
            }

            setStatus('success');
            if (showToast) {
                toast.success('Transaction successful!', { id: 'privy-tx' });
            }

            // Trigger balance refresh
            try {
                window.dispatchEvent(new Event('balances:refresh'));
            } catch { }

            onSuccess?.({ transactionHash: lastHash });

        } catch (error: any) {
            console.error('[PrivyNative] Transaction failed:', error);
            setStatus('error');

            const message = error?.message || 'Transaction failed';
            if (showToast) {
                toast.error(message, { id: 'privy-tx' });
            }

            onError?.(error);
        }
    }, [address, wallets, calls, onSuccess, onError, showToast]);

    return (
        <div className="flex flex-col gap-2">
            <Button
                onClick={handleTransaction}
                disabled={disabled || status === 'pending'}
                className={buttonClassName}
            >
                {status === 'pending' ? 'Processing...' : buttonText}
            </Button>

            {status === 'success' && txHash && (
                <div className="text-xs text-green-600 truncate">
                    ✓ Transaction submitted
                </div>
            )}

            {status === 'error' && (
                <div className="text-xs text-red-600">
                    Transaction failed. Please try again.
                </div>
            )}
        </div>
    );
}
