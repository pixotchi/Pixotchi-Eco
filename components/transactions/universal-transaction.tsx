"use client";

import React, { useCallback, useMemo, useRef } from 'react';
import {
  getLifecycleTransactionProof,
  Transaction,
  TransactionButton,
  TransactionStatus,
} from './transaction-kit';
import GlobalTransactionToast from './global-transaction-toast';
import type { LifecycleStatus, TransactionFeedbackMode } from './transaction-kit';
import { usePaymaster } from '@/lib/paymaster-context';
import type { TransactionCall } from '@/lib/types';
import { getBuilderCapabilities, transformCallsWithBuilderCode } from '@/lib/builder-code';
import { dispatchPostTransactionRefresh } from '@/lib/transaction-refresh';
import { extractTransactionHash } from '@/lib/transaction-utils';
import { useAccount } from 'wagmi';

interface UniversalTransactionProps {
  calls: TransactionCall[];
  onSuccess?: (tx: UntypedValue) => void;
  onError?: (error: UntypedValue) => void;
  buttonText: string;
  buttonClassName?: string;
  disabled?: boolean;
  feedbackMode?: TransactionFeedbackMode;
  showToast?: boolean;
  intentKey?: string;
  forceUnsponsored?: boolean; // Force transaction to be unsponsored (e.g., for swaps)
}

export default function UniversalTransaction({
  calls,
  onSuccess,
  onError,
  buttonText,
  buttonClassName = "",
  disabled = false,
  feedbackMode,
  showToast = true,
  intentKey,
  forceUnsponsored = false
}: UniversalTransactionProps) {
  const { isSponsored: paymasterEnabled } = usePaymaster();
  const { address } = useAccount();

  // Determine if this transaction should be sponsored
  const isSponsored = forceUnsponsored ? false : paymasterEnabled;
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
        source: 'universal-transaction',
        transactionHash: extractTransactionHash(tx) || status.statusData.transactionHash,
        transactionId: status.statusData.transactionId,
      });
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
  }, [handleOnSuccess]);
  const resolvedFeedbackMode: TransactionFeedbackMode = feedbackMode ?? "toast";
  const showInlineStatus = resolvedFeedbackMode === "inline" || resolvedFeedbackMode === "both";
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
        className={buttonClassName}
        disabled={disabled}
      />

      {showInlineStatus && <TransactionStatus />}

      {showGlobalToast && <GlobalTransactionToast />}
    </Transaction>
  );
}
