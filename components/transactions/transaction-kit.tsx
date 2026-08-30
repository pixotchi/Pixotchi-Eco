"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Hex } from "viem";
import { handleExternalAnchorClick, openExternalUrl } from "@/lib/open-external";
import { base } from "viem/chains";
import { useAccount, useChainId, useWalletClient } from "wagmi";
import { useShowCallsStatus } from "wagmi/experimental";
import { waitForBaseReceipt } from "@/lib/base-rpc";
import { Button } from "@/components/ui/button";
import {
  canDurablyPersistPendingEvmTransactions,
  PendingEvmStaleError,
  PENDING_EVM_HARD_LOCK_MS,
  acknowledgePendingEvmRecord,
  createPendingEvmCallsDigest,
  createPendingEvmRecord,
  finalizePendingEvmRecord,
  getPendingEvmCompatibility,
  getPendingEvmPhase,
  getPendingEvmIntentDigest,
  getBrowserPendingEvmStorage,
  isDefinitivePendingEvmPreSubmissionError,
  isDefinitiveUnsupportedEvmBatchError,
  readPendingEvmRecord,
  removePendingEvmRecord,
  resumePendingEvmRecord,
  withPendingEvmHardDeadline,
  withPendingEvmMonitorLease,
  withPendingEvmSubmissionGuard,
  writePendingEvmRecord,
  type PendingEvmExecutionMethod,
  type PendingEvmIntentIdentity,
  type PendingEvmRecord,
} from "@/lib/pending-evm-transaction";
import {
  claimPendingEvmCoordinatorAttempt,
  promotePendingEvmCoordinatorAttemptToMonitor,
  registerPendingEvmController,
  releasePendingEvmCoordinatorAttempt,
  requestPendingEvmCoordinatorReconcile,
} from "@/lib/pending-evm-coordinator";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { extractTransactionHash, normalizeTransactionReceipt } from "@/lib/transaction-utils";
import { cn } from "@/lib/utils";

type TransactionReceiptLike = UntypedValue;

type StatusName =
  | "idle"
  | "buildingTransaction"
  | "transactionPending"
  | "submissionAmbiguous"
  | "transactionUnresolved"
  | "transactionStale"
  | "success"
  | "error"
  | "failed"
  | "reverted"
  | "cancelled"
  | "canceled"
  | "rejected"
  | "transactionRejected"
  | "userRejected"
  | "buildError";

export type LifecycleStatus = {
  statusName: StatusName;
  statusData: {
    error?: UntypedValue;
    transactionHash?: Hex;
    transactionId?: string;
    transactionReceipts: TransactionReceiptLike[];
  };
};

type RawTransactionCall = {
  address?: `0x${string}`;
  data?: `0x${string}`;
  to?: `0x${string}`;
  value?: bigint;
};

type TransactionProps = {
  calls: RawTransactionCall[];
  onError?: (error: UntypedValue) => void;
  onStatus?: (status: LifecycleStatus) => void;
  isSponsored?: boolean;
  capabilities?: Record<string, UntypedValue>;
  intentKey?: string;
  resetAfter?: number;
  children: React.ReactNode;
};

type TransactionContextValue = {
  acknowledgeStale: () => void;
  chainId: number | null;
  dismissToast: () => void;
  errorMessage: string | null;
  explorerHref: string | null;
  isExecuting: boolean;
  isSubmissionLocked: boolean;
  submissionLockMessage: string | null;
  isToastVisible: boolean;
  receipt: TransactionReceiptLike | null;
  retryWalletRouting: () => void;
  setIsToastVisible: (value: boolean) => void;
  status: LifecycleStatus;
  submit: (beforeSubmit?: (() => void) | null) => void;
  transactionHash?: Hex;
  transactionId: string | null;
};

type TransactionButtonRenderProps = {
  status: "default" | "error" | "pending" | "success";
  context: TransactionContextValue;
  onSubmit: () => void;
  onSuccess: () => void;
  isDisabled: boolean;
};

type TransactionButtonProps = {
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  text?: string;
  render?: (props: TransactionButtonRenderProps) => React.ReactNode;
};

type TransactionStatusProps = {
  children?: React.ReactNode;
  className?: string;
};

type TransactionStatusActionProps = {
  className?: string;
};

type TransactionStatusLabelProps = {
  className?: string;
};

type TransactionToastProps = {
  children?: React.ReactNode;
  className?: string;
  duration?: number;
  position?: "bottom-center" | "bottom-right" | "top-center" | "top-right";
};

export type TransactionFeedbackMode = "inline" | "toast" | "both" | "none";

type TransactionToastActionProps = {
  className?: string;
};

type TransactionToastIconProps = {
  className?: string;
};

type TransactionToastLabelProps = {
  className?: string;
};

const TransactionContext = createContext<TransactionContextValue | null>(null);

const IDLE_STATUS: LifecycleStatus = {
  statusData: { transactionReceipts: [] },
  statusName: "idle",
};

const TERMINAL_STATUSES = new Set<StatusName>([
  "success",
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
const CALLS_STATUS_TIMEOUT_MS = 120_000;
const DIRECT_RECEIPT_TIMEOUT_MS = 240_000;
const UNRESOLVED_RETRY_DELAY_MS = 1_000;
const UNRESOLVED_RETRY_MAX_DELAY_MS = 15_000;
const CALLS_STATUS_TIMEOUT_MESSAGE = "Timed out waiting for wallet transaction status.";
const RECEIPT_TIMEOUT_MESSAGE =
  "Transaction was not confirmed after several minutes. Refresh and check the game before trying again.";

const PRESSABLE_PRIMARY =
  "cursor-pointer bg-primary bg-[image:var(--gradient-control-active)] hover:brightness-[1.03] active:brightness-[0.98] focus:brightness-[0.98]";
const PRESSABLE_DISABLED = "opacity-[0.38] pointer-events-none";
const TEXT_HEADLINE = "ock-compat-font font-semibold";
const TEXT_LABEL1 = "ock-compat-font text-sm font-semibold";
const TEXT_LABEL2 = "ock-compat-font text-sm";
const TEXT_DEFAULT = "text-[var(--ock-compat-foreground)]";
const TEXT_MUTED = "text-[var(--ock-compat-foreground-muted)]";
const TEXT_INVERSE = "text-primary-foreground";
const TEXT_PRIMARY = "text-[var(--ock-compat-primary)]";
const TEXT_ERROR = "text-[var(--ock-compat-error)]";
const BG_SURFACE = "chat-white-surface bg-card bg-[image:var(--gradient-surface)]";
const TOAST_SHADOW = "shadow-[var(--shadow-hairline)]";
const unsupportedSendCallsKeys = new Set<string>();
/**
 * A successful EIP-5792 lifecycle may carry only a calls id. Treat that id as
 * verifiable lifecycle proof instead of making all success UI depend on an
 * optional receipt array.
 */
export function getLifecycleTransactionProof(
  status: LifecycleStatus,
): TransactionReceiptLike | null {
  if (status.statusName !== "success") return null;

  const receipt = status.statusData.transactionReceipts[0];
  if (receipt) return normalizeTransactionReceipt(receipt);

  const transactionHash = status.statusData.transactionHash;
  const transactionId = status.statusData.transactionId;
  if (!transactionHash && !transactionId) return null;

  return {
    status: "success",
    ...(transactionHash ? { transactionHash } : {}),
    ...(transactionId ? { transactionId } : {}),
    transactionReceipts: [],
  };
}

function Spinner({ className }: { className?: string }) {
  return (
    <div
      className="flex h-full items-center justify-center"
      data-testid="ockSpinner"
    >
      <div
        className={cn(
          "h-4 w-4 animate-spin rounded-full border-2 border-current/25 border-t-current",
          className,
        )}
      />
    </div>
  );
}

function SuccessSvg({ className = "fill-[hsl(var(--success))]" }: { className?: string }) {
  return (
    <svg
      aria-label="ock-successSvg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      data-testid="ock-successSvg"
    >
      <title>Success SVG</title>
      <path
        d="M8 0C3.58 0 0 3.58 0 8C0 12.42 3.58 16 8 16C12.42 16 16 12.42 16 8C16 3.58 12.42 0 8 0ZM6.72667 11.5333L3.73333 8.54L4.67333 7.6L6.72667 9.65333L11.44 4.94L12.38 5.88L6.72667 11.5333Z"
        className={className}
      />
    </svg>
  );
}

function ErrorSvg({ className = "fill-[hsl(var(--destructive))]" }: { className?: string }) {
  return (
    <svg
      aria-label="ock-errorSvg"
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      data-testid="ock-errorSvg"
    >
      <title>Error</title>
      <path
        d="M8 16C12.4183 16 16 12.4183 16 8C16 3.58171 12.4183 0 8 0C3.58172 0 0 3.58171 0 8C0 12.4183 3.58172 16 8 16ZM11.7576 5.0909L8.84853 8L11.7576 10.9091L10.9091 11.7576L8 8.84851L5.09093 11.7576L4.2424 10.9091L7.15147 8L4.2424 5.0909L5.09093 4.24239L8 7.15145L10.9091 4.24239L11.7576 5.0909Z"
        className={className}
      />
    </svg>
  );
}

function CloseSvg({ className = TEXT_DEFAULT }: { className?: string }) {
  return (
    <svg
      aria-label="ock-closeSvg"
      width="12"
      height="12"
      viewBox="0 0 16 16"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
    >
      <title>Close</title>
      <path d="M2.14921 1L1 2.1492L6.8508 8L1 13.8508L2.1492 15L8 9.1492L13.8508 15L15 13.8508L9.14921 8L15 2.1492L13.8508 1L8 6.8508L2.14921 1Z" />
    </svg>
  );
}

function getErrorMessage(error: UntypedValue): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }
  if (error && typeof error === "object") {
    const message =
      (error as { shortMessage?: UntypedValue; message?: UntypedValue }).shortMessage
      ?? (error as { message?: UntypedValue }).message;
    if (typeof message === "string" && message.trim() !== "") {
      return message;
    }
  }
  return "Transaction failed.";
}

