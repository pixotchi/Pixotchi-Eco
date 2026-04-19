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
import { CircleAlert, CheckCircle2, ExternalLink, Loader2, X } from "lucide-react";
import { useWalletClient } from "wagmi";
import { base } from "viem/chains";
import type { Hex } from "viem";
import { waitForBaseReceipt } from "@/lib/base-rpc";
import { useSmartWallet } from "@/lib/smart-wallet-context";
import { extractTransactionHash, normalizeTransactionReceipt } from "@/lib/transaction-utils";
import { cn } from "@/lib/utils";

type TransactionReceiptLike = any;

type StatusName =
  | "idle"
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
    error?: unknown;
    transactionHash?: Hex;
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
  onError?: (error: unknown) => void;
  onStatus?: (status: LifecycleStatus) => void;
  isSponsored?: boolean;
  capabilities?: Record<string, unknown>;
  resetAfter?: number;
  children: React.ReactNode;
};

type TransactionContextValue = {
  dismissToast: () => void;
  execute: () => Promise<void>;
  explorerHref: string | null;
  isExecuting: boolean;
  isToastDismissed: boolean;
  status: LifecycleStatus | null;
};

const TransactionContext = createContext<TransactionContextValue | null>(null);

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

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string") {
    return error;
  }
  if (error && typeof error === "object") {
    const message = (error as { shortMessage?: unknown; message?: unknown }).shortMessage
      ?? (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") {
      return message;
    }
  }
  return "Transaction failed.";
}

function getErrorStatusName(error: unknown): StatusName {
  const message = getErrorMessage(error).toLowerCase();
  const code = typeof (error as { code?: unknown })?.code === "number"
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
  ) {
    return "buildError";
  }

  if (message.includes("revert")) {
    return "reverted";
  }

  return "error";
}

function getExplorerHref(hash?: string | null, chainUrl?: string | null) {
  if (!hash) return null;
  const explorerBase = chainUrl || base.blockExplorers?.default.url;
  if (!explorerBase) return null;
  return `${explorerBase.replace(/\/$/, "")}/tx/${hash}`;
}

