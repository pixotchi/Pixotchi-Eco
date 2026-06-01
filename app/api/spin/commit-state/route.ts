import { NextRequest, NextResponse } from "next/server";
import { redis, redisCompareAndSetJSONRaw } from "@/lib/redis";
import { isAddress, verifyMessage } from "viem";

const KEY_PREFIX = "spin:commit";
const EXPIRY_SECONDS = 60 * 60 * 48; // 48 hours
const MAX_PLANT_ID = 1_000_000_000;

function buildKey(address: string, plantId: number) {
  return `${KEY_PREFIX}:${address.toLowerCase()}:plant:${plantId}`;
}

function normalizeAddress(address: UntypedValue): string | null {
  return typeof address === "string" && isAddress(address) ? address.toLowerCase() : null;
}

function normalizePlantId(plantId: UntypedValue): number | null {
  const value = typeof plantId === "string" ? Number(plantId) : plantId;
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_PLANT_ID) {
    return null;
  }
  return value;
}

function buildCommitStateMessage(address: string, plantId: number, block: number): string {
  return `Pixotchi spin commit state\nAddress: ${address.toLowerCase()}\nPlant ID: ${plantId}\nBlock: ${block}`;
}

function parseStoredBlock(value: UntypedValue): number | null {
  const block = value != null ? Number(value) : null;
  return block !== null && Number.isSafeInteger(block) && block > 0 ? block : null;
}

export async function GET(req: NextRequest) {
  const address = normalizeAddress(req.nextUrl.searchParams.get("address"));
  const plantId = normalizePlantId(req.nextUrl.searchParams.get("plantId"));

  if (!address || plantId === null) {
    return NextResponse.json({ error: "Missing address or plantId" }, { status: 400 });
  }

  if (!redis) {
    return NextResponse.json({ block: null });
  }

  try {
    const cached = await redis.get(buildKey(address, plantId));
    return NextResponse.json({ block: parseStoredBlock(cached) });
  } catch (error) {
    console.warn("spin/commit-state GET failed", error);
    return NextResponse.json({ block: null });
  }
}

export async function POST(req: NextRequest) {
  const { address, plantId, block, message, signature } = await req.json().catch(() => ({}) as Record<string, UntypedValue>);

  const normalizedAddress = normalizeAddress(address);
  const normalizedPlantId = normalizePlantId(plantId);
  const normalizedBlock = typeof block === "number" ? block : Number(block);

  if (!normalizedAddress || normalizedPlantId === null || !Number.isSafeInteger(normalizedBlock) || normalizedBlock <= 0) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  if (typeof message !== "string" || typeof signature !== "string" || !signature.startsWith("0x")) {
    return NextResponse.json({ success: false, error: "Signed commit proof is required" }, { status: 401 });
  }

  const expectedMessage = buildCommitStateMessage(normalizedAddress, normalizedPlantId, normalizedBlock);
  if (message !== expectedMessage) {
    return NextResponse.json({ success: false, error: "Signed message does not match commit state" }, { status: 400 });
  }

  let signatureValid = false;
  try {
    signatureValid = await verifyMessage({
      address: normalizedAddress as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    signatureValid = false;
  }

  if (!signatureValid) {
    return NextResponse.json({ success: false, error: "Invalid commit proof signature" }, { status: 401 });
  }

  if (!redis) {
    return NextResponse.json({ success: false, error: "Redis unavailable" }, { status: 503 });
  }

  try {
    const key = buildKey(normalizedAddress, normalizedPlantId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const current = await redis.get(key);
      const currentBlock = parseStoredBlock(current);
      if (currentBlock !== null && currentBlock >= normalizedBlock) {
        return NextResponse.json({ success: true, block: currentBlock, stale: true });
      }

      const expected = current == null ? null : String(current);
      const updated = await redisCompareAndSetJSONRaw(key, expected, String(normalizedBlock), EXPIRY_SECONDS);
      if (updated) {
        return NextResponse.json({ success: true, block: normalizedBlock });
      }
    }

    return NextResponse.json({ success: false, error: "Commit state changed, retry required" }, { status: 409 });
  } catch (error) {
    console.warn("spin/commit-state POST failed", error);
    return NextResponse.json({ success: false, error: "Failed to persist" }, { status: 500 });
  }
}