function getErrorStatusName(error: UntypedValue): StatusName {
  const message = getErrorMessage(error).toLowerCase();
  const code =
    typeof (error as { code?: UntypedValue })?.code === "number"
      ? Number((error as { code?: number }).code)
      : null;

  if (
    code === 4001
    || message.includes("user rejected")
    || message.includes("rejected the request")
    || message.includes("transaction rejected")
  ) {
    return "transactionRejected";
  }

  if (
    message.includes("wallet not connected")
    || message.includes("wallet client unavailable")
    || message.includes("transaction call is missing")
    || message.includes("no transaction calls")
    || message.includes("failed to prepare")
    || message.includes("provider unavailable")
    || message.includes("atomic bundled transactions")
  ) {
    return "buildError";
  }

  if (message.includes("revert")) {
    return "reverted";
  }

  return "error";
}

function getFriendlyTransactionMessage(message: string) {
  const normalized = message.toLowerCase();

  if (normalized.includes("user rejected") || normalized.includes("rejected the request")) {
    return "Transaction cancelled. You can try again when ready.";
  }

  if (normalized.includes("wallet client unavailable") || normalized.includes("wallet not connected")) {
    return "Connect your wallet, then try again.";
  }

  if (normalized.includes("insufficient") && normalized.includes("balance")) {
    return "Not enough balance for this action.";
  }

  if (normalized.includes("revert")) {
    return "Transaction reverted. Check the requirements and try again.";
  }

  if (normalized.includes("timed out") || normalized.includes("not confirmed")) {
    return RECEIPT_TIMEOUT_MESSAGE;
  }

  if (!message || message === "Transaction failed.") {
    return "Transaction failed. Check the details and try again.";
  }

  return message.length > 96 ? "Transaction failed. Check the details and try again." : message;
}

function getPendingButtonText(idleText: string) {
  const normalized = idleText.trim().toLowerCase();

  if (normalized.includes("mint")) return "Minting...";
  if (normalized.includes("claim")) return "Claiming...";
  if (normalized.includes("stake")) return "Staking...";
  if (normalized.includes("buy") || normalized.includes("purchase")) return "Purchasing...";
  if (normalized.includes("approve")) return "Approving...";
  if (normalized.includes("transfer")) return "Transferring...";
  if (normalized.includes("spin")) return "Spinning...";
  if (normalized.includes("deal")) return "Dealing...";

  return "Processing...";
}

function getExplorerHref(hash?: string | null, chainUrl?: string | null) {
  if (!hash) return null;
  const explorerBase = chainUrl || base.blockExplorers?.default.url;
  if (!explorerBase) return null;
  return `${explorerBase.replace(/\/$/, "")}/tx/${hash}`;
}

function getSendCallsSupportKey({
  accountAddress,
  chainId,
  connectorId,
}: {
  accountAddress?: string | null;
  chainId?: number | null;
  connectorId?: string | null;
}) {
  if (!accountAddress) return null;
  return `${connectorId || "UntypedValue"}:${chainId || "UntypedValue"}:${accountAddress.toLowerCase()}`;
}

function createAtomicBundleUnsupportedError() {
  return new Error(
    "Your wallet does not support atomic bundled transactions. Please use a smart wallet or a wallet that supports wallet_sendCalls for this multi-step action.",
  );
}

function isUnresolvedWaitError(error: UntypedValue) {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("timed out")
    || message.includes("timeout")
    || message.includes("not confirmed")
    || message.includes("could not be found")
    || message.includes("not be processed")
    || message.includes("network")
    || message.includes("fetch failed")
    || message.includes("connection")
    || message.includes("rate limit")
    || message.includes("429")
    || message.includes("service unavailable")
    || message.includes("temporarily unavailable");
}

function isDefinitivePostSubmissionError(error: UntypedValue) {
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("transaction reverted")
    || message.includes("execution reverted");
}

function createMonitoringAbortError() {
  const error = new Error("Transaction monitoring transferred.");
  error.name = "AbortError";
  return error;
}

function throwIfMonitoringAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw createMonitoringAbortError();
}

function withMonitoringAbort<T>(promise: Promise<T>, signal?: AbortSignal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(createMonitoringAbortError());
  return new Promise<T>((resolve, reject) => {
    const handleAbort = () => reject(createMonitoringAbortError());
    signal.addEventListener("abort", handleAbort, { once: true });
    void promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", handleAbort);
    });
  });
}

function waitBeforeUnresolvedRetry(attempt: number, signal?: AbortSignal) {
  const delayMs = Math.min(
    UNRESOLVED_RETRY_DELAY_MS * (2 ** attempt),
    UNRESOLVED_RETRY_MAX_DELAY_MS,
  );
  return withMonitoringAbort(new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  }), signal);
}

function waitForLeaseRetry(retryAt: number | null, signal?: AbortSignal) {
  const delayMs = Math.max(250, (retryAt ?? Date.now() + 5_000) - Date.now() + 50);
  return withMonitoringAbort(new Promise<void>((resolve) => {
    window.setTimeout(resolve, delayMs);
  }), signal);
}

function isFailedReceipt(receipt: TransactionReceiptLike) {
  const receiptStatus = receipt?.status;
  return receiptStatus === "reverted"
    || receiptStatus === "failed"
    || receiptStatus === 0
    || receiptStatus === "0x0";
}

function getPendingRecordHash(record: PendingEvmRecord) {
  return record.proof.kind === "reservation" ? undefined : record.proof.hash;
}

function getPendingRecordId(record: PendingEvmRecord) {
  return record.proof.kind === "calls" ? record.proof.id : null;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeoutRef: ReturnType<typeof setTimeout> | null = null;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutRef = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeoutRef !== null) {
      clearTimeout(timeoutRef);
    }
  }) as Promise<T>;
}

function getStatusLabelData({
  errorMessage,
  isExecuting,
  status,
  transactionHash,
  transactionId,
}: {
  errorMessage: string | null;
  isExecuting: boolean;
  status: LifecycleStatus;
  transactionHash?: Hex;
  transactionId: string | null;
}) {
  let label = "";
  let labelClassName = TEXT_MUTED;

  if (status.statusName === "buildingTransaction") {
    label = "Building transaction...";
  }

  if (status.statusName === "transactionPending" && !transactionHash && !transactionId) {
    label = "Confirm in wallet.";
  }

  if (transactionHash || transactionId || (isExecuting && status.statusName === "buildingTransaction")) {
    label = "Transaction in progress...";
  }

  if (status.statusName === "transactionUnresolved") {
    label = "Confirmation delayed. Check transaction.";
  }

  if (status.statusName === "submissionAmbiguous") {
    label = "Wallet confirmation may still be pending — check your wallet activity.";
  }

  if (status.statusName === "transactionStale") {
    label = "Still unconfirmed. Check your wallet, then allow a new transaction.";
  }

  if (status.statusName === "success") {
    label = "Successful";
  }

  if (errorMessage) {
    label = getFriendlyTransactionMessage(errorMessage);
    labelClassName = TEXT_ERROR;
  }

  return { label, labelClassName };
}

function getToastLabelData({
  errorMessage,
  isExecuting,
  status,
  transactionHash,
  transactionId,
}: {
  errorMessage: string | null;
  isExecuting: boolean;
  status: LifecycleStatus;
  transactionHash?: Hex;
  transactionId: string | null;
}) {
  let label = "";
  let labelClassName = TEXT_MUTED;

  if (status.statusName === "buildingTransaction") {
    label = "Building transaction";
  }

  if (isExecuting || transactionHash || transactionId) {
    label = "Transaction in progress";
  }

  if (status.statusName === "transactionUnresolved") {
    label = "Confirmation delayed. Check transaction";
  }

  if (status.statusName === "submissionAmbiguous") {
    label = "Wallet confirmation may still be pending — check your wallet activity";
  }

  if (status.statusName === "transactionStale") {
    label = "Still unconfirmed. Check wallet before allowing a new transaction";
  }

  if (status.statusName === "success") {
    label = "Successful";
  }

  if (errorMessage) {
    label = getFriendlyTransactionMessage(errorMessage);
    labelClassName = TEXT_ERROR;
  }

  return { label, labelClassName };
}

function useTransactionContext() {
  const context = useContext(TransactionContext);
  if (!context) {
    throw new Error("Transaction components must be used within <Transaction />");
  }
  return context;
}

