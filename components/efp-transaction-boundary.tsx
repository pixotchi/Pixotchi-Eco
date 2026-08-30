"use client";

import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  TransactionProvider,
  useTransactions,
} from "ethereum-identity-kit";
import { AlertTriangle, CheckCircle2, Loader2 } from "lucide-react";
import toast from "react-hot-toast";
import type { Hex } from "viem";
import { useAccount, useChainId, useSwitchChain, useWalletClient } from "wagmi";
// ethereum-identity-kit's stylesheet (~93 KB) is imported here rather than in the
// root layout: it only matters once an EFP surface is opened, and a root-layout CSS
// import is render-blocking on every route including /status, /admin and the login
// screen. Both EIK consumers import it so it is present whichever one loads first.
import "ethereum-identity-kit/css";

import {
  Transaction,
  TransactionButton,
  TransactionStatus,
  getLifecycleTransactionProof,
  type LifecycleStatus,
} from "@/components/transactions/transaction-kit";
import GlobalTransactionToast from "@/components/transactions/global-transaction-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { waitForBaseReceipt } from "@/lib/base-rpc";
import { getBuilderCapabilities, transformCallsWithBuilderCode } from "@/lib/builder-code";
import {
  advanceEfpWorkflowAfterSuccess,
  createEfpWorkflowSnapshot,
  getBrowserEfpWorkflowStorage,
  readEfpWorkflow,
  removeEfpWorkflow,
  subscribeEfpWorkflowChanges,
  updateEfpWorkflowProof,
  writeEfpWorkflow,
  type EfpWorkflowProof,
  type EfpWorkflowSnapshot,
} from "@/lib/efp-transaction-workflow";
import {
  createPendingEvmCallsDigest,
  getBrowserPendingEvmStorage,
  readPendingEvmRecord,
  subscribePendingEvmChanges,
} from "@/lib/pending-evm-transaction";
import { getPrimaryRpcEndpoint } from "@/lib/rpc-transport";
import { extractTransactionHash, normalizeTransactionReceipt } from "@/lib/transaction-utils";

type EfpTransactionBoundaryProps = {
  children: ReactNode;
  open: boolean;
  onTransactionOpen?: () => void;
};

const BASE_DEFAULT_RPC_ORIGIN = "https://mainnet.base.org";

let originalFetch: typeof window.fetch | null = null;
let rpcRedirectInstallCount = 0;

function shouldRedirectBaseDefaultRpc(input: RequestInfo | URL) {
  const url =
    typeof input === "string"
      ? input
      : input instanceof URL
        ? input.toString()
        : typeof Request !== "undefined" && input instanceof Request
          ? input.url
          : "";

  try {
    return new URL(url).origin === BASE_DEFAULT_RPC_ORIGIN;
  } catch {
    return false;
  }
}

function redirectFetchInput(input: RequestInfo | URL, rpcUrl: string): RequestInfo | URL {
  if (!shouldRedirectBaseDefaultRpc(input)) {
    return input;
  }

  if (typeof input === "string") {
    return rpcUrl;
  }

  if (input instanceof URL) {
    return new URL(rpcUrl);
  }

  if (typeof Request !== "undefined" && input instanceof Request) {
    const method = input.method.toUpperCase();
    return new Request(rpcUrl, {
      body: method === "GET" || method === "HEAD" ? undefined : input.clone().body,
      cache: input.cache,
      credentials: input.credentials,
      headers: input.headers,
      integrity: input.integrity,
      keepalive: input.keepalive,
      method: input.method,
      mode: input.mode,
      redirect: input.redirect,
      referrer: input.referrer,
      referrerPolicy: input.referrerPolicy,
      signal: input.signal,
    });
  }

  return input;
}

function installEfpBaseRpcRedirect() {
  if (typeof window === "undefined" || typeof window.fetch !== "function") {
    return () => {};
  }

  rpcRedirectInstallCount += 1;

  if (!originalFetch) {
    const rpcUrl = getPrimaryRpcEndpoint();
    const fetchBase = window.fetch.bind(window);

    originalFetch = window.fetch;
    window.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      return fetchBase(redirectFetchInput(input, rpcUrl), init);
    }) as typeof window.fetch;
  }

  return () => {
    rpcRedirectInstallCount = Math.max(0, rpcRedirectInstallCount - 1);
    if (rpcRedirectInstallCount === 0 && originalFetch) {
      window.fetch = originalFetch;
      originalFetch = null;
    }
  };
}

