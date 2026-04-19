import { NextResponse } from "next/server";
import { getPrivyChatAuthConfigStatus } from "@/lib/env-config";

const HEALTH_RESPONSE = {
  service: "pixotchi-app",
};

const HEALTH_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

function getHealthStatus() {
  const privyChatAuth = getPrivyChatAuthConfigStatus();

  return {
    ok: privyChatAuth.ready,
    checks: {
      privyChatAuth: {
        ok: privyChatAuth.ready,
        ...(privyChatAuth.missing.length > 0 ? { missing: privyChatAuth.missing } : {}),
        ...(privyChatAuth.warnings.length > 0 ? { warnings: privyChatAuth.warnings } : {}),
      },
    },
  };
}

export function GET() {
  const status = getHealthStatus();

  return NextResponse.json(
    {
      ...HEALTH_RESPONSE,
      ...status,
      timestamp: new Date().toISOString(),
    },
    {
      headers: HEALTH_HEADERS,
      status: status.ok ? 200 : 503,
    },
  );
}

export function HEAD() {
  const status = getHealthStatus();

  return new NextResponse(null, {
    status: status.ok ? 200 : 503,
    headers: HEALTH_HEADERS,
  });
}
