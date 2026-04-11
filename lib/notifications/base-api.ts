import { CLIENT_ENV, SERVER_ENV } from '@/lib/env-config';
import {
  BASE_NOTIFICATIONS_API_BASE_URL,
  BASE_REQUEST_INTERVAL_MS,
  BASE_SEND_BATCH_SIZE,
} from '@/lib/notifications/constants';
import { chunkArray, normalizeTargetPath, sleep, uniqueWalletAddresses } from '@/lib/notifications/utils';

export type BaseNotificationUser = {
  address: string;
  notificationsEnabled: boolean;
};

export type BaseNotificationUsersPage = {
  users: BaseNotificationUser[];
  nextCursor: string | null;
  raw: unknown;
};

export type BaseNotificationSendResult = {
  walletAddress: string;
  sent: boolean;
  failureReason?: string | null;
};

export type BaseNotificationSendResponse = {
  success: boolean;
  sentCount: number;
  failedCount: number;
  results: BaseNotificationSendResult[];
  raw: unknown;
};

export type BaseNotificationBatchResult = {
  batchIndex: number;
  requestedCount: number;
  response: BaseNotificationSendResponse;
};

export type BaseNotificationChunkedSendResponse = {
  success: boolean;
  totalRequested: number;
  sentCount: number;
  failedCount: number;
  batches: BaseNotificationBatchResult[];
  failures: BaseNotificationSendResult[];
};

type BaseFetchUsersOptions = {
  cursor?: string | null;
  limit?: number;
  notificationEnabled?: boolean;
};

type BaseSendOptions = {
  addresses: string[];
  title: string;
  message: string;
  targetPath?: string;
};

type BaseChunkedSendOptions = BaseSendOptions & {
  pacingMs?: number;
  onBatchComplete?: (result: BaseNotificationBatchResult) => Promise<void> | void;
};

function getBaseNotificationsApiKey(): string | null {
  const raw = SERVER_ENV.BASE_NOTIFICATIONS_API_KEY;
  return raw?.trim() ? raw.trim() : null;
}

function getBaseHeaders(): HeadersInit {
  const apiKey = getBaseNotificationsApiKey();
  if (!apiKey) {
    throw new Error('Base notifications API key missing');
  }

  return {
    accept: 'application/json',
    'content-type': 'application/json',
    'x-api-key': apiKey,
  };
}

