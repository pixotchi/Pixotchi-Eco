import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { nanoid } from 'nanoid';
import { base } from 'viem/chains';
import { createClient as createFarcasterQuickAuthClient } from '@farcaster/quick-auth';
import { InvalidAuthTokenError, PrivyClient } from '@privy-io/node';
import { getBaseReadClient } from '@/lib/base-rpc';
import { getPrivyChatAuthConfigStatus } from '@/lib/env-config';
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

interface ParsedBaseSiweMessage {
  address: string;
  chainId: number;
  domain: string;
  expirationTime?: Date;
  issuedAt: Date;
  nonce: string;
  notBefore?: Date;
  requestId?: string;
  resources?: string[];
  scheme?: string;
  statement?: string;
  uri: string;
  version: string;
}

interface PrivyChatAuthPayload {
  accessToken?: string | null;
  expectedAddress?: string | null;
  identityToken?: string | null;
  solanaAddress?: string | null;
}

interface FarcasterChatAuthPayload {
  expectedAddress?: string | null;
  token: string;
}

const CHAT_SESSION_COOKIE_NAME = 'pixotchi_chat_session';
const CHAT_SESSION_TTL_SECONDS = 60 * 60 * 24 * 14;
const BASE_AUTH_NONCE_TTL_SECONDS = 60 * 10;
const FARCASTER_AUTH_ADDRESS_CACHE_TTL_SECONDS = 60 * 60 * 24;
const BASE_NONCE_CONSUME_SCRIPT = `
if redis.call("EXISTS", KEYS[1]) == 1 then
  redis.call("DEL", KEYS[1])
  return 1
end
return 0
`;

const basePublicClient = getBaseReadClient();
let privyServerClientCache:
  | {
      cacheKey: string;
      client: PrivyClient;
    }
  | null = null;

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

function getFarcasterAuthAddressKey(fid: number): string {
  return `chat:auth:farcaster:primary-address:${fid}`;
}

function normalizeAddress(address: string): string {
  return address.toLowerCase();
}

function isFarcasterInvalidTokenError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('name' in error)) {
    return false;
  }

  const name = (error as { name?: unknown }).name;
  if (typeof name !== 'string') {
    return false;
  }

  return (
    name === 'InvalidToken' ||
    name.startsWith('JWT') ||
    name.startsWith('JWS') ||
    name.startsWith('JOSE') ||
    name === 'JWKSNoMatchingKey' ||
    name === 'JWKSTimeout'
  );
}

