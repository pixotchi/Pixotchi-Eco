"use client";

import React, { useCallback, useMemo, useRef } from "react";
import { track } from "@vercel/analytics";
import { useAccount } from "wagmi";

import { getBuilderCapabilities, transformCallsWithBuilderCode } from "@/lib/builder-code";
import { getMiniAppQuickAuthHeaders } from "@/lib/farcaster-miniapp-auth-client";
import {
  reconcileOwnerResources,
  type OwnerResourceInvalidationRequest,
} from "@/lib/owner-resource-invalidation";
import { usePaymaster } from "@/lib/paymaster-context";
import { getHighestTransactionReceiptBlock } from "@/lib/transaction-utils";
import type { TransactionCall } from "@/lib/types";

import GlobalTransactionToast from "./global-transaction-toast";
import {
  getLifecycleTransactionProof,
  Transaction,
  TransactionButton,
  TransactionStatus,
  type LifecycleStatus,
  type TransactionFeedbackMode,
} from "./transaction-kit";

export type GameTransactionEffects = "none" | {
  domains: OwnerResourceInvalidationRequest["domains"];
  expected?: OwnerResourceInvalidationRequest["expected"];
};

export type GameTransactionIntent = {
  atomicity: "single" | "required";
  calls: readonly TransactionCall[];
  effects: GameTransactionEffects;
  intentKey: string;
  sponsorship: "none" | "prefer";
};

export type GameTransactionProps = {
  atomicity?: "single" | "required";
  buttonClassName?: string;
  buttonText: string;
  calls: TransactionCall[];
  disabled?: boolean;
  effects: GameTransactionEffects;
  feedbackMode?: TransactionFeedbackMode;
  hideStatus?: boolean;
  intentKey: string;
  onButtonClick?: () => void;
  onError?: (error: UntypedValue) => void;
  onStatusUpdate?: (status: LifecycleStatus) => void;
  onSuccess?: (proof: UntypedValue) => void | Promise<void>;
  showToast?: boolean;
  sponsorship?: "none" | "prefer";
  trackStreak?: boolean;
};

