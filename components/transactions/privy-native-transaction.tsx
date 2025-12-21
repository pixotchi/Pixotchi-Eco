"use client";

/**
 * PrivyNativeTransaction - Transaction component for Privy embedded wallets
 * 
 * OnchainKit's Transaction component passes chain objects with formatters/serializers
 * that contain functions, which fail to serialize via postMessage to Privy's iframe.
 * 
 * This component uses Privy's native useSendTransaction hook for embedded wallets,
 * completely bypassing OnchainKit and wagmi's problematic serialization.
 */

import React, { useState, useCallback } from 'react';
import { useSendTransaction, useWallets } from '@privy-io/react-auth';
import { useAccount } from 'wagmi';
import { encodeFunctionData } from 'viem';
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
    const { sendTransaction } = useSendTransaction();
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
            // Process each call sequentially
            let lastHash: string | null = null;

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

                // Prepare simple transaction object (no chain object!)
                const txRequest = {
                    to: call.address || (call as any).to,
                    data,
                    value: call.value ? Number(call.value) : undefined,
                    chainId: 8453, // Base mainnet
                };

                console.log('[PrivyNative] Sending transaction via Privy:', {
                    callIndex: i + 1,
                    totalCalls: calls.length,
                    to: txRequest.to,
                    dataLength: txRequest.data?.length,
                    walletAddress: wallet.address,
                });

                // Use Privy's useSendTransaction - bypasses wagmi entirely
                const result = await sendTransaction(
                    txRequest as any,
                    {
                        address: wallet.address,
                        uiOptions: {
                            showWalletUIs: true,
                        },
                    }
                );

                lastHash = result.hash;
                setTxHash(result.hash);

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
    }, [address, wallets, calls, sendTransaction, onSuccess, onError, showToast]);

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