type EfpRawCall = {
  data?: Hex;
  to?: `0x${string}`;
  value?: bigint;
};

const BASE_CHAIN_ID = 8453;
const EFP_TERMINAL_FAILURES = new Set<LifecycleStatus["statusName"]>([
  "buildError",
  "cancelled",
  "canceled",
  "error",
  "failed",
  "rejected",
  "reverted",
  "transactionRejected",
  "userRejected",
]);

function getSubmittedProof(status: LifecycleStatus): Omit<EfpWorkflowProof, "status"> | null {
  const transactionHash = status.statusData.transactionHash;
  const transactionId = status.statusData.transactionId;
  if (!transactionHash && !transactionId) return null;
  return {
    method: transactionId ? "batch" : "direct",
    ...(transactionHash ? { transactionHash } : {}),
    ...(transactionId ? { transactionId } : {}),
  };
}

function isSuccessfulReceipt(receipt: unknown) {
  const status = (receipt as { status?: unknown } | null)?.status;
  return status === "success" || status === 1 || status === BigInt(1) || status === "0x1";
}

function isFailedReceipt(receipt: unknown) {
  const status = (receipt as { status?: unknown } | null)?.status;
  return status === "reverted" || status === "failed" || status === 0 || status === "0x0";
}

function useDurableEfpWorkflow(accountAddress?: string) {
  const [workflow, setWorkflow] = useState<EfpWorkflowSnapshot | null>(null);
  const workflowRef = useRef<EfpWorkflowSnapshot | null>(null);

  const syncWorkflow = useCallback(() => {
    const nextWorkflow = accountAddress
      ? readEfpWorkflow(getBrowserEfpWorkflowStorage(), accountAddress)
      : null;
    workflowRef.current = nextWorkflow;
    setWorkflow(nextWorkflow);
    return nextWorkflow;
  }, [accountAddress]);

  useEffect(() => {
    syncWorkflow();
    if (!accountAddress) return;
    return subscribeEfpWorkflowChanges(accountAddress, syncWorkflow);
  }, [accountAddress, syncWorkflow]);

  return { setWorkflow, syncWorkflow, workflow, workflowRef };
}

