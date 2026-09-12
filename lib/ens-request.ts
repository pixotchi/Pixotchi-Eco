import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';
import { abortable } from './abortable';
import { ENS_LOOKUP_BATCH_SIZE, ENS_LOOKUP_MAX_BODY_BYTES, ENS_LOOKUP_TIMEOUT_MS } from './ens-lookup-policy';
import { readLimitedJson, RequestBodyError } from './request-body';
import { enforceRateLimit, getRequestIp } from './request-rate-limit';

export function createEnsLookupHandler(
  responseKey: 'names' | 'avatars',
  resolve: (addresses: string[], signal: AbortSignal) => Promise<Record<string, string | null>>,
) {
  return async function POST(request: NextRequest) {
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(ENS_LOOKUP_TIMEOUT_MS)]);
    try {
      const body = await readLimitedJson(request, ENS_LOOKUP_MAX_BODY_BYTES, signal);
      const addresses = body && typeof body === 'object' && 'addresses' in body ? body.addresses : null;
      if (!Array.isArray(addresses) || addresses.length === 0) {
        throw new RequestBodyError('addresses must be a non-empty array', 400);
      }
      if (addresses.length > ENS_LOOKUP_BATCH_SIZE) {
        throw new RequestBodyError(`At most ${ENS_LOOKUP_BATCH_SIZE} addresses are allowed.`, 413);
      }
      if (!addresses.every((address): address is string => typeof address === 'string' && isAddress(address))) {
        throw new RequestBodyError('Every address must be a valid Ethereum address.', 400);
      }
      const unique = [...new Set(addresses.map(address => address.toLowerCase()))];
      // Both routes share budgets. Missing or spoofed IP headers cannot bypass
      // the global quota; Redis failure cannot turn off protection.
      const denied = await abortable(enforceRateLimit(request, {
        scope: 'api:ens', failClosed: true, cost: unique.length,
        rules: [
          { kind: 'global', limit: 1200, windowSeconds: 60 },
          { kind: 'ip', identifier: getRequestIp(request) || 'unknown', limit: 300, windowSeconds: 60 },
        ],
      }), signal);
      if (denied) return denied;
      signal.throwIfAborted();
      const values = await abortable(resolve(unique, signal), signal);
      return NextResponse.json({ success: true, [responseKey]: values }, { headers: { 'Cache-Control': 'private, no-store' } });
    } catch (error) {
      const status = error instanceof RequestBodyError ? error.status : signal.aborted ? 504 : 503;
      return NextResponse.json({ success: false, error: error instanceof RequestBodyError ? error.message : 'Identity lookup is temporarily unavailable.' }, {
        status, headers: { 'Cache-Control': 'private, no-store' },
      });
    }
  };
}
