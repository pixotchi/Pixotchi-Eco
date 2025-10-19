"use client";

import React, { useCallback, useRef, useEffect } from 'react';
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
  hideStatus = false
}: SponsoredTransactionProps) {
  const { isSponsored } = usePaymaster();
  const { address } = useAccount();
  
  // Sponsored transaction with paymaster integration
  
  const handleOnSuccess = useCallback((tx: any) => {
    console.log('Sponsored transaction successful:', tx);
    onSuccess?.(tx);
    try { window.dispatchEvent(new Event('balances:refresh')); } catch {}
    // Gamification: track daily activity (non-blocking)
    if (address) {
      fetch('/api/gamification/streak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ address })
      }).catch(err => console.warn('Streak tracking failed (non-critical):', err));
    }
  }, [onSuccess]);

  // Ensure success is handled once per transaction lifecycle
  const successHandledRef = useRef(false);
  const handleOnStatus = useCallback((status: LifecycleStatus) => {
    try { onStatusUpdate?.(status); } catch {}
    if (status.statusName === 'success' && !successHandledRef.current) {
      successHandledRef.current = true;
      handleOnSuccess(status.statusData.transactionReceipts[0]);
    }
  }, [handleOnSuccess, onStatusUpdate]);

  return (
    <Transaction
      onStatus={handleOnStatus}
      calls={calls}
      onError={onError}
      isSponsored={isSponsored}
    >
      <TransactionButton 
        text={buttonText} 
        className={`${buttonClassName} inline-flex items-center justify-center whitespace-nowrap leading-none`}
        disabled={disabled}
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