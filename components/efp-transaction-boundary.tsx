"use client";

import {
  type Dispatch,
  type ReactNode,
  type SetStateAction,
  useEffect,
  useState,
} from "react";
import { TransactionProvider, useTransactions } from "ethereum-identity-kit";
// ethereum-identity-kit's stylesheet (~93 KB) is imported here rather than in the
// root layout: it only matters once an EFP surface is opened, and a root-layout CSS
// import is render-blocking on every route including /status, /admin and the login
// screen. Both EIK consumers import it so it is present whichever one loads first.
import "ethereum-identity-kit/css";

import { TransactionModalWrapper } from "@/components/transaction-modal-wrapper";
import { getPrimaryRpcEndpoint } from "@/lib/rpc-transport";

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

  return <TransactionModalWrapper className="!z-[var(--z-transaction)]" />;
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
