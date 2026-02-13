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
        splitCards?: number[];
        handValue?: number;
        splitValue?: number;
        dealerUpCard?: number;
        gameResult?: BlackjackResult;
        payout?: string;
        busted?: boolean;
        lastActionCard?: number;
        lastActionHandIndex?: number;
        splitResults?: Array<{
            result: BlackjackResult;
            playerFinalValue: number;
            dealerFinalValue: number;
            payout: string;
        }>;
    }) => void;
    onButtonClick?: () => boolean | void | Promise<boolean | void>;
    onError?: (error: string) => void;
    tokenSymbol?: string;
}

const FAILURE_STATUSES = new Set([
    "error", "failed", "reverted", "cancelled", "canceled",
    "rejected", "transactionRejected", "userRejected", "buildError",
]);

type Phase = "idle" | "fetching" | "ready" | "pending" | "complete" | "error";

const WIN_RESULTS = new Set<BlackjackResult>([
    BlackjackResult.PLAYER_WIN,
    BlackjackResult.PLAYER_BLACKJACK,
]);

const LOSS_RESULTS = new Set<BlackjackResult>([
    BlackjackResult.DEALER_WIN,
    BlackjackResult.DEALER_BLACKJACK,
    BlackjackResult.PLAYER_BUST,
]);

const summarizeSplitResult = (results: BlackjackResult[]): BlackjackResult => {
    if (results.length === 0) return BlackjackResult.NONE;

    const wins = results.filter(r => WIN_RESULTS.has(r)).length;
    const losses = results.filter(r => LOSS_RESULTS.has(r)).length;
    const pushes = results.filter(r => r === BlackjackResult.PUSH).length;

    if (wins === results.length) return BlackjackResult.PLAYER_WIN;
    if (losses === results.length) return BlackjackResult.DEALER_WIN;
    if (pushes === results.length) return BlackjackResult.PUSH;
    return BlackjackResult.NONE;
};

