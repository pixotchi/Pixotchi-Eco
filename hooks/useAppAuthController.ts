"use client";

import { useCallback, useEffect, useMemo, useReducer } from "react";
import { type Connector, useAccount, useConnect, useDisconnect } from "wagmi";
import { useFrameContext } from "@/lib/frame-context";
import { clearAuthCaches } from "@/lib/cache-utils";
import { beginAuthCleanup, SIGNED_OUT_QUERY_PARAM, useWalletReconnectAllowed } from "@/lib/auth-cleanup";
import { clearDisconnectedChatSession } from "@/lib/disconnect-wallet-identity";
import { clearConfirmedMiniAppSession } from "@/lib/confirmed-miniapp-session";
import { sessionStorageManager } from "@/lib/session-storage-manager";
import {
  AuthConnectionState,
  AuthSurface,
  DEFAULT_AUTH_SURFACE,
  resolvePreferredAuthSurface,
} from "@/lib/auth-surface";
import { usePrivyAuthAdapter } from "@/hooks/usePrivyAuthAdapter";
import { useBaseAuthAdapter } from "@/hooks/useBaseAuthAdapter";
import { useMiniAppReconnect } from "@/hooks/useMiniAppReconnect";
import { authReducer, initialAuthState } from "@/lib/auth-controller-state";
import { isLocalTestAuthAllowed } from "@/lib/local-test-mode";
import { ensureLocalTestWallet } from "@/lib/local-test-wallet";



