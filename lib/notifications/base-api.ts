import { CLIENT_ENV, SERVER_ENV } from '@/lib/env-config';
import {
  BASE_NOTIFICATIONS_API_BASE_URL,
  BASE_REQUEST_INTERVAL_MS,
  BASE_SEND_BATCH_SIZE,
} from '@/lib/notifications/constants';
import { pruneBaseAudienceAddressesFromCurrentSnapshot } from '@/lib/notifications/storage';
import { chunkArray, normalizeTargetPath, sleep, uniqueWalletAddresses } from '@/lib/notifications/utils';

export type BaseNotificationUser = {
  address: string;
  notificationsEnabled: boolean;
};

export type BaseNotificationUsersPage = {
  users: BaseNotificationUser[];
  nextCursor: string | null;
  raw: UntypedValue;
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
  raw: UntypedValue;
};

export type BaseNotificationBatchResult = {
  batchIndex: number;
  requestedCount: number;
  requestedAddresses: string[];
  response: BaseNotificationSendResponse;
};

export type BaseNotificationChunkedSendResponse = {
  success: boolean;
  totalRequested: number;
  sentCount: number;
  failedCount: number;
  batches: BaseNotificationBatchResult[];
  failures: BaseNotificationSendResult[];
  prunedSnapshotAddresses: string[];
  prunedSnapshotCount: number;
  prunedSnapshotRemainingCount: number;
  prunedSnapshotId: string | null;
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

export type BaseNotificationChunkedSendError = Error & {
  partialResponse?: BaseNotificationChunkedSendResponse;
  status?: number;
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

async function parseJsonSafe(response: Response): Promise<UntypedValue> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildBaseApiError(status: number, payload: UntypedValue, fallback: string): Error {
  const message =
    (payload && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string' && payload.error) ||
    (payload && typeof payload === 'object' && 'message' in payload && typeof payload.message === 'string' && payload.message) ||
    fallback;

  const error = new Error(`Base notifications API error (${status}): ${message}`);
  (error as Error & { status?: number; payload?: UntypedValue }).status = status;
  (error as Error & { status?: number; payload?: UntypedValue }).payload = payload;
  return error;
}

function getRetryDelayMs(attempt: number, pacingMs: number): number {
  return pacingMs * Math.max(2, attempt + 2);
}

function isRetryableBaseSendStatus(status?: number): boolean {
  return status === 429 || status === 503;
}

function shouldPruneBaseFailureReason(failureReason?: string | null): boolean {
  const normalized = String(failureReason || '').trim().toLowerCase();
  return normalized === 'user has not saved this app' || normalized === 'user has notifications disabled';
}

async function finalizePrunedSnapshot(prunableAddresses: Set<string>) {
  const prunedSnapshotAddresses = Array.from(prunableAddresses);
  const pruneResult = await pruneBaseAudienceAddressesFromCurrentSnapshot(prunedSnapshotAddresses);
  return {
    prunedSnapshotAddresses,
    prunedSnapshotCount: pruneResult.removedCount,
    prunedSnapshotRemainingCount: pruneResult.remainingCount,
    prunedSnapshotId: pruneResult.snapshotId,
  };
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

  const rawUsers: UntypedValue[] =
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
  const targetPath = normalizeTargetPath(options.targetPath);
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
      ...(targetPath ? { target_path: targetPath } : {}),
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
  const prunableAddresses = new Set<string>();
  let sentCount = 0;
  let failedCount = 0;

  for (let index = 0; index < batches.length; index += 1) {
    if (index > 0 && pacingMs > 0) {
      await sleep(pacingMs);
    }

    let response: BaseNotificationSendResponse | null = null;
    let lastError: UntypedValue = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        response = await sendBaseNotificationBatch({
          addresses: batches[index] || [],
          title: options.title,
          message: options.message,
          targetPath: options.targetPath,
        });
        lastError = null;
        break;
      } catch (error) {
        lastError = error;
        const status =
          typeof error === 'object' && error && 'status' in error ? (error as { status?: number }).status : undefined;

        if (!isRetryableBaseSendStatus(status) || attempt === 2) {
          const pruneSummary = await finalizePrunedSnapshot(prunableAddresses);
          const partialResponse: BaseNotificationChunkedSendResponse = {
            success: false,
            totalRequested: addresses.length,
            sentCount,
            failedCount,
            batches: results,
            failures,
            ...pruneSummary,
          };
          const enrichedError = (error instanceof Error ? error : new Error('Base notification send failed')) as BaseNotificationChunkedSendError;
          enrichedError.partialResponse = partialResponse;
          enrichedError.status = status;
          throw enrichedError;
        }

        await sleep(getRetryDelayMs(attempt, pacingMs));
      }
    }

    if (!response) {
      throw lastError instanceof Error ? lastError : new Error('Base notification send failed');
    }

    results.push({
      batchIndex: index,
      requestedCount: (batches[index] || []).length,
      requestedAddresses: batches[index] || [],
      response,
    });
    if (options.onBatchComplete) {
      await options.onBatchComplete(results[results.length - 1]!);
    }

    sentCount += response.sentCount;
    failedCount += response.failedCount;
    failures.push(...response.results.filter((entry) => !entry.sent));
    for (const failure of response.results) {
      if (!failure.sent && shouldPruneBaseFailureReason(failure.failureReason)) {
        prunableAddresses.add(failure.walletAddress.toLowerCase());
      }
    }
  }

  const pruneSummary = await finalizePrunedSnapshot(prunableAddresses);

  return {
    success: failedCount === 0,
    totalRequested: addresses.length,
    sentCount,
    failedCount,
    batches: results,
    failures,
    ...pruneSummary,
  };
}
