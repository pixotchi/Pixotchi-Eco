import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { getAddress, isAddress } from 'viem';
import { z } from 'zod';
import { BASE_CHAIN_ID, getKyberTokenAddress, isUserSwapTokenId, MARKET_SLIPPAGE_BPS, SEED_TAX_BPS, SWAP_QUOTE_TTL_MS } from './constants';
import { isAllowedUserSwapPair } from './rules';
import { readUint } from '../contract-value';

// Stateless quote binding: /api/swap/quote signs a payload describing the
// quoted swap plus the exact executable step(s) and hands the token back to
// the client. /api/swap/build-step verifies the HMAC and treats the payload as
// the authoritative source of truth — no Redis round-trip, no storage cost.
//
// This replaces the prior Redis-backed quote store. We lose "single-use"
// enforcement (a token can be replayed to the build endpoint until it
// expires), but that doesn't unlock any real attack: executing the swap
// still requires the user's wallet signature, and Kyber's own deadline
// bounds onchain replay. Rate limits handle quota abuse.

const TOKEN_VERSION = 'v3';
const address = z.string().refine(isAddress).transform(value => getAddress(value).toLowerCase());
const amount = z.string().regex(/^[1-9]\d*$/).max(78).refine(value => {
  try { readUint(value); return true; } catch { return false; }
});
const token = z.string().refine(isUserSwapTokenId);
const terms = {
  sellToken: token, buyToken: token, amountIn: amount, expectedOut: amount, minOut: amount,
  taxBps: z.number().int().min(0).max(10_000), marketSlippageBps: z.literal(MARKET_SLIPPAGE_BPS),
};
const payloadSchema = z.strictObject({
  v: z.literal(TOKEN_VERSION), jti: z.string().min(1).max(32),
  chainId: z.literal(BASE_CHAIN_ID), strategy: z.literal('single_kyber'),
  sender: address.nullable(), recipient: address.nullable(),
  ...terms,
  steps: z.tuple([z.strictObject({ key: z.literal('step1'), kind: z.literal('kyber'), ...terms,
    sellAddress: address, buyAddress: address })]),
  issuedAt: z.number().int().nonnegative(), expiresAt: z.number().int().nonnegative(),
}).refine(payload => {
  const step = payload.steps[0];
  return payload.sender === payload.recipient
    && isAllowedUserSwapPair(payload.sellToken, payload.buyToken)
    && payload.expiresAt > payload.issuedAt
    && payload.expiresAt - payload.issuedAt <= SWAP_QUOTE_TTL_MS
    && BigInt(payload.minOut) <= BigInt(payload.expectedOut)
    && payload.taxBps === (payload.sellToken === 'SEED' || payload.buyToken === 'SEED' ? SEED_TAX_BPS : 0)
    && Object.keys(terms).every(key => step[key as keyof typeof terms] === payload[key as keyof typeof terms])
    && step.sellAddress === getKyberTokenAddress(payload.sellToken).toLowerCase()
    && step.buyAddress === getKyberTokenAddress(payload.buyToken).toLowerCase();
});

export type QuoteTokenPayload = z.infer<typeof payloadSchema>;

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
  const full = payloadSchema.parse({
    v: TOKEN_VERSION,
    jti: b64url(randomBytes(12)),
    ...payload,
  });
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
    const decoded = payloadSchema.parse(JSON.parse(fromB64url(body).toString('utf8')));
    if (Date.now() >= decoded.expiresAt || decoded.issuedAt > Date.now()) return null;
    return decoded;
  } catch {
    return null;
  }
}
