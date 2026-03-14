import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { createPublicClient } from 'viem';
import { base } from 'viem/chains';
import { SiweMessage } from 'siwe';
import { createClient as createFarcasterQuickAuthClient } from '@farcaster/quick-auth';
import { PrivyClient } from '@privy-io/server-auth';
import { getTwinAddress } from '@/lib/solana-twin';
import { redis, redisDel, redisGetJSON, redisSetJSON, withPrefix } from '@/lib/redis';
import { MINIAPP_BYPASS_ADDRESS_COOKIE, MINIAPP_BYPASS_COOKIE } from '@/lib/miniapp-bypass';
import { createResilientTransport } from '@/lib/rpc-transport';
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
  transport: createResilientTransport(),
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

function pushUrlCandidate(candidates: URL[], candidate: string | null | undefined): void {
  if (!candidate) {
    return;
  }

  try {
    candidates.push(new URL(candidate));
  } catch {
    // Ignore malformed URL candidates.
  }
}

function pushHostCandidate(
  candidates: URL[],
  host: string | null | undefined,
  protocol: string | null | undefined,
): void {
  if (!host) {
    return;
  }

  const trimmedHost = host.trim();
  if (!trimmedHost) {
    return;
  }

  const normalizedProtocol = (protocol?.trim() || 'https').replace(/:$/, '');
  pushUrlCandidate(candidates, `${normalizedProtocol}://${trimmedHost}`);
}

function normalizeOrigin(origin: string): string {
  return origin.toLowerCase();
}

function normalizeSiweDomain(domain: string): string {
  const trimmed = domain.trim().toLowerCase();

  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    try {
      return new URL(trimmed).host.toLowerCase();
    } catch {
      return trimmed;
    }
  }

  return trimmed;
}

function getExpectedBaseDomains(urls: URL[]): Set<string> {
  const domains = new Set<string>();

  urls.forEach((url) => {
    domains.add(normalizeSiweDomain(url.host));
    domains.add(normalizeSiweDomain(url.hostname));
  });

  return domains;
}

function normalizeBaseSiweMessage(message: string): string {
  return message
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimStart())
    .join('\n')
    .replace(/^(Chain ID:\s*)(0x[0-9a-fA-F]+)\s*$/m, (_match, prefix, hexValue) => {
      try {
        return `${prefix}${Number.parseInt(hexValue, 16)}`;
      } catch {
        return `${prefix}${hexValue}`;
      }
    })
    .trim();
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }

  if (typeof error === 'string' && error.trim()) {
    return error;
  }

  return 'Unknown error';
}

function redactBaseSiweLine(line: string): string {
  if (/^Nonce:/i.test(line)) {
    return 'Nonce: [redacted]';
  }

  return line;
}

function getBaseSiweLines(message: string): string[] {
  return message
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => redactBaseSiweLine(line));
}

function logBaseSiweFailure(
  request: NextRequest,
  payload: BaseChatAuthPayload,
  details: Record<string, unknown>,
): void {
  const expectedUrls = getExpectedBaseUrls(request);

  console.warn('[chat-auth] Base SIWE verification failed:', {
    address: payload.address?.toLowerCase?.() ?? payload.address ?? null,
    expectedDomains: Array.from(getExpectedBaseDomains(expectedUrls)),
    expectedOrigins: expectedUrls.map((url) => url.origin),
    forwardedHost: request.headers.get('x-forwarded-host'),
    forwardedProto: request.headers.get('x-forwarded-proto'),
    host: request.headers.get('host'),
    origin: request.headers.get('origin'),
    secFetchSite: request.headers.get('sec-fetch-site'),
    signatureLength: typeof payload.signature === 'string' ? payload.signature.length : null,
    userAgent: request.headers.get('user-agent'),
    ...details,
  });
}

