import { NextRequest, NextResponse } from 'next/server';
import { isAddress } from 'viem';

export const runtime = 'nodejs';

const ENS_AVATAR_API_BASE = 'https://api.ethfollow.xyz/api/v1/users';

function normalizeAvatarUrl(value: unknown): string | null {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  if (trimmed.startsWith('ipfs://')) {
    const path = trimmed.slice('ipfs://'.length).replace(/^ipfs\//, '');
    return path ? `https://ipfs.io/ipfs/${path}` : null;
  }

  if (/^https?:\/\//i.test(trimmed) || /^data:image\//i.test(trimmed)) {
    return trimmed;
  }

  return null;
}

async function fetchAvatar(address: string): Promise<string | null> {
  const response = await fetch(
    `${ENS_AVATAR_API_BASE}/${encodeURIComponent(address)}/ens`,
    {
      headers: { Accept: 'application/json' },
      next: { revalidate: 60 * 60 },
    },
  );

  if (!response.ok) {
    if (response.status === 404) {
      return null;
    }
    throw new Error(`ENS avatar lookup failed with status ${response.status}`);
  }

  const payload = await response.json();
  const ens = payload?.ens;

  return (
    normalizeAvatarUrl(ens?.avatar)
    ?? normalizeAvatarUrl(ens?.records?.avatar)
    ?? null
  );
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const addresses: unknown = body?.addresses;

    if (!Array.isArray(addresses) || addresses.length === 0) {
      return NextResponse.json(
        { success: false, error: 'addresses must be a non-empty array' },
        { status: 400 },
      );
    }

    const validAddresses = Array.from(
      new Set(
        addresses
          .filter((address): address is string => typeof address === 'string')
          .map((address) => address.toLowerCase())
          .filter((address) => isAddress(address)),
      ),
    );

    if (validAddresses.length === 0) {
      return NextResponse.json({ success: true, avatars: {} });
    }

    const avatarEntries = await Promise.allSettled(
      validAddresses.map(async (address) => [address, await fetchAvatar(address)] as const),
    );

    const avatars: Record<string, string | null> = {};

    avatarEntries.forEach((entry, index) => {
      const key = validAddresses[index];
      if (!key) {
        return;
      }

      avatars[key] = entry.status === 'fulfilled' ? entry.value[1] : null;
    });

    return NextResponse.json(
      { success: true, avatars },
      {
        headers: {
          'Cache-Control': 'public, max-age=300, s-maxage=3600',
        },
      },
    );
  } catch (error) {
    console.error('[ENS Avatar API] Failed to resolve avatars', error);
    return NextResponse.json(
      { success: false, error: 'Failed to resolve avatars' },
      { status: 500 },
    );
  }
}
