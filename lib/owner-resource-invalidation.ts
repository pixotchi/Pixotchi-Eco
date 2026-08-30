"use client";

import { requestBalanceRefresh } from "@/lib/app-events";

const OWNER_RESOURCE_INVALIDATION_EVENT = "pixotchi:owner-resources:invalidate";

export type OwnerResourceDomain =
  | "arcade"
  | "balances"
  | "buildings"
  | "lands"
  | "plants";

type OwnerStateDomain = Exclude<OwnerResourceDomain, "balances">;

export type OwnerResourceInvalidationRequest = {
  address?: string | null;
  clear?: boolean;
  domains: readonly OwnerResourceDomain[];
  eventId?: string;
  expected?: {
    landCountAtLeast?: number;
    landIdsAbsent?: readonly (bigint | number | string)[];
    landIdsPresent?: readonly (bigint | number | string)[];
    plantCountAtLeast?: number;
    plantIdsAbsent?: readonly number[];
    plantIdsPresent?: readonly number[];
  };
  force?: boolean;
  receiptBlock?: bigint | number | string;
  source?: string;
  transactionHash?: string;
  transactionId?: string;
};

export type OwnerResourceInvalidationDetail = Omit<
  OwnerResourceInvalidationRequest,
  "address" | "domains" | "force"
> & {
  address?: string;
  domains: readonly OwnerStateDomain[];
  eventId: string;
  force: boolean;
  requestedAt: number;
};

type RetryOwnerReadOptions<T> = {
  accept: (value: T) => boolean;
  delaysMs?: readonly number[];
  signal?: AbortSignal;
};

const DEFAULT_RETRY_DELAYS_MS = [0, 350, 900, 1_800, 3_000, 5_000] as const;
const resourceVersions = new Map<string, number>();
let invalidationSequence = 0;

function normalizeAddress(address?: string | null): string | undefined {
  const normalized = address?.trim().toLowerCase();
  return normalized || undefined;
}

function resourceVersionKey(address: string | undefined, domain: OwnerStateDomain): string {
  return `${address ?? "anonymous"}:${domain}`;
}

function createEventId(): string {
  invalidationSequence += 1;
  return `owner-state:${Date.now().toString(36)}:${invalidationSequence.toString(36)}`;
}

/**
 * Marks address-owned resources dirty after a confirmed mutation.
 *
 * Balances deliberately delegate to the canonical balance event instead of
 * creating a second refresh path. Other owner domains share one typed event so
 * retained/hidden tabs can reconcile without relying on fixed timer waves.
 */
export function invalidateOwnerResources(
  request: OwnerResourceInvalidationRequest,
): string | null {
  if (typeof window === "undefined") return null;

  const eventId = request.eventId ?? createEventId();
  const address = normalizeAddress(request.address);
  const domains = [...new Set(request.domains)];

  if (domains.includes("balances")) {
    requestBalanceRefresh({
      address,
      dedupeKey: request.transactionHash ?? request.transactionId ?? eventId,
      eventId,
      source: request.source,
      transactionHash: request.transactionHash,
      transactionId: request.transactionId,
    });
  }

  const ownerDomains = domains.filter(
    (domain): domain is OwnerStateDomain => domain !== "balances",
  );
  if (ownerDomains.length === 0) return eventId;

  for (const domain of ownerDomains) {
    const key = resourceVersionKey(address, domain);
    resourceVersions.set(key, (resourceVersions.get(key) ?? 0) + 1);
  }

  const detail: OwnerResourceInvalidationDetail = {
    address,
    clear: request.clear,
    domains: ownerDomains,
    eventId,
    expected: request.expected,
    force: request.force ?? true,
    receiptBlock: request.receiptBlock,
    requestedAt: Date.now(),
    source: request.source,
    transactionHash: request.transactionHash,
    transactionId: request.transactionId,
  };

  window.dispatchEvent(new CustomEvent(OWNER_RESOURCE_INVALIDATION_EVENT, { detail }));
  return eventId;
}

/** Immediately removes owner-bound UI state before an asynchronous disconnect. */
export function clearOwnerResources(address?: string | null): string | null {
  return invalidateOwnerResources({
    address,
    clear: true,
    domains: ["plants", "lands", "buildings", "arcade"],
    force: false,
    source: "wallet-disconnect",
  });
}

export function onOwnerResourceInvalidation(
  listener: (detail: OwnerResourceInvalidationDetail) => void,
): () => void {
  if (typeof window === "undefined") return () => {};

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<OwnerResourceInvalidationDetail>).detail;
    if (detail?.eventId && Array.isArray(detail.domains)) {
      listener(detail);
    }
  };

  window.addEventListener(OWNER_RESOURCE_INVALIDATION_EVENT, handler as EventListener);
  return () => {
    window.removeEventListener(OWNER_RESOURCE_INVALIDATION_EVENT, handler as EventListener);
  };
}

export function ownerInvalidationMatches(
  detail: OwnerResourceInvalidationDetail,
  address: string | null | undefined,
  domain: OwnerStateDomain,
): boolean {
  const owner = normalizeAddress(address);
  return detail.domains.includes(domain) && (!detail.address || detail.address === owner);
}

export function getOwnerResourceVersion(
  address: string | null | undefined,
  domain: OwnerStateDomain,
): number {
  return resourceVersions.get(resourceVersionKey(normalizeAddress(address), domain)) ?? 0;
}

function waitForRetry(delayMs: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(new DOMException("Aborted", "AbortError"));
  if (delayMs <= 0) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const timer = window.setTimeout(() => {
      cleanup();
      resolve();
    }, delayMs);
    const onAbort = () => {
      window.clearTimeout(timer);
      cleanup();
      reject(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * Repeats an owner read until the post-transaction invariant is observable.
 * The caller still owns address/generation guards; AbortSignal makes wallet
 * switches and unmounts terminate the bounded reconciliation immediately.
 */
export async function retryOwnerRead<T>(
  read: (attempt: number) => Promise<T>,
  options: RetryOwnerReadOptions<T>,
): Promise<T> {
  const delays = options.delaysMs?.length
    ? options.delaysMs
    : DEFAULT_RETRY_DELAYS_MS;
  let lastValue: T | undefined;

  for (let attempt = 0; attempt < delays.length; attempt += 1) {
    await waitForRetry(Math.max(0, delays[attempt] ?? 0), options.signal);
    if (options.signal?.aborted) {
      throw new DOMException("Aborted", "AbortError");
    }
    lastValue = await read(attempt);
    if (options.accept(lastValue)) return lastValue;
  }

  if (lastValue === undefined) {
    throw new Error("Owner reconciliation did not perform a read");
  }
  return lastValue;
}

export function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}