export function Transaction({
  calls,
  onError,
  onStatus,
  isSponsored = false,
  capabilities,
  intentKey = "",
  resetAfter = 2000,
  children,
}: TransactionProps) {
  const { address: connectedAccountAddress, connector } = useAccount();
  const { data: walletClient } = useWalletClient();
  const accountChainId = useChainId();
  const {
    isLoading: isSmartWalletDetectionLoading,
    isSmartWallet,
    refetch: refetchSmartWalletDetection,
    walletType,
  } = useSmartWallet();
  const transactionControllerId = useId();

  const [status, setStatus] = useState<LifecycleStatus>(IDLE_STATUS);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isRecoveryChecking, setIsRecoveryChecking] = useState(true);
  const [isPeerBlocked, setIsPeerBlocked] = useState(false);
  const [isToastVisible, setIsToastVisible] = useState(false);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [transactionHash, setTransactionHash] = useState<Hex | undefined>(undefined);

  const mountedRef = useRef(true);
  const executingRef = useRef(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transactionIdRef = useRef<string | null>(null);
  const transactionHashRef = useRef<Hex | undefined>(undefined);
  const beforeSubmitRef = useRef<(() => void) | undefined>(undefined);
  const activePendingRecordRef = useRef<PendingEvmRecord | null>(null);
  const notifyStatusCallbacksRef = useRef(true);
  const blockerStaleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const normalizedCalls = useMemo(
    () =>
      calls.map((call) => ({
        data: call.data,
        to: call.to ?? call.address,
        value: call.value ?? BigInt(0),
      })),
    [calls],
  );
  const pendingCallsDigest = useMemo(
    () => createPendingEvmCallsDigest(normalizedCalls),
    [normalizedCalls],
  );
  const resolvedIntentKey = intentKey.trim() || `calls:${pendingCallsDigest}`;
  const currentConnectorId = connector?.id;
  const recoveryRegistryIdentity = useMemo(() => {
    if (!walletClient?.account) return null;
    return {
      accountAddress: walletClient.account.address,
      chainId: (walletClient.chain ?? base).id,
    };
  }, [walletClient]);
  const recoveryIntentDigest = useMemo(
    () => getPendingEvmIntentDigest(resolvedIntentKey),
    [resolvedIntentKey],
  );
  const walletClientMatchesAccount = Boolean(
    walletClient?.account
    && connectedAccountAddress
    && walletClient.account.address.toLowerCase() === connectedAccountAddress.toLowerCase()
    && (walletClient.chain?.id ?? accountChainId) === accountChainId,
  );
  const walletRoutingLockMessage = walletClient?.account
    ? !walletClientMatchesAccount || isSmartWalletDetectionLoading
      ? "Checking wallet type…"
      : walletType === "UntypedValue"
        ? "Retry wallet check"
        : null
    : null;
  const recoveryGateActive =
    isRecoveryChecking || isPeerBlocked || walletRoutingLockMessage !== null;
  const walletRoutingIdentity = walletClient?.account && walletRoutingLockMessage === null
    ? `${walletClient.chain?.id ?? accountChainId}:${walletClient.account.address.toLowerCase()}:${walletType}`
    : null;
  const currentWalletRoutingIdentityRef = useRef<string | null>(walletRoutingIdentity);
  currentWalletRoutingIdentityRef.current = walletRoutingIdentity;
  const retryWalletRouting = useCallback(() => {
    void refetchSmartWalletDetection();
  }, [refetchSmartWalletDetection]);

  const clearResetTimer = useCallback(() => {
    if (resetTimeoutRef.current) {
      clearTimeout(resetTimeoutRef.current);
      resetTimeoutRef.current = null;
    }
  }, []);

  const clearTransactionArtifacts = useCallback(() => {
    transactionIdRef.current = null;
    transactionHashRef.current = undefined;
    if (!mountedRef.current) return;
    setTransactionId(null);
    setTransactionHash(undefined);
  }, []);

  const clearPersistedPendingRecord = useCallback(() => {
    const activeRecord = activePendingRecordRef.current;
    if (!activeRecord) return true;
    const removed = removePendingEvmRecord(
      getBrowserPendingEvmStorage(),
      activeRecord,
    );
    if (removed) activePendingRecordRef.current = null;
    return removed;
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearResetTimer();
      if (blockerStaleTimerRef.current) {
        clearTimeout(blockerStaleTimerRef.current);
        blockerStaleTimerRef.current = null;
      }
    };
  }, [clearResetTimer]);

  const scheduleReset = useCallback(() => {
    clearResetTimer();
    if (!resetAfter || resetAfter <= 0) {
      return;
    }

    resetTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      clearTransactionArtifacts();
      setIsToastVisible(false);
      setStatus(IDLE_STATUS);
    }, resetAfter);
  }, [clearResetTimer, clearTransactionArtifacts, resetAfter]);

  const emitStatus = useCallback(
    (nextStatus: LifecycleStatus) => {
      let ownsTerminalCallback = true;
      if (TERMINAL_STATUSES.has(nextStatus.statusName)) {
        const removedOwnRecord = clearPersistedPendingRecord();
        ownsTerminalCallback = removedOwnRecord;
      }
      const isTerminal = TERMINAL_STATUSES.has(nextStatus.statusName);
      if (!mountedRef.current && !isTerminal) return false;
      if (mountedRef.current) setStatus(nextStatus);

      const shouldNotifyCallbacks = notifyStatusCallbacksRef.current && ownsTerminalCallback;
      if (shouldNotifyCallbacks) {
        try {
          void Promise.resolve(onStatus?.(nextStatus)).catch((error) => {
            console.warn("Transaction status callback failed", error);
          });
        } catch (error) {
          console.warn("Transaction status callback failed", error);
        }
      }

      if (mountedRef.current && isTerminal) {
        scheduleReset();
      }
      return shouldNotifyCallbacks;
    },
    [clearPersistedPendingRecord, onStatus, scheduleReset],
  );

  const presentPendingBlocker = useCallback((record: PendingEvmRecord) => {
    setIsPeerBlocked(false);
    if (blockerStaleTimerRef.current) {
      clearTimeout(blockerStaleTimerRef.current);
      blockerStaleTimerRef.current = null;
    }
    activePendingRecordRef.current = record;
    const nextHash = getPendingRecordHash(record);
    const nextId = getPendingRecordId(record);
    transactionHashRef.current = nextHash;
    transactionIdRef.current = nextId;
    notifyStatusCallbacksRef.current = false;
    setTransactionHash(nextHash);
    setTransactionId(nextId);
    setIsToastVisible(true);
    setIsRecoveryChecking(false);

    const phase = getPendingEvmPhase(record);
    emitStatus({
      statusData: {
        error: new Error(
          phase === "stale"
            ? "This pending transaction requires a wallet check before another can be sent."
            : "Another transaction from this wallet is still awaiting confirmation.",
        ),
        ...(nextHash ? { transactionHash: nextHash } : {}),
        ...(nextId ? { transactionId: nextId } : {}),
        transactionReceipts: [],
      },
      statusName: phase === "stale"
        ? "transactionStale"
        : record.proof.kind === "reservation"
          ? "submissionAmbiguous"
          : "transactionUnresolved",
    });

    if (phase === "hard") {
      const staleInMs = Math.max(
        0,
        record.submittedAt + PENDING_EVM_HARD_LOCK_MS - Date.now(),
      );
      blockerStaleTimerRef.current = setTimeout(() => {
        if (activePendingRecordRef.current?.attemptId !== record.attemptId) return;
        emitStatus({
          statusData: {
            error: new PendingEvmStaleError(),
            ...(nextHash ? { transactionHash: nextHash } : {}),
            ...(nextId ? { transactionId: nextId } : {}),
            transactionReceipts: [],
          },
          statusName: "transactionStale",
        });
      }, staleInMs);
    }
  }, [emitStatus]);

  const execute = useCallback(async (
    recoveryRecord?: PendingEvmRecord,
    notifyCallbacks = true,
    recoverySignal?: AbortSignal,
  ) => {
    if (
      !walletRoutingIdentity
      || currentWalletRoutingIdentityRef.current !== walletRoutingIdentity
    ) {
      return;
    }
    if (executingRef.current) {
      return;
    }
    throwIfMonitoringAborted(recoverySignal);
    let monitoringSignal = recoverySignal;

    clearResetTimer();
    if (!recoveryRecord) {
      clearTransactionArtifacts();
    }
    notifyStatusCallbacksRef.current = notifyCallbacks;
    if (!recoveryRecord) setIsToastVisible(true);

    if (!walletClient?.account) {
      const error = new Error("Wallet client unavailable.");
      emitStatus({
        statusData: { error, transactionReceipts: [] },
        statusName: "buildError",
      });
      onError?.(error);
      return;
    }

    if (!recoveryRecord && normalizedCalls.length === 0) {
      const error = new Error("No transaction calls provided.");
      emitStatus({
        statusData: { error, transactionReceipts: [] },
        statusName: "buildError",
      });
      onError?.(error);
      return;
    }

    const invalidCall = recoveryRecord
      ? undefined
      : normalizedCalls.find((call) => !call.to);
    if (invalidCall) {
      const error = new Error("Transaction call is missing a destination address.");
      emitStatus({
        statusData: { error, transactionReceipts: [] },
        statusName: "buildError",
      });
      onError?.(error);
      return;
    }

    const chain = walletClient.chain ?? base;
    const transactionRegistry = {
      accountAddress: walletClient.account.address,
      chainId: chain.id,
    };
    let coordinatedPendingRecord: PendingEvmRecord | null = recoveryRecord ?? null;
    if (recoveryRecord) {
      const recoveryIdentity: PendingEvmIntentIdentity = {
        accountAddress: walletClient.account.address.toLowerCase(),
        chainId: chain.id,
        intentKey: resolvedIntentKey,
      };
      const storedRecord = readPendingEvmRecord(
        getBrowserPendingEvmStorage(),
        recoveryIdentity,
      );
      const compatibility = getPendingEvmCompatibility(recoveryRecord, {
        callsDigest: pendingCallsDigest,
        connectorId: currentConnectorId,
      });
      if (
        !storedRecord
        || storedRecord.attemptId !== recoveryRecord.attemptId
        || getPendingEvmPhase(recoveryRecord) !== "hard"
        || !compatibility.canResume
      ) {
        requestPendingEvmCoordinatorReconcile(transactionRegistry);
        return;
      }

      activePendingRecordRef.current = recoveryRecord;
      setIsPeerBlocked(false);
      setIsToastVisible(true);
      transactionHashRef.current = getPendingRecordHash(recoveryRecord);
      transactionIdRef.current = getPendingRecordId(recoveryRecord);
      if (mountedRef.current) {
        setTransactionHash(getPendingRecordHash(recoveryRecord));
        setTransactionId(getPendingRecordId(recoveryRecord));
      }
    }
    executingRef.current = true;
    if (mountedRef.current) {
      setIsExecuting(true);
    }

    emitStatus(recoveryRecord
      ? {
        statusData: {
          error: new Error("Resuming transaction confirmation."),
          ...(getPendingRecordHash(recoveryRecord)
            ? { transactionHash: getPendingRecordHash(recoveryRecord) }
            : {}),
          ...(getPendingRecordId(recoveryRecord)
            ? { transactionId: getPendingRecordId(recoveryRecord)! }
            : {}),
          transactionReceipts: [],
        },
        statusName: "transactionUnresolved",
      }
      : {
        statusData: { transactionReceipts: [] },
        statusName: "transactionPending",
      });

    const sendCallsSupportKey = getSendCallsSupportKey({
      accountAddress: walletClient.account.address,
      chainId: chain.id,
      connectorId: connector?.id ?? null,
    });
    const canBatch =
      typeof (walletClient as UntypedValue).sendCalls === "function"
      && typeof (walletClient as UntypedValue).waitForCallsStatus === "function";
    const requiresAtomicBundle = normalizedCalls.length > 1;
    const shouldUseBatchedExecution = recoveryRecord
      ? recoveryRecord.method === "batch"
      : (
        canBatch
        && !(
          sendCallsSupportKey
          && unsupportedSendCallsKeys.has(sendCallsSupportKey)
        )
        && (requiresAtomicBundle || isSponsored || isSmartWallet)
      );
    const paymasterUrl =
      process.env.NEXT_PUBLIC_CDP_PAYMASTER_URL
      || process.env.NEXT_PUBLIC_PAYMASTER_SERVICE_URL
      || undefined;
    const mergedCapabilities = {
      ...(capabilities || {}),
      ...(
        isSponsored && paymasterUrl
          ? { paymasterService: { optional: true, url: paymasterUrl } }
          : {}
      ),
    };
    let completedReceipts: TransactionReceiptLike[] = [];

    const createSubmissionReservation = (method: PendingEvmExecutionMethod) => {
      const reservation = createPendingEvmRecord({
        callsDigest: pendingCallsDigest,
        ...(method === "batch" ? { connectorId: currentConnectorId ?? "unavailable" } : {}),
        identity: {
          accountAddress: walletClient.account.address,
          chainId: chain.id,
          intentKey: resolvedIntentKey,
        },
        method,
        proof: { kind: "reservation" },
      });
      coordinatedPendingRecord = reservation;
      activePendingRecordRef.current = reservation;
      claimPendingEvmCoordinatorAttempt(
        transactionRegistry,
        reservation,
        transactionControllerId,
      );
      if (!writePendingEvmRecord(getBrowserPendingEvmStorage(), reservation)) {
        removePendingEvmRecord(getBrowserPendingEvmStorage(), reservation);
        releasePendingEvmCoordinatorAttempt(
          transactionRegistry,
          reservation,
          transactionControllerId,
        );
        coordinatedPendingRecord = null;
        activePendingRecordRef.current = null;
        throw new Error(
          "Safe transaction tracking requires browser storage. Enable site storage, then try again.",
        );
      }
      return reservation;
    };

    const finalizeSubmittedProof = (reservation: PendingEvmRecord, {
      method,
      transactionHash: nextTransactionHash,
      transactionId: nextTransactionId,
    }: {
      method: PendingEvmExecutionMethod;
      transactionHash?: Hex;
      transactionId?: string;
    }) => {
      const finalized = finalizePendingEvmRecord(
        getBrowserPendingEvmStorage(),
        reservation,
        method === "direct"
          ? { hash: nextTransactionHash!, kind: "hash" }
          : { id: nextTransactionId!, kind: "calls" },
      );
      if (!finalized) throw new Error("Failed to finalize transaction tracking proof.");
      if (finalized.persisted) {
        coordinatedPendingRecord = finalized.record;
        activePendingRecordRef.current = finalized.record;
        monitoringSignal = promotePendingEvmCoordinatorAttemptToMonitor(
          transactionRegistry,
          finalized.record,
          transactionControllerId,
        ) ?? monitoringSignal;
      } else {
        coordinatedPendingRecord = finalized.blocker;
        activePendingRecordRef.current = finalized.blocker;
        console.warn(
          "Transaction proof could not replace its durable reservation; keeping the wallet locked until confirmation or explicit stale acknowledgement.",
        );
      }
      return finalized.record;
    };

    const submitWithRegistryGuard = async <T,>(
      method: PendingEvmExecutionMethod,
      submitter: (reservation: PendingEvmRecord) => Promise<T>,
    ) => {
      const storage = getBrowserPendingEvmStorage();
      if (!canDurablyPersistPendingEvmTransactions(storage)) {
        throw new Error(
          "Safe transaction tracking requires browser storage. Enable site storage, then try again.",
        );
      }
      const guarded = await withPendingEvmSubmissionGuard(
        storage,
        transactionRegistry,
        () => submitter(createSubmissionReservation(method)),
      );
      if (!guarded.acquired) {
        setIsPeerBlocked(true);
        setIsRecoveryChecking(false);
        setIsToastVisible(false);
        setStatus(IDLE_STATUS);
        requestPendingEvmCoordinatorReconcile(transactionRegistry);
        return null;
      }
      if (!guarded.value.submitted) {
        setIsPeerBlocked(true);
        setIsRecoveryChecking(false);
        requestPendingEvmCoordinatorReconcile(transactionRegistry);
        return null;
      }
      return guarded.value.value;
    };

    const emitUnresolvedStatus = (error: UntypedValue) => {
      emitStatus({
        statusData: {
          error,
          ...(transactionHashRef.current ? { transactionHash: transactionHashRef.current } : {}),
          ...(transactionIdRef.current ? { transactionId: transactionIdRef.current } : {}),
          transactionReceipts: completedReceipts,
        },
        statusName: "transactionUnresolved",
      });
    };

    const waitForCanonicalReceipt = async (hash: Hex, pendingRecord: PendingEvmRecord) => {
      const requestCanonicalReceipt = () => waitForBaseReceipt(hash);
      let pendingReceipt = requestCanonicalReceipt();
      let initialReceiptRejected = false;
      void pendingReceipt.catch(() => {
        initialReceiptRejected = true;
      });
      try {
        return await withMonitoringAbort(withPendingEvmHardDeadline(
          withTimeout(
            pendingReceipt,
            DIRECT_RECEIPT_TIMEOUT_MS,
            RECEIPT_TIMEOUT_MESSAGE,
          ),
          pendingRecord,
        ), monitoringSignal);
      } catch (error) {
        if (!isUnresolvedWaitError(error)) throw error;
        emitUnresolvedStatus(error);
      }

      // `Promise.race` does not cancel the receipt promise. Keep awaiting that
      // original request first; if its own transport times out, start a fresh
      // monitor without ever resubmitting the transaction.
      let retryAttempt = 0;
      if (initialReceiptRejected) {
        await waitBeforeUnresolvedRetry(retryAttempt, monitoringSignal);
        retryAttempt += 1;
        throwIfMonitoringAborted(monitoringSignal);
        pendingReceipt = requestCanonicalReceipt();
      }
      while (true) {
        try {
          return await withMonitoringAbort(
            withPendingEvmHardDeadline(pendingReceipt, pendingRecord),
            monitoringSignal,
          );
        } catch (error) {
          if (!isUnresolvedWaitError(error)) throw error;
          emitUnresolvedStatus(error);
          await waitBeforeUnresolvedRetry(retryAttempt, monitoringSignal);
          retryAttempt += 1;
          throwIfMonitoringAborted(monitoringSignal);
          pendingReceipt = requestCanonicalReceipt();
        }
      }
    };

    const confirmDirectTransaction = async (
      hash: Hex,
      pendingRecord: PendingEvmRecord,
    ) => {
        transactionHashRef.current = hash;
        if (mountedRef.current) {
          setTransactionHash(hash);
        }

        emitStatus({
          statusData: {
            transactionHash: hash,
            transactionReceipts: completedReceipts,
          },
          statusName: "transactionPending",
        });

        const confirmedReceipt = await waitForCanonicalReceipt(hash, pendingRecord);
        const receipt = normalizeTransactionReceipt(confirmedReceipt);
        const receiptHash = extractTransactionHash(receipt) as Hex | undefined;

        completedReceipts = [...completedReceipts, receipt];
        transactionHashRef.current = receiptHash ?? hash;
        if (mountedRef.current) {
          setTransactionHash(receiptHash ?? hash);
        }

        if (confirmedReceipt.status !== "success") {
          throw new Error("Transaction reverted.");
        }
    };

    const executeDirectTransactions = async () => {
      let submitted: { hash: Hex; pendingRecord: PendingEvmRecord } | null;
      if (recoveryRecord?.method === "direct") {
        submitted = {
          hash: getPendingRecordHash(recoveryRecord)!,
          pendingRecord: recoveryRecord,
        };
      } else {
        const call = normalizedCalls[0]!;
        submitted = await submitWithRegistryGuard("direct", async (reservation) => {
          const hash = await withPendingEvmHardDeadline(
            walletClient.sendTransaction({
              account: walletClient.account,
              chain,
              data: call.data,
              to: call.to!,
              value: call.value,
            }),
            reservation,
          );
          transactionHashRef.current = hash;
          const pendingRecord = finalizeSubmittedProof(reservation, {
            method: "direct",
            transactionHash: hash,
          });
          return { hash, pendingRecord };
        });
      }
      if (!submitted) return;

      const monitorLease = await withPendingEvmMonitorLease(
        getBrowserPendingEvmStorage(),
        submitted.pendingRecord,
        async (isLeaseCurrent) => {
          try {
            await confirmDirectTransaction(submitted.hash, submitted.pendingRecord);
          } catch (error) {
            if (!isDefinitivePostSubmissionError(error)) throw error;
            throwIfMonitoringAborted(monitoringSignal);
            if (!isLeaseCurrent()) {
              throw new Error("Transaction confirmation ownership changed.");
            }
            const shouldNotifyError = emitStatus({
              statusData: {
                error,
                ...(transactionHashRef.current
                  ? { transactionHash: transactionHashRef.current }
                  : {}),
                transactionReceipts: completedReceipts,
              },
              statusName: "reverted",
            });
            if (shouldNotifyError) onError?.(error);
            return;
          }
          throwIfMonitoringAborted(monitoringSignal);
          if (!isLeaseCurrent()) {
            throw new Error("Transaction confirmation ownership changed.");
          }
          emitStatus({
            statusData: {
              ...(transactionHashRef.current
                ? { transactionHash: transactionHashRef.current }
                : {}),
              transactionReceipts: completedReceipts,
            },
            statusName: "success",
          });
        },
      );
      if (!monitorLease.acquired) {
        emitUnresolvedStatus(new Error("Transaction confirmation is being checked in another tab."));
        await waitForLeaseRetry(monitorLease.retryAt, monitoringSignal);
      }
    };

    try {
      if (shouldUseBatchedExecution) {
        try {
          let nextTransactionId: string;
          let pendingRecord: PendingEvmRecord;
          if (recoveryRecord?.method === "batch") {
            nextTransactionId = (
              recoveryRecord.proof as Extract<typeof recoveryRecord.proof, { kind: "calls" }>
            ).id;
            pendingRecord = recoveryRecord;
          } else {
            const submitted = await submitWithRegistryGuard("batch", async (reservation) => {
              const batch: UntypedValue = await withPendingEvmHardDeadline(
                (walletClient as UntypedValue).sendCalls({
                  account: walletClient.account,
                  ...(Object.keys(mergedCapabilities).length > 0 ? { capabilities: mergedCapabilities } : {}),
                  chain,
                  calls: normalizedCalls,
                  ...(normalizedCalls.length > 1 ? { forceAtomic: true } : {}),
                }),
                reservation,
              );
              if (typeof batch?.id !== "string" || batch.id.trim() === "") {
                throw new Error("Wallet returned no transaction id.");
              }
              transactionIdRef.current = batch.id;
              const pendingRecord = finalizeSubmittedProof(reservation, {
                method: "batch",
                transactionId: batch.id,
              });
              return { pendingRecord, transactionId: batch.id as string };
            });
            if (!submitted) return;
            nextTransactionId = submitted.transactionId;
            pendingRecord = submitted.pendingRecord;
          }

          transactionIdRef.current = nextTransactionId;
          if (mountedRef.current) {
            setTransactionId(nextTransactionId);
          }

          emitStatus({
            statusData: {
              transactionId: nextTransactionId,
              transactionReceipts: [],
            },
            statusName: "transactionPending",
          });

          const requestCallsStatus = () => (
            resumePendingEvmRecord(pendingRecord, {
              waitForCallsStatus: (id) => (
                (walletClient as UntypedValue).waitForCallsStatus({
                  id,
                  throwOnFailure: false,
                  timeout: CALLS_STATUS_TIMEOUT_MS,
                }) as Promise<UntypedValue>
              ),
              waitForReceipt: async () => {
                throw new Error("Batch transaction cannot be monitored by direct receipt.");
              },
            }) as Promise<UntypedValue>
          );
          const getBatchTransactionHash = (result: UntypedValue) => {
            const resultReceipts = Array.isArray(result?.receipts)
              ? result.receipts as TransactionReceiptLike[]
              : [];
            return (
              resultReceipts
                .map((resultReceipt) => extractTransactionHash(resultReceipt) as Hex | undefined)
                .find((hash): hash is Hex => Boolean(hash))
              ?? extractTransactionHash(result) as Hex | undefined
            );
          };
          const hasCanonicalReceiptTarget = (result: UntypedValue) => {
            if (result?.status !== "success" || getBatchTransactionHash(result)) return true;
            emitUnresolvedStatus(
              new Error(
                "Wallet reported success without a transaction hash; waiting for canonical Base receipt evidence.",
              ),
            );
            return false;
          };
          const waitForBatchResolution = async () => {
            let pendingStatus = requestCallsStatus();
            let initialStatusRejected = false;
            let needsFreshStatus = false;
            void pendingStatus.catch(() => {
              initialStatusRejected = true;
            });
            try {
              const initialResult = await withMonitoringAbort(withPendingEvmHardDeadline(
                withTimeout<UntypedValue>(
                  pendingStatus,
                  CALLS_STATUS_TIMEOUT_MS + 5_000,
                  CALLS_STATUS_TIMEOUT_MESSAGE,
                ),
                  pendingRecord,
                ), monitoringSignal);
              if (hasCanonicalReceiptTarget(initialResult)) return initialResult;
              needsFreshStatus = true;
            } catch (error) {
              if (!isUnresolvedWaitError(error)) throw error;
              emitUnresolvedStatus(error);
            }

            // Preserve and await the original wallet status promise after our
            // UI timeout. Retry monitoring only if its transport also times
            // out; never call sendCalls again for this calls id.
            let retryAttempt = 0;
            if (initialStatusRejected || needsFreshStatus) {
              await waitBeforeUnresolvedRetry(retryAttempt, monitoringSignal);
              retryAttempt += 1;
              throwIfMonitoringAborted(monitoringSignal);
              pendingStatus = requestCallsStatus();
            }
            while (true) {
              try {
                const result = await withMonitoringAbort(
                  withPendingEvmHardDeadline(pendingStatus, pendingRecord),
                  monitoringSignal,
                );
                if (hasCanonicalReceiptTarget(result)) return result;
                await waitBeforeUnresolvedRetry(retryAttempt, monitoringSignal);
                retryAttempt += 1;
                throwIfMonitoringAborted(monitoringSignal);
                pendingStatus = requestCallsStatus();
              } catch (error) {
                if (!isUnresolvedWaitError(error)) throw error;
                emitUnresolvedStatus(error);
                await waitBeforeUnresolvedRetry(retryAttempt, monitoringSignal);
                retryAttempt += 1;
                throwIfMonitoringAborted(monitoringSignal);
                pendingStatus = requestCallsStatus();
              }
            }
          };
          const monitorLease = await withPendingEvmMonitorLease(
            getBrowserPendingEvmStorage(),
            pendingRecord,
            async (isLeaseCurrent) => {
          const result = await waitForBatchResolution();
          let receipts = ((result?.receipts as TransactionReceiptLike[]) || []).map((receipt) =>
            normalizeTransactionReceipt(receipt),
          );
          let nextTransactionHash = getBatchTransactionHash(result);
          if (nextTransactionHash) {
            transactionHashRef.current = nextTransactionHash;
            if (mountedRef.current) setTransactionHash(nextTransactionHash);
          }

          // Base may expose a provisional receipt with a zero block hash even
          // after a wallet calls-status endpoint says success. When a concrete
          // hash exists, canonical RPC evidence is mandatory before terminal
          // callbacks or pending-proof removal; receipt log presence is not a
          // finality signal.
          if (result?.status === "success") {
            if (!nextTransactionHash) {
              throw new Error(
                "Wallet reported success without a transaction hash; canonical Base receipt is not confirmed.",
              );
            }
            const canonicalReceipt = normalizeTransactionReceipt(
              await waitForCanonicalReceipt(nextTransactionHash, pendingRecord),
            );
            const canonicalHash = (
              extractTransactionHash(canonicalReceipt) ?? nextTransactionHash
            ) as Hex;
            receipts = [
              canonicalReceipt,
              ...receipts.filter((receipt) => extractTransactionHash(receipt) !== canonicalHash),
            ];
            nextTransactionHash = canonicalHash;
          }

          transactionHashRef.current = nextTransactionHash;
          if (mountedRef.current) {
            setTransactionHash(nextTransactionHash);
          }

          if (result?.status !== "success" || receipts.some(isFailedReceipt)) {
            const error = new Error("Transaction reverted.");
            throwIfMonitoringAborted(monitoringSignal);
            if (!isLeaseCurrent()) {
              throw new Error("Transaction confirmation ownership changed.");
            }
            const shouldNotifyError = emitStatus({
              statusData: {
                error,
                ...(nextTransactionHash ? { transactionHash: nextTransactionHash } : {}),
                ...(nextTransactionId ? { transactionId: nextTransactionId } : {}),
                transactionReceipts: receipts,
              },
              statusName: "reverted",
            });
            if (shouldNotifyError) onError?.(error);
            return;
          }

          const successStatus: LifecycleStatus = {
            statusData: {
              ...(nextTransactionHash ? { transactionHash: nextTransactionHash } : {}),
              ...(nextTransactionId ? { transactionId: nextTransactionId } : {}),
              transactionReceipts: receipts,
            },
            statusName: "success",
          };
          if (!getLifecycleTransactionProof(successStatus)) {
            throw new Error("Wallet reported success without transaction proof.");
          }
          throwIfMonitoringAborted(monitoringSignal);
          if (!isLeaseCurrent()) {
            throw new Error("Transaction confirmation ownership changed.");
          }
          emitStatus(successStatus);
            },
          );
          if (!monitorLease.acquired) {
            emitUnresolvedStatus(new Error("Transaction confirmation is being checked in another tab."));
            await waitForLeaseRetry(monitorLease.retryAt, monitoringSignal);
          }
          return;
        } catch (error) {
          if (!isDefinitiveUnsupportedEvmBatchError(error) || transactionIdRef.current) {
            throw error;
          }

          if (sendCallsSupportKey) {
            unsupportedSendCallsKeys.add(sendCallsSupportKey);
          }

          const unsupportedReservation = coordinatedPendingRecord;
          if (unsupportedReservation?.proof.kind === "reservation") {
            const removedReservation = removePendingEvmRecord(
              getBrowserPendingEvmStorage(),
              unsupportedReservation,
            );
            if (!removedReservation) {
              throw new Error(
                "Could not safely release the unsupported batch reservation.",
              );
            }
            releasePendingEvmCoordinatorAttempt(
              transactionRegistry,
              unsupportedReservation,
              transactionControllerId,
            );
            activePendingRecordRef.current = null;
            coordinatedPendingRecord = null;
          }
          clearTransactionArtifacts();
          if (requiresAtomicBundle) {
            throw createAtomicBundleUnsupportedError();
          }

          await executeDirectTransactions();
          return;
        }
      }

      if (requiresAtomicBundle) {
        throw createAtomicBundleUnsupportedError();
      }

      await executeDirectTransactions();
    } catch (error) {
      if ((error as { name?: unknown })?.name === "AbortError") return;
      const hasSubmittedProof = Boolean(
        transactionHashRef.current || transactionIdRef.current,
      );
      const hasAmbiguousReservation = (
        activePendingRecordRef.current?.proof.kind === "reservation"
        && !hasSubmittedProof
      );
      if (
        hasAmbiguousReservation
        && isDefinitivePendingEvmPreSubmissionError(error)
      ) {
        // The wallet/RPC definitively rejected this request before returning a
        // hash/id. Release only by exact compare-and-delete; a failed CAS stays
        // locked because another controller may have advanced the attempt.
        if (!clearPersistedPendingRecord()) {
          const reservation = activePendingRecordRef.current;
          if (mountedRef.current && reservation) presentPendingBlocker(reservation);
          return;
        }
      } else if (hasAmbiguousReservation) {
        const reservation = activePendingRecordRef.current;
        if (mountedRef.current && reservation) presentPendingBlocker(reservation);
        return;
      }
      if (!mountedRef.current) return;

      if (hasSubmittedProof && error instanceof PendingEvmStaleError) {
        emitStatus({
          statusData: {
            error,
            ...(transactionHashRef.current
              ? { transactionHash: transactionHashRef.current }
              : {}),
            ...(transactionIdRef.current
              ? { transactionId: transactionIdRef.current }
              : {}),
            transactionReceipts: completedReceipts,
          },
          statusName: "transactionStale",
        });
        return;
      }
      if (hasSubmittedProof && !isDefinitivePostSubmissionError(error)) {
        // Once a wallet supplied an id/hash, a monitoring failure is not proof
        // that the transaction failed. Preserve the proof indefinitely and
        // never expose a resend action for this unresolved operation.
        emitUnresolvedStatus(error);
        return;
      }

      const statusName = getErrorStatusName(error);
      const shouldNotifyError = emitStatus({
        statusData: {
          error,
          ...(transactionHashRef.current ? { transactionHash: transactionHashRef.current } : {}),
          ...(transactionIdRef.current ? { transactionId: transactionIdRef.current } : {}),
          transactionReceipts: completedReceipts,
        },
        statusName,
      });
      if (shouldNotifyError) onError?.(error);
    } finally {
      executingRef.current = false;
      if (coordinatedPendingRecord) {
        releasePendingEvmCoordinatorAttempt(
          transactionRegistry,
          coordinatedPendingRecord,
          transactionControllerId,
        );
      }
      if (mountedRef.current) {
        setIsExecuting(false);
      }
    }
  }, [
    capabilities,
    clearPersistedPendingRecord,
    clearResetTimer,
    clearTransactionArtifacts,
    emitStatus,
    connector?.id,
    currentConnectorId,
    isSmartWallet,
    isSponsored,
    normalizedCalls,
    onError,
    pendingCallsDigest,
    presentPendingBlocker,
    resolvedIntentKey,
    transactionControllerId,
    walletClient,
    walletRoutingIdentity,
  ]);

  const clearDisplayedPendingBlocker = useCallback(() => {
    if (executingRef.current) return;
    if (blockerStaleTimerRef.current) {
      clearTimeout(blockerStaleTimerRef.current);
      blockerStaleTimerRef.current = null;
    }
    activePendingRecordRef.current = null;
    setIsPeerBlocked(false);
    notifyStatusCallbacksRef.current = true;
    clearTransactionArtifacts();
    setIsToastVisible(false);
    setIsRecoveryChecking(false);
    setStatus(IDLE_STATUS);
  }, [clearTransactionArtifacts]);

  useEffect(() => {
    if (!recoveryRegistryIdentity) {
      setIsRecoveryChecking(false);
      clearDisplayedPendingBlocker();
      return;
    }
    setIsRecoveryChecking(true);
    return registerPendingEvmController(recoveryRegistryIdentity, {
      callsDigest: pendingCallsDigest,
      connectorId: currentConnectorId,
      controllerId: transactionControllerId,
      intentDigest: recoveryIntentDigest,
      onSnapshot: ({ feedbackRecord, locked }) => {
        if (!mountedRef.current) return;
        setIsRecoveryChecking(false);
        if (feedbackRecord) {
          presentPendingBlocker(feedbackRecord);
          return;
        }
        if (locked) {
          if (!executingRef.current) clearDisplayedPendingBlocker();
          setIsPeerBlocked(true);
          return;
        }
        setIsPeerBlocked(false);
        if (!executingRef.current) clearDisplayedPendingBlocker();
      },
      recover: (record, signal) => execute(record, intentKey.trim() !== "", signal),
    });
  }, [
    clearDisplayedPendingBlocker,
    currentConnectorId,
    execute,
    intentKey,
    pendingCallsDigest,
    presentPendingBlocker,
    recoveryIntentDigest,
    recoveryRegistryIdentity,
    transactionControllerId,
  ]);

  const submit = useCallback((beforeSubmit?: (() => void) | null) => {
    if (executingRef.current || recoveryGateActive) return;

    // Passing null deliberately clears an earlier pre-submit callback. Omitting
    // the argument (the toast retry path) replays the callback from the original
    // button, so retries cannot bypass validation or analytics behavior.
    if (beforeSubmit !== undefined) {
      beforeSubmitRef.current = beforeSubmit ?? undefined;
    }
    try {
      beforeSubmitRef.current?.();
    } catch (error) {
      console.warn("Transaction button pre-handler failed", error);
    }
    void execute();
  }, [execute, recoveryGateActive]);

  const acknowledgeStale = useCallback(() => {
    if (status.statusName !== "transactionStale") return;
    const pendingRecord = activePendingRecordRef.current;
    if (
      !pendingRecord
      || !acknowledgePendingEvmRecord(
        getBrowserPendingEvmStorage(),
        pendingRecord,
      )
    ) {
      return;
    }
    if (recoveryRegistryIdentity) {
      releasePendingEvmCoordinatorAttempt(
        recoveryRegistryIdentity,
        pendingRecord,
        transactionControllerId,
      );
    }
    activePendingRecordRef.current = null;
    executingRef.current = false;
    clearTransactionArtifacts();
    setIsExecuting(false);
    setIsToastVisible(false);
    setStatus(IDLE_STATUS);
  }, [
    clearTransactionArtifacts,
    recoveryRegistryIdentity,
    status.statusName,
    transactionControllerId,
  ]);

  const explorerChain = walletClient?.chain ?? base;
  const receipt = useMemo(
    () => getLifecycleTransactionProof(status),
    [status],
  );
  const errorMessage = useMemo(() => {
    if (status.statusName === "idle" || status.statusName === "success") {
      return null;
    }
    if (
      status.statusName === "buildingTransaction"
      || status.statusName === "transactionPending"
      || status.statusName === "submissionAmbiguous"
      || status.statusName === "transactionUnresolved"
      || status.statusName === "transactionStale"
    ) {
      return null;
    }
    return getErrorMessage(status.statusData.error);
  }, [status]);

  const explorerHref = useMemo(() => {
    const hash =
      transactionHash
      || status.statusData.transactionHash
      || (extractTransactionHash(status.statusData.transactionReceipts[0]) as Hex | undefined);
    return getExplorerHref(hash, explorerChain.blockExplorers?.default.url);
  }, [explorerChain.blockExplorers?.default.url, status, transactionHash]);
  const effectiveIsExecuting = isExecuting || isRecoveryChecking;

  const contextValue = useMemo<TransactionContextValue>(
    () => ({
      acknowledgeStale,
      chainId: walletClient?.chain?.id ?? accountChainId ?? null,
      dismissToast: () => setIsToastVisible(false),
      errorMessage,
      explorerHref,
      isExecuting: effectiveIsExecuting,
      isSubmissionLocked: recoveryGateActive || status.statusName === "submissionAmbiguous",
      submissionLockMessage: walletRoutingLockMessage,
      isToastVisible,
      receipt,
      retryWalletRouting,
      setIsToastVisible,
      status,
      submit,
      transactionHash,
      transactionId,
    }),
    [
      accountChainId,
      acknowledgeStale,
      errorMessage,
      explorerHref,
      effectiveIsExecuting,
      recoveryGateActive,
      walletRoutingLockMessage,
      isToastVisible,
      receipt,
      retryWalletRouting,
      status,
      submit,
      transactionHash,
      transactionId,
      walletClient?.chain?.id,
    ],
  );

  return (
    <TransactionContext.Provider value={contextValue}>
      {children}
    </TransactionContext.Provider>
  );
}