export function useAppAuthController() {
  const fc = useFrameContext();
  const isMiniApp = Boolean(fc?.isInMiniApp);
  const [state, dispatch] = useReducer(authReducer, initialAuthState);
  const {
    address,
    isConnected: isEvmConnected,
    isConnecting: isWalletConnecting,
    isReconnecting: isWalletReconnecting,
  } = useAccount();
  const { disconnectAsync: disconnect } = useDisconnect();
  const reconnectAllowed = useWalletReconnectAllowed();
  const { connectAsync, connectors } = useConnect();
  const normalizedAddress = address?.toLowerCase() ?? null;
  const { privyReady, authenticated, hasSolanaWallet, logout, persistPrivyAuthenticatedAddress } = usePrivyAuthAdapter({
    state, dispatch, isMiniApp, normalizedAddress, isEvmConnected, disconnect,
  });

  const { persistBaseAuthenticatedAddress, isBaseAuthPending, isRestoringBaseSession } = useBaseAuthAdapter<Connector>({
    state, dispatch, isMiniApp, normalizedAddress, isEvmConnected, isWalletConnecting, isWalletReconnecting, connectAsync, connectors, disconnect,
  });

  const switchAuthSurface = useCallback(
    async (nextSurface: AuthSurface) => {
      if (typeof window === "undefined") {
        return;
      }

      const finishCleanup = beginAuthCleanup();
      if (!finishCleanup) return;
      try {
        let walletLogoutFailed = false;
        await sessionStorageManager.markPrivyLogoutIntent().catch((error) => {
          console.warn("Failed to mark Privy logout intent before surface switch:", error);
        });

        await sessionStorageManager.removeAutologin().catch((error) => {
          console.warn("Failed to clear autologin before surface switch:", error);
        });
        await sessionStorageManager.clearPendingBaseChatAuth().catch((error) => {
          console.warn("Failed to clear pending Base auth before surface switch:", error);
        });
        await persistPrivyAuthenticatedAddress(null).catch((error) => {
          console.warn("Failed to clear persisted Privy address before surface switch:", error);
        });
        await persistBaseAuthenticatedAddress(null).catch((error) => {
          console.warn("Failed to clear persisted Base address before surface switch:", error);
        });
        await clearDisconnectedChatSession();
        clearConfirmedMiniAppSession("surface-switch");

        if (authenticated && logout) {
          await logout().catch((error) => {
            console.warn("Privy logout failed before surface switch:", error);
            walletLogoutFailed = true;
          });
        }

        try {
          await disconnect();
        } catch (error) {
          console.warn("Wallet disconnect failed before surface switch:", error);
          walletLogoutFailed = true;
        }

        await sessionStorageManager.clearAuthState().catch((error) => {
          console.warn("Failed to clear auth state before surface switch:", error);
        });

        await clearAuthCaches();
        if (walletLogoutFailed) {
          throw new Error('Could not sign out of the previous wallet. Please try again.');
        }

        if (nextSurface === "test") {
          ensureLocalTestWallet();
        }

        await sessionStorageManager.setAuthSurfaceAndAutologin(nextSurface);
        dispatch({ type: "set-surface", surface: nextSurface });
        dispatch({ type: "set-error", message: null });

        const url = new URL(window.location.href);
        url.searchParams.delete(SIGNED_OUT_QUERY_PARAM);
        url.searchParams.set("surface", nextSurface);
        window.location.replace(url.toString());
      } finally { finishCleanup(); }
    },
    [
      authenticated,
      disconnect,
      logout,
      persistBaseAuthenticatedAddress,
      persistPrivyAuthenticatedAddress,
    ],
  );

  const isConnected = useMemo(() => {
    if (!reconnectAllowed) return false;
    if (isMiniApp) {
      return isEvmConnected;
    }

    if (!state.surfaceInitialized) {
      return false;
    }

    switch (state.surface) {
      case "privy":
        return privyReady && authenticated && isEvmConnected;
      case "privysolana":
        return privyReady && authenticated && hasSolanaWallet;
      case "test":
        return isLocalTestAuthAllowed() && isEvmConnected;
      case "base":
        return Boolean(
          isEvmConnected &&
            normalizedAddress &&
            state.baseAuthenticatedAddress === normalizedAddress,
        );
      default:
        return false;
    }
  }, [
    authenticated,
    reconnectAllowed,
    hasSolanaWallet,
    isEvmConnected,
    isMiniApp,
    normalizedAddress,
    privyReady,
    state.baseAuthenticatedAddress,
    state.surface,
    state.surfaceInitialized,
  ]);

  useEffect(() => {
    const nextState: AuthConnectionState =
      isConnected
        ? "connected"
        : reconnectAllowed && (isWalletConnecting || isWalletReconnecting || state.baseAuthStatus !== "idle")
          ? "connecting"
          : "disconnected";

    dispatch({ type: "set-connection-state", state: nextState });
    dispatch({
      type: "set-secure-session-state",
      state:
        nextState === "connected"
          ? "ready"
          : nextState === "connecting"
            ? "booting"
            : "unneeded",
    });
  }, [isConnected, isWalletConnecting, isWalletReconnecting, reconnectAllowed, state.baseAuthStatus]);

  useEffect(() => {
    if (state.surfaceInitialized) {
      return;
    }

    try {
      const effectiveSurface = resolvePreferredAuthSurface({
        fallback: DEFAULT_AUTH_SURFACE,
        search: typeof window !== "undefined" ? window.location.search : "",
        storedSurface: sessionStorageManager.getAuthSurface(),
      });
      dispatch({ type: "hydrate-surface", surface: effectiveSurface });
    } catch (error) {
      console.warn("Failed to read surface on mount:", error);
      dispatch({ type: "hydrate-surface", surface: DEFAULT_AUTH_SURFACE });
    }
  }, [state.surfaceInitialized]);

  useEffect(() => {
    if (!state.surfaceInitialized) {
      return;
    }

    dispatch({
      type: "set-expected-privy-address",
      address: sessionStorageManager.getPrivyAuthenticatedAddress(),
    });
  }, [authenticated, isEvmConnected, state.surface, state.surfaceInitialized]);

  const handleMiniAppReconnect = useMiniAppReconnect({
    connectors,
    connect: (connector) => connectAsync({ connector }),
    onPending: (value) => dispatch({ type: 'set-mini-connect-retrying', value }),
    onError: (message) => dispatch({ type: 'set-error', message }),
  });

  return {
    address,
    authenticated,
    connectors,
    fc,
    handleMiniAppReconnect,
    hasSolanaWallet,
    isBaseAuthPending,
    isConnected,
    isEvmConnected,
    isMiniApp,
    isRestoringBaseSession,
    isWalletConnecting: reconnectAllowed && isWalletConnecting,
    isWalletReconnecting: reconnectAllowed && isWalletReconnecting,
    normalizedAddress,
    privyReady,
    state,
    switchAuthSurface,
  };
}