async function resolveFarcasterAuthAddressFromFid(fid: number): Promise<string | null> {
  try {
    const cached = await redisGetJSON<string>(getFarcasterAuthAddressKey(fid));
    if (typeof cached === 'string' && isValidEthereumAddressFormat(cached)) {
      return normalizeAddress(cached);
    }
  } catch {
    // Ignore cache lookup failures and fall back to the Farcaster API.
  }

  try {
    const response = await fetch(
      `https://api.farcaster.xyz/fc/primary-address?fid=${fid}&protocol=ethereum`,
      { cache: 'no-store' },
    );

    if (!response.ok) {
      return null;
    }

    const payload = await response.json();
    const address = payload?.result?.address?.address;
    if (typeof address !== 'string' || !isValidEthereumAddressFormat(address)) {
      return null;
    }

    const normalizedAddress = normalizeAddress(address);
    await redisSetJSON(
      getFarcasterAuthAddressKey(fid),
      normalizedAddress,
      FARCASTER_AUTH_ADDRESS_CACHE_TTL_SECONDS,
    );
    return normalizedAddress;
  } catch {
    return null;
  }
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

const BASE_SIWE_PREFIX_REGEX =
  /^(?:([a-zA-Z][a-zA-Z0-9+-.]*):\/\/)?([a-zA-Z0-9+-.]*(?::[0-9]{1,5})?) (?:wants you to sign in with your Ethereum account:\n)(0x[a-fA-F0-9]{40})\n\n(?:(.*)\n\n)?/;
const BASE_SIWE_SUFFIX_REGEX =
  /(?:URI: (.+))\n(?:Version: (.+))\n(?:Chain ID: ([^\n]+))\n(?:Nonce: ([a-zA-Z0-9]+))\n(?:Issued At: (.+))(?:\nExpiration Time: (.+))?(?:\nNot Before: (.+))?(?:\nRequest ID: (.+))?/;

function normalizeBaseSiweChainIdValue(chainId: string): string {
  const trimmed = chainId.trim();
  const caipMatch = trimmed.match(/^eip155:(\d+)$/i);

  if (caipMatch) {
    return caipMatch[1];
  }

  if (/^0x[0-9a-fA-F]+$/.test(trimmed)) {
    const parsed = Number.parseInt(trimmed, 16);
    if (Number.isFinite(parsed)) {
      return String(parsed);
    }
  }

  return trimmed;
}

function normalizeBaseSiweLine(line: string): string {
  const trimmed = line.trimStart();
  const fieldMatch = trimmed.match(/^([^:]+):\s*(.*)$/);

  if (!fieldMatch) {
    return trimmed;
  }

  const [, rawLabel, rawValue] = fieldMatch;
  const label = rawLabel.trim().toLowerCase().replace(/\s+/g, ' ');
  const value = rawValue.trim();

  switch (label) {
    case 'uri':
      return `URI: ${value}`;
    case 'version':
      return `Version: ${value}`;
    case 'chain id':
    case 'chainid':
      return `Chain ID: ${normalizeBaseSiweChainIdValue(value)}`;
    case 'nonce':
      return `Nonce: ${value}`;
    case 'issued at':
      return `Issued At: ${value}`;
    case 'expiration time':
      return `Expiration Time: ${value}`;
    case 'not before':
      return `Not Before: ${value}`;
    case 'request id':
      return `Request ID: ${value}`;
    case 'resources':
      return 'Resources:';
    default:
      return trimmed;
  }
}

function normalizeBaseSiweMessage(message: string): string {
  return message
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map(normalizeBaseSiweLine)
    .join('\n')
    .trim();
}

function parseRequiredBaseSiweDate(label: string, value: string): Date {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    throw new ChatAuthError(`Invalid SIWE ${label}.`, 400);
  }

  return date;
}

function parseBaseSiweChainId(value: string): number {
  const normalized = normalizeBaseSiweChainIdValue(value);

  if (!/^\d+$/.test(normalized)) {
    throw new ChatAuthError('Invalid SIWE chain ID.', 400);
  }

  const chainId = Number.parseInt(normalized, 10);
  if (!Number.isFinite(chainId)) {
    throw new ChatAuthError('Invalid SIWE chain ID.', 400);
  }

  return chainId;
}

