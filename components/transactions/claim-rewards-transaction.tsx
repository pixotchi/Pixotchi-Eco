"use client";

import React, { useCallback, useMemo } from 'react';
import {
  Transaction,
  TransactionButton,
  TransactionStatus,
  TransactionStatusAction,
  TransactionStatusLabel,
} from '@coinbase/onchainkit/transaction';
import GlobalTransactionToast from './global-transaction-toast';
import type { LifecycleStatus } from '@coinbase/onchainkit/transaction';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import { getBuilderCapabilities, transformCallsWithBuilderCode } from '@/lib/builder-code';

const PIXOTCHI_NFT_ABI = [
  {
    inputs: [
      { name: 'id', type: 'uint256' },
    ],
    name: 'redeem',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

interface ClaimRewardsTransactionProps {
  plantId: number;
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  minimal?: boolean; // render only the button (no header/badges)
}

export default function ClaimRewardsTransaction({
  plantId,
  onSuccess,
  onError,
  buttonText = "Yes, Claim",
  buttonClassName,
  disabled = false,
  minimal = false
}: ClaimRewardsTransactionProps) {
  const calls = useMemo(() => [{
    address: PIXOTCHI_NFT_ADDRESS,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'redeem',
    args: [BigInt(plantId)],
  }], [plantId]);

  // Get builder code capabilities for ERC-8021 attribution (for smart wallets with ERC-5792)
  const builderCapabilities = getBuilderCapabilities();

  // Transform calls to include builder suffix in calldata (for EOA wallets without ERC-5792)
  const transformedCalls = useMemo(() =>
    transformCallsWithBuilderCode(calls as any[]),
    [calls]
  );

  const handleOnSuccess = useCallback((tx: any) => {
    onSuccess?.(tx);
  }, [onSuccess]);

  const handleOnStatus = useCallback((status: LifecycleStatus) => {
    if (status.statusName === 'success') {
      handleOnSuccess(status.statusData.transactionReceipts[0]);
    }
  }, [handleOnSuccess]);

  return (
    <div className={minimal ? undefined : "space-y-2"}>
      {!minimal && (
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">{buttonText}</span>
        </div>
      )}

      <Transaction
        calls={transformedCalls}
        onError={onError}
        onStatus={handleOnStatus}
        isSponsored={false}
        capabilities={builderCapabilities}
        resetAfter={2000}
      >
        <TransactionButton
          text={buttonText}
          className={buttonClassName}
          disabled={disabled}
        />

        {!minimal && (
          <TransactionStatus>
            <TransactionStatusLabel />
            <TransactionStatusAction />
          </TransactionStatus>
        )}

        <GlobalTransactionToast />
      </Transaction>
    </div>
  );
}