export function TransactionButton({
  ariaLabel,
  className,
  disabled = false,
  onClick,
  text: idleText = "Transact",
  render,
}: TransactionButtonProps) {
  const context = useTransactionContext();
  const { address } = useAccount();
  const { showCallsStatus } = useShowCallsStatus();
  const {
    chainId,
    errorMessage,
    explorerHref,
    isExecuting,
    isSubmissionLocked,
    submissionLockMessage,
    receipt,
    retryWalletRouting,
    status: lifecycleStatus,
    submit,
    transactionHash,
    transactionId,
  } = context;

  const isSuccessful = lifecycleStatus.statusName === "success";
  const isSubmissionAmbiguous = lifecycleStatus.statusName === "submissionAmbiguous";
  const isUnresolved = lifecycleStatus.statusName === "transactionUnresolved";
  const isStale = lifecycleStatus.statusName === "transactionStale";
  const isCheckOnly = isUnresolved || isStale;
  const isWalletRoutingRetry = submissionLockMessage === "Retry wallet check";
  const isDisabled = !isSuccessful
    && !isCheckOnly
    && (isExecuting || (isSubmissionLocked && !isWalletRoutingRetry) || disabled);

  const handleSuccess = useCallback(() => {
    if (receipt && transactionId && transactionHash && chainId && address) {
      const url = new URL("https://wallet.coinbase.com/assets/transactions");
      url.searchParams.set("contentParams[txHash]", transactionHash);
      url.searchParams.set("contentParams[chainId]", JSON.stringify(chainId));
      url.searchParams.set("contentParams[fromAddress]", address);
      // `url` is a URL object here — openExternalUrl takes a string.
      void openExternalUrl(url.toString());
      return;
    }

    if (transactionId) {
      showCallsStatus({ id: transactionId });
      return;
    }

    const transactionHref = explorerHref || getExplorerHref(transactionHash, base.blockExplorers?.default.url);
    if (!transactionHref) {
      return;
    }

    // window.open is inert inside the Farcaster / Base Mini App webview, which is
    // this app's primary surface — the "view your transaction" link silently did
    // nothing there. openExternalUrl routes through sdk.actions.openUrl in the
    // webview and falls back to window.open on plain web.
    void openExternalUrl(transactionHref);
  }, [
    address,
    chainId,
    explorerHref,
    receipt,
    showCallsStatus,
    transactionHash,
    transactionId,
  ]);

  const buttonContent = useMemo(() => {
    if (isSuccessful) {
      return "View transaction";
    }
    if (isCheckOnly) {
      return "Check transaction";
    }
    if (isSubmissionAmbiguous) {
      return "Check wallet activity";
    }
    if (submissionLockMessage) {
      return submissionLockMessage;
    }
    if (errorMessage) {
      return "Try again";
    }
    if (isExecuting) {
      return (
        <>
          <Spinner />
          <span>{getPendingButtonText(idleText)}</span>
        </>
      );
    }
    return idleText;
  }, [
    errorMessage,
    idleText,
    isCheckOnly,
    isExecuting,
    isSubmissionAmbiguous,
    isSuccessful,
    submissionLockMessage,
  ]);

  const handleSubmit = useCallback(() => {
    if (isSuccessful || isCheckOnly) {
      handleSuccess();
      return;
    }
    if (isWalletRoutingRetry) {
      retryWalletRouting();
      return;
    }

    submit(onClick ?? null);
  }, [handleSuccess, isCheckOnly, isSuccessful, isWalletRoutingRetry, onClick, retryWalletRouting, submit]);

  const status = useMemo<"default" | "error" | "pending" | "success">(() => {
    if (isSuccessful) {
      return "success";
    }
    if (errorMessage) {
      return "error";
    }
    if (isWalletRoutingRetry) {
      return "error";
    }
    if (isExecuting || isCheckOnly || submissionLockMessage !== null) {
      return "pending";
    }
    return "default";
  }, [errorMessage, isCheckOnly, isExecuting, isSuccessful, isWalletRoutingRetry, submissionLockMessage]);

  const resolvedAriaLabel = ariaLabel
    ?? (isSuccessful
      ? "View transaction"
      : isCheckOnly
        ? "Check transaction"
        : submissionLockMessage
          ? submissionLockMessage
          : errorMessage
          ? "Try again"
          : isExecuting
            ? getPendingButtonText(idleText)
            : idleText);

  if (render) {
    return render({
      context,
      isDisabled,
      onSubmit: handleSubmit,
      onSuccess: handleSuccess,
      status,
    });
  }

  return (
    <button
      className={cn(
        PRESSABLE_PRIMARY,
        "flex min-h-11 w-full items-center justify-center gap-2 rounded-[var(--radius-control)] px-4 py-3 text-sm font-semibold leading-none shadow-[var(--shadow-control)] transition-[background-color,color,box-shadow,opacity,transform] duration-[var(--motion-quick)]",
        isDisabled && PRESSABLE_DISABLED,
        TEXT_HEADLINE,
        TEXT_INVERSE,
        className,
      )}
      onClick={handleSubmit}
      type="button"
      disabled={isDisabled}
      aria-label={resolvedAriaLabel}
      aria-live="polite"
      data-testid="ockTransactionButton_Button"
    >
      {buttonContent}
    </button>
  );
}

