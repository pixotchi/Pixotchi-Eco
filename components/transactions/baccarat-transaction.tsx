"use client";

import { useMemo, useRef, useCallback } from "react";
import SponsoredTransaction from "./sponsored-transaction";
import {
  buildBaccaratPlaceBetCall,
  buildBaccaratPlaceBetWithTokenCall,
  buildBaccaratRevealCall,
  BaccaratBetType,
  BaccaratOutcome,
} from "@/lib/contracts";
import { getBaseTransactionReceipt } from "@/lib/base-rpc";
import { baccaratAbi, getBaccaratOutcomeLabel } from "@/public/abi/baccarat-abi";
import { toast } from "react-hot-toast";
import { decodeEventLog, formatUnits, type Hex } from "viem";
import type { LifecycleStatus } from "./transaction-kit";
import { extractTransactionHash } from "@/lib/transaction-utils";
import { useAccount } from "wagmi";
import { postMissionProgress } from "@/lib/mission-tracking";

export type BaccaratRevealResult = {
  betType?: BaccaratBetType;
  outcome?: BaccaratOutcome;
  won?: boolean;
  playerCards?: number[];
  bankerCards?: number[];
  playerTotal?: number;
  bankerTotal?: number;
  payout?: string;
  expired?: boolean;
  forfeitedAmount?: string;
  transactionHash?: string;
  receiptIncomplete?: boolean;
};

