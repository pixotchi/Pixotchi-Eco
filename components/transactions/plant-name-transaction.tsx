"use client";

import React, { useCallback } from 'react';
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
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { SponsoredBadge } from '@/components/paymaster-toggle';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';

const PIXOTCHI_NFT_ABI = [
  {
    inputs: [
      { name: '_id', type: 'uint256' },
      { name: '_name', type: 'string' }
    ],
    name: 'setPlantName',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

interface PlantNameTransactionProps {
  plantId: number;
  newName: string;
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export function PlantNameTransaction({
  plantId,
  newName,
  onSuccess,
  onError,
  buttonText = "Change Name (350 SEED)",
  buttonClassName,
  disabled = false
}: PlantNameTransactionProps) {
  
  const { isSponsored } = usePaymaster();
  const { isSmartWallet } = useSmartWallet();
  
  const calls = [{
    address: PIXOTCHI_NFT_ADDRESS,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'setPlantName',
    args: [BigInt(plantId), newName], 
  }];

  const handleOnSuccess = useCallback((tx: any) => {
    console.log('Plant name change transaction successful:', tx);
    onSuccess?.(tx);
  }, [onSuccess]);

  const handleOnStatus = useCallback((status: LifecycleStatus) => {
    if (status.statusName === 'success') {
      handleOnSuccess(status.statusData.transactionReceipts[0]);
    }
  }, [handleOnSuccess]);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{buttonText}</span>
        <SponsoredBadge show={isSponsored && isSmartWallet} />
      </div>
      
      <Transaction
        calls={calls}
        onError={onError}
        onStatus={handleOnStatus}
        isSponsored={isSponsored}
      >
        <TransactionButton
          text={buttonText}
          className={buttonClassName}
          disabled={disabled}
        />
        
        <TransactionStatus>
          <TransactionStatusLabel />
          <TransactionStatusAction />
        </TransactionStatus>

        <GlobalTransactionToast />
      </Transaction>
    </div>
  );
}

export default PlantNameTransaction;