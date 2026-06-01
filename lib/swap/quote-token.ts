import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { isSwapTokenId } from './constants';
import type { SwapStepKind, SwapTokenId, UserSwapTokenId } from './types';

// Stateless quote binding: /api/swap/quote signs a payload describing the
// quoted swap plus the exact executable step(s) and hands the token back to
// the client. /api/swap/build-step verifies the HMAC and treats the payload as
// the authoritative source of truth — no Redis round-trip, no storage cost.
//
// This replaces the prior Redis-backed quote store. We lose "single-use"
// enforcement (a token can be replayed to the build endpoint until it
// expires), but that doesn't unlock any real attack: executing the swap
// still requires the user's wallet signature, and Kyber's own deadline
// bounds on-chain replay. Rate limits handle quota abuse.

const TOKEN_VERSION = 'v2';

const QUOTE_STEP_KINDS: ReadonlySet<SwapStepKind> = new Set([
  'kyber',
  'baseswap_seed',
]);

export interface QuoteTokenStep {
  key: 'step1' | 'step2';
  kind: SwapStepKind;
  sellToken: SwapTokenId;
  buyToken: SwapTokenId;
  amountIn: string;
}

export interface QuoteTokenPayload {
  v: typeof TOKEN_VERSION;
  sender: string | null;
  sellToken: UserSwapTokenId;
  buyToken: UserSwapTokenId;
  amountIn: string;
  steps: QuoteTokenStep[];
  expiresAt: number;
  jti: string;
}

function isQuoteTokenStep(value: UntypedValue): value is QuoteTokenStep {
  if (!value || typeof value !== 'object') return false;

  const candidate = value as Record<string, UntypedValue>;
  return (
    (candidate.key === 'step1' || candidate.key === 'step2') &&
    typeof candidate.kind === 'string' &&
    QUOTE_STEP_KINDS.has(candidate.kind as SwapStepKind) &&
    typeof candidate.sellToken === 'string' &&
    isSwapTokenId(candidate.sellToken) &&
    typeof candidate.buyToken === 'string' &&
    isSwapTokenId(candidate.buyToken) &&
    typeof candidate.amountIn === 'string' &&
    /^\d+$/.test(candidate.amountIn)
  );
}

function getSecret(): string {
  const secret = process.env.SWAP_QUOTE_SIGNING_SECRET;
  if (secret && secret.length >= 32) return secret;

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'SWAP_QUOTE_SIGNING_SECRET must be set to a value of at least 32 characters in production.',
    );
  }
  // Dev-only fallback. Changes per-process, which is fine for local testing.
  return 'pixotchi-dev-swap-token-fallback-secret-0123456789abcdef';
}

function b64url(buffer: Buffer): string {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function fromB64url(value: string): Buffer {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
  const pad = normalized.length % 4 === 0 ? '' : '='.repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + pad, 'base64');
}

export function signQuoteToken(
  payload: Omit<QuoteTokenPayload, 'v' | 'jti'>,
): string {
  const full: QuoteTokenPayload = {
    v: TOKEN_VERSION,
    jti: b64url(randomBytes(12)),
    ...payload,
  };
  const body = b64url(Buffer.from(JSON.stringify(full), 'utf8'));
  const mac = createHmac('sha256', getSecret()).update(body).digest();
  return `${body}.${b64url(mac)}`;
}

export function verifyQuoteToken(token: string): QuoteTokenPayload | null {
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) {
    return null;
  }

  const dotIndex = token.indexOf('.');
  if (dotIndex <= 0 || dotIndex === token.length - 1) return null;

  const body = token.slice(0, dotIndex);
  const macPart = token.slice(dotIndex + 1);

  let providedMac: Buffer;
  try {
    providedMac = fromB64url(macPart);
  } catch {
    return null;
  }

  const expectedMac = createHmac('sha256', getSecret()).update(body).digest();
  if (providedMac.length !== expectedMac.length) return null;
  if (!timingSafeEqual(providedMac, expectedMac)) return null;

  try {
    const decoded = JSON.parse(fromB64url(body).toString('utf8')) as QuoteTokenPayload;
    if (decoded.v !== TOKEN_VERSION) return null;
    if (typeof decoded.expiresAt !== 'number') return null;
    if (!Array.isArray(decoded.steps) || decoded.steps.length === 0) return null;
    if (!decoded.steps.every((step) => isQuoteTokenStep(step))) return null;
    if (Date.now() >= decoded.expiresAt) return null;
    return decoded;
  } catch {
    return null;
  }
}
