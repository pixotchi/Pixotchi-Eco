"use client";
import { isGameTransactionFailure } from "@/lib/game-transaction-status";
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
import { toast } from "react-hot-toast";
import { getBlackjackSettlementProofs, type BlackjackMissionSubject } from '@/lib/blackjack-mission-proof';
import { useAccount } from "wagmi";
import { getBuilderCapabilities, transformCallsWithBuilderCode } from '@/lib/builder-code';
import { postMissionProgress } from '@/lib/mission-tracking';
import { gameActionButtonClass } from './game-dialog-styles';

export interface BlackjackTransactionProps {
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
    tokenDecimals: number | undefined;
    bettingToken?: string | null;
}

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
    tokenDecimals,
    bettingToken = null,
}: BlackjackTransactionProps) {
    const { address } = useAccount();
    const { isSponsored } = usePaymaster();
    const builderCapabilities = getBuilderCapabilities();
    const requiresTokenUnits = mode === "deal" || action === BlackjackAction.DOUBLE || action === BlackjackAction.SPLIT;
    const processedTxHashes = useRef<Set<string>>(new Set());
    const successHandledRef = useRef(false);
    const preparationInFlightRef = useRef(false);
    const preparationGenerationRef = useRef(0);
    const preparedSubjectRef = useRef<BlackjackMissionSubject | null>(null);
    const submittedMissionProofsRef = useRef(new Set<string>());

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

    // Never let an old owner's deferred preparation populate a new transaction.
    useEffect(() => {
        preparationGenerationRef.current += 1;
        preparationInFlightRef.current = false;
        processedTxHashes.current.clear();
        preparedSubjectRef.current = null;
        successHandledRef.current = false;
        setPhase("idle");
        setError(null);
        setCalls([]);
        setPreparedExpiresAt(null);
        return () => { preparationGenerationRef.current += 1; };
    }, [mode, landId, address, bettingToken, action]);

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

    useEffect(() => {
        if (phase !== 'complete') return;
        const timer = window.setTimeout(() => {
            setPhase('idle');
            setCalls([]);
            setPreparedExpiresAt(null);
        }, 500);
        return () => window.clearTimeout(timer);
    }, [phase]);

    // Fetch randomness and build transaction
    const fetchRandomnessAndBuildCalls = useCallback(async () => {
        if (disabled || preparationInFlightRef.current || phase === 'fetching' || phase === 'pending' || (requiresTokenUnits && tokenDecimals === undefined)) return;
        if (!address) {
            toast.error("Wallet not connected");
            return;
        }

        preparationInFlightRef.current = true;
        const generation = preparationGenerationRef.current;
        setPhase('fetching');
        setError(null);
        try {
            const preflightResult = await onButtonClick?.();
            if (preparationGenerationRef.current !== generation) return;
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
            if (preparationGenerationRef.current !== generation) return;

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
            preparedSubjectRef.current = { player: address, landId };
            setPreparedExpiresAt(typeof result.expiresAt === "number" ? result.expiresAt : null);
            setPhase("ready");

        } catch (err) {
            if (preparationGenerationRef.current !== generation) return;
            console.error("[Blackjack] Failed:", err);
            const msg = err instanceof Error ? err.message : "Failed to prepare transaction";

            setError(msg);
            setPhase("error");
            if (onError) {
                onError(msg);
            } else {
                toast.error(msg);
            }
        } finally {
            if (preparationGenerationRef.current === generation) preparationInFlightRef.current = false;
        }
    }, [address, landId, mode, betAmount, action, handIndex, onButtonClick, onError, bettingToken, disabled, phase, requiresTokenUnits, tokenDecimals]);

    // Handle transaction status
    const handleStatus = (status: LifecycleStatus) => {

        onStatusUpdate?.(status);

        if (status.statusName === 'transactionPending') {
            successHandledRef.current = false;
            setPhase("pending");
        }

        if (isGameTransactionFailure(status.statusName ?? "")) {
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
                return;
            }
            newReceipts.forEach(r => {
                if (r?.transactionHash) processedTxHashes.current.add(r.transactionHash);
            });

            const { result: resultData, gameComplete } = parseBlackjackTransactionResult(newReceipts, mode, action, tokenDecimals, LAND_CONTRACT_ADDRESS);

            // The dialog owns the player's net outcome; this toast confirms the
            // settlement without confusing a gross return with winnings.
            if (gameComplete || resultData.gameResult !== undefined || resultData.splitResults?.length) {
                toast(resultData.payout === undefined
                    ? 'Round settled. Verify token details to display the returned amount.'
                    : `Round settled. Total returned ${resultData.payout} ${tokenSymbol}.`);
            }

            const subject = preparedSubjectRef.current;
            if (subject) {
                for (const txHash of getBlackjackSettlementProofs(newReceipts, subject, LAND_CONTRACT_ADDRESS)) {
                    const proofKey = `${subject.player.toLowerCase()}:${txHash}`;
                    if (submittedMissionProofsRef.current.has(proofKey)) continue;
                    submittedMissionProofsRef.current.add(proofKey);
                    postMissionProgress({
                        address: subject.player,
                        taskId: "s3_play_casino_game",
                        proof: { txHash },
                    }).catch(() => { });
                }
            }

            onComplete?.(resultData);
        }
    };

    // Get button text
    const getButtonText = () => {
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

    const isDisabled = disabled || (requiresTokenUnits && tokenDecimals === undefined) || phase === "fetching" || phase === "pending" ||
        (mode === "deal" && (!betAmount || betAmount <= BigInt(0))) ||
        (mode === "action" && action === undefined);

    const activeClassName = `${buttonClassName || gameActionButtonClass('warning')} disabled:cursor-not-allowed disabled:opacity-50`;
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
                className={activeClassName}
                aria-label={error ? `Retry ${resolvedButtonAriaLabel}` : resolvedButtonAriaLabel}
                aria-busy={phase === "fetching"}
            >
                {phase === "fetching" ? (
                    <>
                        <span className="flex items-center justify-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
                            Preparing {resolvedButtonText}…
                        </span>
                    </>
                ) : error ? (
                    `Retry ${resolvedButtonText}`
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
                canSubmit={phase === 'ready' && !disabled && (!requiresTokenUnits || tokenDecimals !== undefined)}
                effects={{ domains: ["arcade", "balances"] }}
                intentKey={`blackjack:${landId}`}
                onStatus={handleStatus}
                calls={transformedCalls}
                isSponsored={isSponsored}
                capabilities={builderCapabilities}
            >
                <div className="space-y-2">
                    {phase === "ready" && <p className="text-center text-xs text-white/80">{resolvedButtonText} is ready. Confirm to open your wallet.</p>}
                    <TransactionButton
                        text={phase === "ready" ? `Confirm ${resolvedButtonText}` : `Confirming ${resolvedButtonText}…`}
                        className={activeClassName}
                        disabled={phase !== "ready" || disabled}
                        ariaLabel={`${resolvedButtonAriaLabel}. Confirm this action`}
                    />
                </div>
                <GlobalTransactionToast suppressSuccess />
            </Transaction>
        );
    }

    return null;
}