export function TransactionStatus({
  children,
  className,
}: TransactionStatusProps) {
  const { errorMessage, isExecuting, status, transactionHash, transactionId } =
    useTransactionContext();
  const { label } = getStatusLabelData({
    errorMessage,
    isExecuting,
    status,
    transactionHash,
    transactionId,
  });

  if (!label) {
    return null;
  }

  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-2", className)}>
      {children ?? (
        <>
          <TransactionStatusLabel />
          <TransactionStatusAction />
        </>
      )}
    </div>
  );
}

function TransactionStatusAction({
  className,
}: TransactionStatusActionProps) {
  const {
    acknowledgeStale,
    explorerHref,
    receipt,
    status,
    transactionHash,
    transactionId,
  } = useTransactionContext();
  const { showCallsStatus } = useShowCallsStatus();
  const isStale = status.statusName === "transactionStale";

  const actionElement = useMemo(() => {
    if (receipt) {
      return null;
    }

    const transactionHref =
      explorerHref || getExplorerHref(transactionHash, base.blockExplorers?.default.url);

    if (transactionHash && transactionHref) {
      return (
        <Button asChild size="touchCompact" variant="ghost" className={cn(TEXT_LABEL1, TEXT_PRIMARY)}>
          <a
            href={transactionHref}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => handleExternalAnchorClick(event, transactionHref)}
          >
            View transaction
          </a>
        </Button>
      );
    }

    if (transactionId) {
      return (
        <Button
          onClick={() => showCallsStatus({ id: transactionId })}
          size="touchCompact"
          type="button"
          variant="ghost"
          className={cn(TEXT_LABEL1, TEXT_PRIMARY)}
        >
          View transaction
        </Button>
      );
    }

    return null;
  }, [explorerHref, receipt, showCallsStatus, transactionHash, transactionId]);

  if (!actionElement && !isStale) {
    return null;
  }

  return (
    <div className={cn(TEXT_LABEL2, "flex min-w-[70px] max-w-full flex-wrap justify-end gap-2", className)}>
      {actionElement}
      {isStale && (
        <Button
          className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-center leading-tight"
          onClick={acknowledgeStale}
          size="touchCompact"
          type="button"
          variant="warning"
        >
          I checked my wallet — allow another transaction
        </Button>
      )}
    </div>
  );
}

