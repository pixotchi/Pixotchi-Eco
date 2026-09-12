/** Configuration requests sponsorship; it does not prove a wallet will receive it. */
export function resolvePaymasterUrl(cdpUrl?: string, serviceUrl?: string): string | undefined {
  for (const value of [cdpUrl, serviceUrl]) {
    if (!value?.trim()) continue;
    try {
      const url = new URL(value.trim());
      if (url.protocol === 'https:' && !url.username && !url.password) return url.toString();
    } catch { /* Ignore invalid configuration. */ }
  }
  return undefined;
}

export function getConfiguredPaymasterUrl(): string | undefined {
  return resolvePaymasterUrl(
    process.env.NEXT_PUBLIC_CDP_PAYMASTER_URL,
    process.env.NEXT_PUBLIC_PAYMASTER_SERVICE_URL,
  );
}
