import { NextResponse } from "next/server";

import packageJson from "@/package.json";
import { CLIENT_ENV } from "@/lib/env-config";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  return NextResponse.json(
    {
      buildId: CLIENT_ENV.APP_BUILD_ID,
      version: packageJson.version,
      environment: process.env.VERCEL_ENV || process.env.NODE_ENV || "development",
    },
    {
      headers: {
        "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
        Pragma: "no-cache",
        Expires: "0",
      },
    },
  );
}
