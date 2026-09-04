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

  // A production process is often bound to localhost behind a reverse proxy.
  // Do not treat that server-side bind address as proof that the caller is
  // local; production diagnostics always require admin authentication.
  if (process.env.NODE_ENV !== 'production' && isLocalhostRequest(request)) {
    return null;
  }

  const adminDenied = await requireAdmin(request);
  if (adminDenied) {
    return NextResponse.json(
      {
        success: false,
        error: 'Bridge diagnostics require admin authentication in production or outside localhost',
        code: 'BRIDGE_DEBUG_AUTH_REQUIRED',
        timestamp: new Date().toISOString(),
      },
      { status: adminDenied.status },
    );
  }

  return null;
}
