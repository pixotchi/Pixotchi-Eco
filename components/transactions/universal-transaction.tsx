"use client";

import React, { useCallback, useRef } from 'react';
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

interface UniversalTransactionProps {
  calls: TransactionCall[];
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText: string;
  buttonClassName?: string;
  disabled?: boolean;
  showToast?: boolean;
  forceUnsponsored?: boolean; // Force transaction to be unsponsored (e.g., for swaps)
}

export default function UniversalTransaction({
  calls,
  onSuccess,
  onError,
  buttonText,
  buttonClassName = "",
  disabled = false,
  showToast = true,
  forceUnsponsored = false
}: UniversalTransactionProps) {
  const { isSponsored: paymasterEnabled } = usePaymaster();
  
  // Determine if this transaction should be sponsored
  const isSponsored = forceUnsponsored ? false : paymasterEnabled;
  
  // Transaction sponsorship determined by paymaster context and forceUnsponsored flag
  
  const handleOnSuccess = useCallback((tx: any) => {
    console.log('Universal transaction successful:', tx);
    onSuccess?.(tx);
    // Notify status bar to refresh balances
    try { window.dispatchEvent(new Event('balances:refresh')); } catch {}
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
      handleOnSuccess(status.statusData.transactionReceipts[0]);
    }
  }, [handleOnSuccess]);

  return (
    <Transaction
      onStatus={handleOnStatus}
      calls={calls}
      onError={handleOnError}
      isSponsored={isSponsored}
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