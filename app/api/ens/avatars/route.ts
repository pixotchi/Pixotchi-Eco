import { createEnsLookupHandler } from '@/lib/ens-request';
import { ENS_LOOKUP_CONCURRENCY } from '@/lib/ens-lookup-policy';

export const runtime = 'nodejs';

const ENS_AVATAR_API_BASE = 'https://api.ethfollow.xyz/api/v1/users';

function normalizeAvatarUrl(value: UntypedValue): string | null {
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

async function fetchAvatar(address: string, signal: AbortSignal): Promise<string | null> {
  const response = await fetch(
    `${ENS_AVATAR_API_BASE}/${encodeURIComponent(address)}/ens`,
    {
      headers: { Accept: 'application/json' },
      signal,
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

export const POST = createEnsLookupHandler('avatars', async (addresses, signal) => {
  const avatars: Record<string, string | null> = {};
  let cursor = 0;
  await Promise.all(Array.from({ length: Math.min(ENS_LOOKUP_CONCURRENCY, addresses.length) }, async () => {
    while (cursor < addresses.length) {
      signal.throwIfAborted();
      const address = addresses[cursor++];
      try { avatars[address] = await fetchAvatar(address, signal); }
      catch { signal.throwIfAborted(); avatars[address] = null; }
    }
  }));
  return avatars;
});
