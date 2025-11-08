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
import { normalizeTransactionReceipt } from '@/lib/transaction-utils';

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
  
  // Sponsored transaction with paymaster integration
  
  const handleOnSuccess = useCallback((tx: any) => {
    console.log('Sponsored transaction successful');
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
      const receipt = status.statusData.transactionReceipts?.[0];
      // Normalize receipt to ensure transactionHash is accessible across all wallet types
      const normalizedReceipt = normalizeTransactionReceipt(receipt);
      handleOnSuccess(normalizedReceipt);
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