/** The sole adapter for game mutations. Transaction owns wallet execution. */
export default function GameTransaction({
  atomicity,
  buttonClassName = "",
  buttonText,
  calls,
  disabled = false,
  effects,
  feedbackMode,
  hideStatus = false,
  intentKey,
  onButtonClick,
  onError,
  onStatusUpdate,
  onSuccess,
  showToast = true,
  sponsorship = "prefer",
  trackStreak = true,
}: GameTransactionProps) {
  const { address } = useAccount();
  const { isSponsored: paymasterEnabled } = usePaymaster();
  const successHandledRef = useRef(false);
  const resolvedAtomicity = atomicity ?? (calls.length > 1 ? "required" : "single");
  const intent = useMemo<GameTransactionIntent>(() => ({
    atomicity: resolvedAtomicity,
    calls,
    effects,
    intentKey,
    sponsorship,
  }), [calls, effects, intentKey, resolvedAtomicity, sponsorship]);

  if (process.env.NODE_ENV !== "production") {
    if (intent.atomicity === "single" && intent.calls.length > 1) {
      throw new Error("A single GameTransaction intent cannot contain multiple calls.");
    }
    if (intent.atomicity === "required" && intent.calls.length < 2) {
      throw new Error("An atomic GameTransaction intent must contain at least two calls.");
    }
  }

  const transformedCalls = useMemo(
    () => transformCallsWithBuilderCode(intent.calls as UntypedValue[]) as TransactionCall[],
    [intent.calls],
  );

  const handleError = useCallback((error: UntypedValue) => {
    if (!successHandledRef.current) onError?.(error);
  }, [onError]);

  const handleConfirmed = useCallback(async (status: LifecycleStatus) => {
    const proof = getLifecycleTransactionProof({ ...status, statusName: "success" });
    if (!proof) throw new Error("Canonical transaction proof is unavailable for reconciliation.");
    const receiptBlock = getHighestTransactionReceiptBlock(status.statusData.transactionReceipts);
    const reconciliationStartedAt = performance.now();
    if (intent.effects !== "none") {
      const reconciled = await reconcileOwnerResources({
        address,
        domains: intent.effects.domains,
        expected: intent.effects.expected,
        receiptBlock,
        source: `game-transaction:${intent.intentKey}`,
        transactionHash: status.statusData.transactionHash,
        transactionId: status.statusData.transactionId,
      });
      if (!reconciled) {
        throw new Error("Transaction confirmed; state refresh delayed.");
      }
    }
    if (status.statusData.correlationId) {
      try {
        track("game_transaction_reconciliation", {
          correlationId: status.statusData.correlationId,
          durationMs: Math.round(performance.now() - reconciliationStartedAt),
          result: "succeeded",
        });
      } catch {
        // Observability must never affect reconciliation.
      }
    }
    try {
      // Recovery may run after transient form state has reset. The stable intent
      // still owns reconciliation, but a callback tied to the old form payload
      // (share text, modal state, analytics details) must not run with new data.
      if (!status.statusData.recovered || status.statusData.callsMatch !== false) {
        await onSuccess?.(proof);
      }
    } catch (error) {
      // Product callbacks are downstream of authoritative reconciliation. A
      // toast or analytics failure must not turn a confirmed mutation into a
      // retryable transaction.
      console.warn("Confirmed transaction callback failed", error);
    }
  }, [address, intent, onSuccess]);

  const handleSuccess = useCallback(async (status: LifecycleStatus) => {
    const proof = getLifecycleTransactionProof(status);
    if (!proof) return;

    if (trackStreak && address) {
      void (async () => {
        const authHeaders = await getMiniAppQuickAuthHeaders();
        await fetch("/api/gamification/streak", {
          method: "POST",
          headers: { "Content-Type": "application/json", ...authHeaders },
        });
      })().catch(() => {});
    }
  }, [address, trackStreak]);

  const handleStatus = useCallback((status: LifecycleStatus) => {
    try {
      onStatusUpdate?.(status);
    } catch {
      // UI observers cannot alter transaction state.
    }
    if (status.statusName === "transactionPending") successHandledRef.current = false;
    if (status.statusName === "success" && !successHandledRef.current) {
      successHandledRef.current = true;
      void handleSuccess(status).catch((error) => {
        console.warn("Post-transaction reconciliation callback failed", error);
      });
    }
  }, [handleSuccess, onStatusUpdate]);

  const resolvedFeedbackMode = feedbackMode ?? "toast";
  // Commit/reveal and similarly prepared actions render before their calldata
  // exists. Zero calls is a valid disabled state, but never a valid submission.
  const isSubmissionDisabled = disabled || transformedCalls.length === 0;
  const showInlineStatus = !hideStatus
    && (resolvedFeedbackMode === "inline" || resolvedFeedbackMode === "both");
  const showGlobalToast = showToast
    && (resolvedFeedbackMode === "toast" || resolvedFeedbackMode === "both");

  return (
    <Transaction
      calls={transformedCalls}
      capabilities={getBuilderCapabilities()}
      effects={intent.effects}
      intentKey={intent.intentKey}
      isSponsored={intent.sponsorship === "prefer" && paymasterEnabled}
      onConfirmed={handleConfirmed}
      onError={handleError}
      onStatus={handleStatus}
      resetAfter={5000}
    >
      <TransactionButton
        className={`${buttonClassName} inline-flex items-center justify-center whitespace-nowrap leading-none`}
        disabled={isSubmissionDisabled}
        onClick={onButtonClick}
        text={buttonText}
      />
      {showInlineStatus && <TransactionStatus />}
      {showGlobalToast && <GlobalTransactionToast />}
    </Transaction>
  );
}
