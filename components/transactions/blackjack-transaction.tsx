"use client";
import { parseBlackjackTransactionResult, type BlackjackTransactionResult } from "@/lib/blackjack-events";
import type { TransactionCall } from "@/lib/types";
import type { TransactionReceiptLike } from "@/lib/transaction-utils";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { Loader2 } from 'lucide-react';
import { usePaymaster } from "@/lib/paymaster-context";
import {
    Transaction,
    TransactionButton,
} from './transaction-kit';
import type { LifecycleStatus } from './transaction-kit';
import GlobalTransactionToast from './global-transaction-toast';
import {
    LAND_CONTRACT_ADDRESS,
    blackjackFetchRandomness,
    buildBlackjackDealWithRandomCall,
    buildBlackjackDealWithRandomForTokenCall,
    buildBlackjackActionWithRandomCall,
    BlackjackAction,
} from "@/lib/contracts";
import { getMiniAppQuickAuthHeaders } from "@/lib/farcaster-miniapp-auth-client";
import { BlackjackResult, getResultText } from "@/public/abi/blackjack-abi";
import { toast } from "react-hot-toast";
import { extractTransactionHash } from "@/lib/transaction-utils";
import { useAccount } from "wagmi";
import { getBuilderCapabilities, transformCallsWithBuilderCode } from '@/lib/builder-code';
import { postMissionProgress } from '@/lib/mission-tracking';

interface BlackjackTransactionProps {
    mode: "deal" | "action";
    landId: bigint;
    betAmount?: bigint;
    handIndex?: number;
    action?: BlackjackAction;
    disabled?: boolean;
    buttonAriaLabel?: string;
    buttonText?: string;
    buttonClassName?: string;
    onStatusUpdate?: (status: LifecycleStatus) => void;
    onComplete?: (result?: BlackjackTransactionResult) => void;
    onButtonClick?: () => boolean | void | { handIndex?: number } | Promise<boolean | void | { handIndex?: number }>;
    onPreparedCancel?: (reason: "cancelled" | "expired") => void;
    onError?: (error: string) => void;
    tokenSymbol?: string;
    tokenDecimals?: number;
    bettingToken?: string | null;
}

const FAILURE_STATUSES = new Set([
    "error", "failed", "reverted", "cancelled", "canceled",
    "rejected", "transactionRejected", "userRejected", "buildError",
]);
const PREPARED_FALLBACK_TIMEOUT_MS = 60_000;

type Phase = "idle" | "fetching" | "ready" | "pending" | "complete" | "error";

