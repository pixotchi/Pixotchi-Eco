import { NextRequest, NextResponse } from "next/server";
import { redis } from "@/lib/redis";

const KEY_PREFIX = "spin:commit";
const EXPIRY_SECONDS = 60 * 60 * 48; // 48 hours

function buildKey(address: string, plantId: number) {
  return `${KEY_PREFIX}:${address.toLowerCase()}:plant:${plantId}`;
}

export async function GET(req: NextRequest) {
  const address = req.nextUrl.searchParams.get("address");
  const plantIdParam = req.nextUrl.searchParams.get("plantId");

  if (!address || !plantIdParam) {
    return NextResponse.json({ error: "Missing address or plantId" }, { status: 400 });
  }

  const plantId = Number(plantIdParam);
  if (!Number.isFinite(plantId) || plantId < 0) {
    return NextResponse.json({ error: "Invalid plantId" }, { status: 400 });
  }

  if (!redis) {
    return NextResponse.json({ block: null });
  }

  try {
    const cached = await redis.get(buildKey(address, plantId));
    const block = cached != null ? Number(cached) : null;
    return NextResponse.json({ block: Number.isFinite(block) ? block : null });
  } catch (error) {
    console.warn("spin/commit-state GET failed", error);
    return NextResponse.json({ block: null });
  }
}

export async function POST(req: NextRequest) {
  const { address, plantId, block } = await req.json().catch(() => ({}) as Record<string, unknown>);

  if (typeof address !== "string" || typeof plantId !== "number" || typeof block !== "number") {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (!redis) {
    return NextResponse.json({ success: false, error: "Redis unavailable" }, { status: 503 });
  }

  if (!Number.isFinite(block) || block <= 0) {
    return NextResponse.json({ success: false, error: "Invalid block" }, { status: 400 });
  }

  try {
    const key = buildKey(address, plantId);
    await redis.set(key, String(block), { ex: EXPIRY_SECONDS });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.warn("spin/commit-state POST failed", error);
    return NextResponse.json({ success: false, error: "Failed to persist" }, { status: 500 });
  }
}

