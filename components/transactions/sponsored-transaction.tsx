"use client";

import React, { useCallback, useMemo, useRef } from 'react';
import {
  Transaction,
  TransactionButton,
  TransactionStatus,
} from './transaction-kit';
import type { LifecycleStatus, TransactionFeedbackMode } from './transaction-kit';
import GlobalTransactionToast from './global-transaction-toast';
import { usePaymaster } from '@/lib/paymaster-context';
import type { TransactionCall } from '@/lib/types';
import { useAccount } from 'wagmi';
import { normalizeTransactionReceipt } from '@/lib/transaction-utils';
import { getBuilderCapabilities, transformCallsWithBuilderCode } from '@/lib/builder-code';
import { getMiniAppQuickAuthHeaders } from '@/lib/farcaster-miniapp-auth-client';

interface SponsoredTransactionProps {
  calls: TransactionCall[];
  onSuccess?: (tx: UntypedValue) => void;
  onError?: (error: UntypedValue) => void;
  buttonText: string;
  buttonClassName?: string;
  disabled?: boolean;
  feedbackMode?: TransactionFeedbackMode;
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
  feedbackMode,
  showToast = true,
  onStatusUpdate,
  hideStatus = false,
  onButtonClick
}: SponsoredTransactionProps) {
  const { isSponsored } = usePaymaster();
  const { address } = useAccount();
  const builderCapabilities = getBuilderCapabilities();

  // Normalize to raw serializable calls for embedded-wallet compatibility.
  // Builder attribution is appended by transform helper + wallet_sendCalls capability.
  const transformedCalls = useMemo(() =>
    transformCallsWithBuilderCode(calls as UntypedValue[]) as TransactionCall[],
    [calls]
  );

  const handleOnSuccess = useCallback((tx: UntypedValue) => {
    onSuccess?.(tx);
    try { window.dispatchEvent(new Event('balances:refresh')); } catch { }
    // Gamification: track daily activity (non-blocking)
    if (address) {
      void (async () => {
        const authHeaders = await getMiniAppQuickAuthHeaders();
        await fetch('/api/gamification/streak', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...authHeaders,
          },
        });
      })().catch(err => console.warn('Streak tracking failed (non-critical):', err));
    }
  }, [address, onSuccess]);

  // Track transaction lifecycle to prevent race conditions where onError is called after success
  const successHandledRef = useRef(false);

  // Wrap onError to ignore errors after success has been handled
  // This fixes OnchainKit race condition where onError can fire after successful tx
  const handleOnError = useCallback((error: UntypedValue) => {
    if (successHandledRef.current) {
      if (process.env.NODE_ENV === 'development') {
        console.debug('Ignoring post-success error callback from OnchainKit:', error);
      }
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
  const resolvedFeedbackMode: TransactionFeedbackMode = feedbackMode ?? (showToast ? "both" : "inline");
  const showInlineStatus = !hideStatus && (resolvedFeedbackMode === "inline" || resolvedFeedbackMode === "both");
  const showGlobalToast = resolvedFeedbackMode === "toast" || resolvedFeedbackMode === "both";

  return (
    <Transaction
      onStatus={handleOnStatus}
      calls={transformedCalls}
      onError={handleOnError}
      isSponsored={isSponsored}
      capabilities={builderCapabilities}
      resetAfter={2000}
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
      {showInlineStatus && <TransactionStatus />}

      {showGlobalToast && <GlobalTransactionToast />}
    </Transaction>
  );
} 