function TransactionStatusLabel({
  className,
}: TransactionStatusLabelProps) {
  const { errorMessage, isExecuting, status, transactionHash, transactionId } =
    useTransactionContext();
  const { label, labelClassName } = getStatusLabelData({
    errorMessage,
    isExecuting,
    status,
    transactionHash,
    transactionId,
  });

  if (!label) {
    return null;
  }

  return (
    <div className={cn(TEXT_LABEL2, className)}>
      <p className={labelClassName}>{label}</p>
    </div>
  );
}

export function TransactionToast({
  children,
  className,
  position = "bottom-center",
}: TransactionToastProps) {
  const { dismissToast, errorMessage, isExecuting, isToastVisible, status, transactionHash, transactionId } =
    useTransactionContext();

  const { label } = getToastLabelData({
    errorMessage,
    isExecuting,
    status,
    transactionHash,
    transactionId,
  });

  // Symmetric exit: the toast used to unmount on the very next commit after
  // dismiss, so its 500ms slide-in was paired with a 0ms disappearance. Keep it
  // mounted through a short animate-out pass before removal.
  const shouldShow = Boolean(isToastVisible && label);
  const [renderState, setRenderState] = React.useState<"hidden" | "visible" | "exiting">(
    shouldShow ? "visible" : "hidden",
  );
  React.useEffect(() => {
    if (shouldShow) {
      setRenderState("visible");
      return;
    }
    setRenderState((previous) => (previous === "visible" ? "exiting" : previous));
    const timer = window.setTimeout(() => setRenderState("hidden"), 220);
    return () => window.clearTimeout(timer);
  }, [shouldShow]);

  if (renderState === "hidden") {
    return null;
  }
  const isExiting = renderState === "exiting";

  const positionClassName = {
        "bottom-center": "bottom-20 left-1/2 -translate-x-1/2 xl:bottom-4",
        "bottom-right": "bottom-20 right-4 xl:bottom-4",
        "top-center": "top-4 left-1/2 -translate-x-1/2",
        "top-right": "top-4 right-4",
  }[position];

  const animationClassName = isExiting
    ? {
        "bottom-center": "animate-out fade-out-0 slide-out-to-bottom-8 duration-[var(--motion-standard)] fill-mode-forwards",
        "bottom-right": "animate-out fade-out-0 slide-out-to-right-8 duration-[var(--motion-standard)] fill-mode-forwards",
        "top-center": "animate-out fade-out-0 slide-out-to-top-8 duration-[var(--motion-standard)] fill-mode-forwards",
        "top-right": "animate-out fade-out-0 slide-out-to-right-8 duration-[var(--motion-standard)] fill-mode-forwards",
      }[position]
    : {
        "bottom-center": "animate-in fade-in-0 slide-in-from-bottom-8 duration-[var(--motion-modal)]",
        "bottom-right": "animate-in fade-in-0 slide-in-from-right-8 duration-[var(--motion-modal)]",
        "top-center": "animate-in fade-in-0 slide-in-from-top-8 duration-[var(--motion-modal)]",
        "top-right": "animate-in fade-in-0 slide-in-from-right-8 duration-[var(--motion-modal)]",
      }[position];

  return (
    <div
      aria-live="polite"
      className={cn(
        "fixed z-[var(--z-toast)] flex max-w-[calc(100vw-2rem)] items-start justify-between rounded-[var(--radius-control)] border border-border/60 p-2 sm:max-w-sm",
        BG_SURFACE,
        TEXT_DEFAULT,
        TOAST_SHADOW,
        animationClassName,
        "motion-reduce:animate-none",
        positionClassName,
        className,
      )}
      role="status"
      data-testid="ockToast"
    >
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2 p-2">
        {children ?? (
          <>
            <TransactionToastIcon />
            <TransactionToastLabel />
            <TransactionToastAction />
          </>
        )}
      </div>
      <button
        className="inline-flex h-11 min-h-11 w-11 min-w-11 shrink-0 items-center justify-center rounded-[var(--radius-control)] p-2 text-muted-foreground hover:bg-[hsl(var(--nav-hover-bg))] hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
        onClick={dismissToast}
        type="button"
        data-testid="ockCloseButton"
        aria-label="Dismiss transaction status"
      >
        <CloseSvg />
      </button>
    </div>
  );
}

