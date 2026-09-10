import { WalletStatusUnavailableError } from "@/lib/wallet-batch-status";
import { getBaseRpcFailure } from '@/lib/base-rpc-errors';
import { TransactionCancelledError, TransactionSupersededError, TransactionVerificationUnavailableError } from '@/lib/transaction-proof-verification';

export type TransactionStatusName =
  | "idle"
  | "buildingTransaction"
  | "transactionPending"
  | "submissionAmbiguous"
  | "transactionUnresolved"
  | "transactionStale"
  | "confirmedSyncing"
  | "success"
  | "error"
  | "failed"
  | "reverted"
  | "superseded"
  | "cancelled"
  | "canceled"
  | "rejected"
  | "transactionRejected"
  | "userRejected"
  | "buildError";

export function isTransactionActionPending(status: TransactionStatusName): boolean {
  return status === 'buildingTransaction' || status === 'transactionPending' || status === 'confirmedSyncing';
}

export function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  if (typeof error === "string" && error.trim() !== "") {
    return error;
  }
  if (error && typeof error === "object") {
    const message =
      (error as { shortMessage?: unknown; message?: unknown }).shortMessage
      ?? (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim() !== "") {
      return message;
    }
  }
  return "Transaction failed.";
}

export function getErrorStatusName(error: unknown): TransactionStatusName {
  if (error instanceof TransactionSupersededError) return 'superseded';
  if (error instanceof TransactionCancelledError) return 'cancelled';
  const message = getErrorMessage(error).toLowerCase();
  const code = getNestedErrorCode(error);

  if (
    code === 4001
    || message.includes("user rejected")
    || message.includes("rejected the request")
    || message.includes("transaction rejected")
  ) {
    return "transactionRejected";
  }

  if (message.includes("transaction cancelled") || message.includes("transaction canceled")) {
    return "cancelled";
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

  if (code === 4100 || code === 5700 || code === 5710 || code === 5740 || code === 5760) {
    return "buildError";
  }

  if (message.includes("revert")) {
    return "reverted";
  }

  return "error";
}

export function getNestedErrorCode(error: unknown): number | null {
  const visited = new Set<unknown>();
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current && !visited.has(current); depth += 1) {
    visited.add(current);
    if (typeof current !== "object") break;
    const typed = current as { cause?: unknown; code?: unknown };
    const numeric = typeof typed.code === "string" ? Number(typed.code) : typed.code;
    if (typeof numeric === "number" && Number.isFinite(numeric)) return numeric;
    current = typed.cause;
  }
  return null;
}

export function getAtomicCapabilityStatus(
  capabilities: unknown,
  chainId: number,
): "supported" | "ready" | "unsupported" | null {
  if (!capabilities || typeof capabilities !== "object") return null;

  // wallet_getCapabilities normally returns a chain-id keyed map. Some wallet
  // clients already select the requested chain and return its capability object
  // directly, so tolerate both shapes rather than making discovery itself a
  // compatibility requirement.
  const byChain = (capabilities as Record<string, unknown>)[String(chainId)]
    ?? (capabilities as Record<string, unknown>)[`0x${chainId.toString(16)}`];
  const selected = byChain && typeof byChain === "object" ? byChain : capabilities;
  const atomic = (selected as { atomic?: unknown }).atomic;
  const status = atomic && typeof atomic === "object"
    ? (atomic as { status?: unknown }).status
    : null;
  return status === "supported" || status === "ready" || status === "unsupported"
    ? status
    : null;
}

export function isUnresolvedWaitError(error: unknown) {
  const rpcFailure = getBaseRpcFailure(error);
  if (rpcFailure) return rpcFailure.retryable;
  if (error instanceof TransactionVerificationUnavailableError) return true;
  if (error instanceof WalletStatusUnavailableError) return true;
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

export function isDefinitivePostSubmissionError(error: unknown) {
  if (error instanceof TransactionSupersededError || error instanceof TransactionCancelledError) return true;
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("transaction reverted")
    || message.includes("execution reverted")
    || message.includes("transaction cancelled")
    || message.includes("transaction canceled");
}
