'use client';

import { getHostEnvironmentSnapshot } from '@/lib/host-environment';

/** Preserve the click's browser activation and report blocked destinations. */
export async function openBroadcastUrl(url: string): Promise<void> {
  const target = new URL(url, window.location.origin);
  if (target.protocol !== 'http:' && target.protocol !== 'https:') throw new Error('Unsupported announcement link');
  if (target.origin === window.location.origin) {
    window.location.assign(target.href);
    return;
  }
  if (getHostEnvironmentSnapshot().isMiniApp) {
    const { sdk } = await import('@farcaster/miniapp-sdk');
    await sdk.actions.openUrl(target.href);
    return;
  }
  const popup = window.open('about:blank', '_blank');
  if (!popup) throw new Error('The browser blocked the announcement link');
  popup.opener = null;
  popup.location.replace(target.href);
}
