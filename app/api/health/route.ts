import { NextResponse } from "next/server";

const HEALTH_RESPONSE = {
  ok: true,
  service: "pixotchi-app",
};

const HEALTH_HEADERS = {
  "Cache-Control": "no-store, no-cache, must-revalidate",
};

export function GET() {
  return NextResponse.json(
    {
      ...HEALTH_RESPONSE,
      timestamp: new Date().toISOString(),
    },
    {
      headers: HEALTH_HEADERS,
    },
  );
}

export function HEAD() {
  return new NextResponse(null, {
    status: 200,
    headers: HEALTH_HEADERS,
  });
}
