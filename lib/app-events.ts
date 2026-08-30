const BALANCE_REFRESH_EVENT = "pixotchi:balances:refresh";
const TASKS_OPEN_EVENT = "pixotchi:tasks:open";
const STAKING_OPEN_EVENT = "pixotchi:staking:open";
const LEGACY_BALANCE_REFRESH_EVENT = "balances:refresh";
const LEGACY_TASKS_OPEN_EVENT = "pixotchi:openTasks";
const LEGACY_STAKING_OPEN_EVENT = "staking:open";

type EventCleanup = () => void;

export type BalanceRefreshRequest = {
  address?: string;
  dedupeKey?: string;
  delayMs?: number;
  eventId?: string;
  source?: string;
  transactionHash?: string;
  transactionId?: string;
};

export type BalanceRefreshDetail = Required<Pick<BalanceRefreshRequest, "delayMs" | "eventId">> &
  Omit<BalanceRefreshRequest, "delayMs" | "eventId"> & {
    domain: "balances";
    requestedAt: number;
  };

let balanceRefreshSequence = 0;
const recentBalanceRefreshes = new Map<string, { seenAt: number; targetAt: number }>();
const BALANCE_REFRESH_DEDUPE_WINDOW_MS = 15_000;
const DEFAULT_BALANCE_REFRESH_DELAY_MS = 500;

function createEventId(prefix: string): string {
  balanceRefreshSequence += 1;
  return `${prefix}:${Date.now().toString(36)}:${balanceRefreshSequence.toString(36)}`;
}

function dispatchTypedEvent<T>(name: string, detail?: T) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(name, { detail }));
}

function subscribeToTypedEvents<T>(
  names: string[],
  listener: (detail: T | undefined) => void,
): EventCleanup {
  if (typeof window === "undefined") return () => {};

  const handlers = names.map((name) => {
    const handler = (event: Event) => {
      listener((event as CustomEvent<T>).detail);
    };
    window.addEventListener(name, handler as EventListener);
    return { handler, name };
  });

  return () => {
    handlers.forEach(({ handler, name }) => {
      window.removeEventListener(name, handler as EventListener);
    });
  };
}

/**
 * Request one canonical balance reconciliation.
 *
 * Numeric input is retained for existing callers. Unlike the legacy helper, this
 * emits only the typed event; consumers that still dispatch `balances:refresh`
 * directly remain supported by `onBalanceRefresh` during migration.
 */
export function requestBalanceRefresh(
  request: number | BalanceRefreshRequest = {},
): string | null {
  if (typeof window === "undefined") return null;

  const options = typeof request === "number" ? { delayMs: request } : request;
  const eventId = options.eventId ?? createEventId("balances");
  const delayMs = Math.max(0, options.delayMs ?? DEFAULT_BALANCE_REFRESH_DELAY_MS);
  const proof = options.transactionHash?.toLowerCase()
    || options.transactionId
    || options.dedupeKey
    || options.eventId;
  const dedupeKey = proof
    ? `balances:${options.address?.toLowerCase() || "*"}:${proof}`
    : null;
  const now = Date.now();
  const targetAt = now + delayMs;
  if (dedupeKey) {
    const recent = recentBalanceRefreshes.get(dedupeKey);
    if (
      recent
      && now - recent.seenAt < BALANCE_REFRESH_DEDUPE_WINDOW_MS
      && recent.targetAt <= targetAt
    ) {
      return null;
    }
    recentBalanceRefreshes.set(dedupeKey, { seenAt: now, targetAt });
    if (recentBalanceRefreshes.size > 200) {
      for (const [key, recentRefresh] of recentBalanceRefreshes) {
        if (now - recentRefresh.seenAt >= BALANCE_REFRESH_DEDUPE_WINDOW_MS) {
          recentBalanceRefreshes.delete(key);
        }
      }
      while (recentBalanceRefreshes.size > 200) {
        const oldestKey = recentBalanceRefreshes.keys().next().value as string | undefined;
        if (!oldestKey) break;
        recentBalanceRefreshes.delete(oldestKey);
      }
    }
  }
  const detail: BalanceRefreshDetail = {
    ...options,
    delayMs,
    domain: "balances",
    eventId,
    requestedAt: now,
  };

  dispatchTypedEvent(BALANCE_REFRESH_EVENT, detail);
  return eventId;
}

export function onBalanceRefresh(
  listener: (detail: BalanceRefreshDetail) => void,
): EventCleanup {
  if (typeof window === "undefined") return () => {};

  const typedHandler = (event: Event) => {
    const detail = (event as CustomEvent<BalanceRefreshDetail>).detail;
    listener({
      ...detail,
      delayMs: Math.max(0, detail?.delayMs ?? 0),
      domain: "balances",
      eventId: detail?.eventId ?? createEventId("balances-typed"),
      requestedAt: detail?.requestedAt ?? Date.now(),
    });
  };
  const legacyHandler = () => {
    listener({
      delayMs: DEFAULT_BALANCE_REFRESH_DELAY_MS,
      domain: "balances",
      eventId: createEventId("balances-legacy"),
      requestedAt: Date.now(),
      source: "legacy",
    });
  };

  window.addEventListener(BALANCE_REFRESH_EVENT, typedHandler as EventListener);
  window.addEventListener(LEGACY_BALANCE_REFRESH_EVENT, legacyHandler as EventListener);
  return () => {
    window.removeEventListener(BALANCE_REFRESH_EVENT, typedHandler as EventListener);
    window.removeEventListener(LEGACY_BALANCE_REFRESH_EVENT, legacyHandler as EventListener);
  };
}

export function openTasksDialog() {
  dispatchTypedEvent(TASKS_OPEN_EVENT);
}

export function onTasksDialogOpen(listener: () => void): EventCleanup {
  return subscribeToTypedEvents(
    [TASKS_OPEN_EVENT, LEGACY_TASKS_OPEN_EVENT],
    () => listener(),
  );
}

export function openStakingDialog() {
  dispatchTypedEvent(STAKING_OPEN_EVENT);
}

export function onStakingDialogOpen(listener: () => void): EventCleanup {
  return subscribeToTypedEvents(
    [STAKING_OPEN_EVENT, LEGACY_STAKING_OPEN_EVENT],
    () => listener(),
  );
}