interface BaccaratTransactionProps {
  mode: "placeBet" | "reveal";
  landId: bigint;
  betType?: BaccaratBetType;
  betAmount?: bigint;
  disabled?: boolean;
  buttonText?: string;
  buttonClassName?: string;
  onStatusUpdate?: (status: LifecycleStatus) => void;
  onComplete?: (result?: BaccaratRevealResult) => void;
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

const NO_CARD = 255;

const compactCards = (card1: number, card2: number, card3: number, count: number) => {
  const cards = [card1, card2];
  if (count >= 3 && card3 !== NO_CARD) cards.push(card3);
  return cards;
};

const parseBaccaratResultFromReceipts = (
  receipts: UntypedValue[],
  tokenDecimals: number
): BaccaratRevealResult | undefined => {
  let roundResult: BaccaratRevealResult | undefined;
  let cards: Pick<BaccaratRevealResult, "playerCards" | "bankerCards"> = {};

  for (const receipt of receipts) {
    const logs = Array.isArray(receipt?.logs) ? receipt.logs : [];
    const transactionHash = extractTransactionHash(receipt);

    for (const log of logs) {
      try {
        const decoded = decodeEventLog({
          abi: baccaratAbi,
          data: log.data as `0x${string}`,
          topics: log.topics as UntypedValue,
        });

        if (decoded.eventName === "BaccaratRoundResult") {
          const args = decoded.args as UntypedValue;

          roundResult = {
            ...roundResult,
            betType: Number(args.betType) as BaccaratBetType,
            outcome: Number(args.outcome) as BaccaratOutcome,
            won: Boolean(args.won),
            playerTotal: Number(args.playerTotal),
            bankerTotal: Number(args.bankerTotal),
            payout: formatUnits(args.payout ?? BigInt(0), tokenDecimals),
            transactionHash,
          };
        }

        if (decoded.eventName === "BaccaratRoundCards") {
          const args = decoded.args as UntypedValue;
          const playerCount = Number(args.playerCardCount ?? 2);
          const bankerCount = Number(args.bankerCardCount ?? 2);

          cards = {
            playerCards: compactCards(
              Number(args.playerCard1),
              Number(args.playerCard2),
              Number(args.playerCard3),
              playerCount
            ),
            bankerCards: compactCards(
              Number(args.bankerCard1),
              Number(args.bankerCard2),
              Number(args.bankerCard3),
              bankerCount
            ),
          };
        }

        if (decoded.eventName === "BaccaratBetExpired") {
          const args = decoded.args as UntypedValue;
          return {
            expired: true,
            forfeitedAmount: formatUnits(args.forfeitedAmount ?? BigInt(0), tokenDecimals),
            transactionHash,
          };
        }
      } catch {
        // Continue to next log if decode fails.
      }
    }
  }

  if (roundResult) {
    return { ...roundResult, ...cards };
  }

  return undefined;
};

export default function BaccaratTransaction({
  mode,
  landId,
  betType,
  betAmount,
  disabled = false,
  buttonText,
  buttonClassName,
  onStatusUpdate,
  onComplete,
  onButtonClick,
  tokenSymbol = "SEED",
  tokenDecimals = 18,
  bettingToken = null,
}: BaccaratTransactionProps) {
  const { address } = useAccount();
  const transactionInitiatedRef = useRef(false);

  const calls = useMemo(() => {
    if (mode === "placeBet") {
      if (betType === undefined || !betAmount || betAmount <= BigInt(0)) return [];
      const call = bettingToken
        ? buildBaccaratPlaceBetWithTokenCall(landId, bettingToken, betType, betAmount)
        : buildBaccaratPlaceBetCall(landId, betType, betAmount);
      return [call];
    }

    return [buildBaccaratRevealCall(landId)];
  }, [mode, landId, betType, betAmount, bettingToken]);

  const handleButtonClick = useCallback(() => {
    transactionInitiatedRef.current = true;
    onButtonClick?.();
  }, [onButtonClick]);

  const handleStatus = useCallback(async (status: LifecycleStatus) => {
    onStatusUpdate?.(status);

    if (status.statusName === "transactionPending") {
      transactionInitiatedRef.current = true;
    }

    if (FAILURE_STATUSES.has(status.statusName ?? "")) {
      if (transactionInitiatedRef.current) {
        onComplete?.(undefined);
        transactionInitiatedRef.current = false;
      }
      return;
    }

    if (status.statusName !== "success") return;
    transactionInitiatedRef.current = false;

    if (mode === "placeBet") {
      toast.success("Baccarat bet placed. Waiting for reveal block...", {
        id: "baccarat-place-bet",
      });
      onComplete?.({});
      return;
    }

    const receipts: UntypedValue[] = (status?.statusData?.transactionReceipts as UntypedValue[]) || [];
    const revealTxHash = status.statusData?.transactionHash ?? extractTransactionHash(receipts[0]);

    if (address && revealTxHash) {
      try {
        postMissionProgress({
          address,
          taskId: "s3_play_casino_game",
          proof: { txHash: revealTxHash },
        }).catch((err) =>
          console.warn("Gamification tracking failed (non-critical):", err)
        );
      } catch (error) {
        console.warn("Failed to dispatch gamification mission (baccarat):", error);
      }
    }

    let revealResult = parseBaccaratResultFromReceipts(receipts, tokenDecimals);

    if (!revealResult && revealTxHash) {
      try {
        const fetchedReceipt = await getBaseTransactionReceipt(revealTxHash as Hex);
        revealResult = parseBaccaratResultFromReceipts([...receipts, fetchedReceipt], tokenDecimals);
      } catch (error) {
        console.warn("Failed to refetch baccarat reveal receipt:", error);
      }
    }

    if (revealResult?.expired) {
      toast.error(`Baccarat round expired. ${revealResult.forfeitedAmount ?? "0"} ${tokenSymbol} forfeited.`, {
        id: "baccarat-result",
      });
    } else if (revealResult?.outcome !== undefined) {
      const outcomeLabel = getBaccaratOutcomeLabel(revealResult.outcome);
      const isPush = !revealResult.won && revealResult.payout && revealResult.payout !== "0";
      if (revealResult.won) {
        toast.success(`Baccarat ${outcomeLabel}. Payout ${revealResult.payout} ${tokenSymbol}.`, {
          id: "baccarat-result",
        });
      } else if (isPush) {
        toast(`Baccarat ${outcomeLabel}. Bet pushed.`, {
          id: "baccarat-result",
        });
      } else {
        toast(`Baccarat ${outcomeLabel}. No win this round.`, {
          id: "baccarat-result",
        });
      }
    } else {
      toast.success("Baccarat reveal complete. Refreshing state...", {
        id: "baccarat-result",
      });
    }

    onComplete?.(revealResult ?? { transactionHash: revealTxHash, receiptIncomplete: true });
  }, [address, mode, onComplete, onStatusUpdate, tokenDecimals, tokenSymbol]);

  return (
    <SponsoredTransaction
      intentKey={`baccarat:${mode}:${landId}`}
      calls={calls}
      onStatusUpdate={handleStatus}
      buttonText={buttonText || (mode === "placeBet" ? "Deal Baccarat" : "Reveal Baccarat")}
      buttonClassName={buttonClassName}
      disabled={disabled || calls.length === 0}
      onButtonClick={handleButtonClick}
      feedbackMode="toast"
    />
  );
}
