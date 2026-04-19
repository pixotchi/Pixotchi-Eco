"use client";

export type BaseChatSessionRefreshReason =
  | 'chat-auth-failure'
  | 'mission-auth-failure'
  | 'session-validation';

export type BaseChatSessionRefreshRequest = {
  reason: BaseChatSessionRefreshReason;
  requestId: string;
};

export type BaseChatSessionRefreshResult = {
  message?: string;
  requestId: string;
  status: 'error' | 'ignored' | 'success';
};

export const BASE_CHAT_SESSION_REFRESH_REQUEST_EVENT =
  'pixotchi:base-chat-session-refresh-request';
export const BASE_CHAT_SESSION_REFRESH_RESULT_EVENT =
  'pixotchi:base-chat-session-refresh-result';

const DEFAULT_REFRESH_TIMEOUT_MS = 45_000;

function generateRequestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `base-chat-refresh-${Date.now()}-${Math.random()
    .toString(16)
    .slice(2)}`;
}

export function emitBaseChatSessionRefreshResult(
  detail: BaseChatSessionRefreshResult,
): void {
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(
    new CustomEvent<BaseChatSessionRefreshResult>(
      BASE_CHAT_SESSION_REFRESH_RESULT_EVENT,
      { detail },
    ),
  );
}

export function requestBaseChatSessionRefresh(
  reason: BaseChatSessionRefreshReason,
  timeoutMs: number = DEFAULT_REFRESH_TIMEOUT_MS,
): Promise<BaseChatSessionRefreshResult> {
  if (typeof window === 'undefined') {
    return Promise.resolve({
      message: 'Base chat session refresh is unavailable during SSR.',
      requestId: 'server',
      status: 'ignored',
    });
  }

  const requestId = generateRequestId();

  return new Promise((resolve) => {
    let settled = false;

    const finalize = (result: BaseChatSessionRefreshResult) => {
      if (settled) {
        return;
      }

      settled = true;
      window.clearTimeout(timeoutId);
      window.removeEventListener(
        BASE_CHAT_SESSION_REFRESH_RESULT_EVENT,
        handleResult as EventListener,
      );
      resolve(result);
    };

    const handleResult = (event: Event) => {
      const detail = (
        event as CustomEvent<BaseChatSessionRefreshResult>
      ).detail;

      if (!detail || detail.requestId !== requestId) {
        return;
      }

      finalize(detail);
    };

    const timeoutId = window.setTimeout(() => {
      finalize({
        message: 'Timed out while refreshing the Base chat session.',
        requestId,
        status: 'error',
      });
    }, timeoutMs);

    window.addEventListener(
      BASE_CHAT_SESSION_REFRESH_RESULT_EVENT,
      handleResult as EventListener,
    );

    window.dispatchEvent(
      new CustomEvent<BaseChatSessionRefreshRequest>(
        BASE_CHAT_SESSION_REFRESH_REQUEST_EVENT,
        {
          detail: {
            reason,
            requestId,
          },
        },
      ),
    );
  });
}
