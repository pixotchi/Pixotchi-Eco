"use client";

import {
  type ConfirmedMiniAppSessionSource,
  clearConfirmedMiniAppSession,
  confirmMiniAppSession,
} from '@/lib/confirmed-miniapp-session';
import { FARCASTER_CONNECTED_WALLET_HEADER } from '@/lib/farcaster-miniapp-auth-headers';
import { getHostEnvironmentSnapshot } from '@/lib/host-environment';
import { getMiniAppQuickAuthHeaders } from '@/lib/farcaster-miniapp-auth-client';

export type PublicChatSession = {
  address: string;
  authenticated: true;
  method: 'privy-ethereum' | 'privy-solana' | 'farcaster-miniapp' | 'base-siwe';
  provider: 'privy' | 'farcaster' | 'base';
  sourceAddress?: string;
};

export const PUBLIC_CHAT_SESSION_EVENT = 'pixotchi:public-chat-session';
const PUBLIC_CHAT_SESSION_CACHE_TTL_MS = 1000;

type PublicChatSessionCacheEntry = {
  expiresAt: number;
  session: PublicChatSession | null;
};

type PrivyChatSessionRequest = {
  accessToken?: string;
  expectedAddress?: string | null;
  identityToken?: string | null;
  provider: 'privy';
  solanaAddress?: string | null;
};

type FarcasterChatSessionRequest = {
  expectedAddress?: string | null;
  provider: 'farcaster';
  token: string;
};

type BaseChatSessionRequest = {
  address: string;
  message: string;
  provider: 'base';
  signature: `0x${string}`;
};

let publicChatSessionCache: PublicChatSessionCacheEntry | null = null;
let inFlightPublicChatSessionRequest: Promise<PublicChatSession | null> | null = null;
// Guards authoritative session writes (POST/DELETE) from being overwritten by
// an older GET that was already in flight. This is especially important during
// Base/test autologin: Wagmi can expose the address before the SIWE session POST
// finishes, so the pre-auth GET may return 401 after the POST has succeeded.
let publicChatSessionGeneration = 0;

function normalizeAddress(address: string | null | undefined): string | null {
  return address?.trim().toLowerCase() || null;
}

function setPublicChatSessionCache(session: PublicChatSession | null) {
  publicChatSessionCache = {
    expiresAt: Date.now() + PUBLIC_CHAT_SESSION_CACHE_TTL_MS,
    session,
  };
}

async function parseError(response: Response): Promise<string> {
  try {
    const data = await response.json();
    if (typeof data?.error === 'string' && data.error.trim()) {
      return data.error;
    }
  } catch {
    // Ignore JSON parse failures and fall back to status text.
  }

  return response.statusText || 'Request failed';
}

async function parseSessionResponse(response: Response): Promise<PublicChatSession> {
  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  return response.json() as Promise<PublicChatSession>;
}

function emitPublicChatSessionEvent(session: PublicChatSession | null) {
  publicChatSessionGeneration += 1;
  setPublicChatSessionCache(session);

  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(PUBLIC_CHAT_SESSION_EVENT, {
    detail: { session },
  }));
}

function syncConfirmedMiniAppSession(
  session: PublicChatSession | null,
  source: ConfirmedMiniAppSessionSource,
) {
  const hostEnvironment = getHostEnvironmentSnapshot();
  if (
    hostEnvironment.isMiniApp &&
    session?.provider === 'farcaster' &&
    session.method === 'farcaster-miniapp'
  ) {
    confirmMiniAppSession(session.address, source);
    return;
  }

  clearConfirmedMiniAppSession(session ? 'non-farcaster-chat-session' : 'chat-session-cleared');
}

export async function getCurrentPublicChatSession(): Promise<PublicChatSession | null> {
  return getCurrentPublicChatSessionForAddress();
}