export default function BlackjackTransaction({
    mode,
    landId,
    betAmount,
    handIndex = 0,
    action,
    disabled = false,
    buttonAriaLabel,
    buttonText,
    buttonClassName,
    onStatusUpdate,
    onComplete,
    onButtonClick,
    onPreparedCancel,
    onError,
    tokenSymbol = "SEED",
    tokenDecimals = 18,
    bettingToken = null,
}: BlackjackTransactionProps) {
    const { address } = useAccount();
    const { isSponsored } = usePaymaster();
    const builderCapabilities = getBuilderCapabilities();
    const processedTxHashes = useRef<Set<string>>(new Set());
    const successHandledRef = useRef(false);

    const [phase, setPhase] = useState<Phase>("idle");
    const [error, setError] = useState<string | null>(null);
    const [calls, setCalls] = useState<TransactionCall[]>([]);
    const [preparedExpiresAt, setPreparedExpiresAt] = useState<number | null>(null);

    // Normalize to raw serializable calls for embedded-wallet compatibility.
    // Builder attribution is appended by transform helper + wallet_sendCalls capability.
    const transformedCalls = useMemo(() => {
        if (calls.length === 0) return [];
        return transformCallsWithBuilderCode(calls);
    }, [calls]);

    // Reset on mode/landId change
    useEffect(() => {
        processedTxHashes.current.clear();
        setPhase("idle");
        setError(null);
        setCalls([]);
        setPreparedExpiresAt(null);
    }, [mode, landId]);

    const resetPreparedAction = useCallback((reason: "cancelled" | "expired") => {
        setPhase("idle");
        setCalls([]);
        setPreparedExpiresAt(null);
        setError(reason === "expired" ? "Prepared action expired. Retry the same action to continue." : null);
        onPreparedCancel?.(reason);
    }, [onPreparedCancel]);

    useEffect(() => {
        if (phase !== "ready") return;

        const timeoutMs = preparedExpiresAt
            ? Math.max((preparedExpiresAt * 1000) - Date.now(), 0)
            : PREPARED_FALLBACK_TIMEOUT_MS;
        const timeoutId = window.setTimeout(() => {
            resetPreparedAction("expired");
        }, timeoutMs);

        return () => window.clearTimeout(timeoutId);
    }, [phase, preparedExpiresAt, resetPreparedAction]);

    // Fetch randomness and build transaction
    const fetchRandomnessAndBuildCalls = useCallback(async () => {
        if (!address) {
            toast.error("Wallet not connected");
            return;
        }

        const preflightResult = await onButtonClick?.();
        if (preflightResult === false) {
            setPhase("idle");
            return;
        }

        let resolvedHandIndex = handIndex;
        if (preflightResult && typeof preflightResult === "object") {
            if (typeof preflightResult.handIndex === "number") {
                resolvedHandIndex = preflightResult.handIndex;
            }
        }

        setPhase("fetching");
        setError(null);

        try {


            const actionName = mode === "deal" ? "deal" :
                action === BlackjackAction.HIT ? "hit" :
                    action === BlackjackAction.STAND ? "stand" :
                        action === BlackjackAction.DOUBLE ? "double" :
                            action === BlackjackAction.SPLIT ? "split" :
                                action === BlackjackAction.SURRENDER ? "surrender" : "action";

            const authHeaders = await getMiniAppQuickAuthHeaders({ expectedAddress: address });
            const result = await blackjackFetchRandomness(
                landId,
                actionName,
                address,
                resolvedHandIndex,
                mode === "deal" ? bettingToken ?? undefined : undefined,
                mode === "deal" ? betAmount?.toString() : undefined,
                authHeaders,
            );



            // Build transaction call
            let call;
            if (mode === "deal" && betAmount) {
                const lockedBetAmount =
                    typeof result.lockedBetAmountWei === "string"
                        ? BigInt(result.lockedBetAmountWei)
                        : null;
                if (lockedBetAmount === null || lockedBetAmount !== betAmount) {
                    throw new Error("Prepared Blackjack bet changed. Retry with the same bet amount.");
                }

                call = bettingToken
                    ? buildBlackjackDealWithRandomForTokenCall(
                        landId,
                        lockedBetAmount,
                        bettingToken,
                        result.randomSeed,
                        result.nonce,
                        result.signature
                    )
                    : buildBlackjackDealWithRandomCall(
                        landId,
                        lockedBetAmount,
                        result.randomSeed,
                        result.nonce,
                        result.signature
                    );
            } else if (mode === "action" && action !== undefined) {
                call = buildBlackjackActionWithRandomCall(
                    landId, resolvedHandIndex, action, result.randomSeed, result.nonce, result.signature
                );
            } else {
                throw new Error("Invalid parameters");
            }


            setCalls([call]);
            setPreparedExpiresAt(typeof result.expiresAt === "number" ? result.expiresAt : null);
            setPhase("ready");

        } catch (err) {
            console.error("[Blackjack] Failed:", err);
            const msg = err instanceof Error ? err.message : "Failed to prepare transaction";

            setError(msg);
            setPhase("error");
            if (onError) {
                onError(msg);
            } else {
                toast.error(msg);
            }
        }
    }, [address, landId, mode, betAmount, action, handIndex, onButtonClick, onError, bettingToken]);

    // Handle transaction status
    const handleStatus = (status: LifecycleStatus) => {

        onStatusUpdate?.(status);

        if (status.statusName === 'transactionPending') {
            successHandledRef.current = false;
            setPhase("pending");
        }

        if (FAILURE_STATUSES.has(status.statusName ?? "")) {
            setPhase("idle");
            setCalls([]);
            setPreparedExpiresAt(null);
            onComplete?.(undefined);
            return;
        }

        if (status.statusName === "success" && !successHandledRef.current) {
            successHandledRef.current = true;
            setPhase("complete");

            const receipts = status.statusData.transactionReceipts;

            // Parse events
            // OnchainKit can surface duplicate receipts for the same hash; dedupe first.
            const receiptsByHash = new Map<string, TransactionReceiptLike>();
            const newReceipts: TransactionReceiptLike[] = [];
            for (const receipt of receipts) {
                const txHash = receipt?.transactionHash;
                if (!txHash) {
                    newReceipts.push(receipt);
                    continue;
                }
                if (processedTxHashes.current.has(txHash)) continue;
                if (!receiptsByHash.has(txHash)) {
                    receiptsByHash.set(txHash, receipt);
                }
            }
            newReceipts.push(...receiptsByHash.values());
            if (newReceipts.length === 0) {
                onComplete?.({ success: true });
                setTimeout(() => { setPhase("idle"); setCalls([]); setPreparedExpiresAt(null); }, 500);
                return;
            }
            newReceipts.forEach(r => {
                if (r?.transactionHash) processedTxHashes.current.add(r.transactionHash);
            });

            const { result: resultData, gameComplete } = parseBlackjackTransactionResult(newReceipts, mode, action, tokenDecimals, LAND_CONTRACT_ADDRESS);

            // Emit one toast per successful settlement
            if (resultData.splitResults && resultData.splitResults.length > 1) {
                const totalPayout = resultData.payout || "0";
                const handSummary = resultData.splitResults
                    .map((hand: { result: BlackjackResult }, idx: number) => `H${idx + 1} ${getResultText(hand.result)}`)
                    .join(" | ");
                if (parseFloat(totalPayout) > 0) {
                    toast.success(`Split resolved: ${handSummary}. Total payout ${totalPayout} ${tokenSymbol}`);
                } else {
                    toast.error(`Split resolved: ${handSummary}.`);
                }
            } else if (resultData.gameResult !== undefined && resultData.gameResult !== BlackjackResult.NONE) {
                const txt = getResultText(resultData.gameResult);
                if (resultData.gameResult === BlackjackResult.PLAYER_WIN || resultData.gameResult === BlackjackResult.PLAYER_BLACKJACK) {
                    toast.success(`${txt} Payout ${resultData.payout || "0"} ${tokenSymbol}!`);
                } else if (resultData.gameResult === BlackjackResult.PUSH) {
                    toast.success('Push!');
                } else {
                    toast.error(txt);
                }
            }

            const gameSettled =
                gameComplete ||
                (resultData.gameResult !== undefined && resultData.gameResult !== BlackjackResult.NONE) ||
                (Array.isArray(resultData.splitResults) && resultData.splitResults.length > 0);

            if (address && mode === "action" && gameSettled) {
                const txHash = extractTransactionHash(newReceipts[0] ?? receipts[0]);
                if (txHash) {
                    postMissionProgress({
                        address,
                        taskId: "s3_play_casino_game",
                        proof: { txHash },
                    }).catch(() => { });
                }
            }

            setTimeout(() => { setPhase("idle"); setCalls([]); setPreparedExpiresAt(null); }, 500);
            onComplete?.(resultData);
        }
    };

    // Get button text
    const getButtonText = () => {
        if (phase === "fetching") return "Preparing...";
        if (phase === "pending") return "Confirming...";
        if (buttonText) return buttonText;
        if (mode === "deal") return "Deal";
        switch (action) {
            case BlackjackAction.HIT: return "Hit";
            case BlackjackAction.STAND: return "Stand";
            case BlackjackAction.DOUBLE: return "Double";
            case BlackjackAction.SPLIT: return "Split";
            case BlackjackAction.SURRENDER: return "Surrender";
            default: return "Action";
        }
    };

    const isDisabled = disabled || phase === "fetching" || phase === "pending" ||
        (mode === "deal" && (!betAmount || betAmount <= BigInt(0))) ||
        (mode === "action" && action === undefined);

    const defaultClassName = "w-full min-h-11 rounded-[var(--radius-control)] px-4 py-2 font-bold transition-colors";
    const activeClassName = buttonClassName || `${defaultClassName} bg-[hsl(var(--warning))] bg-[image:var(--gradient-warning)] text-[hsl(var(--warning-foreground))] hover:brightness-[1.03]`;
    const disabledClassName = `${defaultClassName} bg-muted text-muted-foreground cursor-not-allowed`;
    const resolvedButtonText = getButtonText();
    const resolvedButtonAriaLabel = buttonAriaLabel ?? (
        mode === "deal"
            ? "Deal Blackjack hand"
            : `${resolvedButtonText} current Blackjack hand`
    );

    // Phase: idle, error - show prepare button
    if (phase === "idle" || phase === "error" || phase === "fetching") {
        return (
            <button
                type="button"
                onClick={fetchRandomnessAndBuildCalls}
                disabled={isDisabled}
                className={isDisabled ? disabledClassName : activeClassName}
                aria-label={error ? `Retry ${resolvedButtonAriaLabel}` : resolvedButtonAriaLabel}
                aria-busy={phase === "fetching"}
            >
                {phase === "fetching" ? (
                    <>
                        <span className="flex items-center justify-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            Preparing...
                        </span>
                    </>
                ) : error ? (
                    "Retry"
                ) : (
                    resolvedButtonText
                )}
            </button>
        );
    }

    // Phase: ready - show Transaction component (user clicks to trigger wallet)
    // Phase: pending/complete - show status
    if (transformedCalls.length > 0) {
        return (
            <Transaction
                effects={{ domains: ["arcade", "balances"] }}
                intentKey={`blackjack:${landId}`}
                onStatus={handleStatus}
                calls={transformedCalls}
                isSponsored={isSponsored}
                capabilities={builderCapabilities}
            >
                <div className="space-y-2">
                    <TransactionButton
                        text={phase === "ready" ? resolvedButtonText : getButtonText()}
                        className={activeClassName}
                        disabled={phase !== "ready"}
                        ariaLabel={`${resolvedButtonAriaLabel}. Confirm this action`}
                    />
                </div>
                <GlobalTransactionToast suppressSuccess />
            </Transaction>
        );
    }

    return null;
}
