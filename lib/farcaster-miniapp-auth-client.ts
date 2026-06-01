"use client";

import { sdk } from '@farcaster/miniapp-sdk';
import { getHostEnvironmentSnapshot } from '@/lib/host-environment';

export async function getMiniAppQuickAuthHeaders(): Promise<Record<string, string>> {
  const hostEnvironment = getHostEnvironmentSnapshot();
  if (!hostEnvironment.isMiniApp) {
    return {};
  }

  const { token } = await sdk.quickAuth.getToken();
  return {
    Authorization: `Bearer ${token}`,
  };
}
