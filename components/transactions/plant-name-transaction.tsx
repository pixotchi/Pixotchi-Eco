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
import EthPaymentTransaction from './eth-payment-transaction';
import type { LifecycleStatus } from '@coinbase/onchainkit/transaction';
import { usePaymaster } from '@/lib/paymaster-context';
import { useSmartWallet } from '@/lib/smart-wallet-context';
import { useEthMode } from '@/lib/eth-mode-context';
import { useEthQuote } from '@/components/eth-quote-display';
import { SponsoredBadge } from '@/components/paymaster-toggle';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import { getBuilderCapabilities, transformCallsWithBuilderCode } from '@/lib/builder-code';
import { parseUnits } from 'viem';

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

// Fixed cost for name change: 350 SEED
const NAME_CHANGE_COST_SEED = parseUnits('350', 18);

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
  buttonText: customButtonText,
  buttonClassName,
  disabled = false
}: PlantNameTransactionProps) {

  const { isSponsored } = usePaymaster();
  const { isSmartWallet } = useSmartWallet();
  const { isEthModeEnabled, canUseEthMode } = useEthMode();

  // Get ETH quote for the fixed 350 SEED cost
  const { quote, isLoading: isQuoteLoading } = useEthQuote(NAME_CHANGE_COST_SEED);

  // Get builder code capabilities for ERC-8021 attribution (for smart wallets with ERC-5792)
  const builderCapabilities = getBuilderCapabilities();

  const calls = useMemo(() => [{
    address: PIXOTCHI_NFT_ADDRESS as `0x${string}`,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'setPlantName' as const,
    args: [BigInt(plantId), newName] as const,
  }], [plantId, newName]);

  // Transform calls to include builder suffix in calldata (for EOA wallets without ERC-5792)
  const transformedCalls = useMemo(() =>
    transformCallsWithBuilderCode(calls as any[]),
    [calls]
  );

  // Build button text with ETH or SEED price
  const buttonText = useMemo(() => {
    if (customButtonText) return customButtonText;

    if (isEthModeEnabled && canUseEthMode && quote) {
      return `Change Name (${quote.ethAmountFormatted} ETH)`;
    }

    return "Change Name (350 SEED)";
  }, [customButtonText, isEthModeEnabled, canUseEthMode, quote]);

  const handleOnSuccess = useCallback((tx: any) => {
    console.log('Plant name change transaction successful:', tx);
    onSuccess?.(tx);
  }, [onSuccess]);

  const handleOnStatus = useCallback((status: LifecycleStatus) => {
    if (status.statusName === 'success') {
      handleOnSuccess((status.statusData as any).transactionReceipts[0]);
    }
  }, [handleOnSuccess]);

  // Use ETH Payment when ETH Mode is enabled
  if (isEthModeEnabled && canUseEthMode) {
    return (
      <EthPaymentTransaction
        actionCalls={calls}
        seedAmountRequired={NAME_CHANGE_COST_SEED}
        onSuccess={handleOnSuccess}
        onError={onError}
        buttonText={buttonText}
        buttonClassName={buttonClassName}
        disabled={disabled || isQuoteLoading}
      />
    );
  }

  // Default: regular transaction with SEED payment
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{buttonText}</span>
        <SponsoredBadge show={isSponsored && isSmartWallet} />
      </div>

      <Transaction
        calls={transformedCalls}
        onError={onError}
        onStatus={handleOnStatus}
        isSponsored={isSponsored}
        capabilities={builderCapabilities}
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