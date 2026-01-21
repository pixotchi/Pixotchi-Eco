"use client";

import { useMemo, useRef, useCallback } from "react";
import SponsoredTransaction from "./sponsored-transaction";
import {
    buildCasinoPlaceBetsCall,
    buildCasinoRevealCall,
} from "@/lib/contracts";
import { casinoAbi, CasinoBetType } from "@/public/abi/casino-abi";
import { toast } from "react-hot-toast";
import { decodeEventLog, formatUnits } from "viem";
import type { LifecycleStatus } from "@coinbase/onchainkit/transaction";
import { extractTransactionHash } from "@/lib/transaction-utils";
import { useAccount } from "wagmi";

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
    onComplete?: (result?: {
        winningNumber?: number;
        won?: boolean;
        payout?: string;
    }) => void;
    onButtonClick?: () => void;
    tokenSymbol?: string;
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
}: CasinoTransactionProps) {
    const { address } = useAccount();

    // Track if user has initiated a transaction to prevent false failure callbacks
    const transactionInitiatedRef = useRef(false);

    const calls = useMemo(() => {
        if (mode === "placeBets") {
            if (!betTypes?.length || !betNumbersArray?.length || !betAmounts?.length) {
                return [];
            }
            const call = buildCasinoPlaceBetsCall(landId, betTypes, betNumbersArray, betAmounts);
            return [call];
        }

        if (mode === "reveal") {
            const call = buildCasinoRevealCall(landId);
            return [call];
        }

        return [];
    }, [mode, landId, betTypes, betNumbersArray, betAmounts]);

    const handleButtonClick = useCallback(() => {
        transactionInitiatedRef.current = true;
        onButtonClick?.();
    }, [onButtonClick]);

    const handleStatus = useCallback((status: LifecycleStatus) => {
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
            const receipts: any[] = (status?.statusData?.transactionReceipts as any[]) || [];

            // Track gamification mission
            if (address) {
                const txHash = extractTransactionHash(receipts[0]);
                if (txHash) {
                    try {
                        fetch("/api/gamification/missions", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({
                                address,
                                taskId: "s4_play_casino",
                                proof: { txHash },
                            }),
                        }).catch((err) =>
                            console.warn("Gamification tracking failed (non-critical):", err)
                        );
                    } catch (error) {
                        console.warn("Failed to dispatch gamification mission (casino):", error);
                    }
                }
            }

            // Parse RouletteSpinResult event
            let revealResult: {
                winningNumber?: number;
                won?: boolean;
                payout?: string;
            } | undefined;

            for (const receipt of receipts) {
                const logs = receipt?.logs || [];
                for (const log of logs) {
                    try {
                        const decoded = decodeEventLog({
                            abi: casinoAbi,
                            data: log.data as `0x${string}`,
                            topics: log.topics as any,
                        });

                        if (decoded.eventName === "RouletteSpinResult") {
                            const args = decoded.args as any;
                            const winningNumber = Number(args.winningNumber);
                            const won = Boolean(args.won);
                            const payout = formatUnits(args.payout ?? BigInt(0), 18);

                            revealResult = {
                                winningNumber,
                                won,
                                payout,
                            };

                            if (won) {
                                toast.success(`🎉 You won ${payout} ${tokenSymbol}!`, {
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
                    } catch {
                        // Continue to next log if decode fails
                        continue;
                    }
                }
                if (revealResult) break;
            }

            if (!revealResult) {
                toast.success("Spin complete!", { id: "casino-result" });
            }

            onComplete?.(revealResult);
        }
    }, [mode, onComplete, onStatusUpdate, address, tokenSymbol]);

    let defaultText = "Submit";
    if (mode === "placeBets") defaultText = "🎲 Place Bets";
    if (mode === "reveal") defaultText = "Reveal Result";

    const finalDisabled = disabled || calls.length === 0;

    return (
        <SponsoredTransaction
            calls={calls as any}
            buttonText={buttonText ?? defaultText}
            buttonClassName={buttonClassName}
            disabled={finalDisabled}
            onStatusUpdate={handleStatus as any}
            onButtonClick={handleButtonClick}
        />
    );
}
