"use client";

import React, { useCallback, useMemo, useRef } from 'react';
import {
  getLifecycleTransactionProof,
  Transaction,
  TransactionButton,
  TransactionStatus,
} from './transaction-kit';
import type { LifecycleStatus, TransactionFeedbackMode } from './transaction-kit';
import GlobalTransactionToast from './global-transaction-toast';
import { usePaymaster } from '@/lib/paymaster-context';
import type { TransactionCall } from '@/lib/types';
import { useAccount } from 'wagmi';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { getBuilderCapabilities, transformCallsWithBuilderCode } from '@/lib/builder-code';
import { getMiniAppQuickAuthHeaders } from '@/lib/farcaster-miniapp-auth-client';
import { dispatchPostTransactionRefresh } from '@/lib/transaction-refresh';

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
  intentKey?: string;
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
  onButtonClick,
  intentKey,
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

  const handleOnSuccess = useCallback((tx: UntypedValue, status: LifecycleStatus) => {
    try {
      const result = onSuccess?.(tx) as UntypedValue;
      if (result && typeof result.then === 'function') {
        void Promise.resolve(result).catch((error) => {
          console.warn('Transaction success callback failed', error);
        });
      }
    } finally {
      dispatchPostTransactionRefresh(undefined, undefined, {
        address,
        source: 'sponsored-transaction',
        transactionHash: extractTransactionHash(tx) || status.statusData.transactionHash,
        transactionId: status.statusData.transactionId,
      });

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
    try {
      void Promise.resolve(onStatusUpdate?.(status)).catch((error) => {
        console.warn('Transaction status update callback failed', error);
      });
    } catch (error) {
      console.warn('Transaction status update callback failed', error);
    }
    // Reset the success flag when a new transaction starts
    if (status.statusName === 'transactionPending') {
      successHandledRef.current = false;
    }
    if (status.statusName === 'success' && !successHandledRef.current) {
      const proof = getLifecycleTransactionProof(status);
      if (!proof) return;
      successHandledRef.current = true;
      handleOnSuccess(proof, status);
    }
  }, [handleOnSuccess, onStatusUpdate]);
  const resolvedFeedbackMode: TransactionFeedbackMode = feedbackMode ?? "toast";
  const showInlineStatus = !hideStatus && (resolvedFeedbackMode === "inline" || resolvedFeedbackMode === "both");
  const showGlobalToast = showToast
    && (resolvedFeedbackMode === "toast" || resolvedFeedbackMode === "both");

  return (
    <Transaction
      onStatus={handleOnStatus}
      calls={transformedCalls}
      onError={handleOnError}
      isSponsored={isSponsored}
      capabilities={builderCapabilities}
      intentKey={intentKey}
      resetAfter={2000}
    >
      <TransactionButton
        text={buttonText}
        className={`${buttonClassName} inline-flex items-center justify-center whitespace-nowrap leading-none`}
        disabled={disabled}
        onClick={onButtonClick}
      />
      {showInlineStatus && <TransactionStatus />}

      {showGlobalToast && <GlobalTransactionToast />}
    </Transaction>
  );
} 
