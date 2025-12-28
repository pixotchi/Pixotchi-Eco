"use client";

import { useEthQuote } from "@/components/eth-quote-display";
import { Loader2 } from "lucide-react";

interface EthPriceDisplayProps {
    seedAmount: bigint;
    className?: string;
}

/**
 * Simple inline component to display ETH price for a SEED amount.
 * Used in Details cards to show ETH equivalent price.
 */
export function EthPriceDisplay({ seedAmount, className }: EthPriceDisplayProps) {
    const { quote, isLoading } = useEthQuote(seedAmount);

    if (isLoading) {
        return <span className={className}><Loader2 className="w-3 h-3 animate-spin inline mr-1" />Loading...</span>;
    }

    if (!quote) {
        return <span className={className}>--</span>;
    }

    return <span className={className}>{quote.ethAmountFormatted} ETH</span>;
}

export default EthPriceDisplay;
