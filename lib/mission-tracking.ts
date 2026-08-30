"use client";

import { requestBaseChatSessionRefresh } from "@/lib/base-chat-session-refresh";
import { getMiniAppQuickAuthHeaders } from "@/lib/farcaster-miniapp-auth-client";
import { sessionStorageManager } from "@/lib/session-storage-manager";

export type MissionTrackingPayload = Record<string, UntypedValue>;

export type MissionTrackingEventDetail = {
  message?: string;
  payload: MissionTrackingPayload;
  status: "error" | "queued" | "success";
};

type MissionOutboxEntry = {
  createdAt: number;
  id: string;
  payload: MissionTrackingPayload;
};

export const MISSION_TRACKING_EVENT = "pixotchi:mission-tracking";

const MISSION_OUTBOX_KEY = "pixotchi:mission-progress-outbox:v1";
const MISSION_OUTBOX_MAX_ENTRIES = 40;
const MISSION_OUTBOX_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const MISSION_RETRY_DELAYS_MS = [350, 900] as const;
const RETRYABLE_MISSION_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

let missionOutboxFlushPromise: Promise<void> | null = null;
let missionLifecycleListenersAttached = false;

export class MissionTrackingError extends Error {
  readonly retryable: boolean;
  readonly status: number | null;

  constructor(
    message: string,
    options: { retryable: boolean; status?: number | null },
  ) {
    super(message);
    this.name = "MissionTrackingError";
    this.retryable = options.retryable;
    this.status = options.status ?? null;
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function getExpectedAddress(payload: MissionTrackingPayload): string | null {
  return typeof payload.address === "string" && payload.address.trim()
    ? payload.address.trim().toLowerCase()
    : null;
}

function isRetrySafe(payload: MissionTrackingPayload): boolean {
  // Boolean mission flags are naturally idempotent on the server. Counted
  // progress is additive, so an ambiguous network failure must not be replayed
  // without server-side idempotency support.
  return typeof payload.count !== "number";
}

function getMissionOutboxId(payload: MissionTrackingPayload): string {
  const address = getExpectedAddress(payload) ?? "unknown";
  const taskId =
    typeof payload.taskId === "string" ? payload.taskId : "unknown";
  const proof = payload.proof as { txHash?: UntypedValue } | undefined;
  const txHash =
    typeof proof?.txHash === "string" ? proof.txHash.toLowerCase() : null;
  const day = new Date().toISOString().slice(0, 10);
  return `${address}:${taskId}:${txHash ?? day}`;
}

function emitMissionTrackingEvent(detail: MissionTrackingEventDetail): void {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<MissionTrackingEventDetail>(MISSION_TRACKING_EVENT, {
      detail,
    }),
  );
}

export function onMissionTrackingEvent(
  listener: (detail: MissionTrackingEventDetail) => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const handler = (event: Event) => {
    const detail = (event as CustomEvent<MissionTrackingEventDetail>).detail;
    if (detail) {
      listener(detail);
    }
  };

  window.addEventListener(MISSION_TRACKING_EVENT, handler as EventListener);
  return () =>
    window.removeEventListener(
      MISSION_TRACKING_EVENT,
      handler as EventListener,
    );
}

function readMissionOutbox(): MissionOutboxEntry[] {
  if (typeof window === "undefined") {
    return [];
  }

  try {
    const parsed = JSON.parse(
      window.localStorage.getItem(MISSION_OUTBOX_KEY) ?? "[]",
    );
    if (!Array.isArray(parsed)) {
      return [];
    }

    const now = Date.now();
    return parsed
      .filter((entry): entry is MissionOutboxEntry =>
        Boolean(
          entry &&
          typeof entry === "object" &&
          typeof entry.id === "string" &&
          typeof entry.createdAt === "number" &&
          entry.payload &&
          typeof entry.payload === "object" &&
          now - entry.createdAt <= MISSION_OUTBOX_MAX_AGE_MS,
        ),
      )
      .slice(-MISSION_OUTBOX_MAX_ENTRIES);
  } catch {
    return [];
  }
}

function writeMissionOutbox(entries: MissionOutboxEntry[]): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  try {
    window.localStorage.setItem(
      MISSION_OUTBOX_KEY,
      JSON.stringify(entries.slice(-MISSION_OUTBOX_MAX_ENTRIES)),
    );
    return true;
  } catch (error) {
    console.warn("[missions] Failed to persist retry queue:", error);
    return false;
  }
}

function enqueueMissionProgress(payload: MissionTrackingPayload): boolean {
  if (!isRetrySafe(payload)) {
    return false;
  }

  const id = getMissionOutboxId(payload);
  const existing = readMissionOutbox();
  const next = existing.filter((entry) => entry.id !== id);
  next.push({ createdAt: Date.now(), id, payload });
  return writeMissionOutbox(next);
}

function removeMissionOutboxEntry(payload: MissionTrackingPayload): void {
  const id = getMissionOutboxId(payload);
  removeMissionOutboxEntryById(id);
}

function removeMissionOutboxEntryById(id: string): void {
  const existing = readMissionOutbox();
  const next = existing.filter((entry) => entry.id !== id);
  if (next.length !== existing.length) {
    writeMissionOutbox(next);
  }
}

