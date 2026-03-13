import { NextRequest, NextResponse } from 'next/server';
import { validateAdminKey } from './auth-utils';

function isProductionDeployment(): boolean {
  const vercelEnv = process.env.VERCEL_ENV;
  if (vercelEnv) {
    return vercelEnv === 'production';
  }
  return process.env.NODE_ENV === 'production';
}

export function requireBridgeDebugAccess(request: NextRequest): NextResponse | null {
  if (process.env.BRIDGE_DEBUG_PUBLIC_ENABLED === 'true') {
    return null;
  }

  if (!isProductionDeployment()) {
    return null;
  }

  if (validateAdminKey(request)) {
    return null;
  }

  return NextResponse.json(
    {
      success: false,
      error: 'Bridge diagnostics are restricted in production',
      code: 'BRIDGE_DEBUG_AUTH_REQUIRED',
      timestamp: new Date().toISOString(),
    },
    { status: 401 },
  );
}