async function parseJsonSafe(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildBaseApiError(status: number, payload: unknown, fallback: string): Error {
  const message =
    (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string' && payload.error) ||
    (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string' && payload.message) ||
    fallback;

  const error = new Error(`Base notifications API error (${status}): ${message}`);
  (error as Error & { status?: number; payload?: unknown }).status = status;
  (error as Error & { status?: number; payload?: unknown }).payload = payload;
  return error;
}

export function isBaseNotificationsConfigured(): boolean {
  return Boolean(getBaseNotificationsApiKey() && CLIENT_ENV.APP_URL);
}

export async function fetchBaseNotificationUsers(
  options: BaseFetchUsersOptions = {},
): Promise<BaseNotificationUsersPage> {
  const url = new URL(`${BASE_NOTIFICATIONS_API_BASE_URL}/app/users`);
  url.searchParams.set('app_url', CLIENT_ENV.APP_URL);
  url.searchParams.set('notification_enabled', String(options.notificationEnabled ?? true));
  url.searchParams.set('limit', String(options.limit ?? 100));
  if (options.cursor) {
    url.searchParams.set('cursor', options.cursor);
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: getBaseHeaders(),
    cache: 'no-store',
  });
  const payload = await parseJsonSafe(response);

  if (!response.ok) {
    throw buildBaseApiError(response.status, payload, 'Failed to fetch Base notification users');
  }

  const rawUsers =
    payload && typeof payload === 'object' && 'users' in payload && Array.isArray(payload.users)
      ? payload.users
      : [];

  const users: BaseNotificationUser[] = rawUsers
    .map((entry) => {
      if (!entry || typeof entry !== 'object') {
        return null;
      }

      const address = 'address' in entry && typeof entry.address === 'string' ? entry.address : null;
      const notificationsEnabled =
        'notificationsEnabled' in entry && typeof entry.notificationsEnabled === 'boolean'
          ? entry.notificationsEnabled
          : false;

      if (!address) {
        return null;
      }

      return { address, notificationsEnabled };
    })
    .filter((entry): entry is BaseNotificationUser => entry !== null);

  const nextCursor =
    payload && typeof payload === 'object' && 'nextCursor' in payload && typeof payload.nextCursor === 'string'
      ? payload.nextCursor
      : null;

  return { users, nextCursor, raw: payload };
}

export async function sendBaseNotificationBatch(
  options: BaseSendOptions,
): Promise<BaseNotificationSendResponse> {
  const addresses = uniqueWalletAddresses(options.addresses);
  if (addresses.length === 0) {
    return {
      success: true,
      sentCount: 0,
      failedCount: 0,
      results: [],
      raw: null,
    };
  }

  const response = await fetch(`${BASE_NOTIFICATIONS_API_BASE_URL}/send`, {
    method: 'POST',
    headers: getBaseHeaders(),
    cache: 'no-store',
    body: JSON.stringify({
      app_url: CLIENT_ENV.APP_URL,
      wallet_addresses: addresses,
      title: options.title,
      message: options.message,
      ...(normalizeTargetPath(options.targetPath) ? { target_path: normalizeTargetPath(options.targetPath) } : {}),
    }),
  });
  const payload = await parseJsonSafe(response);

  if (!response.ok) {
    throw buildBaseApiError(response.status, payload, 'Failed to send Base notifications');
  }

  const rawResults =
    payload && typeof payload === 'object' && 'results' in payload && Array.isArray(payload.results)
      ? payload.results
      : [];

  const results: BaseNotificationSendResult[] = [];
  for (const entry of rawResults) {
    if (!entry || typeof entry !== 'object') {
      continue;
    }

    const walletAddress =
      'walletAddress' in entry && typeof entry.walletAddress === 'string' ? entry.walletAddress : null;
    const sent = 'sent' in entry && typeof entry.sent === 'boolean' ? entry.sent : false;
    const failureReason =
      'failureReason' in entry && typeof entry.failureReason === 'string' ? entry.failureReason : undefined;

    if (!walletAddress) {
      continue;
    }

    results.push({ walletAddress, sent, failureReason });
  }

  const sentCount =
    payload && typeof payload === 'object' && 'sentCount' in payload && typeof payload.sentCount === 'number'
      ? payload.sentCount
      : results.filter((entry) => entry.sent).length;
  const failedCount =
    payload && typeof payload === 'object' && 'failedCount' in payload && typeof payload.failedCount === 'number'
      ? payload.failedCount
      : results.filter((entry) => !entry.sent).length;
  const success =
    payload && typeof payload === 'object' && 'success' in payload && typeof payload.success === 'boolean'
      ? payload.success
      : failedCount === 0;

  return {
    success,
    sentCount,
    failedCount,
    results,
    raw: payload,
  };
}

export async function sendBaseNotificationsInChunks(
  options: BaseChunkedSendOptions,
): Promise<BaseNotificationChunkedSendResponse> {
  const addresses = uniqueWalletAddresses(options.addresses);
  const batches = chunkArray(addresses, BASE_SEND_BATCH_SIZE);
  const pacingMs = options.pacingMs ?? BASE_REQUEST_INTERVAL_MS;

  const results: BaseNotificationBatchResult[] = [];
  const failures: BaseNotificationSendResult[] = [];
  let sentCount = 0;
  let failedCount = 0;

  for (let index = 0; index < batches.length; index += 1) {
    if (index > 0 && pacingMs > 0) {
      await sleep(pacingMs);
    }

    let response: BaseNotificationSendResponse;
    try {
      response = await sendBaseNotificationBatch({
        addresses: batches[index] || [],
        title: options.title,
        message: options.message,
        targetPath: options.targetPath,
      });
    } catch (error) {
      const status = typeof error === 'object' && error && 'status' in error ? (error as { status?: number }).status : undefined;
      if (status !== 429) {
        throw error;
      }

      await sleep(pacingMs * 2);
      response = await sendBaseNotificationBatch({
        addresses: batches[index] || [],
        title: options.title,
        message: options.message,
        targetPath: options.targetPath,
      });
    }

    results.push({
      batchIndex: index,
      requestedCount: (batches[index] || []).length,
      response,
    });
    if (options.onBatchComplete) {
      await options.onBatchComplete(results[results.length - 1]!);
    }

    sentCount += response.sentCount;
    failedCount += response.failedCount;
    failures.push(...response.results.filter((entry) => !entry.sent));
  }

  return {
    success: failedCount === 0,
    totalRequested: addresses.length,
    sentCount,
    failedCount,
    batches: results,
    failures,
  };
}
