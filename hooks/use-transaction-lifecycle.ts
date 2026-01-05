import { useCallback, useRef } from 'react';
import { type LifecycleStatus } from '@coinbase/onchainkit/transaction';
import { usePublicClient } from 'wagmi';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { waitForTransactionReceipt } from 'viem/actions';

interface UseTransactionLifecycleProps {
    onSuccess?: (tx: any) => void;
    onError?: (error: any) => void;
    onStatusUpdate?: (status: LifecycleStatus) => void;
}

export function useTransactionLifecycle({
    onSuccess,
    onError,
    onStatusUpdate
}: UseTransactionLifecycleProps) {
    const publicClient = usePublicClient();
    const successHandledRef = useRef(false);
    const isPollingRef = useRef(false);

    const handleOnSuccess = useCallback((tx: any) => {
        if (successHandledRef.current) return;
        successHandledRef.current = true;

        console.log('Transaction confirmed successfully:', tx);
        onSuccess?.(tx);

        // Trigger global refreshes
        try {
            window.dispatchEvent(new Event('balances:refresh'));
            window.dispatchEvent(new Event('buildings:refresh'));
        } catch { }
    }, [onSuccess]);

    const handleOnError = useCallback((error: any) => {
        if (successHandledRef.current) return;
        console.error('Transaction error:', error);
        onError?.(error);
    }, [onError]);

    const checkForReceipt = useCallback(async (txHash: string) => {
        if (!publicClient || isPollingRef.current || successHandledRef.current) return;

        try {
            isPollingRef.current = true;
            console.log('Starting independent receipt polling for:', txHash);

            // Use viem's waitForTransactionReceipt which handles polling efficiently
            // Standard polling is ~4s, bypassing the global 5m wagmi config
            // We set it to 1s to match Base's fast block times (~2s) for snappy UI
            const receipt = await waitForTransactionReceipt(publicClient, {
                hash: txHash as `0x${string}`,
                confirmations: 1,
                pollingInterval: 1_000,
                timeout: 60_000, // Stop polling after 60s to avoid infinite loops if RPC issues
            });

            if (receipt.status === 'success') {
                handleOnSuccess(receipt);
            } else {
                handleOnError(new Error('Transaction reverted'));
            }
        } catch (error) {
            console.warn('Receipt polling failed:', error);
            // Don't call onError here, let OnchainKit handle the timeout/failure UI
        } finally {
            isPollingRef.current = false;
        }
    }, [publicClient, handleOnSuccess, handleOnError]);

    const handleOnStatus = useCallback((status: LifecycleStatus) => {
        onStatusUpdate?.(status);

        // Reset success flag on new transaction start
        if (status.statusName === 'transactionPending') {
            successHandledRef.current = false;
            isPollingRef.current = false;
        }

        // Capture hash and start independent polling
        // This covers both modern and legacy transaction flows
        if (status.statusName === 'transactionPending' || status.statusName === 'transactionLegacyExecuted') {
            const txHash = extractTransactionHash(status.statusData);
            if (txHash) {
                checkForReceipt(txHash);
            }
        }

        if (status.statusName === 'success') {
            const receipt = status.statusData.transactionReceipts?.[0];
            if (receipt) {
                handleOnSuccess(receipt);
            }
        }

        if (status.statusName === 'error') {
            handleOnError(status.statusData.error);
        }
    }, [onStatusUpdate, checkForReceipt, handleOnSuccess, handleOnError]);

    return {
        handleOnStatus,
        handleOnError // Expose safe error handler for components to use
    };
}
