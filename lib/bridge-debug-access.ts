import { NextRequest, NextResponse } from 'next/server';
import { requireAdmin } from './auth-utils';
import { enforceRateLimit, getRequestIp } from './request-rate-limit';

function isLocalhostRequest(request: NextRequest): boolean {
  const hostname = request.nextUrl.hostname.toLowerCase();
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1' || hostname === '[::1]';
}

export async function requireBridgeDebugAccess(request: NextRequest): Promise<NextResponse | null> {
  const rateLimitResponse = await enforceRateLimit(request, {
    scope: 'api:bridge-debug',
    rules: [
      {
        kind: 'ip',
        identifier: getRequestIp(request),
        limit: 30,
        windowSeconds: 60,
      },
    ],
  });

  if (rateLimitResponse) {
    return rateLimitResponse;
  }

  if (isLocalhostRequest(request)) {
    return null;
  }

  const adminDenied = await requireAdmin(request);
  if (adminDenied) {
    return NextResponse.json(
      {
        success: false,
        error: 'Bridge diagnostics are restricted outside localhost',
        code: 'BRIDGE_DEBUG_AUTH_REQUIRED',
        timestamp: new Date().toISOString(),
      },
      { status: adminDenied.status },
    );
  }

  return null;
}