export function TransactionToastIcon({ className }: TransactionToastIconProps) {
  const { errorMessage, isExecuting, receipt, transactionHash, transactionId } =
    useTransactionContext();

  const isInProgress = isExecuting || !!transactionId || !!transactionHash;

  const icon = useMemo(() => {
    if (receipt) {
      return <SuccessSvg />;
    }
    if (errorMessage) {
      return <ErrorSvg />;
    }
    if (isInProgress) {
      return <Spinner className="h-4 w-4" />;
    }
    return null;
  }, [errorMessage, isInProgress, receipt]);

  if (!icon) {
    return null;
  }

  return <div className={cn(TEXT_LABEL2, className)}>{icon}</div>;
}

export function TransactionToastLabel({
  className,
}: TransactionToastLabelProps) {
  const { errorMessage, isExecuting, status, transactionHash, transactionId } =
    useTransactionContext();
  const { label, labelClassName } = getToastLabelData({
    errorMessage,
    isExecuting,
    status,
    transactionHash,
    transactionId,
  });

  if (!label) {
    return null;
  }

  return (
    <div className={cn(TEXT_LABEL1, "min-w-0 max-w-[16rem]", className)}>
      <p className={labelClassName === TEXT_ERROR ? labelClassName : TEXT_DEFAULT}>
        {label}
      </p>
    </div>
  );
}

