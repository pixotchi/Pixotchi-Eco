import type { BaseNotificationSendResponse } from './base-api';

export class BaseNotificationOutcomeUnknownError extends Error {
  readonly status = 502; // Ambiguous delivery must not trigger the automatic 429/503 retry path.
  constructor() { super('Base returned an invalid or incomplete notification delivery result.'); }
}

/** A successful HTTP status is not evidence that a notification was delivered. */
export function parseBaseNotificationOutcome(payload: unknown, requestedAddresses: string[]): BaseNotificationSendResponse {
  const invalid = () => { throw new BaseNotificationOutcomeUnknownError(); };
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return invalid();
  const record = payload as Record<string, unknown>;
  const expected = new Set(requestedAddresses.map(address => address.toLowerCase()));
  const results: BaseNotificationSendResponse['results'] = [];
  if (record.success !== undefined && typeof record.success !== 'boolean') return invalid();
  if (record.results !== undefined) {
    if (!Array.isArray(record.results)) return invalid();
    const seen = new Set<string>();
    for (const raw of record.results) {
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return invalid();
      const entry = raw as Record<string, unknown>;
      if (typeof entry.walletAddress !== 'string' || typeof entry.sent !== 'boolean') return invalid();
      const walletAddress = entry.walletAddress.toLowerCase();
      if (!expected.has(walletAddress) || seen.has(walletAddress)) return invalid();
      if (entry.failureReason != null && typeof entry.failureReason !== 'string') return invalid();
      seen.add(walletAddress);
      results.push({ walletAddress, sent: entry.sent, failureReason: entry.failureReason as string | null | undefined });
    }
    if (results.length > 0 && seen.size !== expected.size) return invalid();
  }
  const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
  const sentCount = record.sentCount ?? (results.length ? results.filter(entry => entry.sent).length : undefined);
  const failedCount = record.failedCount ?? (results.length ? results.filter(entry => !entry.sent).length : undefined);
  if (!isCount(sentCount) || !isCount(failedCount) || sentCount + failedCount !== expected.size) return invalid();
  if (results.length && (results.filter(entry => entry.sent).length !== sentCount || results.filter(entry => !entry.sent).length !== failedCount)) return invalid();
  return { success: failedCount === 0, sentCount, failedCount, results, raw: payload };
}

export function confirmedBaseRecipients(response: BaseNotificationSendResponse, requestedAddresses: string[]): string[] {
  const expected = new Set(requestedAddresses.map(address => address.toLowerCase()));
  if (response.results.length) return response.results.filter(entry => entry.sent && expected.has(entry.walletAddress.toLowerCase())).map(entry => entry.walletAddress.toLowerCase());
  return response.success && response.failedCount === 0 && response.sentCount === expected.size ? [...expected] : [];
}