function parseBaseSiweMessage(message: string): {
  siweMessage: SiweMessage;
  usedNormalizedMessage: boolean;
} {
  const normalizedMessage = normalizeBaseSiweMessage(message);

  try {
    return {
      siweMessage: new SiweMessage(message),
      usedNormalizedMessage: false,
    };
  } catch (rawError) {
    try {
      return {
        siweMessage: new SiweMessage(normalizedMessage),
        usedNormalizedMessage: true,
      };
    } catch (normalizedError) {
      const chatAuthError = new ChatAuthError('Invalid SIWE message.', 400) as ChatAuthError & {
        diagnostics?: Record<string, unknown>;
      };
      chatAuthError.diagnostics = {
        normalizedReason: getErrorMessage(normalizedError),
        rawReason: getErrorMessage(rawError),
      };
      throw chatAuthError;
    }
  }
}

function getExpectedBaseUrls(request: NextRequest): URL[] {
  const candidates: URL[] = [];
  const originHeader = request.headers.get('origin');
  const hostHeader = request.headers.get('host');
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');

  pushUrlCandidate(candidates, originHeader);
  pushUrlCandidate(candidates, request.nextUrl.origin);
  pushHostCandidate(candidates, forwardedHost, forwardedProto);
  pushHostCandidate(candidates, hostHeader, forwardedProto);

  const explicitBaseUrl = process.env.NEXT_PUBLIC_URL?.trim();
  pushUrlCandidate(candidates, explicitBaseUrl);

  const deduped = new Map<string, URL>();
  candidates.forEach((candidate) => {
    deduped.set(normalizeOrigin(candidate.origin), candidate);
  });

  return Array.from(deduped.values());
}

