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
import { normalizeTransactionReceipt } from '@/lib/transaction-utils';

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
  
  // Smart wallet transaction with OnchainKit integration
  
  const handleOnSuccess = useCallback((tx: any) => {
    console.log('Smart wallet transaction successful:', tx);
    onSuccess?.(tx);
    try { window.dispatchEvent(new Event('balances:refresh')); } catch {}
  }, [onSuccess]);

  // Ensure success is handled once per transaction lifecycle
  const successHandledRef = useRef(false);
  const handleOnStatus = useCallback((status: LifecycleStatus) => {
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