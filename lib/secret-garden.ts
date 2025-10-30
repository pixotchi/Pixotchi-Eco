import crypto from "node:crypto";
import { THEMES, type Theme } from "@/lib/theme-utils";

export const SECRET_GARDEN_PROGRESS_COOKIE = "pixotchi_sg_progress";
export const SECRET_GARDEN_TOKEN_COOKIE = "pixotchi_sg_token";

const PROGRESS_TIMEOUT_MS = 15_000;
const TOKEN_TTL_MS = 5 * 60 * 1000;

function getSigningKey(): string {
  const key =
    process.env.SECRET_GARDEN_SIGNING_KEY ||
    process.env.SECRET_GARDEN_SEQUENCE ||
    process.env.NEXT_PUBLIC_THEME_KONAMI_SEQUENCE;

  if (!key) {
    throw new Error("Secret garden signing key is not configured");
  }

  return key;
}

export function getSecretGardenSequence(): Theme[] {
  const raw =
    process.env.SECRET_GARDEN_SEQUENCE ||
    process.env.NEXT_PUBLIC_THEME_KONAMI_SEQUENCE;

  if (!raw) {
    throw new Error("Secret garden sequence is not configured");
  }

  const sequence = raw
    .split(",")
    .map((token) => token.trim().toLowerCase())
    .filter((token): token is Theme => Boolean(THEMES[token as Theme]));

  if (sequence.length !== 5) {
    throw new Error("Secret garden sequence must contain exactly five valid themes");
  }

  return sequence;
}

function signPayload(payload: string): string {
  return crypto.createHmac("sha256", getSigningKey()).update(payload).digest("hex");
}

export function parseProgressCookie(value: string | undefined, now = Date.now()) {
  if (!value) {
    return { progress: 0, expired: true } as const;
  }

  const parts = value.split(".");
  if (parts.length !== 3) {
    return { progress: 0, expired: true } as const;
  }

  const [progressStr, expiresAtStr, signature] = parts;
  const payload = `${progressStr}.${expiresAtStr}`;

  if (signPayload(payload) !== signature) {
    return { progress: 0, expired: true } as const;
  }

  const progress = Number.parseInt(progressStr, 10);
  const expiresAt = Number.parseInt(expiresAtStr, 10);

  if (!Number.isFinite(progress) || progress < 0 || Number.isNaN(expiresAt)) {
    return { progress: 0, expired: true } as const;
  }

  if (expiresAt <= now) {
    return { progress: 0, expired: true } as const;
  }

  return { progress, expired: false } as const;
}

export function serializeProgressCookie(progress: number, now = Date.now()) {
  const expiresAt = now + PROGRESS_TIMEOUT_MS;
  const payload = `${progress}.${expiresAt}`;
  const signature = signPayload(payload);
  return {
    value: `${payload}.${signature}`,
    maxAge: Math.ceil(PROGRESS_TIMEOUT_MS / 1000),
  } as const;
}

export function createUnlockToken(now = Date.now()) {
  const nonce = crypto.randomUUID().replace(/-/g, "");
  const payload = `${now}.${nonce}`;
  const signature = signPayload(payload);
  const token = `${payload}.${signature}`;
  return {
    token,
    signature: signPayload(token),
    maxAge: Math.ceil(TOKEN_TTL_MS / 1000),
  } as const;
}

export function verifyUnlockToken(token: string, now = Date.now()) {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return false;
  }

  const [issuedAtStr, nonce, signature] = parts;
  const payload = `${issuedAtStr}.${nonce}`;

  if (signPayload(payload) !== signature) {
    return false;
  }

  const issuedAt = Number.parseInt(issuedAtStr, 10);
  if (!Number.isFinite(issuedAt)) {
    return false;
  }

  if (issuedAt > now + 60_000) {
    return false;
  }

  if (now - issuedAt > TOKEN_TTL_MS) {
    return false;
  }

  return true;
}

export function signTokenForCookie(token: string): string {
  return signPayload(token);
}

