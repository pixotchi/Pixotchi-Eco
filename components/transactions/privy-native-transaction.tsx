"use client";

/**
 * PrivyNativeTransaction - Transaction component for Privy embedded wallets
 * 
 * OnchainKit's Transaction component passes chain objects with formatters/serializers
 * that contain functions, which fail to serialize via postMessage to Privy's iframe.
 * 
 * This component uses Privy's native sendTransaction for embedded wallets, bypassing
 * the OnchainKit serialization issue.
 */

import React, { useState, useCallback } from 'react';
import { useAccount } from 'wagmi';
import { encodeFunctionData } from 'viem';
import { Button } from '@/components/ui/button';
import { toast } from 'react-hot-toast';
import { appendBuilderSuffix } from '@/lib/builder-code';
import type { TransactionCall } from '@/lib/types';

interface PrivyNativeTransactionProps {
    calls: TransactionCall[];
    onSuccess?: (tx: any) => void;
    onError?: (error: any) => void;
    buttonText: string;
    buttonClassName?: string;
    disabled?: boolean;
    showToast?: boolean;
    /** The Privy embedded wallet object from usePrivyEmbeddedWallet */
    embeddedWallet: any;
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
    embeddedWallet,
}: PrivyNativeTransactionProps) {
    const { address } = useAccount();
    const [status, setStatus] = useState<TxStatus>('idle');
    const [txHash, setTxHash] = useState<string | null>(null);

    const handleTransaction = useCallback(async () => {
        if (!embeddedWallet || !address || calls.length === 0) {
            console.error('[PrivyNative] Missing wallet or calls');
            return;
        }

        setStatus('pending');
        if (showToast) {
            toast.loading('Submitting transaction...', { id: 'privy-tx' });
        }

        try {
            // Get the provider from the embedded wallet
            const provider = await embeddedWallet.getEthereumProvider();

            // Process each call sequentially
            // TODO: For batching support, we could use wallet_sendCalls if available
            for (let i = 0; i < calls.length; i++) {
                const call = calls[i];

                // Encode the function call
                let data: `0x${string}`;
                if (call.abi && call.functionName) {
                    data = encodeFunctionData({
                        abi: call.abi,
                        functionName: call.functionName,
                        args: call.args || [],
                    });
                    // Append builder code suffix
                    data = appendBuilderSuffix(data);
                } else {
                    // Already encoded data
                    data = (call as any).data || '0x';
                }

                // Prepare clean transaction object with only serializable data
                const txRequest = {
                    to: call.address || (call as any).to,
                    data,
                    value: call.value ? `0x${call.value.toString(16)}` : undefined,
                    from: address,
                };

                console.log('[PrivyNative] Sending transaction:', {
                    callIndex: i + 1,
                    totalCalls: calls.length,
                    to: txRequest.to,
                    dataLength: txRequest.data?.length,
                });

                // Send transaction via Privy's EIP-1193 provider
                const hash = await provider.request({
                    method: 'eth_sendTransaction',
                    params: [txRequest],
                });

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

            onSuccess?.({ transactionHash: txHash });

        } catch (error: any) {
            console.error('[PrivyNative] Transaction failed:', error);
            setStatus('error');

            const message = error?.message || 'Transaction failed';
            if (showToast) {
                toast.error(message, { id: 'privy-tx' });
            }

            onError?.(error);
        }
    }, [embeddedWallet, address, calls, onSuccess, onError, showToast, txHash]);

    return (
        <div className="flex flex-col gap-2">
            <Button
                onClick={handleTransaction}
                disabled={disabled || status === 'pending' || !embeddedWallet}
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
