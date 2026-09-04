import { useEffect } from 'react';
import { useFrameContext } from '@/lib/frame-context';

let farcasterSdkPromise: Promise<typeof import('@farcaster/miniapp-sdk')> | null = null;

function loadFarcasterSdk() {
  farcasterSdkPromise ??= import('@farcaster/miniapp-sdk');
  return farcasterSdkPromise;
}

export function useFarcaster() {
  const fc = useFrameContext();

  // Enable web back navigation
  useEffect(() => {
    (async () => {
      if (fc?.isInMiniApp) {
        try {
          const { sdk } = await loadFarcasterSdk();
          await sdk.back.enableWebNavigation();
          await sdk.back.show();
        } catch (error) {
            console.warn('Failed to enable web back navigation', error);
        }
      }
    })();
  }, [fc?.isInMiniApp]);
}
