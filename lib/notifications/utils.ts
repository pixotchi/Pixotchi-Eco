import { getAddress } from 'viem';

export const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function chunkArray<T>(items: T[], size: number): T[][] {
  if (size <= 0) {
    return [items];
  }

  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

export function normalizeWalletAddress(value: string | null | undefined): string | null {
  const trimmed = String(value || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    return getAddress(trimmed).toLowerCase();
  } catch {
    return null;
  }
}

export function uniqueWalletAddresses(values: Iterable<string | null | undefined>): string[] {
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = normalizeWalletAddress(value);
    if (normalized) {
      seen.add(normalized);
    }
  }

  return Array.from(seen);
}

export function parseWalletAddressInput(input: string): string[] {
  return uniqueWalletAddresses(input.split(/[\s,;]+/g));
}

export function normalizeTargetPath(path?: string | null): string | undefined {
  const trimmed = String(path || '').trim();
  if (!trimmed) {
    return undefined;
  }

  return trimmed.startsWith('/') ? trimmed : `/${trimmed.replace(/^\/+/, '')}`;
}
