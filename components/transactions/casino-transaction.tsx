"use client";

import { useMemo, useRef, useCallback } from "react";
import SponsoredTransaction from "./sponsored-transaction";
import {
    buildCasinoPlaceBetsCall,
    buildCasinoPlaceBetsWithTokenCall,
    buildCasinoRevealCall,
} from "@/lib/contracts";
import { rouletteHasUnsupportedZeroCombo } from "@/lib/casino-hardening-rules.mjs";
import { getBaseTransactionReceipt } from "@/lib/base-rpc";
import { casinoAbi, CasinoBetType } from "@/public/abi/casino-abi";
import { toast } from "react-hot-toast";
import { decodeEventLog, formatUnits, type Hex } from "viem";
import type { LifecycleStatus } from "./transaction-kit";
import { extractTransactionHash } from "@/lib/transaction-utils";
import { useAccount } from "wagmi";
import { postMissionProgress } from "@/lib/mission-tracking";

type CasinoRevealResult = {
    winningNumber?: number;
    won?: boolean;
    payout?: string;
    expired?: boolean;
    forfeitedAmount?: string;
    transactionHash?: string;
    receiptIncomplete?: boolean;
};

interface CasinoTransactionProps {
    mode: "placeBets" | "reveal";
    landId: bigint;
    // For placeBets mode
    betTypes?: CasinoBetType[];
    betNumbersArray?: number[][];
    betAmounts?: bigint[];
    // Common props
    disabled?: boolean;
    buttonText?: string;
    buttonClassName?: string;
    onStatusUpdate?: (status: LifecycleStatus) => void;
    onComplete?: (result?: CasinoRevealResult) => void;
    onButtonClick?: () => void;
    tokenSymbol?: string;
    tokenDecimals?: number;
    bettingToken?: string | null;
}

const FAILURE_STATUSES = new Set([
    "error",
    "failed",
    "reverted",
    "cancelled",
    "canceled",
    "rejected",
    "transactionRejected",
    "userRejected",
    "buildError",
]);

const parseRouletteResultFromReceipts = (
    receipts: UntypedValue[],
    tokenDecimals: number
): CasinoRevealResult | undefined => {
    for (const receipt of receipts) {
        const logs = Array.isArray(receipt?.logs) ? receipt.logs : [];
        const transactionHash = extractTransactionHash(receipt);

        for (const log of logs) {
            try {
                const decoded = decodeEventLog({
                    abi: casinoAbi,
                    data: log.data as `0x${string}`,
                    topics: log.topics as UntypedValue,
                });

                if (decoded.eventName === "RouletteSpinResult") {
                    const args = decoded.args as UntypedValue;

                    return {
                        winningNumber: Number(args.winningNumber),
                        won: Boolean(args.won),
                        payout: formatUnits(args.payout ?? BigInt(0), tokenDecimals),
                        transactionHash,
                    };
                }

                if (decoded.eventName === "RouletteBetExpired") {
                    const args = decoded.args as UntypedValue;

                    return {
                        expired: true,
                        forfeitedAmount: formatUnits(args.forfeitedAmount ?? BigInt(0), tokenDecimals),
                        transactionHash,
                    };
                }
            } catch {
                // Continue to next log if decode fails
            }
        }
    }

    return undefined;
};

