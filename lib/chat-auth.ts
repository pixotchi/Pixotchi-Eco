import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { createPublicClient, http } from 'viem';
import { base } from 'viem/chains';
import { SiweMessage } from 'siwe';
import { createClient as createFarcasterQuickAuthClient } from '@farcaster/quick-auth';
import { PrivyClient } from '@privy-io/server-auth';
import { getTwinAddress } from '@/lib/solana-twin';
import { redis, redisDel, redisGetJSON, redisSetJSON, withPrefix } from '@/lib/redis';
import { isValidEthereumAddressFormat } from '@/lib/utils';

export type ChatSessionProvider = 'privy' | 'farcaster' | 'base';
export type ChatSessionMethod = 'privy-ethereum' | 'privy-solana' | 'farcaster-miniapp' | 'base-siwe';

export interface ChatSessionRecord {
  address: string;
  createdAt: number;
  fid?: number;
  id: string;
  method: ChatSessionMethod;
  provider: ChatSessionProvider;
  sourceAddress?: string;
  userId?: string;
}

interface ChatSessionSummary {
  address: string;
  authenticated: true;
  method: ChatSessionMethod;
  provider: ChatSessionProvider;
  sourceAddress?: string;
}

interface ChatIdentity {
  address: string;
  fid?: number;
  method: ChatSessionMethod;
  provider: ChatSessionProvider;
  sourceAddress?: string;
  userId?: string;
}

interface BaseChatAuthPayload {
  address: string;
  message: string;
  signature: `0x${string}`;
}

interface PrivyChatAuthPayload {
  accessToken: string;
  expectedAddress?: string | null;
  solanaAddress?: string | null;
}

interface FarcasterChatAuthPayload {
  expectedAddress?: string | null;
  token: string;
}

const CHAT_SESSION_COOKIE_NAME = 'pixotchi_chat_session';
const CHAT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;
const BASE_AUTH_NONCE_TTL_SECONDS = 60 * 10;
const BASE_NONCE_CONSUME_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  redis.call("DEL", KEYS[1])
  return 1
