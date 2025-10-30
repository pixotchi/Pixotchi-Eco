export const runtime = "nodejs";

import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  SECRET_GARDEN_PROGRESS_COOKIE,
  SECRET_GARDEN_TOKEN_COOKIE,
  createUnlockToken,
  getSecretGardenSequence,
  parseProgressCookie,
  serializeProgressCookie,
} from "@/lib/secret-garden";
import { THEMES } from "@/lib/theme-utils";

type ProgressResponse =
  | { status: "progress"; remaining: number }
  | { status: "reset"; remaining: number }
  | { status: "unlock"; remaining: number; token: string };

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => null) as { theme?: string } | null;

    const theme = body?.theme?.toLowerCase?.();
    if (!theme || !Object.prototype.hasOwnProperty.call(THEMES, theme)) {
      return NextResponse.json({ error: "invalid theme" }, { status: 400 });
    }

    const sequence = getSecretGardenSequence();
    const cookieStore = await cookies();
    const now = Date.now();

    const progressCookie = cookieStore.get(SECRET_GARDEN_PROGRESS_COOKIE)?.value;
    const { progress: storedProgress, expired } = parseProgressCookie(progressCookie, now);
    const currentProgress = expired ? 0 : storedProgress;

    const expectedTheme = sequence[currentProgress];
    let nextProgress = currentProgress;
    let response: ProgressResponse = {
      status: "reset",
      remaining: sequence.length,
    };

    const matchesExpected = expectedTheme === theme;
    const matchesReset = sequence[0] === theme;

    if (matchesExpected) {
      nextProgress += 1;
    } else if (matchesReset) {
      nextProgress = 1;
    } else {
      nextProgress = 0;
    }

    if (nextProgress >= sequence.length) {
      const { token, signature, maxAge } = createUnlockToken(now);
      cookieStore.delete(SECRET_GARDEN_PROGRESS_COOKIE);
      cookieStore.set(SECRET_GARDEN_TOKEN_COOKIE, signature, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge,
        path: "/",
      });

      response = {
        status: "unlock",
        remaining: 0,
        token,
      };
    } else if (nextProgress > 0) {
      const { value, maxAge } = serializeProgressCookie(nextProgress, now);
      cookieStore.set(SECRET_GARDEN_PROGRESS_COOKIE, value, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        maxAge,
        path: "/",
      });

      response = {
        status: "progress",
        remaining: sequence.length - nextProgress,
      };
    } else {
      cookieStore.delete(SECRET_GARDEN_PROGRESS_COOKIE);

      response = {
        status: "reset",
        remaining: sequence.length,
      };
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("[SecretGarden] Failed to process progress request", error);
    return NextResponse.json(
      { error: "server error", message: error instanceof Error ? error.message : String(error) },
      { status: 500 }
    );
  }
}

