"use client";

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { Hex } from "viem";
import { base } from "viem/chains";
import { useAccount, useChainId, useWalletClient } from "wagmi";
import { useShowCallsStatus } from "wagmi/experimental";
import { waitForBaseReceipt } from "@/lib/base-rpc";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { extractTransactionHash, normalizeTransactionReceipt } from "@/lib/transaction-utils";
import { cn } from "@/lib/utils";

type TransactionReceiptLike = UntypedValue;

type StatusName =
  | "idle"
  | "buildingTransaction"
  | "transactionPending"
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
  resetAfter?: number;
  children: React.ReactNode;
};

type TransactionContextValue = {
  chainId: number | null;
  dismissToast: () => void;
  errorMessage: string | null;
  execute: () => Promise<void>;
  explorerHref: string | null;
  isExecuting: boolean;
  isToastVisible: boolean;
  receipt: TransactionReceiptLike | null;
  setIsToastVisible: (value: boolean) => void;
  status: LifecycleStatus;
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
const BG_SURFACE = "chat-white-surface bg-card/95 bg-[image:var(--gradient-surface)] backdrop-blur-[var(--blur-surface)]";
const TOAST_SHADOW = "shadow-[var(--shadow-hairline)]";
const unsupportedSendCallsKeys = new Set<string>();

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

function isUnsupportedSendCallsError(error: UntypedValue) {
  const code =
    typeof (error as { code?: UntypedValue })?.code === "number"
      ? Number((error as { code?: number }).code)
      : null;
  const message = getErrorMessage(error).toLowerCase();

  return (
    code === -32601
    || message.includes("wallet_sendcalls")
    || message.includes("method not found")
    || message.includes("does not exist")
    || message.includes("not available")
    || message.includes("corresponding handler")
    || message.includes("unsupported method")
  );
}

function createAtomicBundleUnsupportedError() {
  return new Error(
    "Your wallet does not support atomic bundled transactions. Please use a smart wallet or a wallet that supports wallet_sendCalls for this multi-step action.",
  );
}

function isReceiptTimeoutError(error: UntypedValue) {
  return getErrorMessage(error) === RECEIPT_TIMEOUT_MESSAGE;
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
  receipt,
  status,
  transactionHash,
  transactionId,
}: {
  errorMessage: string | null;
  isExecuting: boolean;
  receipt: TransactionReceiptLike | null;
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

  if (receipt) {
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
  receipt,
  status,
  transactionHash,
  transactionId,
}: {
  errorMessage: string | null;
  isExecuting: boolean;
  receipt: TransactionReceiptLike | null;
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

  if (receipt) {
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
  resetAfter = 2000,
  children,
}: TransactionProps) {
  const { connector } = useAccount();
  const { data: walletClient } = useWalletClient();
  const accountChainId = useChainId();
  const { isSmartWallet } = useSmartWallet();

  const [status, setStatus] = useState<LifecycleStatus>(IDLE_STATUS);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isToastVisible, setIsToastVisible] = useState(false);
  const [transactionId, setTransactionId] = useState<string | null>(null);
  const [transactionHash, setTransactionHash] = useState<Hex | undefined>(undefined);

  const mountedRef = useRef(true);
  const executingRef = useRef(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const transactionIdRef = useRef<string | null>(null);
  const transactionHashRef = useRef<Hex | undefined>(undefined);

  const normalizedCalls = useMemo(
    () =>
      calls.map((call) => ({
        data: call.data,
        to: call.to ?? call.address,
        value: call.value ?? BigInt(0),
      })),
    [calls],
  );

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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      clearResetTimer();
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
      if (!mountedRef.current) return;

      setStatus(nextStatus);

      try {
        onStatus?.(nextStatus);
      } catch (error) {
        console.warn("Transaction status callback failed", error);
      }

      if (TERMINAL_STATUSES.has(nextStatus.statusName)) {
        scheduleReset();
      }
    },
    [onStatus, scheduleReset],
  );

  const execute = useCallback(async () => {
    if (executingRef.current) {
      return;
    }

    clearResetTimer();
    clearTransactionArtifacts();
    setIsToastVisible(true);

    if (!walletClient?.account) {
      const error = new Error("Wallet client unavailable.");
      emitStatus({
        statusData: { error, transactionReceipts: [] },
        statusName: "buildError",
      });
      onError?.(error);
      return;
    }

    if (normalizedCalls.length === 0) {
      const error = new Error("No transaction calls provided.");
      emitStatus({
        statusData: { error, transactionReceipts: [] },
        statusName: "buildError",
      });
      onError?.(error);
      return;
    }

    const invalidCall = normalizedCalls.find((call) => !call.to);
    if (invalidCall) {
      const error = new Error("Transaction call is missing a destination address.");
      emitStatus({
        statusData: { error, transactionReceipts: [] },
        statusName: "buildError",
      });
      onError?.(error);
      return;
    }

    executingRef.current = true;
    if (mountedRef.current) {
      setIsExecuting(true);
    }

    emitStatus({
      statusData: { transactionReceipts: [] },
      statusName: "transactionPending",
    });

    const chain = walletClient.chain ?? base;
    const sendCallsSupportKey = getSendCallsSupportKey({
      accountAddress: walletClient.account.address,
      chainId: chain.id,
      connectorId: connector?.id ?? null,
    });
    const canBatch =
      typeof (walletClient as UntypedValue).sendCalls === "function"
      && typeof (walletClient as UntypedValue).waitForCallsStatus === "function";
    const requiresAtomicBundle = normalizedCalls.length > 1;
    const shouldUseBatchedExecution =
      canBatch
      && !(
        sendCallsSupportKey
        && unsupportedSendCallsKeys.has(sendCallsSupportKey)
      )
      && (requiresAtomicBundle || isSponsored || isSmartWallet);
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

    const executeDirectTransactions = async () => {
      for (const call of normalizedCalls) {
        const hash = await walletClient.sendTransaction({
          account: walletClient.account,
          chain,
          data: call.data,
          to: call.to!,
          value: call.value,
        });

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

        const confirmedReceipt = await withTimeout(
          waitForBaseReceipt(hash),
          DIRECT_RECEIPT_TIMEOUT_MS,
          RECEIPT_TIMEOUT_MESSAGE,
        );
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
      }

      emitStatus({
        statusData: {
          ...(transactionHashRef.current ? { transactionHash: transactionHashRef.current } : {}),
          transactionReceipts: completedReceipts,
        },
        statusName: "success",
      });
    };

    try {
      if (shouldUseBatchedExecution) {
        try {
          const batch = await (walletClient as UntypedValue).sendCalls({
            account: walletClient.account,
            ...(Object.keys(mergedCapabilities).length > 0 ? { capabilities: mergedCapabilities } : {}),
            chain,
            calls: normalizedCalls,
            ...(normalizedCalls.length > 1 ? { forceAtomic: true } : {}),
          });

          const nextTransactionId =
            typeof batch?.id === "string" && batch.id.trim() !== ""
              ? batch.id
              : null;

          transactionIdRef.current = nextTransactionId;
          if (mountedRef.current) {
            setTransactionId(nextTransactionId);
          }

          emitStatus({
            statusData: {
              ...(nextTransactionId ? { transactionId: nextTransactionId } : {}),
              transactionReceipts: [],
            },
            statusName: "transactionPending",
          });

          const result = await withTimeout<UntypedValue>(
            (walletClient as UntypedValue).waitForCallsStatus({
              id: batch.id,
              throwOnFailure: false,
              timeout: CALLS_STATUS_TIMEOUT_MS,
            }) as Promise<UntypedValue>,
            CALLS_STATUS_TIMEOUT_MS + 5_000,
            "Timed out waiting for wallet transaction status.",
          );

          let receipts = ((result?.receipts as TransactionReceiptLike[]) || []).map((receipt) =>
            normalizeTransactionReceipt(receipt),
          );
          const statusTransactionHash = extractTransactionHash(result) as Hex | undefined;
          let nextTransactionHash = (extractTransactionHash(receipts[0]) ?? statusTransactionHash) as Hex | undefined;

          const firstReceiptLogs = Array.isArray(receipts[0]?.logs) ? receipts[0].logs : [];
          if (nextTransactionHash && firstReceiptLogs.length === 0) {
            try {
              const fetchedReceipt = normalizeTransactionReceipt(
                await withTimeout(
                  waitForBaseReceipt(nextTransactionHash),
                  DIRECT_RECEIPT_TIMEOUT_MS,
                  RECEIPT_TIMEOUT_MESSAGE,
                ),
              );
              receipts = [fetchedReceipt, ...receipts];
              nextTransactionHash = (extractTransactionHash(fetchedReceipt) ?? nextTransactionHash) as Hex;
            } catch (receiptError) {
              if (isReceiptTimeoutError(receiptError)) {
                throw receiptError;
              }
              console.warn("Failed to fetch full transaction receipt from RPC:", receiptError);
            }
          }

          transactionHashRef.current = nextTransactionHash;
          if (mountedRef.current) {
            setTransactionHash(nextTransactionHash);
          }

          if (result?.status !== "success") {
            const error = new Error("Transaction reverted.");
            emitStatus({
              statusData: {
                error,
                ...(nextTransactionHash ? { transactionHash: nextTransactionHash } : {}),
                ...(nextTransactionId ? { transactionId: nextTransactionId } : {}),
                transactionReceipts: receipts,
              },
              statusName: "reverted",
            });
            onError?.(error);
            return;
          }

          emitStatus({
            statusData: {
              ...(nextTransactionHash ? { transactionHash: nextTransactionHash } : {}),
              ...(nextTransactionId ? { transactionId: nextTransactionId } : {}),
              transactionReceipts: receipts,
            },
            statusName: "success",
          });
          return;
        } catch (error) {
          if (!isUnsupportedSendCallsError(error) || transactionIdRef.current) {
            throw error;
          }

          if (sendCallsSupportKey) {
            unsupportedSendCallsKeys.add(sendCallsSupportKey);
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
      const statusName = getErrorStatusName(error);
      emitStatus({
        statusData: {
          error,
          ...(transactionHashRef.current ? { transactionHash: transactionHashRef.current } : {}),
          ...(transactionIdRef.current ? { transactionId: transactionIdRef.current } : {}),
          transactionReceipts: completedReceipts,
        },
        statusName,
      });
      onError?.(error);
    } finally {
      executingRef.current = false;
      if (mountedRef.current) {
        setIsExecuting(false);
      }
    }
  }, [
    capabilities,
    clearResetTimer,
    clearTransactionArtifacts,
    emitStatus,
    connector?.id,
    isSmartWallet,
    isSponsored,
    normalizedCalls,
    onError,
    walletClient,
  ]);

  const explorerChain = walletClient?.chain ?? base;
  const receipt = useMemo(
    () => (status.statusName === "success" ? (status.statusData.transactionReceipts[0] ?? null) : null),
    [status],
  );
  const errorMessage = useMemo(() => {
    if (status.statusName === "idle" || status.statusName === "success") {
      return null;
    }
    if (status.statusName === "buildingTransaction" || status.statusName === "transactionPending") {
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

  const contextValue = useMemo<TransactionContextValue>(
    () => ({
      chainId: walletClient?.chain?.id ?? accountChainId ?? null,
      dismissToast: () => setIsToastVisible(false),
      errorMessage,
      execute,
      explorerHref,
      isExecuting,
      isToastVisible,
      receipt,
      setIsToastVisible,
      status,
      transactionHash,
      transactionId,
    }),
    [
      accountChainId,
      errorMessage,
      execute,
      explorerHref,
      isExecuting,
      isToastVisible,
      receipt,
      status,
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
    execute,
    explorerHref,
    isExecuting,
    receipt,
    transactionHash,
    transactionId,
  } = context;

  const isDisabled = !receipt && (isExecuting || disabled);

  const handleSuccess = useCallback(() => {
    if (receipt && transactionId && transactionHash && chainId && address) {
      const url = new URL("https://wallet.coinbase.com/assets/transactions");
      url.searchParams.set("contentParams[txHash]", transactionHash);
      url.searchParams.set("contentParams[chainId]", JSON.stringify(chainId));
      url.searchParams.set("contentParams[fromAddress]", address);
      window.open(url, "_blank", "noopener,noreferrer");
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

    window.open(
      transactionHref,
      "_blank",
      "noopener,noreferrer",
    );
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
    if (receipt) {
      return "View transaction";
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
  }, [errorMessage, idleText, isExecuting, receipt]);

  const handleSubmit = useCallback(() => {
    if (receipt) {
      handleSuccess();
      return;
    }

    try {
      onClick?.();
    } catch (error) {
      console.warn("Transaction button pre-handler failed", error);
    }

    void execute();
  }, [execute, handleSuccess, onClick, receipt]);

  const status = useMemo<"default" | "error" | "pending" | "success">(() => {
    if (receipt) {
      return "success";
    }
    if (errorMessage) {
      return "error";
    }
    if (isExecuting) {
      return "pending";
    }
    return "default";
  }, [errorMessage, isExecuting, receipt]);

  const resolvedAriaLabel = ariaLabel
    ?? (receipt
      ? "View transaction"
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
  const { errorMessage, isExecuting, receipt, status, transactionHash, transactionId } =
    useTransactionContext();
  const { label } = getStatusLabelData({
    errorMessage,
    isExecuting,
    receipt,
    status,
    transactionHash,
    transactionId,
  });

  if (!label) {
    return null;
  }

  return (
    <div className={cn("flex justify-between", className)}>
      {children ?? (
        <>
          <TransactionStatusLabel />
          <TransactionStatusAction />
        </>
      )}
    </div>
  );
}

export function TransactionStatusAction({
  className,
}: TransactionStatusActionProps) {
  const { explorerHref, receipt, transactionHash, transactionId } = useTransactionContext();
  const { showCallsStatus } = useShowCallsStatus();

  const actionElement = useMemo(() => {
    if (receipt) {
      return null;
    }

    const transactionHref =
      explorerHref || getExplorerHref(transactionHash, base.blockExplorers?.default.url);

    if (transactionHash && transactionHref) {
      return (
        <a
          href={transactionHref}
          target="_blank"
          rel="noreferrer"
        >
          <span className={cn(TEXT_LABEL1, TEXT_PRIMARY)}>View transaction</span>
        </a>
      );
    }

    if (transactionId) {
      return (
        <button
          onClick={() => showCallsStatus({ id: transactionId })}
          type="button"
        >
          <span className={cn(TEXT_LABEL1, TEXT_PRIMARY)}>View transaction</span>
        </button>
      );
    }

    return null;
  }, [explorerHref, receipt, showCallsStatus, transactionHash, transactionId]);

  if (!actionElement) {
    return null;
  }

  return (
    <div className={cn(TEXT_LABEL2, "min-w-[70px]", className)}>
      {actionElement}
    </div>
  );
}

export function TransactionStatusLabel({
  className,
}: TransactionStatusLabelProps) {
  const { errorMessage, isExecuting, receipt, status, transactionHash, transactionId } =
    useTransactionContext();
  const { label, labelClassName } = getStatusLabelData({
    errorMessage,
    isExecuting,
    receipt,
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
  const { dismissToast, errorMessage, isExecuting, isToastVisible, receipt, status, transactionHash, transactionId } =
    useTransactionContext();

  const { label } = getToastLabelData({
    errorMessage,
    isExecuting,
    receipt,
    status,
    transactionHash,
    transactionId,
  });

  if (!isToastVisible || !label) {
    return null;
  }

  const positionClassName = {
        "bottom-center": "bottom-4 left-1/2 -translate-x-1/2",
        "bottom-right": "bottom-4 right-4",
        "top-center": "top-4 left-1/2 -translate-x-1/2",
        "top-right": "top-4 right-4",
  }[position];

  const animationClassName = {
    "bottom-center": "animate-in fade-in-0 slide-in-from-bottom-8 duration-500",
    "bottom-right": "animate-in fade-in-0 slide-in-from-right-8 duration-500",
    "top-center": "animate-in fade-in-0 slide-in-from-top-8 duration-500",
    "top-right": "animate-in fade-in-0 slide-in-from-right-8 duration-500",
  }[position];

  return (
    <div
      aria-live="polite"
      className={cn(
        "fixed z-[var(--z-toast)] flex max-w-[calc(100vw-2rem)] items-center justify-between rounded-[var(--radius-control)] border border-border/60 p-2 sm:max-w-sm",
        BG_SURFACE,
        TEXT_DEFAULT,
        TOAST_SHADOW,
        animationClassName,
        positionClassName,
        className,
      )}
      role="status"
      data-testid="ockToast"
    >
      <div className="flex min-w-0 items-center gap-3 p-2">
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
  const { errorMessage, isExecuting, receipt, status, transactionHash, transactionId } =
    useTransactionContext();
  const { label, labelClassName } = getToastLabelData({
    errorMessage,
    isExecuting,
    receipt,
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
  const { errorMessage, execute, explorerHref, transactionHash, transactionId } =
    useTransactionContext();
  const { showCallsStatus } = useShowCallsStatus();

  const actionElement = useMemo(() => {
    if (transactionHash) {
      return (
        <a
          href={explorerHref || getExplorerHref(transactionHash, base.blockExplorers?.default.url) || undefined}
          target="_blank"
          rel="noreferrer"
        >
          <span className={cn(TEXT_LABEL1, TEXT_PRIMARY)}>View transaction</span>
        </a>
      );
    }

    if (transactionId) {
      return (
        <button
          onClick={() => showCallsStatus({ id: transactionId })}
          type="button"
        >
          <span className={cn(TEXT_LABEL1, TEXT_PRIMARY)}>View transaction</span>
        </button>
      );
    }

    if (errorMessage) {
      return (
        <button
          type="button"
          onClick={() => {
            void execute();
          }}
        >
          <span className={cn(TEXT_LABEL1, TEXT_PRIMARY)}>Try again</span>
        </button>
      );
    }

    return null;
  }, [errorMessage, execute, explorerHref, showCallsStatus, transactionHash, transactionId]);

  if (!actionElement) {
    return null;
  }

  return (
    <div className={cn(TEXT_LABEL1, "shrink-0 text-nowrap", className)}>
      {actionElement}
    </div>
  );
}
