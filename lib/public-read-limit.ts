import type { NextRequest } from 'next/server';
import { enforceRateLimit, getRequestIp } from './request-rate-limit';

/** Shared by public server-side reads, which do not pass through /api/rpc. */
export function enforcePublicReadLimit(request: NextRequest, cost = 1) {
  return enforceRateLimit(request, {
    scope: 'api:public-chain-read',
    cost,
    failClosed: true,
    rules: [
      { kind: 'ip', identifier: getRequestIp(request) ?? 'unknown', limit: 300, windowSeconds: 60 },
      { kind: 'global', limit: 12_000, windowSeconds: 60 },
    ],
  });
}
