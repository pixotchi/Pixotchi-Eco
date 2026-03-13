export const MINIAPP_BYPASS_COOKIE = 'pixotchi_miniapp';
export const MINIAPP_BYPASS_ADDRESS_COOKIE = 'pixotchi_miniapp_address';

function getCookieAttributes(maxAge: number): string {
  const secure = typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  return `Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`;
}

export function setMiniAppBypassCookies(address: string) {
  if (typeof document === 'undefined') return;

  const normalized = address.toLowerCase();
  document.cookie = `${MINIAPP_BYPASS_COOKIE}=1; ${getCookieAttributes(60 * 60 * 24 * 7)}`;
  document.cookie = `${MINIAPP_BYPASS_ADDRESS_COOKIE}=${encodeURIComponent(normalized)}; ${getCookieAttributes(60 * 60 * 24 * 7)}`;
}

export function clearMiniAppBypassCookies() {
  if (typeof document === 'undefined') return;

  document.cookie = `${MINIAPP_BYPASS_COOKIE}=; ${getCookieAttributes(0)}`;
  document.cookie = `${MINIAPP_BYPASS_ADDRESS_COOKIE}=; ${getCookieAttributes(0)}`;
}
