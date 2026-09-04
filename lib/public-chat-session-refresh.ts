"use client";

export type PublicChatSessionRefreshSurface =
  | "privy"
  | "privysolana"
  | "farcaster";

export type PublicChatSessionRefreshRequest = {
  expectedAddress: string;
  reason: "mission-auth-failure";
  requestId: string;
  surface: PublicChatSessionRefreshSurface;
};

export type PublicChatSessionRefreshResult = {
  message?: string;
  requestId: string;
  status: "error" | "ignored" | "success";
};

export const PUBLIC_CHAT_SESSION_REFRESH_REQUEST_EVENT =
  "pixotchi:public-chat-session-refresh-request";
export const PUBLIC_CHAT_SESSION_REFRESH_RESULT_EVENT =
  "pixotchi:public-chat-session-refresh-result";

const DEFAULT_REFRESH_TIMEOUT_MS = 15_000;

function generateRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }

  return `public-chat-refresh-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export function emitPublicChatSessionRefreshResult(
  detail: PublicChatSessionRefreshResult,
): void {
  if (typeof window === "undefined") return;

  window.dispatchEvent(
    new CustomEvent<PublicChatSessionRefreshResult>(
      PUBLIC_CHAT_SESSION_REFRESH_RESULT_EVENT,
      { detail },
    ),
  );
}

export function requestPublicChatSessionRefresh(
  request: Omit<PublicChatSessionRefreshRequest, "requestId">,
  timeoutMs: number = DEFAULT_REFRESH_TIMEOUT_MS,
): Promise<PublicChatSessionRefreshResult> {
  if (typeof window === "undefined") {
    return Promise.resolve({
      message: "Chat session refresh is unavailable during SSR.",
      requestId: "server",
      status: "ignored",
    });
  }

  const requestId = generateRequestId();
  return new Promise((resolve) => {
    let settled = false;

    const finalize = (result: PublicChatSessionRefreshResult) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener(
        PUBLIC_CHAT_SESSION_REFRESH_RESULT_EVENT,
        handleResult as EventListener,
      );
      resolve(result);
    };

    const handleResult = (event: Event) => {
      const detail = (event as CustomEvent<PublicChatSessionRefreshResult>).detail;
      if (!detail || detail.requestId !== requestId) return;
      finalize(detail);
    };

    const timeoutId = window.setTimeout(() => {
      finalize({
        message: "Timed out while restoring the secure session.",
        requestId,
        status: "error",
      });
    }, timeoutMs);

    window.addEventListener(
      PUBLIC_CHAT_SESSION_REFRESH_RESULT_EVENT,
      handleResult as EventListener,
    );
    window.dispatchEvent(
      new CustomEvent<PublicChatSessionRefreshRequest>(
        PUBLIC_CHAT_SESSION_REFRESH_REQUEST_EVENT,
        { detail: { ...request, requestId } },
      ),
    );
  });
}
