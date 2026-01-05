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
import { getBuilderCapabilities, transformCallsWithBuilderCode } from '@/lib/builder-code';

interface UniversalTransactionProps {
  calls: TransactionCall[];
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText: string;
  buttonClassName?: string;
  disabled?: boolean;
  showToast?: boolean;
  forceUnsponsored?: boolean; // Force transaction to be unsponsored (e.g., for swaps)
}

export default function UniversalTransaction({
  calls,
  onSuccess,
  onError,
  buttonText,
  buttonClassName = "",
  disabled = false,
  showToast = true,
  forceUnsponsored = false
}: UniversalTransactionProps) {
  const { isSponsored: paymasterEnabled } = usePaymaster();

  // Determine if this transaction should be sponsored
  const isSponsored = forceUnsponsored ? false : paymasterEnabled;

  // Get builder code capabilities for ERC-8021 attribution (for smart wallets with ERC-5792)
  const builderCapabilities = getBuilderCapabilities();

  // Transform calls to include builder suffix in calldata (for EOA wallets without ERC-5792)
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
    onSuccess,
    onError,
    onStatusUpdate: (status) => console.log('Universal status update:', status.statusName)
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