function getStatusText(status: LifecycleStatus | null): string {
  if (!status) return "";

  switch (status.statusName) {
    case "transactionPending":
      return "Transaction pending...";
    case "success":
      return "Transaction confirmed.";
    case "transactionRejected":
    case "userRejected":
    case "rejected":
      return "Transaction rejected.";
    case "buildError":
      return getErrorMessage(status.statusData.error) || "Could not prepare transaction.";
    default:
      return getErrorMessage(status.statusData.error) || "Transaction failed.";
  }
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
  const { data: walletClient } = useWalletClient();
  const { isSmartWallet } = useSmartWallet();

  const [status, setStatus] = useState<LifecycleStatus | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [isToastDismissed, setIsToastDismissed] = useState(false);

  const mountedRef = useRef(true);
  const executingRef = useRef(false);
  const resetTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setStatus(null);
      setIsToastDismissed(false);
    }, resetAfter);
  }, [clearResetTimer, resetAfter]);

  const emitStatus = useCallback(
    (nextStatus: LifecycleStatus) => {
      if (!mountedRef.current) return;
      setStatus(nextStatus);
      setIsToastDismissed(false);

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

    const chain = walletClient.chain ?? base;
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
    const canBatch =
      typeof (walletClient as any).sendCalls === "function"
      && typeof (walletClient as any).waitForCallsStatus === "function";
    const shouldUseBatchedExecution =
      canBatch && (normalizedCalls.length > 1 || isSponsored || isSmartWallet);

    try {
      if (shouldUseBatchedExecution) {
        const batch = await (walletClient as any).sendCalls({
          account: walletClient.account,
          ...(Object.keys(mergedCapabilities).length > 0 ? { capabilities: mergedCapabilities } : {}),
          chain,
          calls: normalizedCalls,
          ...(normalizedCalls.length > 1 ? { forceAtomic: true } : {}),
        });

        emitStatus({
          statusData: { transactionReceipts: [] },
          statusName: "transactionPending",
        });

        const result = await (walletClient as any).waitForCallsStatus({
          id: batch.id,
          throwOnFailure: false,
          timeout: 120_000,
        });

        const receipts = ((result?.receipts as TransactionReceiptLike[]) || []).map((receipt) =>
          normalizeTransactionReceipt(receipt),
        );
        const transactionHash = extractTransactionHash(receipts[0]) as Hex | undefined;

        if (result?.status !== "success") {
          const error = new Error("Transaction reverted.");
          emitStatus({
            statusData: { error, transactionHash, transactionReceipts: receipts },
            statusName: "reverted",
          });
          onError?.(error);
          return;
        }

        emitStatus({
          statusData: { transactionHash, transactionReceipts: receipts },
          statusName: "success",
        });
        return;
      }

      const [call] = normalizedCalls;
      const hash = await walletClient.sendTransaction({
        account: walletClient.account,
        chain,
        data: call.data,
        to: call.to!,
        value: call.value,
      });

      emitStatus({
        statusData: { transactionHash: hash, transactionReceipts: [] },
        statusName: "transactionPending",
      });

      const receipt = normalizeTransactionReceipt(await waitForBaseReceipt(hash));
      emitStatus({
        statusData: {
          transactionHash: extractTransactionHash(receipt) as Hex | undefined,
          transactionReceipts: [receipt],
        },
        statusName: "success",
      });
    } catch (error) {
      const statusName = getErrorStatusName(error);
      emitStatus({
        statusData: { error, transactionReceipts: [] },
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
    emitStatus,
    isSmartWallet,
    isSponsored,
    normalizedCalls,
    onError,
    walletClient,
  ]);

  const explorerChain = walletClient?.chain ?? base;

  const explorerHref = useMemo(() => {
    const hash = status?.statusData?.transactionHash || extractTransactionHash(status?.statusData?.transactionReceipts?.[0]);
    return getExplorerHref(hash, explorerChain.blockExplorers?.default.url);
  }, [explorerChain.blockExplorers?.default.url, status]);

  const contextValue = useMemo<TransactionContextValue>(
    () => ({
      dismissToast: () => setIsToastDismissed(true),
      execute,
      explorerHref,
      isExecuting,
      isToastDismissed,
      status,
    }),
    [execute, explorerHref, isExecuting, isToastDismissed, status],
  );

  return (
    <TransactionContext.Provider value={contextValue}>
      {children}
    </TransactionContext.Provider>
  );
}

type TransactionButtonProps = {
  className?: string;
  disabled?: boolean;
  onClick?: () => void;
  text: string;
};

export function TransactionButton({
  className,
  disabled = false,
  onClick,
  text,
}: TransactionButtonProps) {
  const { execute, isExecuting } = useTransactionContext();

  const handleClick = useCallback(async () => {
    try {
      onClick?.();
    } catch (error) {
      console.warn("Transaction button pre-handler failed", error);
    }

    await execute();
  }, [execute, onClick]);

  return (
    <button
      type="button"
      className={className}
      disabled={disabled || isExecuting}
      onClick={() => {
        void handleClick();
      }}
    >
      {text}
    </button>
  );
}

type TransactionStatusProps = {
  children: React.ReactNode;
  className?: string;
};

export function TransactionStatus({ children, className }: TransactionStatusProps) {
  const { status } = useTransactionContext();

  if (!status) {
    return null;
  }

  return (
    <div className={cn("mt-2 flex items-center gap-2 text-sm text-muted-foreground", className)}>
      {children}
    </div>
  );
}

export function TransactionStatusAction() {
  const { explorerHref, status } = useTransactionContext();

  if (!status) return null;

  if (status.statusName === "transactionPending") {
    return <Loader2 className="h-4 w-4 animate-spin shrink-0" />;
  }

  if (status.statusName === "success") {
    if (explorerHref) {
      return (
        <a
          href={explorerHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1 text-primary hover:underline"
        >
          <CheckCircle2 className="h-4 w-4 shrink-0" />
          <ExternalLink className="h-3 w-3 shrink-0" />
        </a>
      );
    }

    return <CheckCircle2 className="h-4 w-4 shrink-0 text-green-600" />;
  }

  return <CircleAlert className="h-4 w-4 shrink-0 text-destructive" />;
}

export function TransactionStatusLabel() {
  const { status } = useTransactionContext();

  if (!status) return null;

  return <span>{getStatusText(status)}</span>;
}

type TransactionToastProps = {
  children: React.ReactNode;
  className?: string;
  position?: "bottom-center" | "bottom-right" | "top-center" | "top-right";
};

export function TransactionToast({
  children,
  className,
  position = "bottom-center",
}: TransactionToastProps) {
  const { isToastDismissed, status } = useTransactionContext();

  if (!status || isToastDismissed) {
    return null;
  }

  const positionClassName = {
    "bottom-center": "bottom-4 left-1/2 -translate-x-1/2",
    "bottom-right": "bottom-4 right-4",
    "top-center": "top-4 left-1/2 -translate-x-1/2",
    "top-right": "top-4 right-4",
  }[position];

  return (
    <div
      aria-live="polite"
      className={cn(
        "fixed z-[10000] flex max-w-sm items-center gap-3 rounded-md border bg-background px-4 py-3 text-sm shadow-lg",
        positionClassName,
        className,
      )}
      role="status"
    >
      {children}
    </div>
  );
}

export function TransactionToastIcon() {
  return <TransactionStatusAction />;
}

export function TransactionToastLabel() {
  const { status } = useTransactionContext();

  if (!status) return null;

  return <span className="min-w-0 flex-1">{getStatusText(status)}</span>;
}

export function TransactionToastAction() {
  const { dismissToast, explorerHref, status } = useTransactionContext();

  if (!status) return null;

  if (status.statusName === "success" && explorerHref) {
    return (
      <a
        href={explorerHref}
        target="_blank"
        rel="noreferrer"
        className="inline-flex items-center gap-1 text-primary hover:underline"
      >
        View
        <ExternalLink className="h-3 w-3 shrink-0" />
      </a>
    );
  }

  return (
    <button
      type="button"
      className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-muted-foreground hover:bg-accent hover:text-foreground"
      onClick={dismissToast}
    >
      <X className="h-4 w-4" />
    </button>
  );
}