function parseBaseSiweMessage(message: string): ParsedBaseSiweMessage {
  const normalizedMessage = normalizeBaseSiweMessage(message);
  const prefixMatch = normalizedMessage.match(BASE_SIWE_PREFIX_REGEX);
  const suffixMatch = normalizedMessage.match(BASE_SIWE_SUFFIX_REGEX);

  if (!prefixMatch || !suffixMatch) {
    throw new ChatAuthError('Invalid SIWE message.', 400);
  }

  const [, scheme, domain, address, statement] = prefixMatch;
  const [
    ,
    uri,
    version,
    chainId,
    nonce,
    issuedAt,
    expirationTime,
    notBefore,
    requestId,
  ] = suffixMatch;

  if (!address || !domain || !uri || !version || !issuedAt || !nonce || !chainId) {
    throw new ChatAuthError('Invalid SIWE message.', 400);
  }

  if (version.trim() !== '1') {
    throw new ChatAuthError('Invalid SIWE version.', 400);
  }

  const resources = normalizedMessage
    .split('Resources:')[1]
    ?.split('\n- ')
    .slice(1)
    .map((resource) => resource.trim())
    .filter(Boolean);

  return {
    address,
    chainId: parseBaseSiweChainId(chainId),
    domain,
    ...(expirationTime ? { expirationTime: parseRequiredBaseSiweDate('expiration time', expirationTime) } : {}),
    issuedAt: parseRequiredBaseSiweDate('issued at', issuedAt),
    nonce,
    ...(notBefore ? { notBefore: parseRequiredBaseSiweDate('not before', notBefore) } : {}),
    ...(requestId ? { requestId } : {}),
    ...(resources?.length ? { resources } : {}),
    ...(scheme ? { scheme } : {}),
    ...(statement ? { statement } : {}),
    uri,
    version,
  };
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

export function setChatSessionCookie(response: NextResponse, sessionId: string) {
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

export function createChatAuthErrorResponse(error: ChatAuthError): NextResponse {
  if (error.status === 503) {
    return createChatUnavailableResponse(error.message);
  }

  return NextResponse.json(
    { error: error.message },
    {
      headers: buildPrivateNoStoreHeaders(),
      status: error.status,
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
    const evalFn = (redis as UntypedValue)?.eval;
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
  if (session) {
    void redisSetJSON(getChatSessionKey(sessionId), session, CHAT_SESSION_TTL_SECONDS).catch(
      (error) => {
        console.warn('[chat-auth] Failed to refresh public chat session TTL.', error);
      },
    );
  }
  return {
    session,
    sessionId,
  };
}

export function getFarcasterQuickAuthTokenFromRequest(request: NextRequest): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization) {
    return null;
  }

  const match = authorization.match(/^Bearer\s+(.+)$/i);
  const token = match?.[1]?.trim();
  return token || null;
}

export async function getChatSessionOrQuickAuthFromRequest(
  request: NextRequest,
): Promise<{
  session: ChatSessionRecord | null;
  sessionId: string | null;
  viaQuickAuth: boolean;
}> {
  const { session, sessionId } = await getChatSessionFromRequest(request);

  if (session) {
    return {
      session,
      sessionId,
      viaQuickAuth: false,
    };
  }

  const token = getFarcasterQuickAuthTokenFromRequest(request);
  if (!token) {
    return {
      session: null,
      sessionId,
      viaQuickAuth: false,
    };
  }

  const identity = await verifyFarcasterChatIdentity(request, { token });

  return {
    session: {
      address: identity.address,
      createdAt: Date.now(),
      id: 'farcaster-quick-auth',
      method: identity.method,
      provider: identity.provider,
      ...(identity.fid ? { fid: identity.fid } : {}),
    },
    sessionId,
    viaQuickAuth: true,
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
  const configStatus = getPrivyChatAuthConfigStatus();
  if (!configStatus.ready) {
    throw new ChatAuthError('Privy server authentication is not configured.', 503);
  }

  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID!.trim();
  const appSecret = process.env.PRIVY_APP_SECRET!.trim();
  const jwtVerificationKey = process.env.PRIVY_JWT_VERIFICATION_KEY?.trim() || undefined;
  const cacheKey = `${appId}:${appSecret}:${jwtVerificationKey ?? ''}`;

  if (!privyServerClientCache || privyServerClientCache.cacheKey !== cacheKey) {
    privyServerClientCache = {
      cacheKey,
      client: new PrivyClient({
        appId,
        appSecret,
        ...(jwtVerificationKey ? { jwtVerificationKey } : {}),
      }),
    };
  }

  return privyServerClientCache.client;
}

function getPrivyWalletAccounts(user: UntypedValue, chainType: 'ethereum' | 'solana'): Array<{ address: string }> {
  const linkedAccounts = Array.isArray(user?.linkedAccounts)
    ? user.linkedAccounts
    : Array.isArray(user?.linked_accounts)
      ? user.linked_accounts
      : [];

  return linkedAccounts.filter((account: UntypedValue) => {
    const accountChainType =
      typeof account?.chainType === 'string'
        ? account.chainType
        : typeof account?.chain_type === 'string'
          ? account.chain_type
          : null;

    return (
      account?.type === 'wallet' &&
      accountChainType === chainType &&
      typeof account?.address === 'string'
    );
  });
}

export async function verifyPrivyChatIdentity(
  payload: PrivyChatAuthPayload,
): Promise<ChatIdentity> {
  const expectedAddress = payload.expectedAddress ? normalizeAddress(payload.expectedAddress) : null;
  const privy = getPrivyServerClient();
  const identityToken = payload.identityToken?.trim() || null;
  const accessToken = payload.accessToken?.trim() || null;

  if (!identityToken && !accessToken) {
    throw new ChatAuthError('Privy identity or access token is required.', 400);
  }

  let user: UntypedValue;
  let userId: string;

  try {
    if (identityToken) {
      user = await privy.users().get({ id_token: identityToken });
      userId = typeof user?.id === 'string' ? user.id : '';
      if (!userId) {
        throw new ChatAuthError('Privy identity token is missing a valid user ID.', 401);
      }
    } else {
      const claims = await privy.utils().auth().verifyAccessToken(accessToken!);
      user = await privy.users()._get(claims.user_id);
      userId = claims.user_id;
    }
  } catch (error) {
    if (error instanceof ChatAuthError) {
      throw error;
    }

    if (error instanceof InvalidAuthTokenError) {
      throw new ChatAuthError('Invalid Privy token.', 401);
    }

    throw error;
  }

  if (payload.solanaAddress) {
    const normalizedSolanaAddress = payload.solanaAddress.trim();
    const solanaWallets = getPrivyWalletAccounts(user, 'solana');
    const matchedWallet = solanaWallets.find((wallet) => wallet.address === normalizedSolanaAddress);

    if (!matchedWallet) {
      throw new ChatAuthError('Privy Solana session does not match the connected wallet.', 401);
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
      userId,
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
    userId,
  };
}

export async function verifyFarcasterChatIdentity(
  request: NextRequest,
  payload: FarcasterChatAuthPayload,
): Promise<ChatIdentity> {
  const token = payload.token?.trim();
  if (!token) {
    throw new ChatAuthError('Farcaster Quick Auth token is required.', 401);
  }

  const quickAuthClient = createFarcasterQuickAuthClient();
  let verified: { sub?: UntypedValue };

  try {
    verified = await quickAuthClient.verifyJwt({
      domain: getExpectedDomain(request),
      token,
    }) as { sub?: UntypedValue };
  } catch (error) {
    if (isFarcasterInvalidTokenError(error)) {
      throw new ChatAuthError('Invalid Farcaster Quick Auth token.', 401);
    }

    throw error;
  }

  const fid = typeof verified.sub === 'number'
    ? verified.sub
    : Number.parseInt(String(verified.sub ?? ''), 10);

  if (!Number.isFinite(fid)) {
    throw new ChatAuthError('Farcaster Quick Auth token is missing a valid fid.', 401);
  }

  const normalizedAddress = await resolveFarcasterAuthAddressFromFid(fid);
  if (!normalizedAddress) {
    throw new ChatAuthError('Farcaster Quick Auth address could not be resolved.', 401);
  }

  const expectedAddress = payload.expectedAddress ? normalizeAddress(payload.expectedAddress) : null;
  if (expectedAddress && normalizedAddress !== expectedAddress) {
    throw new ChatAuthError('Farcaster Quick Auth address does not match the connected wallet.', 401);
  }

  return {
    address: normalizedAddress,
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

  const siweMessage = parseBaseSiweMessage(payload.message);

  const expectedUrls = getExpectedBaseUrls(request);
  const expectedDomains = getExpectedBaseDomains(expectedUrls);
  const expectedOrigins = new Set(expectedUrls.map((url) => normalizeOrigin(url.origin)));
  const normalizedAddress = normalizeAddress(payload.address);

  if (normalizeAddress(siweMessage.address) !== normalizedAddress) {
    throw new ChatAuthError('SIWE address does not match the connected wallet.', 400);
  }

  if (!expectedDomains.has(normalizeSiweDomain(siweMessage.domain))) {
    throw new ChatAuthError('Unexpected SIWE domain.', 400);
  }

  if (Number(siweMessage.chainId) !== base.id) {
    throw new ChatAuthError('SIWE signature must target Base mainnet.', 400);
  }

  if (siweMessage.uri) {
    try {
      if (!expectedOrigins.has(normalizeOrigin(new URL(siweMessage.uri).origin))) {
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

  const isValid = await basePublicClient.verifyMessage({
    address: payload.address as `0x${string}`,
    message: payload.message,
    signature: payload.signature,
  });

  if (!isValid) {
    throw new ChatAuthError('Invalid Base authentication signature.', 401);
  }

  const nonceConsumed = await consumeBaseAuthNonce(siweMessage.nonce);
  if (!nonceConsumed) {
    throw new ChatAuthError('Invalid or reused Base authentication nonce.', 400);
  }

  return {
    address: normalizedAddress,
    method: 'base-siwe',
    provider: 'base',
  };
}