export default function CasinoTransaction({
    mode,
    landId,
    betTypes,
    betNumbersArray,
    betAmounts,
    disabled = false,
    buttonText,
    buttonClassName,
    onStatusUpdate,
    onComplete,
    onButtonClick,
    tokenSymbol = "SEED",
    tokenDecimals = 18,
    bettingToken = null,
}: CasinoTransactionProps) {
    const { address } = useAccount();

    // Track if user has initiated a transaction to prevent false failure callbacks
    const transactionInitiatedRef = useRef(false);

    const calls = useMemo(() => {
        if (mode === "placeBets") {
            if (!betTypes?.length || !betNumbersArray?.length || !betAmounts?.length) {
                return [];
            }
            if (betTypes.some((type, index) => rouletteHasUnsupportedZeroCombo(type, betNumbersArray[index] ?? []))) {
                return [];
            }
            const call = bettingToken
                ? buildCasinoPlaceBetsWithTokenCall(landId, bettingToken, betTypes, betNumbersArray, betAmounts)
                : buildCasinoPlaceBetsCall(landId, betTypes, betNumbersArray, betAmounts);
            return [call];
        }

        if (mode === "reveal") {
            const call = buildCasinoRevealCall(landId);
            return [call];
        }

        return [];
    }, [mode, landId, betTypes, betNumbersArray, betAmounts, bettingToken]);

    const handleButtonClick = useCallback(() => {
        transactionInitiatedRef.current = true;
        onButtonClick?.();
    }, [onButtonClick]);

    const handleStatus = useCallback(async (status: LifecycleStatus) => {
        onStatusUpdate?.(status);

        // Mark transaction as initiated on pending
        if (status.statusName === 'transactionPending') {
            transactionInitiatedRef.current = true;
        }

        // Handle failures - only report if user actually initiated the transaction
        if (FAILURE_STATUSES.has(status.statusName ?? "")) {
            if (transactionInitiatedRef.current) {
                onComplete?.(undefined);
                transactionInitiatedRef.current = false; // Reset for next attempt
            }
            return;
        }

        if (status.statusName !== "success") return;

        // Reset initiation flag on success
        transactionInitiatedRef.current = false;

        if (mode === "placeBets") {
            toast.success("Bets placed! Waiting for block...", {
                id: "casino-place-bets",
            });
            // Call onComplete to signal success (no result data for placeBets)
            onComplete?.({});
        } else if (mode === "reveal") {
            const receipts: UntypedValue[] = (status?.statusData?.transactionReceipts as UntypedValue[]) || [];
            const revealTxHash = status.statusData?.transactionHash ?? extractTransactionHash(receipts[0]);

            // Track gamification mission
            if (address) {
                const txHash = revealTxHash;
                if (txHash) {
                    try {
                        postMissionProgress({
                            address,
                            taskId: "s3_play_casino_game",
                            proof: { txHash },
                        }).catch((err) =>
                            console.warn("Gamification tracking failed (non-critical):", err)
                        );
                    } catch (error) {
                        console.warn("Failed to dispatch gamification mission (casino):", error);
                    }
                }
            }

            // Parse roulette result or expiration event
            let revealResult = parseRouletteResultFromReceipts(receipts, tokenDecimals);

            for (const receipt of receipts) {
                const logs = receipt?.logs || [];
                const receiptTransactionHash = extractTransactionHash(receipt);
                for (const log of logs) {
                    try {
                        const decoded = decodeEventLog({
                            abi: casinoAbi,
                            data: log.data as `0x${string}`,
                            topics: log.topics as UntypedValue,
                        });

                        if (decoded.eventName === "RouletteSpinResult") {
                            const args = decoded.args as UntypedValue;
                            const winningNumber = Number(args.winningNumber);
                            const won = Boolean(args.won);
                            const payout = formatUnits(args.payout ?? BigInt(0), tokenDecimals);

                            revealResult = {
                                winningNumber,
                                won,
                                payout,
                                transactionHash: receiptTransactionHash,
                            };

                            if (won) {
                                toast.success(`🎉 Payout ${payout} ${tokenSymbol}!`, {
                                    id: "casino-result",
                                });
                            } else {
                                toast("Better luck next time!", {
                                    icon: "🎲",
                                    id: "casino-result",
                                });
                            }
                            break;
                        }

                        if (decoded.eventName === "RouletteBetExpired") {
                            const args = decoded.args as UntypedValue;
                            const forfeitedAmount = formatUnits(args.forfeitedAmount ?? BigInt(0), tokenDecimals);

                            revealResult = {
                                expired: true,
                                forfeitedAmount,
                                transactionHash: receiptTransactionHash,
                            };

                            toast.error(`Bet expired. ${forfeitedAmount} ${tokenSymbol} forfeited.`, {
                                id: "casino-result",
                            });
                            break;
                        }
                    } catch {
                        // Continue to next log if decode fails
                        continue;
                    }
                }
                if (revealResult) break;
            }

            if (!revealResult && revealTxHash) {
                try {
                    const fetchedReceipt = await getBaseTransactionReceipt(revealTxHash as Hex);
                    revealResult = parseRouletteResultFromReceipts([...receipts, fetchedReceipt], tokenDecimals);
                } catch (error) {
                    console.warn("Failed to refetch roulette reveal receipt:", error);
                }
            }

            if (!revealResult) {
                toast.success("Spin complete. Refreshing roulette state...", { id: "casino-result" });
            }

            onComplete?.(revealResult ?? { transactionHash: revealTxHash, receiptIncomplete: true });
        }
    }, [mode, onComplete, onStatusUpdate, address, tokenDecimals, tokenSymbol]);

    let defaultText = "Submit";
    if (mode === "placeBets") defaultText = "🎲 Place Bets";
    if (mode === "reveal") defaultText = "Reveal Result";

    const finalDisabled = disabled || calls.length === 0;

    return (
        <SponsoredTransaction
            calls={calls as UntypedValue}
            buttonText={buttonText ?? defaultText}
            buttonClassName={buttonClassName}
            disabled={finalDisabled}
            onStatusUpdate={handleStatus as UntypedValue}
            onButtonClick={handleButtonClick}
        />
    );
}
