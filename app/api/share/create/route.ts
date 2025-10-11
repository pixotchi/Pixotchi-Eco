import { NextRequest, NextResponse } from 'next/server';
import { redisSetJSON } from '@/lib/redis';

export const runtime = 'edge';

interface MintShareData {
  address: string;
  basename?: string;
  strain: string;
  name: string;
  mintedAt: string;
  tx?: string;
}

// Generate a short, URL-safe ID (8 chars base62)
function generateShortId(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let id = '';
  const timestamp = Date.now().toString(36); // Base36 timestamp (shorter)
  const random = Array.from({ length: 4 }, () => 
    chars[Math.floor(Math.random() * chars.length)]
  ).join('');
  id = timestamp + random;
  return id.slice(-8); // Take last 8 chars for consistency
}

export async function POST(request: NextRequest) {
  try {
    const data: MintShareData = await request.json();

    // Validate required fields
    if (!data.address || !data.strain || !data.name || !data.mintedAt) {
      return NextResponse.json(
        { error: 'Missing required fields' },
        { status: 400 }
      );
    }

    // Generate short ID
    const shortId = generateShortId();
    
    // Store in Redis with 90-day expiry (share links should last long)
    const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 days
    const stored = await redisSetJSON(`share:mint:${shortId}`, data, TTL_SECONDS);

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

