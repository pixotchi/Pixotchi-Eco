'use client';

import { createContext, useContext } from 'react';
import type { Hex } from 'viem';
import type { TransactionStatusName as StatusName } from '@/lib/transaction-lifecycle';
import type { TransactionReceiptLike } from '@/lib/transaction-utils';

export type LifecycleStatus = {
  statusName: StatusName;
  statusData: {
    error?: unknown;
    transactionHash?: Hex;
    transactionId?: string;
    atomic?: boolean;
    correlationId?: string;
    /** True when this status came from a durable proof restored after remount/reload. */
    recovered?: boolean;
    /** Whether the currently rendered calls still match the originally submitted payload. */
    callsMatch?: boolean;
    transactionReceipts: TransactionReceiptLike[];
  };
};

export type TransactionPhase =
  | "idle"
  | "awaiting-wallet"
  | "submitted"
  | "confirming"
  | "confirmed-syncing"
  | "succeeded"
  | "superseded"
  | "reverted"
  | "unresolved";

export function getTransactionPhase(status: LifecycleStatus): TransactionPhase {
  if (status.statusName === "idle") return "idle";
  if (status.statusName === "buildingTransaction") return "awaiting-wallet";
  if (status.statusName === "transactionPending") {
    return status.statusData.transactionHash || status.statusData.transactionId
      ? "submitted"
      : "awaiting-wallet";
  }
  if (status.statusName === "confirmedSyncing") return "confirmed-syncing";
  if (status.statusName === "success") return "succeeded";
  if (status.statusName === "superseded") return "superseded";
  if (
    status.statusName === "reverted"
    || status.statusName === "cancelled"
    || status.statusName === "canceled"
  ) return "reverted";
  return "unresolved";
}

export type TransactionProof = TransactionReceiptLike & {
  atomic: boolean;
  callsId?: string;
  kind: "batch" | "direct";
  transactionReceipts: TransactionReceiptLike[];
};

export type TransactionContextValue = {
  canSubmit: boolean;
  acknowledgeStale: () => Promise<void>;
  chainId: number | null;
  dismissToast: () => void;
  pauseToastTimer: () => void;
  resumeToastTimer: () => void;
  errorMessage: string | null;
  explorerHref: string | null;
  isExecuting: boolean;
  isSubmissionLocked: boolean;
  submissionLockMessage: string | null;
  isToastVisible: boolean;
  receipt: TransactionReceiptLike | null;
  retryWalletRouting: () => void;
  retrySync: () => void;
  setIsToastVisible: (value: boolean) => void;
  status: LifecycleStatus;
  submit: (source?: "button" | "retry") => void;
  transactionHash?: Hex;
  transactionId: string | null;
};

export const TransactionContext = createContext<TransactionContextValue | null>(null);

export function useTransactionContext() {
  const context = useContext(TransactionContext);
  if (!context) {
    throw new Error("Transaction components must be used within <Transaction />");
  }
  return context;
}
