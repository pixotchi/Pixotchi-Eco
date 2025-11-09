import { useEffect } from 'react';
import { useAccount, useConnect } from 'wagmi';
import { useFrameContext } from '@/lib/frame-context';

export function useAutoConnect() {
  const { isConnected } = useAccount();
  const { connect, connectors } = useConnect();
  const fc = useFrameContext();
  const shouldForceMiniAppAutoconnect = process.env.NEXT_PUBLIC_MINIKIT_FORCE_AUTOCONNECT === 'true';

  useEffect(() => {
    if (!shouldForceMiniAppAutoconnect) {
      return;
    }

    if (!fc?.isInMiniApp || isConnected || !connectors || connectors.length === 0) {
      return;
    }
    
    const farcasterConnector = connectors.find((c: any) => {
      const id = (c?.id ?? "").toString().toLowerCase();
      const name = (c?.name ?? "").toString().toLowerCase();
      return id.includes("farcaster") || name.includes("farcaster");
    }) || connectors[0];

    if (farcasterConnector) {
        try {
            connect({ connector: farcasterConnector as any });
        } catch (error) {
            console.warn("Farcaster auto-connect failed", error)
        }
    }
  }, [fc?.isInMiniApp, isConnected, connectors, connect, shouldForceMiniAppAutoconnect]);
}