export async function getCurrentPublicChatSessionForAddress(
  expectedAddress?: string | null,
): Promise<PublicChatSession | null> {
  const now = Date.now();
  const normalizedExpectedAddress = normalizeAddress(expectedAddress);
  if (publicChatSessionCache && publicChatSessionCache.expiresAt > now) {
    if (
      normalizedExpectedAddress &&
      publicChatSessionCache.session?.address?.toLowerCase() !== normalizedExpectedAddress
    ) {
      setPublicChatSessionCache(null);
    } else {
      syncConfirmedMiniAppSession(publicChatSessionCache.session, 'restored');
      return publicChatSessionCache.session;
    }
  }

  if (inFlightPublicChatSessionRequest) {
    return inFlightPublicChatSessionRequest;
  }

  const requestGeneration = publicChatSessionGeneration;
  inFlightPublicChatSessionRequest = (async () => {
    const miniAppHeaders = await getMiniAppQuickAuthHeaders({ expectedAddress });
    const response = await fetch('/api/chat/auth/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: miniAppHeaders,
    });

    // A newer create/clear completed while this request was in flight. Its
    // cache entry is authoritative, regardless of this older response.
    if (publicChatSessionGeneration !== requestGeneration) {
      return publicChatSessionCache?.session ?? null;
    }

    if (response.status === 401) {
      setPublicChatSessionCache(null);
      clearConfirmedMiniAppSession('chat-session-missing');
      return null;
    }

    const session = await parseSessionResponse(response);
    if (
      normalizedExpectedAddress &&
      session.address?.toLowerCase() !== normalizedExpectedAddress
    ) {
      await clearPublicChatSession().catch(() => {
        // Ignore cleanup failures when discarding a stale session response.
      });
      setPublicChatSessionCache(null);
      clearConfirmedMiniAppSession('chat-session-wallet-mismatch');
      return null;
    }

    // Parsing may yield long enough for an authoritative event to win the
    // race, so validate the generation once more before mutating the cache.
    if (publicChatSessionGeneration !== requestGeneration) {
      return publicChatSessionCache?.session ?? null;
    }

    setPublicChatSessionCache(session);
    syncConfirmedMiniAppSession(session, 'restored');
    return session;
  })();

  try {
    return await inFlightPublicChatSessionRequest;
  } finally {
    inFlightPublicChatSessionRequest = null;
  }
}

export async function createPrivyPublicChatSession(payload: Omit<PrivyChatSessionRequest, 'provider'>): Promise<PublicChatSession> {
  const { identityToken, ...bodyPayload } = payload;
  const response = await fetch('/api/chat/auth/session', {
    body: JSON.stringify({
      ...bodyPayload,
      provider: 'privy',
    }),
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...(identityToken ? { 'privy-id-token': identityToken } : {}),
    },
    method: 'POST',
  });

  const session = await parseSessionResponse(response);
  syncConfirmedMiniAppSession(session, 'chat-session');
  emitPublicChatSessionEvent(session);
  return session;
}

export async function createFarcasterPublicChatSession(payload: Omit<FarcasterChatSessionRequest, 'provider'>): Promise<PublicChatSession> {
  const authHeaders = payload.token
    ? {
        Authorization: `Bearer ${payload.token}`,
        ...(payload.expectedAddress
          ? { [FARCASTER_CONNECTED_WALLET_HEADER]: payload.expectedAddress.toLowerCase() }
          : {}),
      }
    : await getMiniAppQuickAuthHeaders({ expectedAddress: payload.expectedAddress });
  const response = await fetch('/api/chat/auth/session', {
    body: JSON.stringify({
      ...payload,
      provider: 'farcaster',
    }),
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
    },
    method: 'POST',
  });

  const session = await parseSessionResponse(response);
  syncConfirmedMiniAppSession(session, 'quick-auth');
  emitPublicChatSessionEvent(session);
  return session;
}

export async function createBasePublicChatSession(payload: Omit<BaseChatSessionRequest, 'provider'>): Promise<PublicChatSession> {
  const response = await fetch('/api/chat/auth/session', {
    body: JSON.stringify({
      ...payload,
      provider: 'base',
    }),
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  const session = await parseSessionResponse(response);
  syncConfirmedMiniAppSession(session, 'chat-session');
  emitPublicChatSessionEvent(session);
  return session;
}

export async function clearPublicChatSession(): Promise<void> {
  const response = await fetch('/api/chat/auth/session', {
      cache: 'no-store',
      credentials: 'same-origin',
      method: 'DELETE',
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  clearConfirmedMiniAppSession('chat-session-cleared');
  emitPublicChatSessionEvent(null);
}

export async function requestBasePublicChatNonce(): Promise<string> {
  const response = await fetch('/api/chat/auth/base/nonce', {
    cache: 'no-store',
    credentials: 'same-origin',
  });

  if (!response.ok) {
    throw new Error(await parseError(response));
  }

  const data = await response.json();
  if (typeof data?.nonce !== 'string' || !data.nonce.trim()) {
    throw new Error('Invalid nonce response.');
  }

  return data.nonce;
}
