"use client";

import React, { useCallback, useRef } from 'react';
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
import { createEfpFollowCall } from '@/lib/efp-service';
import toast from 'react-hot-toast';

interface FollowTransactionProps {
  targetAddress: `0x${string}`;
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonClassName?: string;
  disabled?: boolean;
  showToast?: boolean;
}

export default function FollowTransaction({
  targetAddress,
  onSuccess,
  onError,
  buttonClassName = "w-full",
  disabled = false,
  showToast = true,
}: FollowTransactionProps) {
  const { isSponsored } = usePaymaster();

  // Create EFP follow call
  const calls = [createEfpFollowCall(targetAddress)];

  const handleOnSuccess = useCallback((tx: any) => {
    if (showToast) {
      toast.success('Successfully followed via EFP!');
    }
    onSuccess?.(tx);
  }, [onSuccess, showToast]);

  // Ensure success is handled once per transaction lifecycle
  const successHandledRef = useRef(false);
  const handleOnStatus = useCallback((status: LifecycleStatus) => {
    if (status.statusName === 'success' && !successHandledRef.current) {
      successHandledRef.current = true;
      handleOnSuccess(status.statusData.transactionReceipts[0]);
    }
  }, [handleOnSuccess]);

  return (
    <Transaction
      onStatus={handleOnStatus}
      calls={calls as any}
      onError={onError}
      isSponsored={isSponsored}
    >
      <TransactionButton
        text="Follow"
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
