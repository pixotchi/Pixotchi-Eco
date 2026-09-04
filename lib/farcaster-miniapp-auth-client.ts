"use client";

import { FARCASTER_CONNECTED_WALLET_HEADER } from '@/lib/farcaster-miniapp-auth-headers';
import { getHostEnvironmentSnapshot } from '@/lib/host-environment';

const ETHEREUM_ADDRESS_REGEX = /^0x[a-fA-F0-9]{40}$/;

type MiniAppQuickAuthHeaderOptions = {
  expectedAddress?: string | null;
};

let farcasterSdkPromise: Promise<typeof import('@farcaster/miniapp-sdk')> | null = null;

function loadFarcasterSdk() {
  farcasterSdkPromise ??= import('@farcaster/miniapp-sdk');
  return farcasterSdkPromise;
}

function normalizeEthereumAddress(address: string | null | undefined): string | null {
  const trimmed = address?.trim();
  if (!trimmed || !ETHEREUM_ADDRESS_REGEX.test(trimmed)) {
    return null;
  }

  return trimmed.toLowerCase();
}

async function getConnectedMiniAppWalletAddress(): Promise<string | null> {
  try {
    const { sdk } = await loadFarcasterSdk();
    const accounts = await sdk.wallet.ethProvider.request({
      method: 'eth_accounts',
    });

    const firstAccount = Array.isArray(accounts) && typeof accounts[0] === 'string'
      ? accounts[0]
      : null;

    return normalizeEthereumAddress(firstAccount);
  } catch {
    return null;
  }
}

export async function getMiniAppQuickAuthHeaders(
  options: MiniAppQuickAuthHeaderOptions = {},
): Promise<Record<string, string>> {
  const hostEnvironment = getHostEnvironmentSnapshot();
  if (!hostEnvironment.isMiniApp) {
    return {};
  }

  const { sdk } = await loadFarcasterSdk();
  const { token } = await sdk.quickAuth.getToken();
  const explicitAddress = normalizeEthereumAddress(options.expectedAddress);
  const connectedWalletAddress = explicitAddress ?? (await getConnectedMiniAppWalletAddress());

  return {
    Authorization: `Bearer ${token}`,
    ...(connectedWalletAddress
      ? { [FARCASTER_CONNECTED_WALLET_HEADER]: connectedWalletAddress }
      : {}),
  };
}
