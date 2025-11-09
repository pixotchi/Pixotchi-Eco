import { sendFrameNotification } from "@/lib/notification-client";
import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

const SECRET_HEADER = "x-notification-secret";
const GLOBAL_RATE_LIMIT = { limit: 50, windowSeconds: 300 }; // 50 requests per 5 minutes
const PER_FID_RATE_LIMIT = { limit: 5, windowSeconds: 60 };  // 5 requests per fid per minute

async function incrementWithExpiry(key: string, windowSeconds: number) {
  if (!redis) return { current: 1 };
  const current = await (redis as any)?.incr?.(key);
  if (current === 1) {
    await (redis as any)?.expire?.(key, windowSeconds);
  }
  return { current };
}

async function checkRateLimit(key: string, limit: number, windowSeconds: number) {
  try {
    const { current } = await incrementWithExpiry(key, windowSeconds);
    return current <= limit;
  } catch (error) {
    // On Redis failure, fail open but log so we can investigate.
    console.warn("[notify] Rate limit check failed:", error);
    return true;
  }
}

function validatePayload(body: unknown) {
  if (typeof body !== "object" || body === null) {
    throw new Error("Invalid request body");
  }

  const { fid, notification, type = "custom" } = body as Record<string, unknown>;

  if (typeof fid !== "number" || !Number.isFinite(fid)) {
    throw new Error("Invalid fid");
  }

  if (typeof notification !== "object" || notification === null) {
    throw new Error("Invalid notification payload");
  }

  const { title, body: messageBody, notificationDetails } = notification as Record<string, unknown>;
  if (typeof title !== "string" || title.trim().length === 0) {
    throw new Error("Notification title is required");
  }
  if (typeof messageBody !== "string" || messageBody.trim().length === 0) {
    throw new Error("Notification body is required");
  }
  if (notificationDetails && typeof notificationDetails !== "object") {
    throw new Error("Invalid notificationDetails");
  }

  if (typeof type !== "string") {
    throw new Error("Invalid notification type");
  }

  return {
    fid,
    notification: {
      title: title.trim(),
      body: messageBody.trim(),
      notificationDetails,
    },
    type: type.trim() || "custom",
  };
}

export async function POST(request: Request) {
  try {
    const secret = process.env.NOTIFICATION_PROXY_SECRET;

    if (secret) {
      const provided = request.headers.get(SECRET_HEADER);
      if (provided !== secret) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Notification proxy disabled" },
        { status: 503 },
      );
    } else {
      console.warn("[notify] NOTIFICATION_PROXY_SECRET is not set. Endpoint is unsecured (development only).");
    }

    const payload = await request.json();
    const { fid, notification, type } = validatePayload(payload);

    if (redis) {
      const globalKey = "notif:rate:global";
      const fidKey = `notif:rate:fid:${fid}`;
      const withinGlobalLimit = await checkRateLimit(globalKey, GLOBAL_RATE_LIMIT.limit, GLOBAL_RATE_LIMIT.windowSeconds);
      const withinFidLimit = await checkRateLimit(fidKey, PER_FID_RATE_LIMIT.limit, PER_FID_RATE_LIMIT.windowSeconds);

      if (!withinGlobalLimit || !withinFidLimit) {
        return NextResponse.json(
          { error: "Rate limit exceeded" },
          { status: 429 },
        );
      }
    }

    const result = await sendFrameNotification({
      fid,
      title: notification.title,
      body: notification.body,
      notificationDetails: notification.notificationDetails,
    });

    if (result.state === "error") {
      return NextResponse.json(
        { error: result.error },
        { status: 500 },
      );
    }

    // Log for admin dashboards (global + per-type)
    try {
      const ts = Date.now();
      await (redis as any)?.lpush?.("notif:global:log", JSON.stringify({ ts, fid, type }));
      await (redis as any)?.ltrim?.("notif:global:log", 0, 199);
      await (redis as any)?.hset?.("notif:global:last", { [fid]: String(ts) });
      try { await (redis as any)?.incrby?.("notif:global:sentCount", 1); } catch {}
      await (redis as any)?.lpush?.(`notif:type:${type}:log`, JSON.stringify({ ts, fid }));
      await (redis as any)?.ltrim?.(`notif:type:${type}:log`, 0, 199);
      await (redis as any)?.hset?.(`notif:type:${type}:last`, { [fid]: String(ts) });
      try { await (redis as any)?.incrby?.(`notif:type:${type}:sentCount`, 1); } catch {}
      await (redis as any)?.sadd?.("notif:eligible:fids", String(fid));
    } catch (error) {
      console.warn("[notify] Logging failed:", error);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 },
    );
  }
}