function getConfiguredBaseUrl(request: NextRequest): URL {
  const expectedUrls = getExpectedBaseUrls(request);
  if (expectedUrls.length > 0) {
    return expectedUrls[0];
  }

  return new URL('https://mini.pixotchi.tech');
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

function getMiniAppBypassAddressFromRequest(
  request: NextRequest,
  fallbackAddress?: string | null,
): string | null {
  const miniAppMarker =
    request.cookies.get(MINIAPP_BYPASS_COOKIE)?.value === '1' ||
    request.headers.get('x-pixotchi-miniapp') === '1';

  if (!miniAppMarker) {
    return null;
  }

  const url = new URL(request.url);
  const candidates = [
    request.headers.get('x-pixotchi-address'),
    request.cookies.get(MINIAPP_BYPASS_ADDRESS_COOKIE)?.value ?? null,
    url.searchParams.get('address'),
    fallbackAddress ?? null,
  ];

  for (const candidate of candidates) {
    if (!candidate) continue;

    const decoded = decodeURIComponent(candidate).trim();
    if (!isValidEthereumAddressFormat(decoded)) {
      continue;
    }

    return normalizeAddress(decoded);
  }

  return null;
}

export async function getChatSessionOrMiniAppBypassFromRequest(
  request: NextRequest,
  options?: {
    fallbackAddress?: string | null;
  },
): Promise<{
  session: ChatSessionRecord | null;
  sessionId: string | null;
  viaMiniAppBypass: boolean;
}> {
  const { session, sessionId } = await getChatSessionFromRequest(request);

  if (session) {
    return {
      session,
      sessionId,
      viaMiniAppBypass: false,
    };
  }

  const bypassAddress = getMiniAppBypassAddressFromRequest(request, options?.fallbackAddress);
  if (!bypassAddress) {
    return {
      session: null,
      sessionId,
      viaMiniAppBypass: false,
    };
  }

  return {
    session: {
      address: bypassAddress,
      createdAt: Date.now(),
      id: 'miniapp-bypass',
      method: 'farcaster-miniapp',
      provider: 'farcaster',
    },
    sessionId,
    viaMiniAppBypass: true,
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
  let usedNormalizedMessage = false;
  try {
    const parsed = parseBaseSiweMessage(payload.message);
    siweMessage = parsed.siweMessage;
    usedNormalizedMessage = parsed.usedNormalizedMessage;
  } catch (error) {
    const normalizedMessage = normalizeBaseSiweMessage(payload.message);
    const diagnostics =
      error instanceof ChatAuthError &&
      'diagnostics' in error &&
      error.diagnostics &&
      typeof error.diagnostics === 'object'
        ? error.diagnostics
        : {};
    logBaseSiweFailure(request, payload, {
      ...diagnostics,
      normalizedLines: getBaseSiweLines(normalizedMessage),
      normalizedPreview: normalizedMessage.slice(0, 400),
      rawLines: getBaseSiweLines(payload.message),
      rawPreview: payload.message.slice(0, 400),
      reason: getErrorMessage(error),
      stage: 'parse',
    });

    if (error instanceof ChatAuthError) {
      throw error;
    }
    throw new ChatAuthError('Invalid SIWE message.', 400);
  }

  const expectedUrls = getExpectedBaseUrls(request);
  const expectedDomains = getExpectedBaseDomains(expectedUrls);
  const expectedOrigins = new Set(expectedUrls.map((url) => normalizeOrigin(url.origin)));
  const normalizedAddress = normalizeAddress(payload.address);

  if (normalizeAddress(siweMessage.address) !== normalizedAddress) {
    logBaseSiweFailure(request, payload, {
      parsedAddress: normalizeAddress(siweMessage.address),
      reason: 'SIWE address does not match the connected wallet.',
      stage: 'address',
      usedNormalizedMessage,
    });
    throw new ChatAuthError('SIWE address does not match the connected wallet.', 400);
  }

  if (!expectedDomains.has(normalizeSiweDomain(siweMessage.domain))) {
    logBaseSiweFailure(request, payload, {
      parsedDomain: normalizeSiweDomain(siweMessage.domain),
      reason: 'Unexpected SIWE domain.',
      stage: 'domain',
      usedNormalizedMessage,
    });
    throw new ChatAuthError('Unexpected SIWE domain.', 400);
  }

  if (Number(siweMessage.chainId) !== base.id) {
    logBaseSiweFailure(request, payload, {
      parsedChainId: Number(siweMessage.chainId),
      reason: 'SIWE signature must target Base mainnet.',
      stage: 'chainId',
      usedNormalizedMessage,
    });
    throw new ChatAuthError('SIWE signature must target Base mainnet.', 400);
  }

  if (siweMessage.uri) {
    try {
      if (!expectedOrigins.has(normalizeOrigin(new URL(siweMessage.uri).origin))) {
        logBaseSiweFailure(request, payload, {
          parsedUri: siweMessage.uri,
          reason: 'Unexpected SIWE origin.',
          stage: 'origin',
          usedNormalizedMessage,
        });
        throw new ChatAuthError('Unexpected SIWE origin.', 400);
      }
    } catch (error) {
      if (error instanceof ChatAuthError) {
        throw error;
      }
      logBaseSiweFailure(request, payload, {
        parsedUri: siweMessage.uri,
        reason: getErrorMessage(error),
        stage: 'origin-parse',
        usedNormalizedMessage,
      });
      throw new ChatAuthError('Invalid SIWE origin.', 400);
    }
  }

  if (!siweMessage.nonce) {
    logBaseSiweFailure(request, payload, {
      reason: 'SIWE nonce is missing.',
      stage: 'nonce-missing',
      usedNormalizedMessage,
    });
    throw new ChatAuthError('SIWE nonce is missing.', 400);
  }

  const isValid = await basePublicClient.verifyMessage({
    address: payload.address as `0x${string}`,
    message: payload.message,
    signature: payload.signature,
  });

  if (!isValid) {
    logBaseSiweFailure(request, payload, {
      reason: 'Invalid Base authentication signature.',
      stage: 'signature',
      usedNormalizedMessage,
    });
    throw new ChatAuthError('Invalid Base authentication signature.', 401);
  }

  const nonceConsumed = await consumeBaseAuthNonce(siweMessage.nonce);
  if (!nonceConsumed) {
    logBaseSiweFailure(request, payload, {
      reason: 'Invalid or reused Base authentication nonce.',
      stage: 'nonce-consume',
      usedNormalizedMessage,
    });
    throw new ChatAuthError('Invalid or reused Base authentication nonce.', 400);
  }

  return {
    address: normalizedAddress,
    method: 'base-siwe',
    provider: 'base',
  };
}
