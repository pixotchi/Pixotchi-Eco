"use client";

import React, { useMemo } from 'react';
import SponsoredTransaction from './sponsored-transaction';
import EthPaymentTransaction from './eth-payment-transaction';
import { PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import { useEthMode } from '@/lib/eth-mode-context';
import { useEthQuote } from '@/components/eth-quote-display';

const PIXOTCHI_NFT_ABI = [
  {
    inputs: [{ name: 'strain', type: 'uint256' }],
    name: 'mint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

interface MintTransactionProps {
  strain: number;
  mintPrice?: bigint; // Mint price in wei for ETH quote
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export default function MintTransaction({
  strain,
  mintPrice,
  onSuccess,
  onError,
  buttonText: customButtonText,
  buttonClassName,
  disabled = false
}: MintTransactionProps) {
  const { isEthModeEnabled, canUseEthMode } = useEthMode();
  const { quote, isLoading: isQuoteLoading } = useEthQuote(mintPrice || BigInt(0));

  const calls = useMemo(() => [{
    address: PIXOTCHI_NFT_ADDRESS as `0x${string}`,
    abi: PIXOTCHI_NFT_ABI,
    functionName: 'mint' as const,
    args: [BigInt(strain)],
  }], [strain]);

  // Build button text with ETH or SEED price
  const buttonText = useMemo(() => {
    if (customButtonText && !isEthModeEnabled) return customButtonText;

    if (isEthModeEnabled && canUseEthMode && quote && mintPrice && mintPrice > BigInt(0)) {
      return `Mint Plant (${quote.ethAmountFormatted} ETH)`;
    }

    return customButtonText || "Mint Plant";
  }, [customButtonText, isEthModeEnabled, canUseEthMode, quote, mintPrice]);

  // Use ETH Payment when ETH Mode is enabled
  if (isEthModeEnabled && canUseEthMode && mintPrice && mintPrice > BigInt(0)) {
    return (
      <EthPaymentTransaction
        actionCalls={calls}
        seedAmountRequired={mintPrice}
        onSuccess={onSuccess}
        onError={onError}
        buttonText={buttonText}
        buttonClassName={buttonClassName}
        disabled={disabled || isQuoteLoading}
      />
    );
  }

  return (
    <SponsoredTransaction
      calls={calls}
      onSuccess={onSuccess}
      onError={onError}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      disabled={disabled}
    />
  );
} 