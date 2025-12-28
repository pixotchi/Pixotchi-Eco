"use client";

import { useState, useEffect, useCallback } from "react";
import { formatEthAmount, getEthQuote, getCachedEthQuote, type EthQuoteResult } from "@/lib/eth-quote-service";
import { useEthMode } from "@/lib/eth-mode-context";
import { Loader2, AlertCircle, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";

interface EthQuoteDisplayProps {
    /** Amount of SEED in wei */
    seedAmountWei: bigint;
    /** Optional multiplier for quantity (e.g., buying 5 items) */
    quantity?: number;
    /** Show inline (compact) or block (full) style */
    variant?: "inline" | "block";
    /** Optional className */
    className?: string;
    /** Callback when quote is fetched (for parent to use) */
    onQuoteUpdate?: (quote: EthQuoteResult | null) => void;
}

/**
 * Displays an ETH equivalent for a SEED amount.
 * 
 * When ETH Mode is enabled, shows the ETH price instead of SEED.
 * Uses cached quotes and multiplies for quantity changes.
 */
export function EthQuoteDisplay({
    seedAmountWei,
    quantity = 1,
    variant = "inline",
    className,
    onQuoteUpdate,
}: EthQuoteDisplayProps) {
    const { isEthModeEnabled, canUseEthMode } = useEthMode();
    const [quote, setQuote] = useState<EthQuoteResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Calculate total SEED amount based on quantity
    const totalSeedWei = seedAmountWei * BigInt(quantity);

    const fetchQuote = useCallback(async (forceRefresh = false) => {
        if (!isEthModeEnabled || !canUseEthMode || totalSeedWei === BigInt(0)) {
            return;
        }

        setIsLoading(true);
        setError(null);

        try {
            const result = await getEthQuote(totalSeedWei, forceRefresh);
            setQuote(result);
            onQuoteUpdate?.(result);
        } catch (err) {
            console.error("[EthQuoteDisplay] Failed to fetch quote:", err);
            setError("Quote unavailable");
            setQuote(null);
            onQuoteUpdate?.(null);
        } finally {
            setIsLoading(false);
        }
    }, [totalSeedWei, isEthModeEnabled, canUseEthMode, onQuoteUpdate]);

    // Try to get cached quote first (instant for quantity changes)
    useEffect(() => {
        if (!isEthModeEnabled || !canUseEthMode || totalSeedWei === BigInt(0)) {
            setQuote(null);
            return;
        }

        // Try cached quote first (instant)
        const cached = getCachedEthQuote(totalSeedWei);
        if (cached && !cached.isStale) {
            setQuote(cached);
            onQuoteUpdate?.(cached);
            return;
        }

        // No valid cache, fetch fresh
        fetchQuote(false);
    }, [totalSeedWei, isEthModeEnabled, canUseEthMode, fetchQuote, onQuoteUpdate]);

    // Don't render if ETH Mode is not enabled or can't be used
    if (!isEthModeEnabled || !canUseEthMode) {
        return null;
    }

    if (isLoading && !quote) {
        return (
            <span className={cn("inline-flex items-center gap-1 text-muted-foreground", className)}>
                <Loader2 className="w-3 h-3 animate-spin" />
                <span className="text-xs">...</span>
            </span>
        );
    }

    if (error && !quote) {
        return (
            <span className={cn("inline-flex items-center gap-1 text-destructive", className)}>
                <AlertCircle className="w-3 h-3" />
                {variant === "block" && (
                    <button
                        onClick={() => fetchQuote(true)}
                        className="text-xs underline"
                    >
                        Retry
                    </button>
                )}
            </span>
        );
    }

    if (!quote) {
        return null;
    }

    if (variant === "block") {
        return (
            <div className={cn("flex items-center gap-2", className)}>
                <span className="font-medium">{quote.ethAmountFormatted} ETH</span>
                {quote.isStale && (
                    <button
                        onClick={() => fetchQuote(true)}
                        className="text-muted-foreground hover:text-foreground"
                        title="Refresh quote"
                    >
                        <RefreshCw className="w-3 h-3" />
                    </button>
                )}
                {isLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
            </div>
        );
    }

    // Inline variant
    return (
        <span className={cn("inline-flex items-center gap-1", className)}>
            <span>{quote.ethAmountFormatted} ETH</span>
            {quote.isStale && <RefreshCw className="w-3 h-3 text-muted-foreground" />}
            {isLoading && <Loader2 className="w-3 h-3 animate-spin text-muted-foreground" />}
        </span>
    );
}

/**
 * Hook to use ETH quotes in components
 */
export function useEthQuote(seedAmountWei: bigint, quantity = 1) {
    const { isEthModeEnabled, canUseEthMode } = useEthMode();
    const [quote, setQuote] = useState<EthQuoteResult | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const totalSeedWei = seedAmountWei * BigInt(quantity);

    const refreshQuote = useCallback(async (forceRefresh = false) => {
        if (!isEthModeEnabled || !canUseEthMode || totalSeedWei === BigInt(0)) {
            return null;
        }

        setIsLoading(true);
        setError(null);

        try {
            const result = await getEthQuote(totalSeedWei, forceRefresh);
            setQuote(result);
            return result;
        } catch (err) {
            const errorMsg = "Quote unavailable";
            setError(errorMsg);
            setQuote(null);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, [totalSeedWei, isEthModeEnabled, canUseEthMode]);

    // Auto-fetch on mount and when dependencies change
    useEffect(() => {
        if (!isEthModeEnabled || !canUseEthMode || totalSeedWei === BigInt(0)) {
            setQuote(null);
            return;
        }

        // Try cached first
        const cached = getCachedEthQuote(totalSeedWei);
        if (cached && !cached.isStale) {
            setQuote(cached);
            return;
        }

        refreshQuote(false);
    }, [totalSeedWei, isEthModeEnabled, canUseEthMode, refreshQuote]);

    return {
        quote,
        isLoading,
        error,
        refreshQuote,
        isEnabled: isEthModeEnabled && canUseEthMode,
    };
}

export default EthQuoteDisplay;
