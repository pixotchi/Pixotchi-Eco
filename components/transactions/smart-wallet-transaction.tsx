"use client";

import React, { useCallback, useMemo, useRef } from 'react';
import {
  Transaction,
  TransactionButton,
  TransactionStatus,
} from './transaction-kit';
import GlobalTransactionToast from './global-transaction-toast';
import type { LifecycleStatus, TransactionFeedbackMode } from './transaction-kit';
import { usePaymaster } from '@/lib/paymaster-context';
import type { TransactionCall } from '@/lib/types';
import { normalizeTransactionReceipt } from '@/lib/transaction-utils';
import { getBuilderCapabilities, transformCallsWithBuilderCode } from '@/lib/builder-code';
import { dispatchPostTransactionRefresh } from '@/lib/transaction-refresh';

interface SmartWalletTransactionProps {
  calls: TransactionCall[];
  onSuccess?: (tx: UntypedValue) => void;
  onError?: (error: UntypedValue) => void;
  buttonText: string;
  buttonClassName?: string;
  disabled?: boolean;
  feedbackMode?: TransactionFeedbackMode;
  showToast?: boolean;
}

export default function SmartWalletTransaction({
  calls,
  onSuccess,
  onError,
  buttonText,
  buttonClassName = "",
  disabled = false,
  feedbackMode
}: SmartWalletTransactionProps) {
  const { isSponsored } = usePaymaster();
  const builderCapabilities = getBuilderCapabilities();

  // Normalize to raw serializable calls for embedded-wallet compatibility.
  // Builder attribution is appended by transform helper + wallet_sendCalls capability.
  const transformedCalls = useMemo(() =>
    transformCallsWithBuilderCode(calls as UntypedValue[]) as TransactionCall[],
    [calls]
  );

  const handleOnSuccess = useCallback((tx: UntypedValue) => {
    onSuccess?.(tx);
    dispatchPostTransactionRefresh();
  }, [onSuccess]);

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
      successHandledRef.current = true;
      const receipt = status.statusData.transactionReceipts?.[0];
      // Normalize receipt to ensure transactionHash is accessible across all wallet types
      const normalizedReceipt = normalizeTransactionReceipt(receipt);
      handleOnSuccess(normalizedReceipt);
    }
  }, [handleOnSuccess]);
  const resolvedFeedbackMode: TransactionFeedbackMode = feedbackMode ?? "toast";
  const showInlineStatus = resolvedFeedbackMode === "inline" || resolvedFeedbackMode === "both";
  const showGlobalToast = resolvedFeedbackMode !== "none";

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
        className={buttonClassName}
        disabled={disabled}
      />

      {showInlineStatus && <TransactionStatus />}

      {showGlobalToast && <GlobalTransactionToast />}
    </Transaction>
  );
} 
