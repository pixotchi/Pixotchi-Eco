import { useEffect, useRef } from 'react';
import { useFrameContext } from '@/lib/frame-context';
import { sdk } from '@farcaster/miniapp-sdk';

interface UseFarcasterOptions {
  readyBlocker?: boolean;
}

export function useFarcaster(options?: UseFarcasterOptions) {
  const fc = useFrameContext();
  const readyBlocker = options?.readyBlocker ?? false;
  const readySignalledRef = useRef(false);

  // Signal Farcaster host that the frame is ready once blockers are cleared
  useEffect(() => {
    if (readyBlocker || readySignalledRef.current || !fc?.isInMiniApp) {
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        await sdk.actions.ready();
        if (!cancelled) {
          readySignalledRef.current = true;
        }
      } catch (error) {
        console.warn('Failed to signal sdk.actions.ready():', error);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [fc?.isInMiniApp, readyBlocker]);

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
