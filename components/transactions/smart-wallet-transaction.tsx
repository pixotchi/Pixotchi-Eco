"use client";

import React, { useCallback, useMemo, useRef } from 'react';
import {
  Transaction,
  TransactionButton,
  TransactionStatus,
  TransactionStatusAction,
  TransactionStatusLabel,
} from '@coinbase/onchainkit/transaction';
import GlobalTransactionToast from './global-transaction-toast';
import type { LifecycleStatus } from '@coinbase/onchainkit/transaction';
import { usePaymaster } from '@/lib/paymaster-context';
import type { TransactionCall } from '@/lib/types';
import { normalizeTransactionReceipt } from '@/lib/transaction-utils';
import { transformCallsWithBuilderCode } from '@/lib/builder-code';

interface SmartWalletTransactionProps {
  calls: TransactionCall[];
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText: string;
  buttonClassName?: string;
  disabled?: boolean;
  showToast?: boolean;
}

export default function SmartWalletTransaction({
  calls,
  onSuccess,
  onError,
  buttonText,
  buttonClassName = "",
  disabled = false,
  showToast = true
}: SmartWalletTransactionProps) {
  const { isSponsored } = usePaymaster();

  // Normalize to raw serializable calls for embedded-wallet compatibility.
  // Builder attribution is handled at Wagmi client level via `dataSuffix`.
  const transformedCalls = useMemo(() =>
    transformCallsWithBuilderCode(calls as any[]) as TransactionCall[],
    [calls]
  );

  const handleOnSuccess = useCallback((tx: any) => {
    console.log('Smart wallet transaction successful:', tx);
    onSuccess?.(tx);
    try { window.dispatchEvent(new Event('balances:refresh')); } catch { }
  }, [onSuccess]);

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
  }, [handleOnSuccess]);

  return (
    <Transaction
      onStatus={handleOnStatus}
      calls={transformedCalls}
      onError={handleOnError}
      isSponsored={isSponsored}
      resetAfter={2000}
    >
      <TransactionButton
        text={buttonText}
        className={buttonClassName}
        disabled={disabled}
      />

      <TransactionStatus>
        <TransactionStatusAction />
        <TransactionStatusLabel />
      </TransactionStatus>

      {showToast && <GlobalTransactionToast />}
    </Transaction>
  );
} 
