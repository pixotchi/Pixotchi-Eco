"use client";

import React, { useCallback, useMemo, useState, useEffect } from "react";
import {
    Transaction,
    TransactionButton,
    TransactionStatus,
    TransactionStatusAction,
    TransactionStatusLabel,
} from "@coinbase/onchainkit/transaction";
import type { LifecycleStatus } from "@coinbase/onchainkit/transaction";
import { usePaymaster } from "@/lib/paymaster-context";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { SponsoredBadge } from "@/components/paymaster-toggle";
import GlobalTransactionToast from "./global-transaction-toast";
import { getBuilderCapabilities, transformCallsWithBuilderCode } from "@/lib/builder-code";
import { normalizeTransactionReceipt } from "@/lib/transaction-utils";
import { getEthQuote, formatEthAmount, type EthQuoteResult } from "@/lib/eth-quote-service";
import { useEthMode } from "@/lib/eth-mode-context";
import { PIXOTCHI_TOKEN_ADDRESS, WETH_ADDRESS } from "@/lib/contracts";
import { Loader2 } from "lucide-react";
import { encodeFunctionData } from "viem";

// Uniswap V2 Router ABI for swapExactETHForTokens
const UNISWAP_ROUTER_ABI = [
    {
        inputs: [
            { name: "amountOutMin", type: "uint256" },
            { name: "path", type: "address[]" },
            { name: "to", type: "address" },
            { name: "deadline", type: "uint256" },
        ],
        name: "swapExactETHForTokens",
        outputs: [{ name: "amounts", type: "uint256[]" }],
        stateMutability: "payable",
        type: "function",
    },
] as const;

// BaseSwap Router (Uniswap V2 Fork on Base)
const BASESWAP_ROUTER_ADDRESS = "0x327Df1E6de05895d2ab08513aaDD9313Fe505d86";

interface TransactionCall {
    address: `0x${string}`;
    abi: readonly any[];
    functionName: string;
    args?: readonly any[];
    value?: bigint;
}

interface EthPaymentTransactionProps {
    /** The action calls to execute after swapping ETH to SEED */
    actionCalls: TransactionCall[];
    /** Required SEED amount for the action (in wei) */
    seedAmountRequired: bigint;
    /** Called on successful transaction */
    onSuccess?: (receipt: any) => void;
    /** Called on error */
    onError?: (error: any) => void;
    /** Button text */
    buttonText?: string;
    /** Button class name */
    buttonClassName?: string;
    /** Whether the button is disabled */
    disabled?: boolean;
}

/**
 * EthPaymentTransaction
 * 
 * Handles payment with ETH by:
 * 1. Swapping ETH → SEED (with slippage buffer)
 * 2. Executing the intended action call(s)
 * 
 * Excess SEED remains in the user's wallet as a refund.
 * Only works with smart wallets (for batched transactions).
 */
export function EthPaymentTransaction({
    actionCalls,
    seedAmountRequired,
    onSuccess,
    onError,
    buttonText = "Pay with ETH",
    buttonClassName,
    disabled = false,
}: EthPaymentTransactionProps) {
    const { isSponsored } = usePaymaster();
    const { isSmartWallet } = useSmartWallet();
    const { isEthModeEnabled } = useEthMode();

    const [quote, setQuote] = useState<EthQuoteResult | null>(null);
    const [isQuoteLoading, setIsQuoteLoading] = useState(false);
    const [quoteError, setQuoteError] = useState<string | null>(null);

    // Get builder code capabilities for ERC-8021 attribution
    const builderCapabilities = getBuilderCapabilities();

    // Fetch fresh quote before transaction
    const refreshQuote = useCallback(async () => {
        if (!isEthModeEnabled || !isSmartWallet || seedAmountRequired === BigInt(0)) {
            return null;
        }

        setIsQuoteLoading(true);
        setQuoteError(null);

        try {
            // Force refresh to get latest quote before submission
            const freshQuote = await getEthQuote(seedAmountRequired, true);
            setQuote(freshQuote);
            return freshQuote;
        } catch (err) {
            console.error("[EthPaymentTx] Failed to get quote:", err);
            setQuoteError("Unable to get ETH quote");
            return null;
        } finally {
            setIsQuoteLoading(false);
        }
    }, [seedAmountRequired, isEthModeEnabled, isSmartWallet]);

    // Initial quote fetch
    useEffect(() => {
        refreshQuote();
    }, [refreshQuote]);

    // Build the batched transaction calls
    const calls = useMemo(() => {
        if (!quote || !isEthModeEnabled || !isSmartWallet) {
            return [];
        }

        const swapDeadline = BigInt(Math.floor(Date.now() / 1000) + 1200); // 20 minutes

        // Minimum SEED output (the required amount - we're getting MORE due to buffer)
        const minSeedOut = seedAmountRequired;

        // Path: WETH -> SEED
        const swapPath = [WETH_ADDRESS, PIXOTCHI_TOKEN_ADDRESS] as const;

        // 1. Swap call: swapExactETHForTokens
        // We send the quoted ETH amount and expect at least seedAmountRequired SEED
        const swapCall: TransactionCall = {
            address: BASESWAP_ROUTER_ADDRESS as `0x${string}`,
            abi: UNISWAP_ROUTER_ABI,
            functionName: "swapExactETHForTokens",
            args: [
                minSeedOut,
                swapPath,
                "0x0000000000000000000000000000000000000000", // Will be replaced with user address
                swapDeadline,
            ],
            value: quote.ethAmountWei,
        };

        // 2. Action calls (the original intended actions)
        return [swapCall, ...actionCalls];
    }, [quote, seedAmountRequired, actionCalls, isEthModeEnabled, isSmartWallet]);

    // Transform calls for builder code
    const transformedCalls = useMemo(
        () => transformCallsWithBuilderCode(calls as any[]),
        [calls]
    );

    const handleOnSuccess = useCallback(
        (tx: any) => {
            const normalized = normalizeTransactionReceipt(tx);
            console.log("[EthPaymentTx] Transaction successful:", normalized);
            onSuccess?.(normalized);

            // Dispatch balance refresh
            try {
                window.dispatchEvent(new Event("balances:refresh"));
            } catch { }
        },
        [onSuccess]
    );

    const handleOnStatus = useCallback(
        (status: LifecycleStatus) => {
            if (status.statusName === "success") {
                const receipts = (status.statusData as any)?.transactionReceipts;
                if (receipts?.[0]) {
                    handleOnSuccess(receipts[0]);
                }
            }
        },
        [handleOnSuccess]
    );

    // Not in ETH mode or not smart wallet - shouldn't be rendered
    if (!isEthModeEnabled || !isSmartWallet) {
        return null;
    }

    // Show loading while getting initial quote
    if (isQuoteLoading && !quote) {
        return (
            <div className="flex items-center justify-center py-3 text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin mr-2" />
                <span className="text-sm">Getting ETH quote...</span>
            </div>
        );
    }

    // Quote error
    if (quoteError && !quote) {
        return (
            <div className="text-center py-3 text-destructive">
                <p className="text-sm">{quoteError}</p>
                <button
                    onClick={() => refreshQuote()}
                    className="text-xs underline mt-1"
                >
                    Retry
                </button>
            </div>
        );
    }

    // No valid calls
    if (calls.length === 0) {
        return null;
    }

    const displayButtonText = quote
        ? `${buttonText} (${quote.ethAmountFormatted} ETH)`
        : buttonText;

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium">{displayButtonText}</span>
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
                    text={displayButtonText}
                    className={buttonClassName}
                    disabled={disabled || isQuoteLoading}
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

export default EthPaymentTransaction;
