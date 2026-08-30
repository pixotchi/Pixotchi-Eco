"use client";

import { requestBalanceRefresh } from "@/lib/app-events";

// Receipt confirmation is the synchronization boundary. Domain consumers may
// perform one bounded reconciliation; fixed multi-wave polling multiplied every
// caller and made a single transaction fan out into dozens of RPC requests.
export const POST_TRANSACTION_REFRESH_DELAYS_MS = [350] as const;

export type PostTransactionRefreshContext = {
  address?: string;
  eventId?: string;
  source?: string;
  transactionHash?: string;
  transactionId?: string;
};

type ScheduledRefresh = {
  cancel: () => void;
  targetAt: number;
};

const scheduledRefreshes = new Map<string, ScheduledRefresh>();
const recentRefreshes = new Map<string, number>();
const UNKEYED_COALESCE_WINDOW_MS = 250;
const TRANSACTION_DEDUPE_WINDOW_MS = 15_000;
let refreshSequence = 0;

function createEventId(): string {
  refreshSequence += 1;
  return `transaction-refresh:${Date.now().toString(36)}:${refreshSequence.toString(36)}`;
}

function getRefreshKey(eventName: string, context: PostTransactionRefreshContext): string {
  const domain = eventName === "balances:refresh" || eventName === "pixotchi:balances:refresh"
    ? "balances"
    : eventName;
  const proof = context.transactionHash?.toLowerCase() || context.transactionId || context.eventId;
  return `${domain}:${proof || "unkeyed"}`;
}

function emitDomainRefresh(
  eventNames: readonly string[],
  context: PostTransactionRefreshContext,
  eventId: string,
  stableDedupeKey?: string,
) {
  for (const eventName of new Set(eventNames)) {
    if (eventName === "balances:refresh" || eventName === "pixotchi:balances:refresh") {
      requestBalanceRefresh({
        ...context,
        ...(stableDedupeKey ? { dedupeKey: stableDedupeKey } : {}),
        delayMs: 0,
        eventId,
      });
      continue;
    }

    window.dispatchEvent(new CustomEvent(eventName, {
      detail: {
        ...context,
        domain: eventName,
        eventId,
        requestedAt: Date.now(),
      },
    }));
  }
}

/**
 * Schedule one coalesced post-receipt reconciliation and return a cancellation
 * function. The legacy `delays` argument remains accepted, but only the earliest
 * requested pass is used.
 */
export function dispatchPostTransactionRefresh(
  eventNames: string[] = ["balances:refresh"],
  delays: readonly number[] = POST_TRANSACTION_REFRESH_DELAYS_MS,
  context: PostTransactionRefreshContext = {},
): () => void {
  if (typeof window === "undefined" || eventNames.length === 0) return () => {};

  const eventId = context.eventId ?? createEventId();
  const normalizedContext = { ...context, eventId };
  const now = Date.now();
  const proofKeyed = Boolean(context.transactionHash || context.transactionId || context.eventId);
  const dedupeWindow = proofKeyed ? TRANSACTION_DEDUPE_WINDOW_MS : UNKEYED_COALESCE_WINDOW_MS;
  const delayMs = delays.length > 0
    ? Math.max(0, Math.min(...delays.map((delay) => Number.isFinite(delay) ? delay : 0)))
    : 0;
  const cancellations = [...new Set(eventNames)].map((eventName) => {
    const key = getRefreshKey(eventName, context);
    const lastEmittedAt = recentRefreshes.get(key) ?? 0;
    if (now - lastEmittedAt < dedupeWindow) return () => {};

    const targetAt = now + delayMs;
    const existing = scheduledRefreshes.get(key);
    // A duplicate caller does not own (and therefore must not be able to
    // cancel) an earlier caller's scheduled reconciliation.
    if (existing && existing.targetAt <= targetAt) return () => {};
    existing?.cancel();

    let cancelled = false;
    let timer: number | null = null;
    const cancel = () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
        timer = null;
      }
      if (scheduledRefreshes.get(key)?.cancel === cancel) {
        scheduledRefreshes.delete(key);
      }
    };
    const emit = () => {
      if (cancelled) return;
      scheduledRefreshes.delete(key);
      recentRefreshes.set(key, Date.now());
      emitDomainRefresh(
        [eventName],
        normalizedContext,
        eventId,
        proofKeyed ? getRefreshKey(eventName, context) : undefined,
      );
    };

    if (delayMs === 0) {
      emit();
    } else {
      timer = window.setTimeout(emit, delayMs);
      scheduledRefreshes.set(key, { cancel, targetAt });
    }
    return cancel;
  });

  if (recentRefreshes.size > 200) {
    const cutoff = now - TRANSACTION_DEDUPE_WINDOW_MS;
    for (const [recentKey, timestamp] of recentRefreshes) {
      if (timestamp <= cutoff) recentRefreshes.delete(recentKey);
    }
    while (recentRefreshes.size > 200) {
      const oldestKey = recentRefreshes.keys().next().value as string | undefined;
      if (!oldestKey) break;
      recentRefreshes.delete(oldestKey);
    }
  }

  return () => cancellations.forEach((cancel) => cancel());
}
