import { SiweMessage } from 'siwe';
import { normalizeVerifyWalletAddress } from './verify-claim-records';

const DEFAULT_VERIFY_APP_URL = 'https://mini.pixotchi.tech';
const VERIFY_CHAIN_ID = 8453;
const VERIFY_PROVIDER = 'x';
const VERIFY_ACTION = 'claim_free_plant';
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;
const MAX_MESSAGE_LENGTH = 8_192;

export class VerifyClaimPrincipalError extends Error {
  constructor(message: string, readonly status: number = 400) {
    super(message);
    this.name = 'VerifyClaimPrincipalError';
  }
}

export type VerifyClaimPrincipal = {
  address: string;
  action: typeof VERIFY_ACTION;
  provider: typeof VERIFY_PROVIDER;
};

type ResolveVerifyClaimPrincipalOptions = {
  claimedAddress?: unknown;
  claimedProvider?: unknown;
  expectedAppUrl?: string;
  nowMs?: number;
};

function parseExpectedAppUrl(value?: string): URL {
  try {
    const url = new URL(value?.trim() || process.env.NEXT_PUBLIC_URL?.trim() || DEFAULT_VERIFY_APP_URL);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('unsupported protocol');
    }
    return url;
  } catch {
    throw new VerifyClaimPrincipalError('Verify claim app URL is misconfigured.', 500);
  }
}

function parseTime(value: string | undefined, field: string): number | null {
  if (!value) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new VerifyClaimPrincipalError(`Invalid SIWE ${field}.`);
  }
  return parsed;
}

/**
 * Parses the exact SIWE message sent to Base Verify and derives the claim
 * principal from its signed fields. Legacy body address/provider fields are
 * accepted only as consistency assertions and never become authoritative.
 */
export function resolveVerifyClaimPrincipal(
  message: unknown,
  options: ResolveVerifyClaimPrincipalOptions = {},
): VerifyClaimPrincipal {
  if (typeof message !== 'string' || message.length === 0 || message.length > MAX_MESSAGE_LENGTH) {
    throw new VerifyClaimPrincipalError('A valid SIWE message is required.');
  }

  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(message);
  } catch {
    throw new VerifyClaimPrincipalError('Invalid SIWE message.');
  }

  const address = normalizeVerifyWalletAddress(siwe.address);
  if (!address) {
    throw new VerifyClaimPrincipalError('Invalid SIWE wallet address.');
  }

  const expectedUrl = parseExpectedAppUrl(options.expectedAppUrl);
  if (siwe.domain.toLowerCase() !== expectedUrl.hostname.toLowerCase()) {
    throw new VerifyClaimPrincipalError('Unexpected SIWE domain.');
  }

  let messageOrigin: string;
  try {
    messageOrigin = new URL(siwe.uri).origin;
  } catch {
    throw new VerifyClaimPrincipalError('Invalid SIWE URI.');
  }
  if (messageOrigin !== expectedUrl.origin) {
    throw new VerifyClaimPrincipalError('Unexpected SIWE URI.');
  }

  if (siwe.version !== '1' || siwe.chainId !== VERIFY_CHAIN_ID) {
    throw new VerifyClaimPrincipalError('SIWE message must target Base mainnet.');
  }

  const nowMs = options.nowMs ?? Date.now();
  const issuedAtMs = parseTime(siwe.issuedAt, 'issued-at time');
  const notBeforeMs = parseTime(siwe.notBefore, 'not-before time');
  const expirationMs = parseTime(siwe.expirationTime, 'expiration time');
  if (issuedAtMs === null || expirationMs === null) {
    throw new VerifyClaimPrincipalError('SIWE issued-at and expiration times are required.');
  }
  if (issuedAtMs > nowMs + MAX_CLOCK_SKEW_MS) {
    throw new VerifyClaimPrincipalError('SIWE message was issued in the future.');
  }
  if (notBeforeMs !== null && notBeforeMs > nowMs + MAX_CLOCK_SKEW_MS) {
    throw new VerifyClaimPrincipalError('SIWE message is not valid yet.');
  }
  if (expirationMs < nowMs - MAX_CLOCK_SKEW_MS || expirationMs <= issuedAtMs) {
    throw new VerifyClaimPrincipalError('SIWE message has expired.');
  }

  const resources = siwe.resources ?? [];
  const providerPrefix = `urn:verify:provider:${VERIFY_PROVIDER}`;
  const providerResources = resources.filter((resource) => resource.startsWith('urn:verify:provider:'));
  if (
    providerResources.length === 0
    || providerResources.some(
      (resource) => resource !== providerPrefix && !resource.startsWith(`${providerPrefix}:`),
    )
  ) {
    throw new VerifyClaimPrincipalError('SIWE message must request the X verification provider.');
  }

  const actionResources = resources.filter((resource) => resource.startsWith('urn:verify:action:'));
  if (actionResources.length !== 1 || actionResources[0] !== `urn:verify:action:${VERIFY_ACTION}`) {
    throw new VerifyClaimPrincipalError('SIWE message contains an invalid verification action.');
  }

  if (options.claimedAddress !== undefined) {
    if (typeof options.claimedAddress !== 'string') {
      throw new VerifyClaimPrincipalError('Invalid wallet address field.');
    }
    const claimedAddress = normalizeVerifyWalletAddress(options.claimedAddress);
    if (!claimedAddress || claimedAddress !== address) {
      throw new VerifyClaimPrincipalError('Wallet address does not match the signed SIWE principal.');
    }
  }

  if (
    options.claimedProvider !== undefined
    && (typeof options.claimedProvider !== 'string' || options.claimedProvider.trim() !== VERIFY_PROVIDER)
  ) {
    throw new VerifyClaimPrincipalError('Verification provider does not match the signed SIWE request.');
  }

  return {
    address,
    action: VERIFY_ACTION,
    provider: VERIFY_PROVIDER,
  };
}
