"use client";
import { isGameTransactionFailure } from "@/lib/game-transaction-status";

import { useMemo, useRef, useCallback } from "react";
import GameTransaction from "./game-transaction";
import {
  buildBaccaratPlaceBetCall,
  buildBaccaratPlaceBetWithTokenCall,
  buildBaccaratRevealCall,
  BaccaratBetType,
  LAND_CONTRACT_ADDRESS,
} from "@/lib/contracts";
import { getBaseTransactionReceipt } from "@/lib/base-rpc";
import { getBaccaratOutcomeLabel } from "@/public/abi/baccarat-abi";
import { toast } from "react-hot-toast";
import { type Hex } from "viem";
import type { LifecycleStatus } from "./transaction-kit";
import { extractTransactionHash } from "@/lib/transaction-utils";
import { useAccount } from "wagmi";
import { postMissionProgress } from "@/lib/mission-tracking";

import { hasCompleteBaccaratResult, parseBaccaratResultFromReceipts, type BaccaratRoundIdentity, type BaccaratRevealResult } from '@/lib/baccarat-result';
export type { BaccaratRevealResult } from '@/lib/baccarat-result';

interface BaccaratTransactionProps {
  mode: "placeBet" | "reveal";
  roundIdentity?: BaccaratRoundIdentity;
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
  bettingToken?: string | null;
}


export default function BaccaratTransaction({
  mode,
  roundIdentity,
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

    if (isGameTransactionFailure(status.statusName ?? "")) {
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

    let revealResult = roundIdentity ? parseBaccaratResultFromReceipts(receipts, roundIdentity, LAND_CONTRACT_ADDRESS) : undefined;

    if ((!revealResult || !hasCompleteBaccaratResult(revealResult)) && revealTxHash && roundIdentity) {
      try {
        const fetchedReceipt = await getBaseTransactionReceipt(revealTxHash as Hex);
        revealResult = parseBaccaratResultFromReceipts([fetchedReceipt, ...receipts], roundIdentity, LAND_CONTRACT_ADDRESS);
      } catch (error) {
        console.warn("Failed to refetch baccarat reveal receipt:", error);
      }
    }

    if (revealResult && hasCompleteBaccaratResult(revealResult) && revealResult.expired) {
      toast.error(`Baccarat round expired. ${revealResult.forfeitedAmount === undefined ? 'Verify token details to display the forfeited amount.' : `${revealResult.forfeitedAmount} ${tokenSymbol} forfeited.`}`, {
        id: "baccarat-result",
      });
    } else if (revealResult && hasCompleteBaccaratResult(revealResult) && revealResult.outcome !== undefined) {
      const outcomeLabel = getBaccaratOutcomeLabel(revealResult.outcome);
      const isPush = !revealResult.won && (revealResult.payoutWei !== undefined ? revealResult.payoutWei > BigInt(0) : revealResult.payout && revealResult.payout !== "0");
      if (revealResult.payout === undefined) {
        toast(`Baccarat ${outcomeLabel}. Round settled; verify token details to display the payout amount.`, { id: 'baccarat-result' });
      } else if (revealResult.won) {
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
      toast("Reveal confirmed. The result is still loading.", {
        id: "baccarat-result",
      });
    }

    onComplete?.(revealResult ?? { transactionHash: revealTxHash, receiptIncomplete: true });
  }, [address, mode, onComplete, onStatusUpdate, tokenSymbol, roundIdentity]);

  return (
    <GameTransaction
      successFeedback="feature"
      effects={{ domains: ["arcade", "balances"] }}
      intentKey={`baccarat:${landId}`}
      calls={calls}
      onStatusUpdate={handleStatus}
      buttonText={buttonText || (mode === "placeBet" ? "Deal Baccarat" : "Reveal Baccarat")}
      buttonClassName={buttonClassName}
      disabled={disabled || calls.length === 0 || (mode === "reveal" && !roundIdentity)}
      onButtonClick={handleButtonClick}
      feedbackMode="toast"
    />
  );
}
