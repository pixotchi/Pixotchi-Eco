"use client";
import { isGameTransactionFailure } from "@/lib/game-transaction-status";

import { useMemo, useRef, useCallback } from "react";
import GameTransaction from "./game-transaction";
import {
    buildCasinoPlaceBetsCall,
    buildCasinoPlaceBetsWithTokenCall,
    buildCasinoRevealCall,
    LAND_CONTRACT_ADDRESS,
} from "@/lib/contracts";
import { rouletteHasUnsupportedZeroCombo } from "@/lib/casino-hardening-rules.mjs";
import { getBaseTransactionReceipt } from "@/lib/base-rpc";
import { CasinoBetType } from "@/public/abi/casino-abi";
import { toast } from "react-hot-toast";
import { formatUnits, type Hex } from "viem";
import type { LifecycleStatus, TransactionPreflight } from "./transaction-kit";
import { extractTransactionHash } from "@/lib/transaction-utils";
import { useAccount } from "wagmi";
import { postMissionProgress } from "@/lib/mission-tracking";
import { parseRouletteReceipt, type RouletteReceiptResult } from "@/lib/roulette-receipt";

type CasinoRevealResult = Partial<RouletteReceiptResult> & { receiptIncomplete?: boolean };

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
    onButtonClick?: TransactionPreflight;
    tokenSymbol?: string;
    tokenDecimals?: number;
    bettingToken?: string | null;
}




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
    tokenSymbol = "TOKEN",
    tokenDecimals,
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

    const handleButtonClick = useCallback(async () => {
        const accepted = await onButtonClick?.();
        if (accepted === false) return false;
        transactionInitiatedRef.current = true;
        return accepted;
    }, [onButtonClick]);

    const handleStatus = useCallback(async (status: LifecycleStatus) => {
        onStatusUpdate?.(status);

        // Mark transaction as initiated on pending
        if (status.statusName === 'transactionPending') {
            transactionInitiatedRef.current = true;
        }

        // Handle failures - only report if user actually initiated the transaction
        if (isGameTransactionFailure(status.statusName)) {
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

            // Recovery never depends on token metadata: decode and retain raw units.
            const subject = { landId, player: address, contract: LAND_CONTRACT_ADDRESS };
            let revealResult = parseRouletteReceipt(receipts, subject);

            if (!revealResult && revealTxHash) {
                try {
                    const fetchedReceipt = await getBaseTransactionReceipt(revealTxHash as Hex);
                    revealResult = parseRouletteReceipt([...receipts, fetchedReceipt], subject);
                } catch (error) {
                    console.warn("Failed to refetch roulette reveal receipt:", error);
                }
            }

            const canFormat = tokenDecimals !== undefined && bettingToken?.toLowerCase() === revealResult?.bettingToken.toLowerCase();
            if (revealResult?.expired) {
                const amount = canFormat && revealResult.forfeitedAmountWei !== undefined ? `${formatUnits(revealResult.forfeitedAmountWei, tokenDecimals!)} ${tokenSymbol} ` : '';
                toast.error(`Bet expired. ${amount}forfeited.`, { id: 'casino-result' });
            } else if (revealResult?.won) {
                const amount = canFormat && revealResult.payoutWei !== undefined ? ` Payout ${formatUnits(revealResult.payoutWei, tokenDecimals!)} ${tokenSymbol}.` : ' Token amount is awaiting verified details.';
                toast.success(`Winning spin.${amount}`, { id: 'casino-result' });
            } else if (revealResult) {
                toast('No win this spin.', { id: 'casino-result', icon: '🎲' });
            } else {
                toast('Spin confirmed. Checking the result...', { id: 'casino-result' });
            }

            onComplete?.(revealResult ?? { transactionHash: revealTxHash, receiptIncomplete: true });
        }
    }, [mode, landId, onComplete, onStatusUpdate, address, bettingToken, tokenDecimals, tokenSymbol]);

    let defaultText = "Submit";
    if (mode === "placeBets") defaultText = "🎲 Place Bets";
    if (mode === "reveal") defaultText = "Reveal Result";

    const finalDisabled = disabled || calls.length === 0;

    return (
        <GameTransaction
            successFeedback="feature"
          effects={{ domains: ["arcade", "balances"] }}
            intentKey={`roulette:${landId}`}
            calls={calls as UntypedValue}
            buttonText={buttonText ?? defaultText}
            buttonClassName={buttonClassName}
            disabled={finalDisabled}
            onStatusUpdate={handleStatus as UntypedValue}
            onButtonClick={handleButtonClick}
        />
    );
}
