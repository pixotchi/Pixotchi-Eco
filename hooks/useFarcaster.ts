import { useEffect } from 'react';
import { useMiniKit } from '@coinbase/onchainkit/minikit';
import { useFrameContext } from '@/lib/frame-context';
import { sdk } from '@farcaster/miniapp-sdk';

export function useFarcaster() {
  const miniKit = useMiniKit();
  // OCK v1.1+: isMiniAppReady/setMiniAppReady (deprecated: isFrameReady/setFrameReady)
  const isReady = (miniKit as any).isMiniAppReady ?? (miniKit as any).isFrameReady;
  const setReady = (miniKit as any).setMiniAppReady ?? (miniKit as any).setFrameReady;
  const fc = useFrameContext();

  // Initialize SDKs
  useEffect(() => {
    const initializeSDKs = async () => {
      if (!isReady) {
        try {
          setReady?.();
          console.log('✅ MiniKit SDK initialized successfully');
        } catch (error) {
          console.warn('⚠️ MiniKit SDK not available or failed:', error);
        }
      }
    };

    initializeSDKs();
  }, [setReady, isReady]);

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
