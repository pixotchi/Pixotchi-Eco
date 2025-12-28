"use client";

import React, { useMemo } from 'react';
import SmartWalletTransaction from './smart-wallet-transaction';
import EthPaymentTransaction from './eth-payment-transaction';
import { PIXOTCHI_TOKEN_ADDRESS, PIXOTCHI_NFT_ADDRESS } from '@/lib/contracts';
import { useEthMode } from '@/lib/eth-mode-context';
import { useEthQuote } from '@/components/eth-quote-display';

const ERC20_ABI = [
  {
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' }
    ],
    name: 'approve',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

const NFT_ABI = [
  {
    inputs: [{ name: 'strain', type: 'uint256' }],
    name: 'mint',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const;

interface ApproveMintBundleProps {
  strain: number;
  tokenAddress?: `0x${string}`; // Optional: defaults to SEED token
  mintPrice?: bigint; // Mint price in wei for ETH quote
  onSuccess?: (tx: any) => void;
  onTransactionComplete?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
}

export default function ApproveMintBundle({
  strain,
  tokenAddress,
  mintPrice,
  onSuccess,
  onTransactionComplete,
  onError,
  buttonText: customButtonText,
  buttonClassName = 'w-full',
  disabled = false,
}: ApproveMintBundleProps) {
  const { isEthModeEnabled, canUseEthMode } = useEthMode();

  // Get ETH quote for the mint price (if provided)
  const { quote, isLoading: isQuoteLoading } = useEthQuote(mintPrice || BigInt(0));

  // Unlimited approval followed by mint call
  const maxApproval = BigInt('115792089237316195423570985008687907853269984665640564039457584007913129639935');

  // Use provided token address or default to SEED
  const token = tokenAddress || PIXOTCHI_TOKEN_ADDRESS;

  // For ETH mode, we only need the mint call (no approve needed since we're swapping)
  const mintCalls = useMemo(() => [{
    address: PIXOTCHI_NFT_ADDRESS as `0x${string}`,
    abi: NFT_ABI,
    functionName: 'mint' as const,
    args: [BigInt(strain)],
  }], [strain]);

  // Full calls with approve for SEED payment
  const approveAndMintCalls = useMemo(() => [
    {
      address: token as `0x${string}`,
      abi: ERC20_ABI,
      functionName: 'approve' as const,
      args: [PIXOTCHI_NFT_ADDRESS, maxApproval],
    },
    {
      address: PIXOTCHI_NFT_ADDRESS as `0x${string}`,
      abi: NFT_ABI,
      functionName: 'mint' as const,
      args: [BigInt(strain)],
    },
  ], [strain, token, maxApproval]);

  // Build button text
  const buttonText = useMemo(() => {
    if (customButtonText) return customButtonText;

    if (isEthModeEnabled && canUseEthMode && quote && mintPrice && mintPrice > BigInt(0)) {
      return `Mint (${quote.ethAmountFormatted} ETH)`;
    }

    return 'Approve + Mint';
  }, [customButtonText, isEthModeEnabled, canUseEthMode, quote, mintPrice]);

  const handleSuccess = (tx: any) => {
    onSuccess?.(tx);
    onTransactionComplete?.(tx);
  };

  // Use ETH Payment when ETH Mode is enabled and we have a mint price
  // Also check that the payment token is SEED (not other tokens like JESSE)
  const canUseEthPayment = isEthModeEnabled && canUseEthMode && mintPrice && mintPrice > BigInt(0) &&
    (!tokenAddress || tokenAddress.toLowerCase() === PIXOTCHI_TOKEN_ADDRESS.toLowerCase());

  if (canUseEthPayment) {
    return (
      <EthPaymentTransaction
        actionCalls={mintCalls}
        seedAmountRequired={mintPrice}
        onSuccess={handleSuccess}
        onError={onError}
        buttonText={buttonText}
        buttonClassName={buttonClassName}
        disabled={disabled || isQuoteLoading}
      />
    );
  }

  // Default: SmartWalletTransaction with SEED approval + mint
  return (
    <SmartWalletTransaction
      calls={approveAndMintCalls}
      onSuccess={handleSuccess}
      onError={onError}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      disabled={disabled}
      showToast={true}
    />
  );
}