async function getMissionResponseError(response: Response): Promise<string> {
  try {
    const payload = await response.clone().json();
    if (typeof payload?.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  } catch {
    // Fall through to the HTTP status below.
  }

  return `Mission progress request failed (${response.status}).`;
}

async function postMissionRequest(
  payload: MissionTrackingPayload,
): Promise<Response> {
  const authHeaders = await getMiniAppQuickAuthHeaders({
    expectedAddress: getExpectedAddress(payload),
  });
  return fetch("/api/gamification/missions", {
    body: JSON.stringify(payload),
    cache: "no-store",
    credentials: "same-origin",
    headers: {
      "Content-Type": "application/json",
      ...authHeaders,
    },
    method: "POST",
  });
}

function canRecoverBaseMissionAuth(): boolean {
  if (typeof window === "undefined") {
    return false;
  }

  const surface = sessionStorageManager.getAuthSurface();
  return surface === "base" || surface === "test";
}

async function performMissionRequest(
  payload: MissionTrackingPayload,
): Promise<Response> {
  const retrySafe = isRetrySafe(payload);
  const maxAttempts = retrySafe ? MISSION_RETRY_DELAYS_MS.length + 1 : 1;
  let authRecoveryAttempted = false;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    let response: Response;
    try {
      response = await postMissionRequest(payload);
    } catch {
      if (attempt < maxAttempts - 1) {
        await delay(MISSION_RETRY_DELAYS_MS[attempt]);
        continue;
      }

      throw new MissionTrackingError(
        "Could not reach the task progress service.",
        {
          retryable: true,
        },
      );
    }

    if (response.ok) {
      return response;
    }

    if (
      response.status === 401 &&
      !authRecoveryAttempted &&
      canRecoverBaseMissionAuth()
    ) {
      authRecoveryAttempted = true;
      const recovery = await requestBaseChatSessionRefresh(
        "mission-auth-failure",
        15_000,
      );
      if (recovery.status === "success") {
        // Authentication failures occur before mutation, so this retry is safe
        // even for counted mission payloads.
        response = await postMissionRequest(payload);
        if (response.ok) {
          return response;
        }
      }
    }

    if (
      retrySafe &&
      RETRYABLE_MISSION_STATUSES.has(response.status) &&
      attempt < maxAttempts - 1
    ) {
      await delay(MISSION_RETRY_DELAYS_MS[attempt]);
      continue;
    }

    return response;
  }

  throw new MissionTrackingError("Mission progress could not be synced.", {
    retryable: true,
  });
}

function ensureMissionLifecycleListeners(): void {
  if (typeof window === "undefined" || missionLifecycleListenersAttached) {
    return;
  }

  missionLifecycleListenersAttached = true;
  window.addEventListener("online", () => {
    void flushMissionProgressOutbox();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") {
      void flushMissionProgressOutbox();
    }
  });
}

export function flushMissionProgressOutbox(): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.resolve();
  }
  ensureMissionLifecycleListeners();
  if (missionOutboxFlushPromise) {
    return missionOutboxFlushPromise;
  }

  missionOutboxFlushPromise = (async () => {
    const entries = readMissionOutbox();
    for (const entry of entries) {
      try {
        const response = await performMissionRequest(entry.payload);
        if (!response.ok) {
          if (
            !RETRYABLE_MISSION_STATUSES.has(response.status) &&
            response.status !== 401
          ) {
            removeMissionOutboxEntryById(entry.id);
            emitMissionTrackingEvent({
              message: await getMissionResponseError(response),
              payload: entry.payload,
              status: "error",
            });
          }
          continue;
        }

        removeMissionOutboxEntryById(entry.id);
        emitMissionTrackingEvent({ payload: entry.payload, status: "success" });
      } catch {
        // Keep retry-safe entries for the next online/visible transition.
      }
    }
  })().finally(() => {
    missionOutboxFlushPromise = null;
  });

  return missionOutboxFlushPromise;
}

export async function postMissionProgress(
  payload: MissionTrackingPayload,
): Promise<Response> {
  ensureMissionLifecycleListeners();

  try {
    const response = await performMissionRequest(payload);
    if (!response.ok) {
      const message = await getMissionResponseError(response);
      throw new MissionTrackingError(message, {
        retryable:
          RETRYABLE_MISSION_STATUSES.has(response.status) ||
          response.status === 401,
        status: response.status,
      });
    }

    removeMissionOutboxEntry(payload);
    emitMissionTrackingEvent({ payload, status: "success" });
    // Successful foreground work is a good opportunity to drain older safe
    // entries without delaying the caller's transaction-success path.
    void flushMissionProgressOutbox();
    return response;
  } catch (error) {
    const missionError =
      error instanceof MissionTrackingError
        ? error
        : new MissionTrackingError("Mission progress could not be synced.", {
            retryable: true,
          });
    const queued = missionError.retryable && enqueueMissionProgress(payload);
    const message = queued
      ? "Task progress is queued and will retry automatically."
      : missionError.message;

    emitMissionTrackingEvent({
      message,
      payload,
      status: queued ? "queued" : "error",
    });

    if (queued) {
      return new Response(JSON.stringify({ queued: true, success: false }), {
        headers: { "Content-Type": "application/json" },
        status: 202,
      });
    }

    throw missionError;
  }
}