const normalizeSplitHandEvents = (
    events: Array<{
        result: BlackjackResult;
        playerFinalValue: number;
        dealerFinalValue: number;
        payoutWei: bigint;
    }>,
    totalPayoutWei?: bigint
) => {
    if (events.length <= 2) return events;

    // Best-effort: choose two entries whose payouts match total payout when available.
    if (typeof totalPayoutWei === 'bigint') {
        for (let i = 0; i < events.length; i++) {
            for (let j = i + 1; j < events.length; j++) {
                if (events[i].payoutWei + events[j].payoutWei === totalPayoutWei) {
                    return [events[i], events[j]];
                }
            }
        }
    }

    // Fallback to first+last to avoid rendering phantom extra hands.
    return [events[0], events[events.length - 1]];
};

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
    onError,
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

        const preflightResult = await onButtonClick?.();
        if (preflightResult === false) {
            setPhase("idle");
            return;
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

            const result = await blackjackFetchRandomness(landId, actionName, address, handIndex);



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

        } catch (err: any) {
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
    }, [address, landId, mode, betAmount, action, handIndex, onButtonClick, onError]);

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

            // Parse events
            // OnchainKit can surface duplicate receipts for the same hash; dedupe first.
            const receiptsByHash = new Map<string, any>();
            const newReceipts: any[] = [];
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
                setTimeout(() => { setPhase("idle"); setCalls([]); }, 500);
                return;
            }
            newReceipts.forEach(r => {
                if (r?.transactionHash) processedTxHashes.current.add(r.transactionHash);
            });

            let resultData: any = { success: true };
            const handResultEvents: Array<{
                result: BlackjackResult;
                playerFinalValue: number;
                dealerFinalValue: number;
                payoutWei: bigint;
            }> = [];
            const seenBlackjackResultLogs = new Set<string>();
            let gameCompleteData: {
                result: BlackjackResult;
                playerCards: number[];
                splitCards: number[];
                dealerCards: number[];
                playerFinalValue: number;
                splitFinalValue: number;
                dealerFinalValue: number;
                payoutWei: bigint;
            } | null = null;

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
                                        handIndex: Number(args.handIndex),
                                        lastActionCard: Number(args.newCard),
                                        lastActionHandIndex: Number(args.handIndex),
                                    };
                                }
                            } catch { }
                        }

                        // Parse BlackjackGameComplete event for full card state (preferred over BlackjackResult)
                        try {
                            const decoded = decodeEventLog({ abi: blackjackAbi, data: log.data, topics: log.topics, eventName: 'BlackjackGameComplete' });
                            if (decoded.args) {
                                const args = decoded.args as any;
                                gameCompleteData = {
                                    result: args.result as BlackjackResult,
                                    playerCards: Array.isArray(args.playerCards) ? args.playerCards.map(Number) : [],
                                    splitCards: Array.isArray(args.splitCards) ? args.splitCards.map(Number) : [],
                                    dealerCards: Array.isArray(args.dealerCards) ? args.dealerCards.map(Number) : [],
                                    playerFinalValue: Number(args.playerFinalValue),
                                    splitFinalValue: Number(args.splitFinalValue),
                                    dealerFinalValue: Number(args.dealerFinalValue),
                                    payoutWei: BigInt(args.payout),
                                };
                            }
                        } catch { }

                        // Parse BlackjackResult (single result or per-hand split results)
                        try {
                            const decoded = decodeEventLog({ abi: blackjackAbi, data: log.data, topics: log.topics, eventName: 'BlackjackResult' });
                            if (decoded.args) {
                                const fallbackLogId = `${log?.data ?? ''}-${Array.isArray(log?.topics) ? log.topics.join('|') : ''}`;
                                const resultLogKey = `${receipt?.transactionHash ?? 'nohash'}-${String(log?.logIndex ?? log?.transactionLogIndex ?? fallbackLogId)}-BlackjackResult`;
                                if (seenBlackjackResultLogs.has(resultLogKey)) {
                                    continue;
                                }
                                seenBlackjackResultLogs.add(resultLogKey);

                                const args = decoded.args as any;
                                handResultEvents.push({
                                    result: args.result as BlackjackResult,
                                    playerFinalValue: Number(args.playerFinalValue),
                                    dealerFinalValue: Number(args.dealerFinalValue),
                                    payoutWei: BigInt(args.payout),
                                });
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

            // Finalize result parsing once we have all logs
            if (gameCompleteData) {
                resultData = {
                    ...resultData,
                    cards: gameCompleteData.playerCards.length > 0 ? gameCompleteData.playerCards : resultData.cards,
                    splitCards: gameCompleteData.splitCards.length > 0 ? gameCompleteData.splitCards : resultData.splitCards,
                    dealerCards: gameCompleteData.dealerCards,
                    handValue: gameCompleteData.playerFinalValue,
                    splitValue: gameCompleteData.splitFinalValue,
                    dealerValue: gameCompleteData.dealerFinalValue,
                    payout: formatUnits(gameCompleteData.payoutWei, 18),
                };
            }

            if (handResultEvents.length > 0) {
                const hasSplitCardsFromComplete = !!gameCompleteData && gameCompleteData.splitCards.length > 0;
                const isSplitResolution =
                    hasSplitCardsFromComplete ||
                    gameCompleteData?.result === BlackjackResult.NONE ||
                    (!gameCompleteData && handResultEvents.length > 1);
                if (isSplitResolution) {
                    const normalizedSplitEvents = normalizeSplitHandEvents(
                        handResultEvents,
                        gameCompleteData?.payoutWei
                    );
                    const splitResults = normalizedSplitEvents.map((entry) => ({
                        result: entry.result,
                        playerFinalValue: entry.playerFinalValue,
                        dealerFinalValue: entry.dealerFinalValue,
                        payout: formatUnits(entry.payoutWei, 18),
                    }));
                    const totalPayoutWei = gameCompleteData
                        ? gameCompleteData.payoutWei
                        : handResultEvents.reduce((sum, entry) => sum + entry.payoutWei, BigInt(0));

                    resultData = {
                        ...resultData,
                        splitResults,
                        gameResult: summarizeSplitResult(normalizedSplitEvents.map(entry => entry.result)),
                        payout: formatUnits(totalPayoutWei, 18),
                        dealerValue: gameCompleteData?.dealerFinalValue ?? normalizedSplitEvents[0].dealerFinalValue,
                    };
                } else {
                    const final = handResultEvents[handResultEvents.length - 1];
                    resultData = {
                        ...resultData,
                        gameResult: gameCompleteData?.result !== BlackjackResult.NONE ? gameCompleteData?.result : final.result,
                        handValue: gameCompleteData?.playerFinalValue ?? final.playerFinalValue,
                        payout: formatUnits(gameCompleteData?.payoutWei ?? final.payoutWei, 18),
                        dealerValue: gameCompleteData?.dealerFinalValue ?? final.dealerFinalValue,
                    };
                }
            } else if (gameCompleteData?.result !== undefined) {
                resultData = {
                    ...resultData,
                    gameResult: gameCompleteData.result,
                };
            }

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
                    toast.success(`${txt} Won ${resultData.payout || "0"} ${tokenSymbol}!`);
                } else if (resultData.gameResult === BlackjackResult.PUSH) {
                    toast.success('Push!');
                } else {
                    toast.error(txt);
                }
            }

            const gameSettled =
                Boolean(gameCompleteData) ||
                (resultData.gameResult !== undefined && resultData.gameResult !== BlackjackResult.NONE) ||
                (Array.isArray(resultData.splitResults) && resultData.splitResults.length > 0);

            if (address && mode === "action" && gameSettled) {
                const txHash = extractTransactionHash(newReceipts[0] ?? receipts[0]);
                if (txHash) {
                    fetch("/api/gamification/missions", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ address, taskId: "s3_play_casino_game", proof: { txHash } }),
                    }).catch(() => { });
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
