import { NextRequest, NextResponse } from 'next/server';
import { enforceRateLimit, getRequestIp } from '@/lib/request-rate-limit';
import { redisSetJSON } from '@/lib/redis';
import type { MintShareData } from '@/lib/types';
import { nanoid } from 'nanoid';
import { isAddress } from 'viem';

export const runtime = 'nodejs';

const SHARE_CREATE_IP_LIMIT = 60;
const SHARE_CREATE_WINDOW_SECONDS = 600;

function cleanOptionalString(value: UntypedValue, maxLength: number): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return undefined;
  return trimmed;
}

function cleanRequiredString(value: UntypedValue, maxLength: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) return null;
  return trimmed;
}

function cleanTxHash(value: UntypedValue): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  return /^0x[a-fA-F0-9]{64}$/.test(trimmed) ? trimmed : undefined;
}

export async function POST(request: NextRequest) {
  try {
    const rateLimitResponse = await enforceRateLimit(request, {
      scope: 'api:share:create',
      rules: [
        {
          kind: 'ip',
          identifier: getRequestIp(request),
          limit: SHARE_CREATE_IP_LIMIT,
          windowSeconds: SHARE_CREATE_WINDOW_SECONDS,
        },
      ],
    });

    if (rateLimitResponse) {
      return rateLimitResponse;
    }

    const body = await request.json();
    const address = typeof body?.address === 'string' && isAddress(body.address)
      ? body.address.toLowerCase()
      : null;
    const name = cleanRequiredString(body?.name, 64);
    const strain = cleanRequiredString(body?.strain ?? body?.strainName, 40);
    const mintedTime = typeof body?.mintedAt === 'string' ? Date.parse(body.mintedAt) : Number.NaN;
    const strainId = Number(body?.strainId);
    const txHash = cleanTxHash(body?.txHash ?? body?.tx);

    // Validate required fields
    if (!address || !strain || !name || !Number.isFinite(mintedTime) || mintedTime <= 0) {
      return NextResponse.json(
        { error: 'Invalid share payload' },
        { status: 400 }
      );
    }

    const sanitizedData: MintShareData = {
      address,
      name,
      strain,
      mintedAt: new Date(mintedTime).toISOString(),
      ...(Number.isSafeInteger(strainId) && strainId >= 0 && strainId <= 10_000 ? { strainId } : {}),
      ...(cleanOptionalString(body?.basename, 80) ? { basename: cleanOptionalString(body?.basename, 80) } : {}),
      ...(txHash ? { txHash, tx: txHash } : {}),
    };

    // Generate short ID
    const shortId = nanoid(12);
    
    // Store in Redis with 90-day expiry (share links should last long)
    const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
    const stored = await redisSetJSON(`share:mint:${shortId}`, sanitizedData, TTL_SECONDS);

    if (!stored) {
      return NextResponse.json(
        { error: 'Failed to create short URL' },
        { status: 500 }
      );
    }

    // Return the short URL
    const baseUrl = process.env.NEXT_PUBLIC_URL || 'https://mini.pixotchi.tech';
    const shortUrl = `${baseUrl}/share/m/${shortId}`;

    return NextResponse.json({ 
      shortUrl,
      shortId,
      expiresIn: TTL_SECONDS 
    });

  } catch (error) {
    console.error('Error creating short URL:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
