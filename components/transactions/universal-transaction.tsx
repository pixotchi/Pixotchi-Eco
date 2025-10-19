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
    console.log('Universal transaction successful:', {
      hash: tx?.transactionHash,
      blockNumber: tx?.blockNumber ? Number(tx.blockNumber) : undefined,
      status: tx?.status
    }); // ✅ Only log safe properties, avoid BigInt serialization
    onSuccess?.(tx);
    // Notify status bar to refresh balances
    try { window.dispatchEvent(new Event('balances:refresh')); } catch {}
  }, [onSuccess]);

  // Ensure we only handle success once per transaction lifecycle
  const successHandledRef = useRef(false);
  const handleOnStatus = useCallback((status: LifecycleStatus) => {
    if (status.statusName === 'success' && !successHandledRef.current) {
      successHandledRef.current = true;
      handleOnSuccess(status.statusData.transactionReceipts[0]);
    }
  }, []); // ✅ REMOVED handleOnSuccess - ref prevents infinite loop

  return (
    <Transaction
      onStatus={handleOnStatus}
      calls={calls}
      onError={onError}
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