function SafeEfpTransactionModal() {
  const { address, isConnected } = useAccount();
  const chainId = useChainId();
  const { data: walletClient } = useWalletClient();
  const { isPending: isSwitchingChain, switchChain } = useSwitchChain();
  const {
    currentTxIndex,
    defaultChainId,
    paymasterService,
    pendingTxs,
    resetTransactions,
    selectedList,
    setCurrentTxIndex,
    setPendingTxs,
    setSelectedChainId,
    setSelectedList,
    setTxModalOpen,
    txModalOpen,
  } = useTransactions();
  const { setWorkflow, syncWorkflow, workflow, workflowRef } = useDurableEfpWorkflow(address);
  const hadWorkflowRef = useRef(false);
  const legacyMigrationAttemptedRef = useRef(false);
  const [pendingRegistryRevision, setPendingRegistryRevision] = useState(0);
  const [orphanCheckRevision, setOrphanCheckRevision] = useState(0);
  const [orphanError, setOrphanError] = useState<string | null>(null);

  useEffect(() => subscribePendingEvmChanges(() => {
    setPendingRegistryRevision((revision) => revision + 1);
  }), []);

  // Keep Identity Kit's read/query context in sync, but never let it own a send.
  // This preserves FollowButton state and its query invalidation behavior while
  // the app-owned workflow remains the only transaction source of truth.
  useEffect(() => {
    if (workflow) {
      hadWorkflowRef.current = true;
      legacyMigrationAttemptedRef.current = true;
      if (pendingTxs !== workflow.pendingTxs) {
        setPendingTxs(workflow.pendingTxs);
      }
      if (currentTxIndex !== workflow.currentTxIndex) {
        setCurrentTxIndex(workflow.currentTxIndex);
      }
      if (workflow.selectedList !== undefined && selectedList !== workflow.selectedList) {
        setSelectedList(workflow.selectedList);
      }
      const targetChainId = workflow.pendingTxs[workflow.currentTxIndex]?.chainId
        ?? defaultChainId
        ?? BASE_CHAIN_ID;
      setSelectedChainId(targetChainId);
      setTxModalOpen(true);
      return;
    }

    if (hadWorkflowRef.current) {
      hadWorkflowRef.current = false;
      legacyMigrationAttemptedRef.current = true;
      resetTransactions();
      setTxModalOpen(false);
    }
  }, [
    currentTxIndex,
    defaultChainId,
    pendingTxs,
    resetTransactions,
    selectedList,
    setCurrentTxIndex,
    setPendingTxs,
    setSelectedChainId,
    setSelectedList,
    setTxModalOpen,
    workflow,
  ]);

  // One-time migration for an Identity Kit workflow persisted by an older app
  // version. A transaction carrying a hash is restored as submitted and is
  // monitored; it is never converted into a retry button.
  useEffect(() => {
    if (
      !address
      || workflow
      || legacyMigrationAttemptedRef.current
      || pendingTxs.length === 0
    ) {
      return;
    }
    legacyMigrationAttemptedRef.current = true;
    try {
      const fallbackIndex = pendingTxs.findIndex((transaction) => !transaction.hash);
      const migrated = createEfpWorkflowSnapshot({
        accountAddress: address,
        currentTxIndex: currentTxIndex
          ?? (fallbackIndex === -1 ? pendingTxs.length - 1 : fallbackIndex),
        pendingTxs,
        selectedList,
      });
      if (!writeEfpWorkflow(getBrowserEfpWorkflowStorage(), migrated)) {
        throw new Error("The existing EFP update could not be safely restored.");
      }
      workflowRef.current = migrated;
      setWorkflow(migrated);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to restore the EFP update.");
    }
  }, [
    address,
    currentTxIndex,
    pendingTxs,
    selectedList,
    setWorkflow,
    workflow,
    workflowRef,
  ]);

  const currentTransaction = workflow?.pendingTxs[workflow.currentTxIndex];
  const currentProof = workflow?.proofs[workflow.currentTxIndex];
  const targetChainId = currentTransaction?.chainId ?? defaultChainId ?? BASE_CHAIN_ID;

  const preparedCall = useMemo(() => {
    if (!currentTransaction) return { calls: [] as EfpRawCall[], error: null as string | null };
    try {
      const calls = transformCallsWithBuilderCode([currentTransaction]) as unknown as EfpRawCall[];
      if (!calls[0]?.to || !calls[0]?.data) {
        throw new Error("The EFP transaction could not be encoded.");
      }
      return { calls, error: null };
    } catch (error) {
      return {
        calls: [] as EfpRawCall[],
        error: error instanceof Error ? error.message : "The EFP transaction could not be encoded.",
      };
    }
  }, [currentTransaction]);

  const intentKey = useMemo(() => {
    if (!workflow || preparedCall.calls.length === 0) return "";
    return [
      "efp",
      workflow.workflowId,
      workflow.currentTxIndex,
      createPendingEvmCallsDigest(preparedCall.calls),
    ].join(":");
  }, [preparedCall.calls, workflow]);

  // The revision is intentionally read here: pending-registry events trigger a
  // render, then this authoritative lookup decides whether Transaction owns
  // recovery or the proof-only monitor must take over.
  void pendingRegistryRevision;
  const pendingRecord = !address || !intentKey || targetChainId !== BASE_CHAIN_ID
    ? null
    : readPendingEvmRecord(getBrowserPendingEvmStorage(), {
      accountAddress: address,
      chainId: targetChainId,
      intentKey,
    });

  const persistStatus = useCallback((status: LifecycleStatus) => {
    if (!address) return;
    const latest = readEfpWorkflow(getBrowserEfpWorkflowStorage(), address);
    const expected = workflowRef.current;
    if (
      !latest
      || !expected
      || latest.workflowId !== expected.workflowId
      || latest.currentTxIndex !== expected.currentTxIndex
    ) {
      syncWorkflow();
      return;
    }

    const submittedProof = getSubmittedProof(status);
    if (status.statusName === "success") {
      if (!getLifecycleTransactionProof(status) || !submittedProof) {
        toast.error("The wallet reported success without durable transaction proof.");
        return;
      }
      const advanced = advanceEfpWorkflowAfterSuccess(
        latest,
        latest.currentTxIndex,
        submittedProof,
      );
      if (!writeEfpWorkflow(getBrowserEfpWorkflowStorage(), advanced.snapshot)) {
        syncWorkflow();
        return;
      }
      workflowRef.current = advanced.snapshot;
      setWorkflow(advanced.snapshot);

      if (!advanced.complete) {
        setCurrentTxIndex(advanced.snapshot.currentTxIndex);
        setSelectedChainId(
          advanced.snapshot.pendingTxs[advanced.snapshot.currentTxIndex]?.chainId
            ?? BASE_CHAIN_ID,
        );
        return;
      }

      // The shared transaction lifecycle grants a terminal callback to exactly
      // one receipt owner. Only that owner removes the completed workflow; the
      // profile's single modal-close transition performs its cache refresh.
      if (!removeEfpWorkflow(
        getBrowserEfpWorkflowStorage(),
        advanced.snapshot.accountAddress,
        advanced.snapshot.workflowId,
      )) {
        toast.error("EFP updated, but its completion marker could not be cleared safely.");
        return;
      }
      workflowRef.current = null;
      setWorkflow(null);
      resetTransactions();
      setTxModalOpen(false);
      return;
    }

    if (EFP_TERMINAL_FAILURES.has(status.statusName)) {
      const failed = updateEfpWorkflowProof(
        latest,
        latest.currentTxIndex,
        { ...(submittedProof ?? {}), status: "failed" },
      );
      if (writeEfpWorkflow(getBrowserEfpWorkflowStorage(), failed)) {
        workflowRef.current = failed;
        setWorkflow(failed);
      } else {
        syncWorkflow();
      }
      return;
    }

    if (!submittedProof) return;
    const existingProof = latest.proofs[latest.currentTxIndex];
    if (
      existingProof.status === "submitted"
      && existingProof.transactionHash === submittedProof.transactionHash
      && existingProof.transactionId === submittedProof.transactionId
    ) {
      return;
    }
    const submitted = updateEfpWorkflowProof(
      latest,
      latest.currentTxIndex,
      { ...submittedProof, status: "submitted" },
    );
    if (writeEfpWorkflow(getBrowserEfpWorkflowStorage(), submitted)) {
      workflowRef.current = submitted;
      setWorkflow(submitted);
    } else {
      syncWorkflow();
    }
  }, [
    address,
    resetTransactions,
    setCurrentTxIndex,
    setSelectedChainId,
    setTxModalOpen,
    setWorkflow,
    syncWorkflow,
    workflowRef,
  ]);

  const isOrphanedSubmittedProof = currentProof?.status === "submitted" && !pendingRecord;

  useEffect(() => {
    if (
      !isOrphanedSubmittedProof
      || !currentProof
      || !walletClient
      || chainId !== targetChainId
      || targetChainId !== BASE_CHAIN_ID
    ) {
      return;
    }

    let cancelled = false;
    setOrphanError(null);
    const monitor = async () => {
      try {
        if (currentProof.transactionId) {
          const result = await (walletClient as unknown as {
            waitForCallsStatus: (input: {
              id: string;
              throwOnFailure: boolean;
              timeout: number;
            }) => Promise<unknown>;
          }).waitForCallsStatus({
            id: currentProof.transactionId,
            throwOnFailure: false,
            timeout: 120_000,
          });
          if (cancelled) return;
          const callsResult = result as {
            receipts?: unknown[];
            status?: unknown;
          };
          const transactionHash = extractTransactionHash(result) as Hex | undefined;
          const hasFailedReceipt = (callsResult.receipts ?? []).some(isFailedReceipt);
          if (callsResult.status !== "success" || hasFailedReceipt) {
            persistStatus({
              statusData: {
                error: new Error("Transaction reverted."),
                ...(transactionHash ? { transactionHash } : {}),
                transactionId: currentProof.transactionId,
                transactionReceipts: callsResult.receipts ?? [],
              },
              statusName: "reverted",
            });
            return;
          }

          let receipts = (callsResult.receipts ?? []).map(normalizeTransactionReceipt);
          if (transactionHash) {
            try {
              const canonicalReceipt = await waitForBaseReceipt(transactionHash);
              if (cancelled) return;
              receipts = [normalizeTransactionReceipt(canonicalReceipt), ...receipts];
            } catch {
              // The wallet calls result is still a durable success proof. The
              // shared lifecycle applies the same best-effort enrichment rule.
            }
          }
          persistStatus({
            statusData: {
              ...(transactionHash ? { transactionHash } : {}),
              transactionId: currentProof.transactionId,
              transactionReceipts: receipts,
            },
            statusName: "success",
          });
          return;
        }

        if (!currentProof.transactionHash) {
          throw new Error("The pending EFP update has no transaction proof.");
        }
        const receipt = await waitForBaseReceipt(currentProof.transactionHash);
        if (cancelled) return;
        const normalizedReceipt = normalizeTransactionReceipt(receipt);
        persistStatus({
          statusData: {
            transactionHash: currentProof.transactionHash,
            transactionReceipts: [normalizedReceipt],
          },
          statusName: isSuccessfulReceipt(receipt) ? "success" : "reverted",
        });
      } catch (error) {
        if (!cancelled) {
          setOrphanError(
            error instanceof Error
              ? error.message
              : "Confirmation is still unavailable. No new transaction will be sent.",
          );
        }
      }
    };
    void monitor();
    return () => {
      cancelled = true;
    };
  }, [
    chainId,
    currentProof,
    isOrphanedSubmittedProof,
    orphanCheckRevision,
    persistStatus,
    targetChainId,
    walletClient,
  ]);

  const cancelPreparedWorkflow = useCallback(() => {
    const latest = workflowRef.current;
    if (!latest || latest.proofs[latest.currentTxIndex]?.status === "submitted") return;
    if (!removeEfpWorkflow(
      getBrowserEfpWorkflowStorage(),
      latest.accountAddress,
      latest.workflowId,
    )) {
      toast.error("The EFP update could not be cancelled safely.");
      return;
    }
    workflowRef.current = null;
    setWorkflow(null);
    resetTransactions();
    setTxModalOpen(false);
  }, [resetTransactions, setTxModalOpen, setWorkflow, workflowRef]);

  const finishCompletedWorkflow = useCallback(() => {
    const latest = workflowRef.current;
    if (!latest || latest.proofs[latest.currentTxIndex]?.status !== "success") return;
    if (!removeEfpWorkflow(
      getBrowserEfpWorkflowStorage(),
      latest.accountAddress,
      latest.workflowId,
    )) {
      toast.error("The EFP completion marker still cannot be cleared safely.");
      return;
    }
    workflowRef.current = null;
    setWorkflow(null);
    resetTransactions();
    setTxModalOpen(false);
  }, [resetTransactions, setTxModalOpen, setWorkflow, workflowRef]);

  const capabilities = useMemo(() => ({
    ...(getBuilderCapabilities() ?? {}),
    ...(paymasterService
      ? { paymasterService: { optional: true, url: paymasterService } }
      : {}),
  }), [paymasterService]);

  if (!workflow || !currentTransaction || !currentProof) return null;

  const stepLabel = workflow.pendingTxs.length > 1
    ? `Step ${workflow.currentTxIndex + 1} of ${workflow.pendingTxs.length}`
    : "EFP relationship update";
  const unsupportedChain = targetChainId !== BASE_CHAIN_ID;
  const wrongChain = chainId !== targetChainId;

  return (
    <Dialog open={txModalOpen} onOpenChange={() => {}}>
      <DialogContent
        hideCloseButton
        layer="nested"
        mobileMode="sheet"
        size="sm"
        className="gap-5"
      >
        <DialogHeader className="gap-2 pr-0 text-left">
          <div className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {stepLabel}
          </div>
          <DialogTitle>{currentTransaction.title ?? "Update EFP relationship"}</DialogTitle>
          <DialogDescription>
            {currentTransaction.description
              ?? "Confirm this onchain social update. It will resume safely if the page reloads."}
          </DialogDescription>
        </DialogHeader>

        {unsupportedChain ? (
          <div className="rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
              <p>This EFP list is not on Base, the only network supported by this app.</p>
            </div>
          </div>
        ) : !isConnected ? (
          <div className="rounded-[var(--radius-control)] border border-border bg-muted/40 p-4 text-sm text-muted-foreground">
            Reconnect the wallet that started this EFP update to continue safely.
          </div>
        ) : wrongChain ? (
          <div className="space-y-3 rounded-[var(--radius-control)] border border-border bg-muted/40 p-4">
            <p className="text-sm text-muted-foreground">Switch to Base before confirming this update.</p>
            <Button
              fullWidth
              loading={isSwitchingChain}
              loadingText="Switching network…"
              onClick={() => switchChain({ chainId: BASE_CHAIN_ID })}
            >
              Switch to Base
            </Button>
          </div>
        ) : preparedCall.error ? (
          <div className="rounded-[var(--radius-control)] border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
            {preparedCall.error}
          </div>
        ) : isOrphanedSubmittedProof ? (
          <div className="space-y-4 rounded-[var(--radius-control)] border border-primary/20 bg-primary/5 p-4">
            <div className="flex items-start gap-3">
              {orphanError ? (
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden="true" />
              ) : (
                <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" aria-hidden="true" />
              )}
              <div className="space-y-1">
                <p className="text-sm font-semibold">Checking the submitted transaction</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  {orphanError
                    ?? "The wallet already accepted this update. Pixotchi will not ask you to send it again."}
                </p>
              </div>
            </div>
            {orphanError && (
              <Button
                fullWidth
                variant="outline"
                onClick={() => setOrphanCheckRevision((revision) => revision + 1)}
              >
                Check again
              </Button>
            )}
          </div>
        ) : currentProof.status === "success" ? (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-[var(--radius-control)] border border-emerald-500/25 bg-emerald-500/10 p-4 text-sm">
              <CheckCircle2 className="h-4 w-4 text-emerald-500" aria-hidden="true" />
              The EFP update was confirmed.
            </div>
            <Button fullWidth onClick={finishCompletedWorkflow}>
              Finish
            </Button>
          </div>
        ) : (
          <Transaction
            key={`${workflow.workflowId}:${workflow.currentTxIndex}`}
            calls={preparedCall.calls}
            capabilities={capabilities}
            intentKey={intentKey}
            isSponsored={Boolean(paymasterService)}
            onStatus={persistStatus}
            resetAfter={0}
          >
            <div className="space-y-4">
              <TransactionStatus className="rounded-[var(--radius-control)] border border-border/70 bg-muted/35 px-3 py-2.5" />
              <TransactionButton
                render={({ context, isDisabled, onSubmit, status }) => {
                  const isCheckingOnly = context.status.statusName === "transactionUnresolved"
                    || context.status.statusName === "transactionStale";
                  const actionLabel = isCheckingOnly
                    ? "Check transaction"
                    : status === "error"
                      ? "Try again"
                      : context.isExecuting
                        ? "Confirming…"
                        : "Confirm update";
                  return (
                    <div className="grid grid-cols-2 gap-3">
                      <Button
                        variant="outline"
                        disabled={context.isExecuting || context.isSubmissionLocked}
                        onClick={cancelPreparedWorkflow}
                      >
                        Cancel
                      </Button>
                      <Button
                        disabled={isDisabled}
                        loading={context.isExecuting}
                        loadingText="Confirming…"
                        onClick={onSubmit}
                      >
                        {actionLabel}
                      </Button>
                    </div>
                  );
                }}
              />
              <GlobalTransactionToast />
            </div>
          </Transaction>
        )}

        {(unsupportedChain || preparedCall.error) && (
          <Button fullWidth variant="outline" onClick={cancelPreparedWorkflow}>
            Cancel update
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EfpTransactionLifecycle({
  open,
  onTransactionOpen,
  setKeepMounted,
}: {
  open: boolean;
  onTransactionOpen?: () => void;
  setKeepMounted: Dispatch<SetStateAction<boolean>>;
}) {
  const { txModalOpen, pendingTxs } = useTransactions();

  useEffect(() => installEfpBaseRpcRedirect(), []);

  useEffect(() => {
    if (txModalOpen) {
      onTransactionOpen?.();
    }
  }, [txModalOpen, onTransactionOpen]);

  useEffect(() => {
    if (!open && !txModalOpen && pendingTxs.length === 0) {
      setKeepMounted(false);
    }
  }, [open, pendingTxs.length, setKeepMounted, txModalOpen]);

  return <SafeEfpTransactionModal />;
}

export function EfpTransactionBoundary({
  children,
  open,
  onTransactionOpen,
}: EfpTransactionBoundaryProps) {
  const [keepMounted, setKeepMounted] = useState(open);
  const shouldRender = open || keepMounted;

  useEffect(() => {
    if (open) {
      setKeepMounted(true);
    }
  }, [open]);

  if (!shouldRender) {
    return null;
  }

  return (
    <TransactionProvider
      defaultChainId={8453}
      paymasterService={process.env.NEXT_PUBLIC_PAYMASTER_SERVICE_URL}
    >
      {children}
      <EfpTransactionLifecycle
        open={open}
        onTransactionOpen={onTransactionOpen}
        setKeepMounted={setKeepMounted}
      />
    </TransactionProvider>
  );
}
