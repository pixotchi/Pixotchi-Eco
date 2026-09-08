import { expect, type Page } from '@playwright/test';

/** The public session DTO contains no cookie, signature or private wallet data. */
export async function expectSignedSession(page: Page, expectedAddress?: string) {
  await expect.poll(async () => page.evaluate(async (address) => {
    const response = await fetch('/api/chat/auth/session', { credentials: 'include', cache: 'no-store' });
    if (!response.ok) return false;
    const value: unknown = await response.json();
    if (!value || typeof value !== 'object') return false;
    const session = value as Record<string, unknown>;
    return session.authenticated === true && session.provider === 'base' && session.method === 'base-siwe'
      && typeof session.address === 'string'
      && (!address || session.address.toLowerCase() === address.toLowerCase());
  }, expectedAddress), { message: 'The actual server must accept and retain this wallet’s signed session', timeout: 30_000, intervals: [2_000] }).toBe(true);
}
