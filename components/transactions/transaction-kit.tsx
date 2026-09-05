"use client";

import { monitorSubmittedBatch, throwIfMonitoringAborted, withMonitoringAbort, waitForMonitorDelay } from "@/lib/transaction-monitor";
import { parseWalletBatchStatus, parseWalletCallsId, getBatchTransactionHashes, hasWalletBatchResolution, type WalletBatchStatus } from "@/lib/wallet-batch-status";
import { getErrorMessage, getErrorStatusName, getAtomicCapabilityStatus, isUnresolvedWaitError, isDefinitivePostSubmissionError, type TransactionStatusName as StatusName } from "@/lib/transaction-lifecycle";

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
import { track } from "@vercel/analytics";
import type { Hex } from "viem";
import { handleExternalAnchorClick, openExternalUrl } from "@/lib/open-external";
import { base } from "viem/chains";
import { useAccount, useChainId, useWalletClient } from "wagmi";
import { useShowCallsStatus } from "wagmi/experimental";
import { waitForBaseReceipt } from "@/lib/base-rpc";
import {
  reconcileOwnerResources,
  type OwnerResourceInvalidationRequest,
} from "@/lib/owner-resource-invalidation";
import { Button } from "@/components/ui/button";
import { getTransactionFeedback } from "@/lib/transaction-feedback";
import { TransactionFeedbackCard, TransactionFeedbackIcon, type TransactionFeedbackPosition } from './transaction-feedback-card';
import { TransactionRecoveryOptions } from './transaction-recovery-options';
import {
  canDurablyPersistPendingEvmTransactions,
  PendingEvmStaleError,
  acknowledgePendingEvmRecord,
  createPendingEvmCallsDigest,
  createPendingEvmRecord,
  finalizePendingEvmRecord,
  getPendingEvmCompatibility,
  getPendingEvmAckUnlockAt,
  getPendingEvmPhase,
  getPendingEvmIntentDigest,
  getBrowserPendingEvmStorage,
  isDefinitivePendingEvmPreSubmissionError,
  isDefinitiveUnsupportedEvmBatchError,
  listPendingEvmRecords,
  readPendingEvmRecord,
  removePendingEvmRecord,
  replacePendingEvmProof,
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
import {
  extractTransactionHash,
  getHighestTransactionReceiptBlock,
  normalizeTransactionReceipt,
} from "@/lib/transaction-utils";
import { cn } from "@/lib/utils";

import type { TransactionReceiptLike } from '@/lib/transaction-utils';
export type { TransactionReceiptLike } from '@/lib/transaction-utils';



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
  | "reverted"
  | "unresolved";

function getTransactionPhase(status: LifecycleStatus): TransactionPhase {
  if (status.statusName === "idle") return "idle";
  if (status.statusName === "buildingTransaction") return "awaiting-wallet";
  if (status.statusName === "transactionPending") {
    return status.statusData.transactionHash || status.statusData.transactionId
      ? "submitted"
      : "awaiting-wallet";
  }
  if (status.statusName === "confirmedSyncing") return "confirmed-syncing";
  if (status.statusName === "success") return "succeeded";
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

type RawTransactionCall = {
  address?: `0x${string}`;
  data?: `0x${string}`;
  to?: `0x${string}`;
  value?: bigint;
};

type TransactionProps = {
  calls: RawTransactionCall[];
  effects: "none" | {
    domains: OwnerResourceInvalidationRequest["domains"];
    expected?: OwnerResourceInvalidationRequest["expected"];
  };
  onError?: (error: unknown) => void;
  onConfirmed?: (status: LifecycleStatus) => void | Promise<void>;
  onStatus?: (status: LifecycleStatus) => void;
  isSponsored?: boolean;
  capabilities?: Record<string, unknown>;
  intentKey?: string;
  resetAfter?: number;
  children: React.ReactNode;
};

type TransactionContextValue = {
  acknowledgeStale: () => void;
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
  suppressSuccess?: boolean;
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
  suppressSuccess?: boolean;
  successMessage?: string;
  children?: React.ReactNode;
  className?: string;
  duration?: number;
  position?: TransactionFeedbackPosition;
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
  "confirmedSyncing",
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
const TEXT_INVERSE = "text-primary-foreground";
const TEXT_PRIMARY = "text-[var(--ock-compat-primary)]";
const TEXT_ERROR = "text-[var(--ock-compat-error)]";
const TOAST_ACTION_LAYOUT =
  "min-h-11 rounded-lg px-2.5 text-xs font-semibold shadow-none";
const unsupportedSendCallsKeys = new Set<string>();
/**
 * Terminal success requires canonical onchain receipt evidence. A calls id is
 * durable recovery proof, but is not proof that the game mutation executed.
 */
export function getLifecycleTransactionProof(
  status: LifecycleStatus,
): TransactionProof | null {
  if (status.statusName !== "success") return null;

  const receipts = status.statusData.transactionReceipts.map(normalizeTransactionReceipt);
  const receipt = receipts[0];
  if (receipt) {
    const isBatch = Boolean(status.statusData.transactionId);
    return {
      ...receipt,
      atomic: status.statusData.atomic ?? !isBatch,
      ...(status.statusData.transactionId ? { callsId: status.statusData.transactionId } : {}),
      kind: isBatch ? "batch" : "direct",
      transactionReceipts: receipts,
    };
  }

  return null;
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







function waitBeforeUnresolvedRetry(attempt: number, signal?: AbortSignal) {
  const delayMs = Math.min(
    UNRESOLVED_RETRY_DELAY_MS * (2 ** attempt),
    UNRESOLVED_RETRY_MAX_DELAY_MS,
  );
  return waitForMonitorDelay(delayMs, signal);
}

function waitForLeaseRetry(retryAt: number | null, signal?: AbortSignal) {
  const delayMs = Math.max(250, (retryAt ?? Date.now() + 5_000) - Date.now() + 50);
  return waitForMonitorDelay(delayMs, signal);
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

type FeedbackInput = {
  errorMessage: string | null;
  isExecuting: boolean;
  status: LifecycleStatus;
  transactionHash?: Hex;
  transactionId: string | null;
};

function getToastLabelData(input: FeedbackInput) {
  const feedback = getTransactionFeedback({
    statusName: input.status.statusName,
    hasProof: Boolean(input.transactionHash || input.transactionId),
    errorMessage: input.errorMessage,
    syncDelayed: Boolean(input.status.statusData.error),
  });
  return {
    ...feedback,
    feedback,
    label: feedback?.title ?? "",
    labelClassName: feedback?.tone === "error" ? TEXT_ERROR : TEXT_DEFAULT,
  };
}

function getStatusLabelData(input: FeedbackInput) {
  const feedback = getToastLabelData(input);
  return {
    label: [feedback.label, feedback.description].filter(Boolean).join('. '),
    labelClassName: feedback.labelClassName,
  };
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
  effects,
  onError,
  onConfirmed,
  onStatus,
  isSponsored = false,
  capabilities,
  intentKey = "",
  resetAfter = 5000,
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
  const statusRef = useRef<LifecycleStatus>(IDLE_STATUS);
  const executingRef = useRef(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const resetDeadlineRef = useRef<number | null>(null);
  const resetRemainingRef = useRef<number | null>(null);
  const resetPauseCountRef = useRef(0);
  const dismissedFeedbackKeyRef = useRef<string | null>(null);
  const reopenedFeedbackKeysRef = useRef(new Set<string>());
  const transactionIdRef = useRef<string | null>(null);
  const transactionHashRef = useRef<Hex | undefined>(undefined);
  const confirmedFallbackRecordRef = useRef<PendingEvmRecord | null>(null);
  const confirmedSyncStatusRef = useRef<LifecycleStatus | null>(null);
  const lastTelemetryKeyRef = useRef<string | null>(null);
  const beforeSubmitRef = useRef<(() => void) | undefined>(undefined);
  const activePendingRecordRef = useRef<PendingEvmRecord | null>(null);
  const activeRecoverySignalRef = useRef<AbortSignal | null>(null);
  const registeredRecoveryIdentityRef = useRef<string | null>(null);
  const notifyStatusCallbacksRef = useRef(true);
  const blockerStaleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const capabilitiesRef = useRef(capabilities);
  const effectsRef = useRef(effects);
  const onConfirmedRef = useRef(onConfirmed);
  const onErrorRef = useRef(onError);
  const onStatusRef = useRef(onStatus);
  capabilitiesRef.current = capabilities;
  effectsRef.current = effects;
  onConfirmedRef.current = onConfirmed;
  onErrorRef.current = onError;
  onStatusRef.current = onStatus;
  const updateStatus = useCallback((nextStatus: LifecycleStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  /*
   * Most game callers build `calls={[...]}` inline. Panels that watch Base's
   * block number therefore receive a new array every block even when the
   * transaction is byte-for-byte identical. Depending on that array identity
   * re-registered the pending controller, whose cleanup aborts its active
   * receipt monitor. On two-second Base block renders this could livelock a
   * successful transaction in "in progress" forever.
   *
   * Keep the normalized call objects stable while their durable digest is
   * stable. A real calldata/target/value change still produces a new digest,
   * registration, and recovery compatibility check.
   */
  const nextNormalizedCalls = calls.map((call) => ({
    data: call.data,
    to: call.to ?? call.address,
    value: call.value ?? BigInt(0),
  }));
  const nextPendingCallsDigest = createPendingEvmCallsDigest(nextNormalizedCalls);
  const stableCallsRef = useRef<{
    digest: Hex;
    normalizedCalls: typeof nextNormalizedCalls;
  } | null>(null);
  if (stableCallsRef.current?.digest !== nextPendingCallsDigest) {
    stableCallsRef.current = {
      digest: nextPendingCallsDigest,
      normalizedCalls: nextNormalizedCalls,
    };
  }
  const activeCallsRef = useRef<{
    digest: Hex;
    normalizedCalls: typeof nextNormalizedCalls;
  } | null>(null);
  // A quote/deadline tick is intentionally allowed to prepare the *next*
  // submission. Once an operation starts, however, its exact calldata and
  // digest must remain the controller identity until the durable proof is
  // terminal. Otherwise the tick unregisters the active monitor and suppresses
  // its confirmation callback.
  const callsSnapshot = activeCallsRef.current ?? stableCallsRef.current;
  const normalizedCalls = callsSnapshot.normalizedCalls;
  const pendingCallsDigest = callsSnapshot.digest;
  const resolvedIntentKey = intentKey.trim() || `calls:${pendingCallsDigest}`;
  const currentConnectorId = connector?.id;
  const recoveryRegistryIdentity = useMemo(() => {
    const chainId = walletClient?.chain?.id ?? accountChainId;
    if (!walletClient?.account || chainId !== base.id) return null;
    return {
      accountAddress: walletClient.account.address,
      chainId,
    };
  }, [accountChainId, walletClient]);
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
  const walletRoutingLockMessage = !connectedAccountAddress
    ? "Connect a Base wallet"
    : accountChainId !== base.id || (walletClient?.chain?.id !== undefined && walletClient.chain.id !== base.id)
      ? "Switch wallet to Base"
      : !walletClient?.account
        ? "Wallet is not ready"
        : !walletClientMatchesAccount || isSmartWalletDetectionLoading
          ? "Checking wallet type…"
          : walletType === "UntypedValue"
            ? "Retry wallet check"
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
    resetDeadlineRef.current = null;
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

  const runResetTimer = useCallback((delayMs: number) => {
    if (!mountedRef.current) return;
    clearResetTimer();
    resetRemainingRef.current = delayMs;
    resetDeadlineRef.current = Date.now() + delayMs;
    resetTimeoutRef.current = setTimeout(() => {
      if (!mountedRef.current) return;
      resetDeadlineRef.current = null;
      resetRemainingRef.current = null;
      clearTransactionArtifacts();
      setIsToastVisible(false);
      updateStatus(IDLE_STATUS);
    }, delayMs);
  }, [clearResetTimer, clearTransactionArtifacts, updateStatus]);

  const scheduleReset = useCallback(() => {
    clearResetTimer();
    resetRemainingRef.current = null;
    if (!resetAfter || resetAfter <= 0) return;
    resetRemainingRef.current = resetAfter;
    if (resetPauseCountRef.current === 0) runResetTimer(resetAfter);
  }, [clearResetTimer, resetAfter, runResetTimer]);

  const pauseToastTimer = useCallback(() => {
    resetPauseCountRef.current += 1;
    if (resetTimeoutRef.current && resetDeadlineRef.current !== null) {
      resetRemainingRef.current = Math.max(0, resetDeadlineRef.current - Date.now());
      clearResetTimer();
    }
  }, [clearResetTimer]);

  const resumeToastTimer = useCallback(() => {
    resetPauseCountRef.current = Math.max(0, resetPauseCountRef.current - 1);
    if (!mountedRef.current) return;
    if (
      resetPauseCountRef.current === 0
      && resetRemainingRef.current !== null
      && resetTimeoutRef.current === null
    ) {
      runResetTimer(resetRemainingRef.current);
    }
  }, [runResetTimer]);

  useEffect(() => {
    let visibilityPaused = false;
    const handleVisibilityChange = () => {
      if (document.hidden && !visibilityPaused) {
        visibilityPaused = true;
        pauseToastTimer();
      } else if (!document.hidden && visibilityPaused) {
        visibilityPaused = false;
        resumeToastTimer();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    handleVisibilityChange();
    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      // The provider's mount cleanup clears its timer. Balance only our own
      // pause here so unmounting while hidden cannot schedule a fresh timer.
      if (visibilityPaused) {
        resetPauseCountRef.current = Math.max(0, resetPauseCountRef.current - 1);
      }
    };
  }, [pauseToastTimer, resumeToastTimer]);

  const emitStatus = useCallback(
    (nextStatus: LifecycleStatus) => {
      const activeRecord = activePendingRecordRef.current;
      let ownsTerminalCallback = true;
      if (TERMINAL_STATUSES.has(nextStatus.statusName)) {
        const removedOwnRecord = clearPersistedPendingRecord();
        ownsTerminalCallback = removedOwnRecord;
      }
      const isTerminal = TERMINAL_STATUSES.has(nextStatus.statusName);
      if (!mountedRef.current && !isTerminal) return false;
      if (mountedRef.current) {
        updateStatus(nextStatus);
        const feedbackAttempt = activeRecord?.attemptId
          ?? nextStatus.statusData.correlationId
          ?? nextStatus.statusData.transactionHash
          ?? nextStatus.statusData.transactionId
          ?? "current";
        const feedbackStatusKey = nextStatus.statusName === "confirmedSyncing"
          && Boolean(nextStatus.statusData.error)
          ? "confirmedSyncing:delayed"
          : nextStatus.statusName;
        const feedbackKey = `${feedbackAttempt}:${feedbackStatusKey}`;
        const shouldReopen = (
          nextStatus.statusName === "success"
          || nextStatus.statusName === "transactionStale"
          || (nextStatus.statusName === "confirmedSyncing" && Boolean(nextStatus.statusData.error))
          || (isTerminal && nextStatus.statusName !== "confirmedSyncing")
        );
        if (
          shouldReopen
          && dismissedFeedbackKeyRef.current !== null
          && dismissedFeedbackKeyRef.current !== feedbackKey
          && !reopenedFeedbackKeysRef.current.has(feedbackKey)
        ) {
          reopenedFeedbackKeysRef.current.add(feedbackKey);
          dismissedFeedbackKeyRef.current = null;
          setIsToastVisible(true);
        }
      }

      const phase = getTransactionPhase(nextStatus);
      const correlationId = nextStatus.statusData.correlationId ?? activeRecord?.attemptId;
      if (correlationId) {
        const telemetryKey = `${correlationId}:${phase}`;
        if (lastTelemetryKeyRef.current !== telemetryKey) {
          lastTelemetryKeyRef.current = telemetryKey;
          try {
            track("game_transaction_lifecycle", {
              correlationId,
              executionPath: activeRecord?.method ?? "unselected",
              phase,
              walletType,
            });
          } catch {
            // Observability must never affect transaction execution.
          }
        }
      }

      const shouldNotifyCallbacks = notifyStatusCallbacksRef.current && ownsTerminalCallback;
      if (shouldNotifyCallbacks) {
        try {
          void Promise.resolve(onStatusRef.current?.(nextStatus)).catch((error) => {
            console.warn("Transaction status callback failed", error);
          });
        } catch (error) {
          console.warn("Transaction status callback failed", error);
        }
      }

      // Failures stay actionable until dismissed or a new attempt starts.
      // Success may still reset after the caller's configured display window.
      if (mountedRef.current && nextStatus.statusName === "success") {
        scheduleReset();
      }
      return shouldNotifyCallbacks;
    },
    [clearPersistedPendingRecord, scheduleReset, updateStatus, walletType],
  );

  const runConfirmedReconciliation = useCallback(async (
    status: LifecycleStatus,
    fallbackRecord?: PendingEvmRecord,
  ) => {
    if (!fallbackRecord) {
      await onConfirmedRef.current?.(status);
      return;
    }

    const fallbackEffects = fallbackRecord.effects ?? {
      domains: [
        "allowances",
        "arcade",
        "balances",
        "buildings",
        "lands",
        "plants",
        "rewards",
      ] as const,
    };
    if (fallbackEffects === "none") return;
    const reconciled = await reconcileOwnerResources({
      address: fallbackRecord.accountAddress,
      domains: fallbackEffects.domains,
      expected: fallbackEffects.expected,
      receiptBlock: getHighestTransactionReceiptBlock(status.statusData.transactionReceipts),
      source: "pending-transaction-recovery",
      transactionHash: status.statusData.transactionHash,
      transactionId: status.statusData.transactionId,
    });
    if (!reconciled) {
      throw new Error("Transaction confirmed; state refresh delayed.");
    }
  }, []);

  const completeConfirmedTransaction = useCallback(async (
    statusData: LifecycleStatus["statusData"],
    fallbackRecord?: PendingEvmRecord,
  ): Promise<boolean> => {
    const syncingStatus: LifecycleStatus = {
      statusData,
      statusName: "confirmedSyncing",
    };
    confirmedSyncStatusRef.current = syncingStatus;
    confirmedFallbackRecordRef.current = fallbackRecord ?? null;
    emitStatus(syncingStatus);

    try {
      await runConfirmedReconciliation(syncingStatus, fallbackRecord);
    } catch (error) {
      const delayedStatus: LifecycleStatus = {
        statusData: { ...statusData, error },
        statusName: "confirmedSyncing",
      };
      confirmedSyncStatusRef.current = delayedStatus;
      emitStatus(delayedStatus);
      return false;
    }

    confirmedSyncStatusRef.current = null;
    confirmedFallbackRecordRef.current = null;
    emitStatus({ statusData, statusName: "success" });
    return true;
  }, [emitStatus, runConfirmedReconciliation]);

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
    setIsRecoveryChecking(false);

    const phase = getPendingEvmPhase(record);
    const statusName = phase === "stale"
      ? "transactionStale"
      : record.proof.kind === "reservation"
        ? "submissionAmbiguous"
        : "transactionUnresolved";
    const feedbackKey = `${record.attemptId}:${statusName}`;
    if (dismissedFeedbackKeyRef.current !== feedbackKey) {
      setIsToastVisible(true);
    }
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
      statusName,
    });

    if (phase === "hard") {
      // A proofless reservation unlocks on the short ambiguous window; a record
      // that carries a hash or calls id keeps the full lock.
      const staleInMs = Math.max(0, getPendingEvmAckUnlockAt(record) - Date.now());
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
    fallbackRecovery = false,
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
    let recoveryCallsMatch = true;

    clearResetTimer();
    resetRemainingRef.current = null;
    if (!recoveryRecord) {
      clearTransactionArtifacts();
    }
    notifyStatusCallbacksRef.current = notifyCallbacks;
    if (!recoveryRecord) {
      dismissedFeedbackKeyRef.current = null;
      reopenedFeedbackKeysRef.current.clear();
      setIsToastVisible(true);
    }

    if (!walletClient?.account) {
      const error = new Error("Wallet client unavailable.");
      emitStatus({
        statusData: { error, transactionReceipts: [] },
        statusName: "buildError",
      });
      onErrorRef.current?.(error);
      return;
    }

    if (!recoveryRecord && normalizedCalls.length === 0) {
      const error = new Error("No transaction calls provided.");
      emitStatus({
        statusData: { error, transactionReceipts: [] },
        statusName: "buildError",
      });
      onErrorRef.current?.(error);
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
      onErrorRef.current?.(error);
      return;
    }

    const chain = walletClient.chain ?? base;
    const transactionRegistry = {
      accountAddress: walletClient.account.address,
      chainId: chain.id,
    };
    let coordinatedPendingRecord: PendingEvmRecord | null = recoveryRecord ?? null;
    if (recoveryRecord) {
      const requestedRecoveryRecord = recoveryRecord;
      const recoveryIdentity: PendingEvmIntentIdentity = {
        accountAddress: walletClient.account.address.toLowerCase(),
        chainId: chain.id,
        intentKey: resolvedIntentKey,
      };
      const pendingStorage = getBrowserPendingEvmStorage();
      const storedRecord = fallbackRecovery
        ? listPendingEvmRecords(pendingStorage, transactionRegistry).find((candidate) => (
            candidate.attemptId === requestedRecoveryRecord.attemptId
            && candidate.intentDigest === requestedRecoveryRecord.intentDigest
          )) ?? null
        : readPendingEvmRecord(pendingStorage, recoveryIdentity);
      const compatibility = getPendingEvmCompatibility(requestedRecoveryRecord, {
        callsDigest: pendingCallsDigest,
        connectorId: currentConnectorId,
      });
      recoveryCallsMatch = compatibility.callsMatch;
      if (
        !storedRecord
        || storedRecord.attemptId !== requestedRecoveryRecord.attemptId
        || storedRecord.intentDigest !== requestedRecoveryRecord.intentDigest
        || storedRecord.callsDigest !== requestedRecoveryRecord.callsDigest
        || storedRecord.method !== requestedRecoveryRecord.method
        || storedRecord.connectorId !== requestedRecoveryRecord.connectorId
        || storedRecord.submittedAt !== requestedRecoveryRecord.submittedAt
        || JSON.stringify(storedRecord.proof) !== JSON.stringify(requestedRecoveryRecord.proof)
        || getPendingEvmPhase(storedRecord) !== "hard"
        || !compatibility.canResume
      ) {
        requestPendingEvmCoordinatorReconcile(transactionRegistry);
        return;
      }

      // Fallback recovery is status-only and may be hosted by an unrelated
      // mounted intent. Continue with the validated immutable stored record,
      // never the caller's current transaction payload.
      recoveryRecord = storedRecord;

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
    // Capture this before the first await. Swap builders refresh their deadline
    // on a timer; subsequent renders must keep observing this submission rather
    // than re-keying the monitor to fresh, never-submitted calldata. Keep this
    // after every synchronous build-error return so a rejected preflight cannot
    // leave stale calls frozen for the next submission.
    if (!activeCallsRef.current) {
      activeCallsRef.current = {
        digest: pendingCallsDigest,
        normalizedCalls,
      };
    }
    const ownedRecoverySignal = recoverySignal ?? null;
    if (ownedRecoverySignal) {
      activeRecoverySignalRef.current = ownedRecoverySignal;
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
      typeof walletClient.sendCalls === "function"
      && typeof walletClient.waitForCallsStatus === "function";
    const requiresAtomicBundle = normalizedCalls.length > 1;
    if (!recoveryRecord && requiresAtomicBundle && canBatch) {
      // Capability discovery is optional in EIP-5792. An unsupported response
      // is useful preflight evidence; an absent method, missing field, or a
      // discovery transport failure must not prevent forceAtomic from asking the
      // wallet to enforce the requirement at submission time.
      try {
        const reportedCapabilities = await walletClient.getCapabilities?.({
          account: walletClient.account,
          chainId: chain.id,
        });
        if (getAtomicCapabilityStatus(reportedCapabilities, chain.id) === "unsupported") {
          throw createAtomicBundleUnsupportedError();
        }
      } catch (error) {
        if (getErrorMessage(error).includes("atomic bundled transactions")) throw error;
      }
    }
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
      ...(capabilitiesRef.current || {}),
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
        effects: effectsRef.current,
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
        updateStatus(IDLE_STATUS);
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

    const emitUnresolvedStatus = (error: unknown) => {
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
      let currentHash = hash;
      let currentPendingRecord = pendingRecord;
      let replacementCancelled = false;
      const requestCanonicalReceipt = () => waitForBaseReceipt(currentHash, {
        onReplaced: ({ reason, transaction }) => {
          const replacementHash = transaction.hash;
          currentHash = replacementHash;
          replacementCancelled = replacementCancelled || reason === "cancelled";
          transactionHashRef.current = replacementHash;
          if (mountedRef.current) setTransactionHash(replacementHash);

          const replacementRecord = replacePendingEvmProof(
            getBrowserPendingEvmStorage(),
            currentPendingRecord,
            currentPendingRecord.proof.kind === "calls"
              ? {
                hash: replacementHash,
                id: currentPendingRecord.proof.id,
                kind: "calls",
              }
              : { hash: replacementHash, kind: "hash" },
          );
          if (replacementRecord) {
            currentPendingRecord = replacementRecord;
            activePendingRecordRef.current = replacementRecord;
            coordinatedPendingRecord = replacementRecord;
          }
        },
      });
      let pendingReceipt = requestCanonicalReceipt();
      let initialReceiptRejected = false;
      void pendingReceipt.catch(() => {
        initialReceiptRejected = true;
      });
      try {
        const confirmed = await withMonitoringAbort(withPendingEvmHardDeadline(
          withTimeout(
            pendingReceipt,
            DIRECT_RECEIPT_TIMEOUT_MS,
            RECEIPT_TIMEOUT_MESSAGE,
          ),
          currentPendingRecord,
        ), monitoringSignal);
        if (replacementCancelled) throw new Error("Transaction cancelled by wallet replacement.");
        return confirmed;
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
          const confirmed = await withMonitoringAbort(
            withPendingEvmHardDeadline(pendingReceipt, currentPendingRecord),
            monitoringSignal,
          );
          if (replacementCancelled) throw new Error("Transaction cancelled by wallet replacement.");
          return confirmed;
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
              statusName: getErrorStatusName(error),
            });
            if (shouldNotifyError) onErrorRef.current?.(error);
            return;
          }
          throwIfMonitoringAborted(monitoringSignal);
          if (!isLeaseCurrent()) {
            throw new Error("Transaction confirmation ownership changed.");
          }
          await completeConfirmedTransaction({
            callsMatch: recoveryRecord ? recoveryCallsMatch : true,
            correlationId: submitted.pendingRecord.attemptId,
            recovered: Boolean(recoveryRecord),
            ...(transactionHashRef.current
              ? { transactionHash: transactionHashRef.current }
              : {}),
            transactionReceipts: completedReceipts,
          }, fallbackRecovery ? recoveryRecord : undefined);
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
          if (recoveryRecord?.method === "batch" && recoveryRecord.proof.kind === "calls") {
            nextTransactionId = recoveryRecord.proof.id;
            pendingRecord = recoveryRecord;
          } else {
            const submitted = await submitWithRegistryGuard("batch", async (reservation) => {
              const batch: unknown = await withPendingEvmHardDeadline(
                walletClient.sendCalls({
                  account: walletClient.account,
                  ...(Object.keys(mergedCapabilities).length > 0 ? { capabilities: mergedCapabilities } : {}),
                  chain,
                  calls: normalizedCalls.map(call => {
                    if (!call.to) throw new Error("Transaction call is missing a destination address.");
                    return { ...call, to: call.to };
                  }),
                  ...(normalizedCalls.length > 1 ? { forceAtomic: true } : {}),
                }),
                reservation,
              );
              const batchId = parseWalletCallsId(batch);
              if (!batchId) {
                throw new Error("Wallet returned no transaction id.");
              }
              transactionIdRef.current = batchId;
              const pendingRecord = finalizeSubmittedProof(reservation, {
                method: "batch",
                transactionId: batchId,
              });
              return { pendingRecord, transactionId: batchId };
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
                walletClient.waitForCallsStatus({
                  id,
                  throwOnFailure: false,
                  timeout: CALLS_STATUS_TIMEOUT_MS,
                })
              ),
              waitForReceipt: async () => {
                throw new Error("Batch transaction cannot be monitored by direct receipt.");
              },
            }).then(result => parseWalletBatchStatus(result, chain.id))
          );
          const hasCanonicalReceiptTarget = (result: WalletBatchStatus) => {
            if (hasWalletBatchResolution(result)) return true;
            emitUnresolvedStatus(
              new Error(
                result.status === 'pending'
                  ? 'Wallet is still confirming the submitted transaction.'
                  : "Wallet reported success without a transaction hash; waiting for canonical Base receipt evidence.",
              ),
            );
            return false;
          };
          const waitForBatchResolution = () => monitorSubmittedBatch({
            request: requestCallsStatus,
            initialWait: (pending) => withMonitoringAbort(withPendingEvmHardDeadline(
              withTimeout(pending, CALLS_STATUS_TIMEOUT_MS + 5_000, CALLS_STATUS_TIMEOUT_MESSAGE), pendingRecord,
            ), monitoringSignal),
            wait: (pending) => withMonitoringAbort(withPendingEvmHardDeadline(pending, pendingRecord), monitoringSignal),
            resolved: hasCanonicalReceiptTarget,
            retryable: isUnresolvedWaitError,
            onUnresolved: emitUnresolvedStatus,
            delay: (attempt) => waitBeforeUnresolvedRetry(attempt, monitoringSignal),
            signal: monitoringSignal,
          });
          const monitorLease = await withPendingEvmMonitorLease(
            getBrowserPendingEvmStorage(),
            pendingRecord,
            async (isLeaseCurrent) => {
          const result = await waitForBatchResolution();
          let receipts = result.receipts;
          const reportedHashes = getBatchTransactionHashes(result);
          let nextTransactionHash: Hex | undefined = reportedHashes[0];
          if (nextTransactionHash) {
            transactionHashRef.current = nextTransactionHash;
            if (mountedRef.current) setTransactionHash(nextTransactionHash);
          }

          const statusCode = typeof result?.statusCode === "number"
            ? result.statusCode
            : undefined;
          const reportedSuccess = result?.status === "success"
            && (statusCode === undefined || (statusCode >= 200 && statusCode < 300));

          if (reportedSuccess && reportedHashes.length === 0) {
            throw new Error(
              "Wallet reported success without a transaction hash; canonical Base receipt is not confirmed.",
            );
          }
          // `atomic` metadata is optional in real wallet status payloads. The
          // canonical Base receipts below are authoritative evidence that the
          // submitted calls executed; missing metadata must not turn that proof
          // into a false failure. `forceAtomic` still requests atomic execution
          // from wallets that implement the EIP-5792 capability.

          // A calls status can contain multiple ordered receipts. Canonicalize
          // every hash (including partial/reverted results), rather than letting
          // the first receipt stand in for the entire bundle.
          if (reportedHashes.length > 0) {
            const canonicalReceipts = await Promise.all(
              reportedHashes.map(async (hash) => normalizeTransactionReceipt(
                await waitForCanonicalReceipt(hash, pendingRecord),
              )),
            );
            const canonicalHashes = new Set(
              canonicalReceipts
                .map((receipt) => extractTransactionHash(receipt))
                .filter((hash): hash is Hex => Boolean(hash)),
            );
            receipts = [
              ...canonicalReceipts,
              ...receipts.filter((receipt) => {
                const hash = extractTransactionHash(receipt);
                return !hash || !canonicalHashes.has(hash as Hex);
              }),
            ];
            nextTransactionHash = extractTransactionHash(canonicalReceipts[0]) as Hex | undefined;
          } else if (reportedSuccess) {
            if (!nextTransactionHash) {
              throw new Error(
                "Wallet reported success without a transaction hash; canonical Base receipt is not confirmed.",
              );
            }
          }

          completedReceipts = receipts;

          transactionHashRef.current = nextTransactionHash;
          if (mountedRef.current) {
            setTransactionHash(nextTransactionHash);
          }

          if (!reportedSuccess || receipts.length === 0 || receipts.some(isFailedReceipt)) {
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
            if (shouldNotifyError) onErrorRef.current?.(error);
            return;
          }

          const successStatusData: LifecycleStatus["statusData"] = {
            atomic: result?.atomic === true,
            callsMatch: recoveryRecord ? recoveryCallsMatch : true,
            correlationId: pendingRecord.attemptId,
            recovered: Boolean(recoveryRecord),
            ...(nextTransactionHash ? { transactionHash: nextTransactionHash } : {}),
            ...(nextTransactionId ? { transactionId: nextTransactionId } : {}),
            transactionReceipts: receipts,
          };
          if (!getLifecycleTransactionProof({ statusData: successStatusData, statusName: "success" })) {
            throw new Error("Wallet reported success without transaction proof.");
          }
          throwIfMonitoringAborted(monitoringSignal);
          if (!isLeaseCurrent()) {
            throw new Error("Transaction confirmation ownership changed.");
          }
          await completeConfirmedTransaction(
            successStatusData,
            fallbackRecovery ? recoveryRecord : undefined,
          );
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
      if (shouldNotifyError) onErrorRef.current?.(error);
    } finally {
      executingRef.current = false;
      if (activeRecoverySignalRef.current === ownedRecoverySignal) {
        activeRecoverySignalRef.current = null;
      }
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
      // Keep a submitted proof's payload frozen while it remains unresolved so
      // a deadline tick cannot replace the recovery controller mid-monitor.
      // Terminal/pre-submission outcomes have no durable record to protect.
      if (!activePendingRecordRef.current) {
        activeCallsRef.current = null;
      }
    }
  }, [
    clearPersistedPendingRecord,
    clearResetTimer,
    clearTransactionArtifacts,
    completeConfirmedTransaction,
    emitStatus,
    updateStatus,
    connector?.id,
    currentConnectorId,
    isSmartWallet,
    isSponsored,
    normalizedCalls,
    pendingCallsDigest,
    presentPendingBlocker,
    resolvedIntentKey,
    transactionControllerId,
    walletClient,
    walletRoutingIdentity,
  ]);

  const clearDisplayedPendingBlocker = useCallback((force = false) => {
    if (executingRef.current && !force) return;
    if (!force && TERMINAL_STATUSES.has(statusRef.current.statusName)) {
      return;
    }
    if (blockerStaleTimerRef.current) {
      clearTimeout(blockerStaleTimerRef.current);
      blockerStaleTimerRef.current = null;
    }
    activePendingRecordRef.current = null;
    activeCallsRef.current = null;
    clearResetTimer();
    resetRemainingRef.current = null;
    dismissedFeedbackKeyRef.current = null;
    reopenedFeedbackKeysRef.current.clear();
    setIsPeerBlocked(false);
    notifyStatusCallbacksRef.current = true;
    clearTransactionArtifacts();
    setIsToastVisible(false);
    setIsRecoveryChecking(false);
    updateStatus(IDLE_STATUS);
  }, [clearResetTimer, clearTransactionArtifacts, updateStatus]);

  useEffect(() => {
    const nextRecoveryIdentity = recoveryRegistryIdentity
      ? `${recoveryRegistryIdentity.chainId}:${recoveryRegistryIdentity.accountAddress.toLowerCase()}`
      : null;
    const recoveryIdentityChanged = registeredRecoveryIdentityRef.current !== nextRecoveryIdentity;
    registeredRecoveryIdentityRef.current = nextRecoveryIdentity;
    if (!recoveryRegistryIdentity) {
      setIsRecoveryChecking(false);
      clearDisplayedPendingBlocker(true);
      return;
    }
    if (recoveryIdentityChanged) {
      clearDisplayedPendingBlocker(true);
    }
    setIsRecoveryChecking(true);
    const unregister = registerPendingEvmController(recoveryRegistryIdentity, {
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
      recover: (record, signal) => execute(
        record,
        getPendingEvmCompatibility(record, {
          callsDigest: pendingCallsDigest,
          connectorId: currentConnectorId,
        }).callsMatch,
        signal,
      ),
      recoverFallback: (record, signal) => execute(record, false, signal, true),
    });
    return () => {
      const activeRecoverySignal = activeRecoverySignalRef.current;
      const wasAlreadyAborted = activeRecoverySignal?.aborted ?? false;
      unregister();
      if (
        mountedRef.current
        && activeRecoverySignal
        && !wasAlreadyAborted
        && activeRecoverySignal.aborted
        && !TERMINAL_STATUSES.has(statusRef.current.statusName)
      ) {
        // This registration will receive no later coordinator snapshot. Retire
        // only its local progress notice; the immutable proof, status, and
        // wallet-wide lock remain owned by the coordinator and recovery task.
        setIsToastVisible(false);
      }
    };
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
    if (executingRef.current) return;
    if (recoveryGateActive) {
      const error = new Error(
        walletRoutingLockMessage
        ?? (isRecoveryChecking
          ? "Checking pending transaction state. Please wait."
          : isPeerBlocked
            ? "Another transaction from this wallet is being checked."
            : "Transaction submission is temporarily unavailable."),
      );
      setIsToastVisible(true);
      const shouldNotifyError = emitStatus({
        statusData: { error, transactionReceipts: [] },
        statusName: "buildError",
      });
      if (shouldNotifyError) onErrorRef.current?.(error);
      return;
    }

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
  }, [emitStatus, execute, isPeerBlocked, isRecoveryChecking, recoveryGateActive, walletRoutingLockMessage]);

  const retrySync = useCallback(() => {
    const syncingStatus = confirmedSyncStatusRef.current;
    if (!syncingStatus || executingRef.current) return;

    const cleanStatus: LifecycleStatus = {
      statusData: { ...syncingStatus.statusData, error: undefined },
      statusName: "confirmedSyncing",
    };
    executingRef.current = true;
    setIsExecuting(true);
    emitStatus(cleanStatus);
    void Promise.resolve(runConfirmedReconciliation(
      cleanStatus,
      confirmedFallbackRecordRef.current ?? undefined,
    )).then(() => {
      confirmedSyncStatusRef.current = null;
      confirmedFallbackRecordRef.current = null;
      emitStatus({ statusData: cleanStatus.statusData, statusName: "success" });
    }).catch((error) => {
      const delayedStatus: LifecycleStatus = {
        statusData: { ...cleanStatus.statusData, error },
        statusName: "confirmedSyncing",
      };
      confirmedSyncStatusRef.current = delayedStatus;
      emitStatus(delayedStatus);
    }).finally(() => {
      executingRef.current = false;
      if (mountedRef.current) setIsExecuting(false);
    });
  }, [emitStatus, runConfirmedReconciliation]);

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
    activeCallsRef.current = null;
    executingRef.current = false;
    clearTransactionArtifacts();
    setIsExecuting(false);
    setIsToastVisible(false);
    updateStatus(IDLE_STATUS);
  }, [
    clearTransactionArtifacts,
    recoveryRegistryIdentity,
    status.statusName,
    transactionControllerId,
    updateStatus,
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
      || status.statusName === "confirmedSyncing"
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
      dismissToast: () => {
        const feedbackAttempt = activePendingRecordRef.current?.attemptId
          ?? status.statusData.correlationId
          ?? status.statusData.transactionHash
          ?? status.statusData.transactionId
          ?? "current";
        const feedbackStatusKey = status.statusName === "confirmedSyncing"
          && Boolean(status.statusData.error)
          ? "confirmedSyncing:delayed"
          : status.statusName;
        dismissedFeedbackKeyRef.current = `${feedbackAttempt}:${feedbackStatusKey}`;
        setIsToastVisible(false);
      },
      errorMessage,
      explorerHref,
      isExecuting: effectiveIsExecuting,
      isSubmissionLocked: recoveryGateActive || status.statusName === "submissionAmbiguous",
      submissionLockMessage: walletRoutingLockMessage,
      isToastVisible,
      pauseToastTimer,
      receipt,
      retrySync,
      retryWalletRouting,
      resumeToastTimer,
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
      pauseToastTimer,
      receipt,
      retrySync,
      retryWalletRouting,
      resumeToastTimer,
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
    retrySync,
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
  const isConfirmedSyncing = lifecycleStatus.statusName === "confirmedSyncing";
  const isCheckOnly = isUnresolved || isStale;
  const isWalletRoutingRetry = submissionLockMessage === "Retry wallet check";
  const isDisabled = isConfirmedSyncing
    ? isExecuting
    : !isSuccessful
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
    if (isConfirmedSyncing) {
      return "Refresh game";
    }
    if (isCheckOnly) {
      return "View transaction";
    }
    if (isSubmissionAmbiguous) {
      return "Confirmation delayed";
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
    isConfirmedSyncing,
    isExecuting,
    isSubmissionAmbiguous,
    isSuccessful,
    submissionLockMessage,
  ]);

  const handleSubmit = useCallback(() => {
    if (isConfirmedSyncing) {
      retrySync();
      return;
    }
    if (isSuccessful || isCheckOnly) {
      handleSuccess();
      return;
    }
    if (isWalletRoutingRetry) {
      retryWalletRouting();
      return;
    }

    submit(onClick ?? null);
  }, [handleSuccess, isCheckOnly, isConfirmedSyncing, isSuccessful, isWalletRoutingRetry, onClick, retrySync, retryWalletRouting, submit]);

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
    if (isExecuting || isCheckOnly || isConfirmedSyncing || submissionLockMessage !== null) {
      return "pending";
    }
    return "default";
  }, [errorMessage, isCheckOnly, isConfirmedSyncing, isExecuting, isSuccessful, isWalletRoutingRetry, submissionLockMessage]);

  const resolvedAriaLabel = ariaLabel
    ?? (isSuccessful
      ? "View transaction"
      : isConfirmedSyncing
        ? "Refresh game"
      : isCheckOnly
        ? "View transaction"
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
  suppressSuccess = false,
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

  if (!label || (suppressSuccess && status.statusName === 'success')) {
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
      {isStale && <TransactionRecoveryOptions onContinue={acknowledgeStale} />}
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
  suppressSuccess = false,
  successMessage,
  children,
  className,
  position = "auto",
}: TransactionToastProps) {
  const context = useTransactionContext();
  const { dismissToast, isToastVisible, pauseToastTimer, resumeToastTimer } = context;
  const { feedback } = getToastLabelData(context);
  const shouldShow = Boolean(isToastVisible && feedback && !(suppressSuccess && feedback.tone === 'success'));
  const lastVisibleContext = useRef(context);
  if (shouldShow) lastVisibleContext.current = context;
  const [renderState, setRenderState] = useState<"hidden" | "visible" | "exiting">(
    shouldShow ? "visible" : "hidden",
  );
  const paused = useRef({ pointer: false, focus: false });
  const setPaused = (source: 'pointer' | 'focus', value: boolean) => {
    if (paused.current[source] === value) return;
    paused.current[source] = value;
    if (value) pauseToastTimer();
    else resumeToastTimer();
  };
  useEffect(() => () => {
    if (paused.current.pointer) resumeToastTimer();
    if (paused.current.focus) resumeToastTimer();
    paused.current = { pointer: false, focus: false };
  }, [resumeToastTimer]);
  useEffect(() => {
    if (shouldShow) {
      setRenderState("visible");
      return;
    }
    if (paused.current.pointer) resumeToastTimer();
    if (paused.current.focus) resumeToastTimer();
    paused.current = { pointer: false, focus: false };
    setRenderState((previous) => previous === "visible" ? "exiting" : previous);
    const timer = window.setTimeout(() => setRenderState("hidden"), 180);
    return () => window.clearTimeout(timer);
  }, [shouldShow, resumeToastTimer]);

  const displayContext = shouldShow ? context : lastVisibleContext.current;
  const displayed = getToastLabelData(displayContext).feedback;
  if (renderState === "hidden" || !displayed || (suppressSuccess && displayed.tone === 'success')) return null;

  return (
    <TransactionContext.Provider value={displayContext}>
      <TransactionFeedbackCard
        feedback={displayed.tone === "success" && successMessage ? { ...displayed, description: successMessage } : displayed}
        actions={<TransactionToastAction />}
        className={className}
        position={position}
        exiting={!shouldShow || renderState === "exiting"}
        onDismiss={dismissToast}
        onPointerEnter={(event) => { if (event.pointerType === 'mouse') setPaused('pointer', true); }}
        onPointerLeave={() => setPaused('pointer', false)}
        onFocusCapture={() => setPaused('focus', true)}
        onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setPaused('focus', false);
        }}
      >
        {children}
      </TransactionFeedbackCard>
    </TransactionContext.Provider>
  );
}

export function TransactionToastIcon({ className }: TransactionToastIconProps) {
  const context = useTransactionContext();
  const { feedback } = getToastLabelData(context);
  return feedback ? <TransactionFeedbackIcon feedback={feedback} className={className} /> : null;
}

export function TransactionToastLabel({ className }: TransactionToastLabelProps) {
  const context = useTransactionContext();
  const { feedback } = getToastLabelData(context);
  if (!feedback) return null;
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-sm font-semibold leading-5 text-foreground">{feedback.title}</p>
      {feedback.description && <p className="mt-1 text-[13px] leading-[1.45] text-muted-foreground">{feedback.description}</p>}
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
    retrySync,
    isExecuting,
  } =
    useTransactionContext();
  const { showCallsStatus } = useShowCallsStatus();
  const isStale = status.statusName === "transactionStale";
  const isSyncDelayed = status.statusName === "confirmedSyncing" && Boolean(status.statusData.error);

  const actionElement = useMemo(() => {
    if (isSyncDelayed) {
      return (
        <Button size="touchCompact" variant="ghost" className={TOAST_ACTION_LAYOUT} onClick={retrySync} disabled={isExecuting}>
          Refresh game
        </Button>
      );
    }
    if (transactionHash) {
      const viewHref =
        explorerHref || getExplorerHref(transactionHash, base.blockExplorers?.default.url) || undefined;
      return (
        <Button
          asChild
          size="compact"
          variant="ghost"
          className={cn(TEXT_LABEL1, TEXT_PRIMARY, TOAST_ACTION_LAYOUT)}
        >
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
          size="compact"
          type="button"
          variant="ghost"
          className={cn(TEXT_LABEL1, TEXT_PRIMARY, TOAST_ACTION_LAYOUT)}
        >
          View transaction
        </Button>
      );
    }

    if (errorMessage) {
      return (
        <Button
          className={cn(TEXT_LABEL1, TEXT_PRIMARY, TOAST_ACTION_LAYOUT)}
          size="compact"
          type="button"
          variant="ghost"
          onClick={() => submit()}
        >
          Try again
        </Button>
      );
    }

    return null;
  }, [errorMessage, explorerHref, isExecuting, isSyncDelayed, retrySync, showCallsStatus, submit, transactionHash, transactionId]);

  if (!actionElement && !isStale) {
    return null;
  }

  return (
    <div className={cn("-ml-2.5 mt-2 flex min-w-0 flex-wrap items-center justify-start gap-x-1 gap-y-0.5", className)}>
      {actionElement}
      {isStale && <TransactionRecoveryOptions onContinue={acknowledgeStale} />}
    </div>
  );
}