end
return 0
`;

const basePublicClient = createPublicClient({
  chain: base,
  transport: http(base.rpcUrls.default.http[0]),
});

export class ChatAuthError extends Error {
  status: number;

  constructor(message: string, status: number = 401) {
    super(message);
    this.name = 'ChatAuthError';
    this.status = status;
  }
}

function getChatSessionKey(sessionId: string): string {
  return `chat:auth:session:${sessionId}`;
}

function getBaseNonceKey(nonce: string): string {
  return `chat:auth:base:nonce:${nonce}`;
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function getConfiguredBaseUrl(request: NextRequest): URL {
  const explicitBaseUrl = process.env.NEXT_PUBLIC_URL?.trim();
  if (explicitBaseUrl) {
    return new URL(explicitBaseUrl);
  }

  const originHeader = request.headers.get('origin');
  if (originHeader) {
    return new URL(originHeader);
  }

  return new URL(request.nextUrl.origin);
}

function getExpectedDomain(request: NextRequest): string {
  return getConfiguredBaseUrl(request).host;
}

function buildPrivateNoStoreHeaders(): HeadersInit {
  return {
    'Cache-Control': 'private, no-store',
  };
}

function setChatSessionCookie(response: NextResponse, sessionId: string) {
  response.cookies.set(CHAT_SESSION_COOKIE_NAME, sessionId, {
    httpOnly: true,
    maxAge: CHAT_SESSION_TTL_SECONDS,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

export function clearChatSessionCookie(response: NextResponse) {
  response.cookies.set(CHAT_SESSION_COOKIE_NAME, '', {
    httpOnly: true,
    maxAge: 0,
    path: '/',
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
  });
}

function toSessionSummary(session: ChatSessionRecord): ChatSessionSummary {
  return {
    address: session.address,
    authenticated: true,
    method: session.method,
    provider: session.provider,
    ...(session.sourceAddress ? { sourceAddress: session.sourceAddress } : {}),
  };
}

export function createChatAuthRequiredResponse(options?: {
  clearCookie?: boolean;
  message?: string;
  status?: number;
}): NextResponse {
  const response = NextResponse.json(
    { error: options?.message ?? 'Authentication required for public chat.' },
    {
      headers: buildPrivateNoStoreHeaders(),
      status: options?.status ?? 401,
    },
  );

  if (options?.clearCookie) {
    clearChatSessionCookie(response);
  }

  return response;
}

export function createChatUnavailableResponse(message: string = 'Chat authentication is currently unavailable.'): NextResponse {
  return NextResponse.json(
    { error: message },
    {
      headers: buildPrivateNoStoreHeaders(),
      status: 503,
    },
  );
}

export async function issueBaseAuthNonce(): Promise<string> {
  if (!redis) {
    throw new ChatAuthError('Redis is required for Base authentication.', 503);
  }

  const nonce = randomBytes(16).toString('hex');
  const stored = await redisSetJSON(getBaseNonceKey(nonce), { createdAt: Date.now() }, BASE_AUTH_NONCE_TTL_SECONDS);

  if (!stored) {
    throw new ChatAuthError('Failed to create Base authentication nonce.', 503);
  }

  return nonce;
}

async function consumeBaseAuthNonce(nonce: string): Promise<boolean> {
  if (!redis) {
    return false;
  }

  const key = withPrefix(getBaseNonceKey(nonce));

  try {
    const evalFn = (redis as any)?.eval;
    if (typeof evalFn === 'function') {
      const result = await evalFn.call(redis, BASE_NONCE_CONSUME_SCRIPT, [key], []);
      return Number(result) === 1;
    }
  } catch (error) {
    console.warn('[chat-auth] Failed to consume nonce atomically, falling back to GET/DEL.', error);
  }

  const existing = await redisGetJSON<{ createdAt: number }>(getBaseNonceKey(nonce));
  if (!existing) {
    return false;
  }

  await redisDel(getBaseNonceKey(nonce));
  return true;
}

export async function getChatSessionFromRequest(request: NextRequest): Promise<{
  session: ChatSessionRecord | null;
  sessionId: string | null;
}> {
  const sessionId = request.cookies.get(CHAT_SESSION_COOKIE_NAME)?.value ?? null;
  if (!sessionId) {
    return { session: null, sessionId: null };
  }

  if (!redis) {
    return { session: null, sessionId };
  }

  const session = await redisGetJSON<ChatSessionRecord>(getChatSessionKey(sessionId));
  return {
    session,
    sessionId,
  };
}

export async function clearChatSessionForRequest(request: NextRequest): Promise<void> {
  const sessionId = request.cookies.get(CHAT_SESSION_COOKIE_NAME)?.value;
  if (!sessionId) {
    return;
  }

  await redisDel(getChatSessionKey(sessionId));
}

export async function createChatSessionResponse(request: NextRequest, identity: ChatIdentity): Promise<NextResponse> {
  if (!redis) {
    throw new ChatAuthError('Redis is required for public chat sessions.', 503);
  }

  const sessionId = nanoid();
  const session: ChatSessionRecord = {
    address: normalizeAddress(identity.address),
    createdAt: Date.now(),
    id: sessionId,
    method: identity.method,
    provider: identity.provider,
    ...(identity.fid ? { fid: identity.fid } : {}),
    ...(identity.sourceAddress ? { sourceAddress: identity.sourceAddress } : {}),
    ...(identity.userId ? { userId: identity.userId } : {}),
  };

  const stored = await redisSetJSON(getChatSessionKey(sessionId), session, CHAT_SESSION_TTL_SECONDS);
  if (!stored) {
    throw new ChatAuthError('Failed to create public chat session.', 503);
  }

  const previousSessionId = request.cookies.get(CHAT_SESSION_COOKIE_NAME)?.value;
  if (previousSessionId && previousSessionId !== sessionId) {
    await redisDel(getChatSessionKey(previousSessionId));
  }

  const response = NextResponse.json(toSessionSummary(session), {
    headers: buildPrivateNoStoreHeaders(),
  });

  setChatSessionCookie(response, sessionId);
  return response;
}

function getPrivyServerClient(): PrivyClient {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID?.trim();
  const appSecret = process.env.PRIVY_APP_SECRET?.trim();

  if (!appId || !appSecret) {
    throw new ChatAuthError('Privy server authentication is not configured.', 503);
  }

  return new PrivyClient(appId, appSecret);
}

function getPrivyWalletAccounts(user: any, chainType: 'ethereum' | 'solana'): Array<{ address: string }> {
  const accounts = Array.isArray(user?.linkedAccounts) ? user.linkedAccounts : [];
  return accounts.filter(
    (account: any) =>
      account?.type === 'wallet' &&
      account?.chainType === chainType &&
      typeof account?.address === 'string',
  );
}

export async function verifyPrivyChatIdentity(
  payload: PrivyChatAuthPayload,
): Promise<ChatIdentity> {
  if (!payload.accessToken) {
    throw new ChatAuthError('Privy access token is required.', 400);
  }

  const expectedAddress = payload.expectedAddress ? normalizeAddress(payload.expectedAddress) : null;
  const privy = getPrivyServerClient();
  const claims = await privy.verifyAuthToken(payload.accessToken);
  const user = await privy.getUser(claims.userId);

  if (payload.solanaAddress) {
    const normalizedSolanaAddress = payload.solanaAddress.trim();
    const solanaWallets = getPrivyWalletAccounts(user, 'solana');
    const matchedWallet =
      solanaWallets.find((wallet) => wallet.address === normalizedSolanaAddress) ??
      solanaWallets[0];

    if (!matchedWallet?.address) {
      throw new ChatAuthError('No verified Solana wallet is linked to this Privy user.', 401);
    }

    const twinAddress = normalizeAddress(await getTwinAddress(matchedWallet.address));
    if (expectedAddress && twinAddress !== expectedAddress) {
      throw new ChatAuthError('Privy Solana session does not match the connected wallet.', 401);
    }

    return {
      address: twinAddress,
      method: 'privy-solana',
      provider: 'privy',
      sourceAddress: matchedWallet.address,
      userId: claims.userId,
    };
  }

  const ethereumWallets = getPrivyWalletAccounts(user, 'ethereum').map((wallet) => normalizeAddress(wallet.address));

  if (expectedAddress && !ethereumWallets.includes(expectedAddress)) {
    throw new ChatAuthError('Privy session does not match the connected wallet.', 401);
  }

  const address = expectedAddress ?? ethereumWallets[0];
  if (!address) {
    throw new ChatAuthError('No verified Ethereum wallet is linked to this Privy user.', 401);
  }

  return {
    address,
    method: 'privy-ethereum',
    provider: 'privy',
    userId: claims.userId,
  };
}

export async function verifyFarcasterChatIdentity(
  request: NextRequest,
  payload: FarcasterChatAuthPayload,
): Promise<ChatIdentity> {
  if (!payload.token) {
    throw new ChatAuthError('Farcaster Quick Auth token is required.', 400);
  }

  const quickAuthClient = createFarcasterQuickAuthClient();
  const verified = await quickAuthClient.verifyJwt({
    domain: getExpectedDomain(request),
    token: payload.token,
  }) as { address?: unknown; sub?: unknown };

  if (typeof verified.address !== 'string' || !verified.address) {
    throw new ChatAuthError('Farcaster Quick Auth token is missing an address.', 401);
  }

  const fid = typeof verified.sub === 'number'
    ? verified.sub
    : Number.parseInt(String(verified.sub ?? ''), 10);

  return {
    address: normalizeAddress(verified.address),
    ...(Number.isFinite(fid) ? { fid } : {}),
    method: 'farcaster-miniapp',
    provider: 'farcaster',
  };
}

export async function verifyBaseChatIdentity(
  request: NextRequest,
  payload: BaseChatAuthPayload,
): Promise<ChatIdentity> {
  if (!payload.address || !payload.message || !payload.signature) {
    throw new ChatAuthError('Address, message, and signature are required.', 400);
  }

  if (!isValidEthereumAddressFormat(payload.address)) {
    throw new ChatAuthError('Invalid wallet address format.', 400);
  }

  let siweMessage: SiweMessage;
  try {
    siweMessage = new SiweMessage(payload.message);
  } catch {
    throw new ChatAuthError('Invalid SIWE message.', 400);
  }

  const expectedDomain = getExpectedDomain(request);
  const expectedOrigin = getConfiguredBaseUrl(request).origin;
  const normalizedAddress = normalizeAddress(payload.address);

  if (normalizeAddress(siweMessage.address) !== normalizedAddress) {
    throw new ChatAuthError('SIWE address does not match the connected wallet.', 400);
  }

  if (siweMessage.domain !== expectedDomain) {
    throw new ChatAuthError('Unexpected SIWE domain.', 400);
  }

  if (Number(siweMessage.chainId) !== base.id) {
    throw new ChatAuthError('SIWE signature must target Base mainnet.', 400);
  }

  if (siweMessage.uri) {
    try {
      if (new URL(siweMessage.uri).origin !== expectedOrigin) {
        throw new ChatAuthError('Unexpected SIWE origin.', 400);
      }
    } catch (error) {
      if (error instanceof ChatAuthError) {
        throw error;
      }
      throw new ChatAuthError('Invalid SIWE origin.', 400);
    }
  }

  if (!siweMessage.nonce) {
    throw new ChatAuthError('SIWE nonce is missing.', 400);
  }

  const nonceConsumed = await consumeBaseAuthNonce(siweMessage.nonce);
  if (!nonceConsumed) {
    throw new ChatAuthError('Invalid or reused Base authentication nonce.', 400);
  }

  const isValid = await basePublicClient.verifyMessage({
    address: payload.address as `0x${string}`,
    message: payload.message,
    signature: payload.signature,
  });

  if (!isValid) {
    throw new ChatAuthError('Invalid Base authentication signature.', 401);
  }

  return {
    address: normalizedAddress,
    method: 'base-siwe',
    provider: 'base',
  };
}
