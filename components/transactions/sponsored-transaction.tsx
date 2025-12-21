"use client";

import React, { useCallback, useMemo, useRef, useEffect } from 'react';
import {
  Transaction,
  TransactionButton,
  TransactionStatus,
  TransactionStatusAction,
  TransactionStatusLabel,
} from '@coinbase/onchainkit/transaction';
import type { LifecycleStatus } from '@coinbase/onchainkit/transaction';
import GlobalTransactionToast from './global-transaction-toast';
import { usePaymaster } from '@/lib/paymaster-context';
import type { TransactionCall } from '@/lib/types';
import { useAccount } from 'wagmi';
import { normalizeTransactionReceipt } from '@/lib/transaction-utils';
import { getBuilderCapabilities, transformCallsWithBuilderCode, serializeCapabilities, debugLogTransactionData } from '@/lib/builder-code';
import { usePrivyEmbeddedWallet } from '@/hooks/usePrivyEmbeddedWallet';

interface SponsoredTransactionProps {
  calls: TransactionCall[];
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText: string;
  buttonClassName?: string;
  disabled?: boolean;
  showToast?: boolean;
  onStatusUpdate?: (status: LifecycleStatus) => void;
  hideStatus?: boolean;
  onButtonClick?: () => void;
}

export default function SponsoredTransaction({
  calls,
  onSuccess,
  onError,
  buttonText,
  buttonClassName = "",
  disabled = false,
  showToast = true
  , onStatusUpdate,
  hideStatus = false,
  onButtonClick
}: SponsoredTransactionProps) {
  const { isSponsored } = usePaymaster();
  const { address } = useAccount();

  // Detect if using Privy embedded wallet
  const { isEmbeddedWallet, isReady } = usePrivyEmbeddedWallet();

  // For embedded wallets, skip builder capabilities entirely to avoid postMessage serialization issues
  // The ox library's builder code attribution adds non-serializable functions to the chain object
  const builderCapabilities = useMemo(() => {
    if (isEmbeddedWallet) {
      console.log('[SponsoredTransaction] Skipping builder capabilities for embedded wallet');
      return undefined;
    }
    return serializeCapabilities(getBuilderCapabilities());
  }, [isEmbeddedWallet]);

  // Transform calls - for embedded wallets, skip builder suffix to avoid any serialization issues
  const transformedCalls = useMemo(() => {
    if (isEmbeddedWallet) {
      // For embedded wallets, just convert to raw format without builder suffix
      // This ensures ABI objects are removed (they contain non-serializable functions)
      return calls.map(call => {
        if ((call as any).abi && (call as any).functionName) {
          const { encodeFunctionData } = require('viem');
          const data = encodeFunctionData({
            abi: (call as any).abi,
            functionName: (call as any).functionName,
            args: (call as any).args || [],
          });
          return {
            to: call.address || (call as any).to,
            data,
            value: call.value,
          } as TransactionCall;
        }
        return {
          to: call.address || (call as any).to,
          data: (call as any).data,
          value: call.value,
        } as TransactionCall;
      });
    }
    return transformCallsWithBuilderCode(calls as any[]) as TransactionCall[];
  }, [calls, isEmbeddedWallet]);

  // Debug logging for Privy embedded wallet serialization issues
  useEffect(() => {
    debugLogTransactionData('SponsoredTransaction', {
      calls,
      transformedCalls,
      capabilities: builderCapabilities,
    });

    if (isReady) {
      console.log('[SponsoredTransaction] Wallet type:', {
        isEmbeddedWallet,
        skipBuilderCode: isEmbeddedWallet,
      });
    }
  }, [calls, transformedCalls, builderCapabilities, isEmbeddedWallet, isReady]);

  const handleOnSuccess = useCallback((tx: any) => {
    console.log('Sponsored transaction successful');
    onSuccess?.(tx);
    try { window.dispatchEvent(new Event('balances:refresh')); } catch { }
    // Gamification: track daily activity (non-blocking)
    if (address) {
      fetch('/api/gamification/streak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
      }).catch(err => console.warn('Streak tracking failed (non-critical):', err));
    }
  }, [onSuccess, address]);

  // Track transaction lifecycle to prevent race conditions where onError is called after success
  const successHandledRef = useRef(false);

  // Wrap onError to ignore errors after success has been handled
  // This fixes OnchainKit race condition where onError can fire after successful tx
  const handleOnError = useCallback((error: any) => {
    if (successHandledRef.current) {
      console.log('Ignoring post-success error callback from OnchainKit:', error);
      return;
    }
    onError?.(error);
  }, [onError]);

  const handleOnStatus = useCallback((status: LifecycleStatus) => {
    try { onStatusUpdate?.(status); } catch { }
    // Reset the success flag when a new transaction starts
    if (status.statusName === 'transactionPending') {
      successHandledRef.current = false;
    }
    if (status.statusName === 'success' && !successHandledRef.current) {
      successHandledRef.current = true;
      const receipt = status.statusData.transactionReceipts?.[0];
      // Normalize receipt to ensure transactionHash is accessible across all wallet types
      const normalizedReceipt = normalizeTransactionReceipt(receipt);
      handleOnSuccess(normalizedReceipt);
    }
  }, [handleOnSuccess, onStatusUpdate]);

  // Use OnchainKit Transaction but WITHOUT capabilities for embedded wallets
  return (
    <Transaction
      onStatus={handleOnStatus}
      calls={transformedCalls}
      onError={handleOnError}
      isSponsored={isSponsored}
      capabilities={builderCapabilities}
    >
      <TransactionButton
        text={buttonText}
        className={`${buttonClassName} inline-flex items-center justify-center whitespace-nowrap leading-none`}
        disabled={disabled}
        onClick={() => {
          if (disabled) return;
          try {
            onButtonClick?.();
          } catch (error) {
            console.warn('Pre-transaction handler failed', error);
          }
        }}
      />
      {!hideStatus && (
        <TransactionStatus>
          <TransactionStatusAction />
          <TransactionStatusLabel />
        </TransactionStatus>
      )}

      {showToast && <GlobalTransactionToast />}
    </Transaction>
  );
} 