"use client";

export type PublicChatSession = {
  address: string;
  authenticated: true;
  method: 'privy-ethereum' | 'privy-solana' | 'farcaster-miniapp' | 'base-siwe';
  provider: 'privy' | 'farcaster' | 'base';
  sourceAddress?: string;
};

export const PUBLIC_CHAT_SESSION_EVENT = 'pixotchi:public-chat-session';

type PrivyChatSessionRequest = {
  accessToken: string;
  expectedAddress?: string | null;
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
  if (typeof window === 'undefined') {
    return;
  }

  window.dispatchEvent(new CustomEvent(PUBLIC_CHAT_SESSION_EVENT, {
    detail: { session },
  }));
}

export async function getCurrentPublicChatSession(): Promise<PublicChatSession | null> {
  const response = await fetch('/api/chat/auth/session', {
    cache: 'no-store',
    credentials: 'same-origin',
  });

  if (response.status === 401) {
    return null;
  }

  return parseSessionResponse(response);
}

export async function createPrivyPublicChatSession(payload: Omit<PrivyChatSessionRequest, 'provider'>): Promise<PublicChatSession> {
  const response = await fetch('/api/chat/auth/session', {
    body: JSON.stringify({
      ...payload,
      provider: 'privy',
    }),
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  const session = await parseSessionResponse(response);
  emitPublicChatSessionEvent(session);
  return session;
}

export async function createFarcasterPublicChatSession(payload: Omit<FarcasterChatSessionRequest, 'provider'>): Promise<PublicChatSession> {
  const response = await fetch('/api/chat/auth/session', {
    body: JSON.stringify({
      ...payload,
      provider: 'farcaster',
    }),
    cache: 'no-store',
    credentials: 'same-origin',
    headers: {
      'Content-Type': 'application/json',
    },
    method: 'POST',
  });

  const session = await parseSessionResponse(response);
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
