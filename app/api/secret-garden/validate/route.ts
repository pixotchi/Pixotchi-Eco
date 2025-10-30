export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SECRET_GARDEN_TOKEN_COOKIE,
  verifyUnlockToken,
  signTokenForCookie,
} from "@/lib/secret-garden";

type ValidateResponse = { valid: boolean };

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { token?: string } | null;
    const token = body?.token;

    if (!token || typeof token !== "string") {
      return NextResponse.json({ valid: false }, { status: 400 });
    }

    if (!verifyUnlockToken(token)) {
      return NextResponse.json({ valid: false }, { status: 403 });
    }

    const cookieStore = await cookies();
    const storedSignature = cookieStore.get(SECRET_GARDEN_TOKEN_COOKIE)?.value;
    if (!storedSignature) {
      return NextResponse.json({ valid: false }, { status: 403 });
    }

    if (signTokenForCookie(token) !== storedSignature) {
      return NextResponse.json({ valid: false }, { status: 403 });
    }

    cookieStore.delete(SECRET_GARDEN_TOKEN_COOKIE);

    const response: ValidateResponse = { valid: true };
    return NextResponse.json(response);
  } catch (error) {
    console.error("[SecretGarden] Failed to validate token", error);
    return NextResponse.json(
      { valid: false, message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

