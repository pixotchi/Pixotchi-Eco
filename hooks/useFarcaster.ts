import { useEffect } from 'react';
import { useFrameContext } from '@/lib/frame-context';
import { sdk } from '@farcaster/miniapp-sdk';

export function useFarcaster() {
  const fc = useFrameContext();

  // Enable web back navigation
  useEffect(() => {
    (async () => {
      if (fc?.isInMiniApp) {
        try {
          await sdk.back.enableWebNavigation();
          await sdk.back.show();
        } catch (error) {
            console.warn('Failed to enable web back navigation', error);
        }
      }
    })();
  }, [fc?.isInMiniApp]);
}
