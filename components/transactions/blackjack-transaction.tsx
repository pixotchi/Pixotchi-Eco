"use client";

import { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { usePaymaster } from "@/lib/paymaster-context";
import {
    Transaction,
    TransactionButton,
    TransactionStatus,
    TransactionStatusAction,
    TransactionStatusLabel,
} from '@coinbase/onchainkit/transaction';
import type { LifecycleStatus } from '@coinbase/onchainkit/transaction';
import GlobalTransactionToast from './global-transaction-toast';
import {
    blackjackFetchRandomness,
    buildBlackjackDealWithRandomCall,
    buildBlackjackActionWithRandomCall,
    BlackjackAction,
} from "@/lib/contracts";
import { blackjackAbi, BlackjackResult, getResultText } from "@/public/abi/blackjack-abi";
import { toast } from "react-hot-toast";
import { decodeEventLog, formatUnits } from "viem";
import { extractTransactionHash } from "@/lib/transaction-utils";
import { useAccount } from "wagmi";
import { getBuilderCapabilities, transformCallsWithBuilderCode } from '@/lib/builder-code';

interface BlackjackTransactionProps {
    mode: "deal" | "action";
    landId: bigint;
    betAmount?: bigint;
    handIndex?: number;
    action?: BlackjackAction;
    disabled?: boolean;
    buttonText?: string;
    buttonClassName?: string;
    onStatusUpdate?: (status: LifecycleStatus) => void;
    onComplete?: (result?: {
        success: boolean;
        cards?: number[];
        handValue?: number;
        dealerUpCard?: number;
        gameResult?: BlackjackResult;
        payout?: string;
        busted?: boolean;
    }) => void;
    onButtonClick?: () => void;
    tokenSymbol?: string;
}

const FAILURE_STATUSES = new Set([
    "error", "failed", "reverted", "cancelled", "canceled",
    "rejected", "transactionRejected", "userRejected", "buildError",
]);

type Phase = "idle" | "fetching" | "ready" | "pending" | "complete" | "error";

export default function BlackjackTransaction({
    mode,
    landId,
    betAmount,
    handIndex = 0,
    action,
    disabled = false,
    buttonText,
    buttonClassName,
    onStatusUpdate,
    onComplete,
    onButtonClick,
    tokenSymbol = "SEED",
}: BlackjackTransactionProps) {
    const { address } = useAccount();
    const { isSponsored } = usePaymaster();
    const processedTxHashes = useRef<Set<string>>(new Set());
    const successHandledRef = useRef(false);

    const [phase, setPhase] = useState<Phase>("idle");
    const [error, setError] = useState<string | null>(null);
    const [calls, setCalls] = useState<any[]>([]);

    // Builder code capabilities
    const builderCapabilities = getBuilderCapabilities();

    // Transform calls with builder code
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
    }, [mode, landId]);

    // Fetch randomness and build transaction
    const fetchRandomnessAndBuildCalls = useCallback(async () => {
        if (!address) {
            toast.error("Wallet not connected");
            return;
        }

        setPhase("fetching");
        setError(null);
        onButtonClick?.();

        try {


            const actionName = mode === "deal" ? "deal" :
                action === BlackjackAction.HIT ? "hit" :
                    action === BlackjackAction.STAND ? "stand" :
                        action === BlackjackAction.DOUBLE ? "double" :
                            action === BlackjackAction.SPLIT ? "split" :
                                action === BlackjackAction.SURRENDER ? "surrender" : "action";

            const result = await blackjackFetchRandomness(landId, actionName, address);



            // Build transaction call
            let call;
            if (mode === "deal" && betAmount) {
                call = buildBlackjackDealWithRandomCall(
                    landId, betAmount, result.randomSeed, result.nonce, result.signature
                );
            } else if (mode === "action" && action !== undefined) {
                call = buildBlackjackActionWithRandomCall(
                    landId, handIndex, action, result.randomSeed, result.nonce, result.signature
                );
            } else {
                throw new Error("Invalid parameters");
            }


            setCalls([call]);
            setPhase("ready");

        } catch (err) {
            console.error("[Blackjack] Failed:", err);
            const msg = err instanceof Error ? err.message : "Failed to prepare transaction";
            setError(msg);
            setPhase("error");
            toast.error(msg);
        }
    }, [address, landId, mode, betAmount, action, handIndex, onButtonClick]);

    // Handle transaction status
    const handleStatus = useCallback((status: LifecycleStatus) => {

        onStatusUpdate?.(status);

        if (status.statusName === 'transactionPending') {
            successHandledRef.current = false;
            setPhase("pending");
        }

        if (FAILURE_STATUSES.has(status.statusName ?? "")) {
            setPhase("idle");
            setCalls([]);
            onComplete?.(undefined);
            return;
        }

        if (status.statusName === "success" && !successHandledRef.current) {
            successHandledRef.current = true;
            setPhase("complete");

            const receipts: any[] = (status?.statusData?.transactionReceipts as any[]) || [];

            // Track gamification
            if (address && mode === "action") {
                const txHash = extractTransactionHash(receipts[0]);
                if (txHash) {
                    fetch("/api/gamification/missions", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ address, taskId: "s4_play_blackjack", proof: { txHash } }),
                    }).catch(() => { });
                }
            }

            // Parse events
            const newReceipts = receipts.filter(r => !processedTxHashes.current.has(r.transactionHash));
            if (newReceipts.length === 0) {
                onComplete?.({ success: true });
                setTimeout(() => { setPhase("idle"); setCalls([]); }, 500);
                return;
            }
            newReceipts.forEach(r => processedTxHashes.current.add(r.transactionHash));

            let resultData: any = { success: true };

            for (const receipt of newReceipts) {
                for (const log of (receipt?.logs || [])) {
                    try {
                        if (mode === "deal") {
                            try {
                                const decoded = decodeEventLog({ abi: blackjackAbi, data: log.data, topics: log.topics, eventName: 'BlackjackDealt' });
                                if (decoded.args) {
                                    const args = decoded.args as any;
                                    resultData = { ...resultData, cards: [args.playerCard1, args.playerCard2], handValue: args.playerHandValue, dealerUpCard: args.dealerUpCard };
                                }
                            } catch { }
                        }

                        if (mode === "action") {
                            try {
                                const decoded = decodeEventLog({ abi: blackjackAbi, data: log.data, topics: log.topics, eventName: 'BlackjackHit' });
                                if (decoded.args) {
                                    const args = decoded.args as any;
                                    resultData = {
                                        ...resultData,
                                        cards: [Number(args.newCard)],
                                        handValue: Number(args.newHandValue),
                                        busted: args.busted,
                                        handIndex: Number(args.handIndex)
                                    };
                                }
                            } catch { }
                        }

                        // Parse BlackjackGameComplete event for full card state (preferred over BlackjackResult)
                        try {
                            const decoded = decodeEventLog({ abi: blackjackAbi, data: log.data, topics: log.topics, eventName: 'BlackjackGameComplete' });
                            if (decoded.args) {
                                const args = decoded.args as any;
                                const gameResult = args.result as BlackjackResult;
                                const payout = formatUnits(args.payout, 18);

                                // Get full card arrays directly from event
                                const playerCards = Array.isArray(args.playerCards)
                                    ? args.playerCards.map(Number)
                                    : [];
                                const dealerCards = Array.isArray(args.dealerCards)
                                    ? args.dealerCards.map(Number)
                                    : [];

                                resultData = {
                                    ...resultData,
                                    gameResult,
                                    cards: playerCards.length > 0 ? playerCards : resultData.cards,
                                    handValue: Number(args.playerFinalValue),
                                    dealerCards,
                                    dealerValue: Number(args.dealerFinalValue),
                                    payout
                                };

                                const txt = getResultText(gameResult);
                                if (gameResult === BlackjackResult.PLAYER_WIN || gameResult === BlackjackResult.PLAYER_BLACKJACK) {
                                    toast.success(`${txt} Won ${payout} ${tokenSymbol}!`);
                                } else if (gameResult === BlackjackResult.PUSH) {
                                    toast.success('Push!');
                                } else {
                                    toast.error(txt);
                                }
                            }
                        } catch { }

                        // Fallback: Parse BlackjackResult for backward compatibility
                        try {
                            const decoded = decodeEventLog({ abi: blackjackAbi, data: log.data, topics: log.topics, eventName: 'BlackjackResult' });
                            if (decoded.args && !resultData.gameResult) {
                                const args = decoded.args as any;
                                const gameResult = args.result as BlackjackResult;
                                const payout = formatUnits(args.payout, 18);
                                resultData = {
                                    ...resultData,
                                    gameResult,
                                    handValue: Number(args.playerFinalValue),
                                    payout,
                                    dealerValue: Number(args.dealerFinalValue)
                                };

                                // Infer dealer cards only if BlackjackGameComplete wasn't found
                                if (!resultData.dealerCards && resultData.dealerUpCard !== undefined) {
                                    const upCard = resultData.dealerUpCard;
                                    const finalVal = Number(args.dealerFinalValue);
                                    let holeCard = 0;
                                    for (let r = 0; r < 13; r++) {
                                        const rankVal = (r + 1) > 10 ? 10 : (r + 1);
                                        const upRank = (upCard % 13) + 1;
                                        const upVal = upRank > 10 ? 10 : upRank;
                                        if (rankVal + upVal === finalVal) { holeCard = r; break; }
                                        if (rankVal === 1 && upVal + 11 === finalVal) { holeCard = r; break; }
                                        if (upVal === 1 && rankVal + 11 === finalVal) { holeCard = r; break; }
                                    }
                                    resultData.dealerCards = [upCard, holeCard];
                                }

                                const txt = getResultText(gameResult);
                                if (gameResult === BlackjackResult.PLAYER_WIN || gameResult === BlackjackResult.PLAYER_BLACKJACK) {
                                    toast.success(`${txt} Won ${payout} ${tokenSymbol}!`);
                                } else if (gameResult === BlackjackResult.PUSH) {
                                    toast.success('Push!');
                                } else {
                                    toast.error(txt);
                                }
                            }
                        } catch { }

                        // Parse BlackjackDealerHit events for animation data
                        try {
                            const decoded = decodeEventLog({ abi: blackjackAbi, data: log.data, topics: log.topics, eventName: 'BlackjackDealerHit' });
                            if (decoded.args) {
                                const args = decoded.args as any;
                                if (!resultData.dealerHits) resultData.dealerHits = [];
                                resultData.dealerHits.push({
                                    card: Number(args.newCard),
                                    value: Number(args.dealerValue)
                                });
                            }
                        } catch { }
                    } catch { }
                }
            }

            setTimeout(() => { setPhase("idle"); setCalls([]); }, 500);
            onComplete?.(resultData);
        }
    }, [mode, action, address, tokenSymbol, onComplete, onStatusUpdate]);

    // Get button text
    const getButtonText = () => {
        if (phase === "fetching") return "Preparing...";
        if (phase === "pending") return "Confirming...";
        if (buttonText) return buttonText;
        if (mode === "deal") return "DEAL";
        switch (action) {
            case BlackjackAction.HIT: return "HIT";
            case BlackjackAction.STAND: return "STAND";
            case BlackjackAction.DOUBLE: return "DOUBLE";
            case BlackjackAction.SPLIT: return "SPLIT";
            case BlackjackAction.SURRENDER: return "SURRENDER";
            default: return "ACTION";
        }
    };

    const isDisabled = disabled || phase === "fetching" || phase === "pending" ||
        (mode === "deal" && (!betAmount || betAmount <= BigInt(0))) ||
        (mode === "action" && action === undefined);

    const defaultClassName = "w-full py-2 px-4 rounded-lg font-bold transition-colors";
    const activeClassName = buttonClassName || `${defaultClassName} bg-yellow-500 hover:bg-yellow-600 text-black`;
    const disabledClassName = `${defaultClassName} bg-gray-600 text-gray-400 cursor-not-allowed`;

    // Phase: idle, error - show prepare button
    if (phase === "idle" || phase === "error" || phase === "fetching") {
        return (
            <button
                onClick={fetchRandomnessAndBuildCalls}
                disabled={isDisabled}
                className={isDisabled ? disabledClassName : activeClassName}
            >
                {phase === "fetching" ? (
                    <span className="flex items-center justify-center gap-2">
                        <span className="animate-spin">⟳</span> Preparing...
                    </span>
                ) : error ? (
                    "Retry"
                ) : (
                    getButtonText()
                )}
            </button>
        );
    }

    // Phase: ready - show Transaction component (user clicks to trigger wallet)
    // Phase: pending/complete - show status
    if (transformedCalls.length > 0) {
        return (
            <Transaction
                onStatus={handleStatus}
                calls={transformedCalls}
                isSponsored={isSponsored}
                capabilities={builderCapabilities}
                resetAfter={2000}
            >
                <TransactionButton
                    text={phase === "ready" ? "Confirm Transaction" : getButtonText()}
                    className={activeClassName}
                    disabled={phase !== "ready"}
                />
                <TransactionStatus>
                    <TransactionStatusAction />
                    <TransactionStatusLabel />
                </TransactionStatus>
                <GlobalTransactionToast />
            </Transaction>
        );
    }

    return null;
}
