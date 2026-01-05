"use client";

import React, { useMemo } from 'react';
import { useTransactionLifecycle } from '@/hooks/use-transaction-lifecycle';
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
import { getBuilderCapabilities, transformCallsWithBuilderCode } from '@/lib/builder-code';

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

  // Get builder code capabilities for ERC-8021 attribution (for smart wallets with ERC-5792)
  const builderCapabilities = getBuilderCapabilities();

  // Transform calls to include builder suffix in calldata (for EOA wallets without ERC-5792)
  // This ensures builder attribution works across ALL wallet types
  const transformedCalls = useMemo(() =>
    transformCallsWithBuilderCode(calls as any[]) as TransactionCall[],
    [calls]
  );

  /* 
   * Use robust lifecycle hook to handle transaction updates.
   * This hook implements a fallback polling mechanism (via waitForTransactionReceipt)
   * to ensure the UI updates specifically for the confirmed transaction,
   * bypassing the slow global polling interval (5 minutes) in wagmi config.
   */
  const { handleOnStatus, handleOnError } = useTransactionLifecycle({
    onSuccess: (tx) => {
      // Normalize receipt to ensure transactionHash is accessible across all wallet types
      const normalizedReceipt = normalizeTransactionReceipt(tx);
      console.log('Sponsored transaction successful');
      onSuccess?.(normalizedReceipt);

      // Notify status bar to refresh balances
      try { window.dispatchEvent(new Event('balances:refresh')); } catch { }

      // Gamification: track daily activity (non-blocking)
      if (address) {
        fetch('/api/gamification/streak', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ address })
        }).catch(err => console.warn('Streak tracking failed (non-critical):', err));
      }
    },
    onError,
    onStatusUpdate
  });

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