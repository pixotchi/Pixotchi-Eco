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
import GlobalTransactionToast from './global-transaction-toast';
import type { LifecycleStatus } from '@coinbase/onchainkit/transaction';
import { usePaymaster } from '@/lib/paymaster-context';
import type { TransactionCall } from '@/lib/types';
import { normalizeTransactionReceipt } from '@/lib/transaction-utils';
import { getBuilderCapabilities, transformCallsWithBuilderCode } from '@/lib/builder-code';

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

  // Get builder code capabilities for ERC-8021 attribution (for smart wallets with ERC-5792)
  const builderCapabilities = getBuilderCapabilities();

  // Transform calls to include builder suffix in calldata (for EOA wallets without ERC-5792)
  const transformedCalls = useMemo(() =>
    transformCallsWithBuilderCode(calls as any[]) as TransactionCall[],
    [calls]
  );

  const { handleOnStatus, handleOnError } = useTransactionLifecycle({
    onSuccess: (tx) => {
      // Normalize receipt to ensure transactionHash is accessible across all wallet types
      // The hook passes the raw receipt
      const normalizedReceipt = normalizeTransactionReceipt(tx);
      console.log('Smart wallet transaction successful:', normalizedReceipt);
      onSuccess?.(normalizedReceipt);
    },
    onError,
    onStatusUpdate: (status) => console.log('Smart wallet status update:', status.statusName)
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