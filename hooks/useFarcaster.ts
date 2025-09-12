import { useEffect } from 'react';
import { useMiniKit } from '@coinbase/onchainkit/minikit';
import { useFrameContext } from '@/lib/frame-context';
import { sdk } from '@farcaster/miniapp-sdk';

export function useFarcaster() {
  const { setFrameReady, isFrameReady } = useMiniKit();
  const fc = useFrameContext();

  // Initialize SDKs
  useEffect(() => {
    const initializeSDKs = async () => {
      if (!isFrameReady) {
        try {
          setFrameReady();
          console.log('✅ MiniKit SDK initialized successfully');
        } catch (error) {
          console.warn('⚠️ MiniKit SDK not available or failed:', error);
        }
      }
    };

    initializeSDKs();
  }, [setFrameReady, isFrameReady]);

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
