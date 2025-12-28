"use client";

import React, { useMemo } from "react";
import SponsoredTransaction from "./sponsored-transaction";
import EthPaymentTransaction from "./eth-payment-transaction";
import { PIXOTCHI_NFT_ADDRESS } from "@/lib/contracts";
import { useEthMode } from "@/lib/eth-mode-context";
import { useEthQuote } from "@/components/eth-quote-display";
import { parseUnits } from "viem";

const PIXOTCHI_NFT_ABI = [
  {
    inputs: [{ name: "_Id", type: "uint256" }],
    name: "Revive",
    outputs: [],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

// Revive cost: 1000 SEED (fixed)
const REVIVE_COST_SEED = parseUnits('1000', 18);

interface ReviveTransactionProps {
  plantId: number;
  onSuccess?: (tx: any) => void;
  onError?: (error: any) => void;
  buttonText?: string;
  buttonClassName?: string;
  disabled?: boolean;
  showToast?: boolean;
  onStatusUpdate?: (status: any) => void;
}

export default function ReviveTransaction({
  plantId,
  onSuccess,
  onError,
  buttonText: customButtonText,
  buttonClassName,
  disabled = false,
  showToast = true,
  onStatusUpdate,
}: ReviveTransactionProps) {
  const { isEthModeEnabled, canUseEthMode } = useEthMode();
  const { quote, isLoading: isQuoteLoading } = useEthQuote(REVIVE_COST_SEED);

  const calls = useMemo(() => [
    {
      address: PIXOTCHI_NFT_ADDRESS as `0x${string}`,
      abi: PIXOTCHI_NFT_ABI,
      functionName: "Revive" as const,
      args: [BigInt(plantId)],
    },
  ], [plantId]);

  // Build button text with ETH or SEED price
  const buttonText = useMemo(() => {
    if (customButtonText) return customButtonText;

    if (isEthModeEnabled && canUseEthMode && quote) {
      return `Revive (${quote.ethAmountFormatted} ETH)`;
    }

    return "Revive (1000 SEED)";
  }, [customButtonText, isEthModeEnabled, canUseEthMode, quote]);

  // Use ETH Payment when ETH Mode is enabled
  if (isEthModeEnabled && canUseEthMode) {
    return (
      <EthPaymentTransaction
        actionCalls={calls}
        seedAmountRequired={REVIVE_COST_SEED}
        onSuccess={onSuccess}
        onError={onError}
        buttonText={buttonText}
        buttonClassName={buttonClassName}
        disabled={disabled || isQuoteLoading}
      />
    );
  }

  // Default: regular transaction with SEED payment
  return (
    <SponsoredTransaction
      calls={calls}
      onSuccess={onSuccess}
      onError={onError}
      buttonText={buttonText}
      buttonClassName={buttonClassName}
      disabled={disabled}
      showToast={showToast}
      onStatusUpdate={onStatusUpdate}
    />
  );
}


