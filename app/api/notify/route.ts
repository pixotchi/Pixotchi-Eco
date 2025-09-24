import { sendFrameNotification } from "@/lib/notification-client";
import { NextResponse } from "next/server";
import { redis } from "@/lib/redis";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { fid, notification, type = 'custom' } = body;

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
      // Global
      await (redis as any)?.lpush?.('notif:global:log', JSON.stringify({ ts, fid, type }));
      await (redis as any)?.ltrim?.('notif:global:log', 0, 199);
      await (redis as any)?.hset?.('notif:global:last', { [fid]: String(ts) });
      try { await (redis as any)?.incrby?.('notif:global:sentCount', 1); } catch {}
      // Per type
      await (redis as any)?.lpush?.(`notif:type:${type}:log`, JSON.stringify({ ts, fid }));
      await (redis as any)?.ltrim?.(`notif:type:${type}:log`, 0, 199);
      await (redis as any)?.hset?.(`notif:type:${type}:last`, { [fid]: String(ts) });
      try { await (redis as any)?.incrby?.(`notif:type:${type}:sentCount`, 1); } catch {}
      // Track eligible fids set
      if (fid != null) await (redis as any)?.sadd?.('notif:eligible:fids', String(fid));
    } catch {}

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