export function TransactionToastAction({
  className,
}: TransactionToastActionProps) {
  const {
    acknowledgeStale,
    errorMessage,
    submit,
    explorerHref,
    status,
    transactionHash,
    transactionId,
  } =
    useTransactionContext();
  const { showCallsStatus } = useShowCallsStatus();
  const isStale = status.statusName === "transactionStale";

  const actionElement = useMemo(() => {
    if (transactionHash) {
      const viewHref =
        explorerHref || getExplorerHref(transactionHash, base.blockExplorers?.default.url) || undefined;
      return (
        <Button asChild size="touchCompact" variant="ghost" className={cn(TEXT_LABEL1, TEXT_PRIMARY)}>
          <a
            href={viewHref}
            target="_blank"
            rel="noreferrer"
            onClick={(event) => {
              if (viewHref) handleExternalAnchorClick(event, viewHref);
            }}
          >
            View transaction
          </a>
        </Button>
      );
    }

    if (transactionId) {
      return (
        <Button
          onClick={() => showCallsStatus({ id: transactionId })}
          size="touchCompact"
          type="button"
          variant="ghost"
          className={cn(TEXT_LABEL1, TEXT_PRIMARY)}
        >
          View transaction
        </Button>
      );
    }

    if (errorMessage) {
      return (
        <Button
          className={cn(TEXT_LABEL1, TEXT_PRIMARY)}
          size="touchCompact"
          type="button"
          variant="ghost"
          onClick={() => submit()}
        >
          Try again
        </Button>
      );
    }

    return null;
  }, [errorMessage, explorerHref, showCallsStatus, submit, transactionHash, transactionId]);

  if (!actionElement && !isStale) {
    return null;
  }

  return (
    <div className={cn(TEXT_LABEL1, "flex w-full min-w-0 flex-wrap items-center justify-end gap-2 sm:w-auto", className)}>
      {actionElement}
      {isStale && (
        <Button
          className="h-auto min-h-11 max-w-full whitespace-normal py-2 text-center leading-tight"
          onClick={acknowledgeStale}
          size="touchCompact"
          type="button"
          variant="warning"
        >
          I checked my wallet — allow another transaction
        </Button>
      )}
    </div>
  );
}
