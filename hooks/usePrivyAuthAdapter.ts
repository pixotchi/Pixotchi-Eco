"use client";

import { usePrivy, useLogin, useLogout, useModalStatus } from '@privy-io/react-auth';
import { type Dispatch, useCallback, useEffect, useMemo, useRef } from 'react';
import toast from 'react-hot-toast';
import { type AuthControllerState } from '@/lib/auth-surface';
import { type AuthControllerAction } from '@/lib/auth-controller-state';
import { beginAuthCleanup, getAuthGeneration, isAuthCleanupPending, isWalletReconnectAllowed, useAuthCleanupPending } from '@/lib/auth-cleanup';
import { clearDisconnectedChatSession } from '@/lib/disconnect-wallet-identity';
import { sessionStorageManager } from '@/lib/session-storage-manager';

function getPrivyLoginErrorMessage(error: string) {
  switch (error) {
    case "exited_auth_flow":
      return "Login was cancelled before authentication completed.";
    case "unable_to_sign":
      return "Please sign the wallet message to continue.";
    case "client_request_timeout":
      return "Wallet login timed out. Please try again.";
    case "generic_connect_wallet_error":
    case "unknown_connect_wallet_error":
      return "Could not connect the wallet. Please try again.";
    default:
      return "Privy login failed. Please try again.";
  }
}

/** Owns Privy EVM/Solana identity, SDK callbacks, cancellation and wallet binding. */
export function usePrivyAuthAdapter({ state, dispatch, isMiniApp, normalizedAddress, isEvmConnected, disconnect }: {
  state: AuthControllerState;
  dispatch: Dispatch<AuthControllerAction>;
  isMiniApp: boolean;
  normalizedAddress: string | null;
  isEvmConnected: boolean;
  disconnect: () => Promise<void>;
}) {
  const cleanupPending = useAuthCleanupPending();
  const isWebPrivySurface = !isMiniApp && state.surface === 'privy';
  const privySessionResetRef = useRef(false);
  const privyLoginInProgressRef = useRef(false);
  const loginGenerationRef = useRef(getAuthGeneration());
  const resetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimerRef.current) clearTimeout(resetTimerRef.current); }, []);
  const { ready: privyReady, authenticated, user } = usePrivy();
  const { isOpen: isPrivyModalOpen } = useModalStatus();
  const { logout } = useLogout();

  const hasSolanaWallet = useMemo(() => {
    if (!authenticated || !user) {
      return false;
    }

    return (
      user.linkedAccounts?.some(
        (account) => account.type === "wallet" && account.chainType === "solana",
      ) ?? false
    );
  }, [authenticated, user]);

  const persistPrivyAuthenticatedAddress = useCallback(async (nextAddress: string | null) => {
    dispatch({ type: "set-expected-privy-address", address: nextAddress });

    if (!nextAddress) {
      await sessionStorageManager.removePrivyAuthenticatedAddress();
      return;
    }

    await sessionStorageManager.setPrivyAuthenticatedAddress(nextAddress);
  }, [dispatch]);

  const resetPrivySession = useCallback(
    async (message?: string) => {
      if (privySessionResetRef.current || isAuthCleanupPending()) {
        return;
      }

      const finishCleanup = beginAuthCleanup();
      if (!finishCleanup) return;
      privySessionResetRef.current = true;

      try {
        await sessionStorageManager.removeAutologin();
        await persistPrivyAuthenticatedAddress(null);
        await clearDisconnectedChatSession();

        if (authenticated && logout) {
          try {
            await logout();
          } catch (error) {
            console.warn("Privy logout during session reset failed:", error);
          }
        }

        try {
          await disconnect();
        } catch (error) {
          console.warn("Wallet disconnect during Privy session reset failed:", error);
        }

        dispatch({ type: "set-error", message: message ?? null });
        if (message) {
          toast.error(message);
        }
      } finally {
        finishCleanup();
        resetTimerRef.current = setTimeout(() => { privySessionResetRef.current = false; }, 250);
      }
    },
    [authenticated, disconnect, dispatch, logout, persistPrivyAuthenticatedAddress],
  );

  const { login } = useLogin({
    onComplete: ({ loginAccount }) => {
      if (loginGenerationRef.current !== getAuthGeneration() || isAuthCleanupPending()) return;
      privyLoginInProgressRef.current = false;
      const loginAddress =
        loginAccount?.type === "wallet" &&
        loginAccount.chainType === "ethereum" &&
        typeof loginAccount.address === "string"
          ? loginAccount.address.toLowerCase()
          : normalizedAddress;

      if (loginAddress) {
        void persistPrivyAuthenticatedAddress(loginAddress);
      } else {
        void persistPrivyAuthenticatedAddress(null);
      }
    },
    onError: (error) => {
      if (loginGenerationRef.current !== getAuthGeneration() || isAuthCleanupPending()) return;
      privyLoginInProgressRef.current = false;
      if ((state.surface === "privy" || state.surface === "privysolana") && !sessionStorageManager.hasRecentPrivyLogoutIntent()) {
        void resetPrivySession(getPrivyLoginErrorMessage(error));
      }
    },
  });

  useEffect(() => {
    if (!isWebPrivySurface || !privyReady || !authenticated || !normalizedAddress
      || cleanupPending || !isWalletReconnectAllowed() || sessionStorageManager.hasRecentPrivyLogoutIntent()) {
      return;
    }

    if (state.expectedPrivyAddress) {
      return;
    }

    void persistPrivyAuthenticatedAddress(normalizedAddress);
  }, [
    authenticated,
    cleanupPending,
    isWebPrivySurface,
    normalizedAddress,
    persistPrivyAuthenticatedAddress,
    privyReady,
    state.expectedPrivyAddress,
  ]);

  useEffect(() => {
    if (
      !isWebPrivySurface ||
      !privyReady ||
      authenticated ||
      !isEvmConnected ||
      isPrivyModalOpen ||
      privyLoginInProgressRef.current
    ) {
      return;
    }

    if (sessionStorageManager.hasRecentPrivyLogoutIntent()) {
      return;
    }

    void resetPrivySession("Privy login was cancelled. Please sign the message to continue.");
  }, [
    authenticated,
    isEvmConnected,
    isPrivyModalOpen,
    isWebPrivySurface,
    privyReady,
    resetPrivySession,
  ]);

  useEffect(() => {
    if (authenticated || isEvmConnected || cleanupPending) {
      return;
    }

    void sessionStorageManager.clearPrivyLogoutIntent();
  }, [authenticated, cleanupPending, isEvmConnected]);

  useEffect(() => {
    if (
      !isWebPrivySurface ||
      !privyReady ||
      !authenticated ||
      !normalizedAddress ||
      !state.expectedPrivyAddress
    ) {
      return;
    }

    if (state.expectedPrivyAddress !== normalizedAddress) {
      void resetPrivySession("Wallet changed. Please sign in again.");
    }
  }, [
    authenticated,
    isWebPrivySurface,
    normalizedAddress,
    privyReady,
    resetPrivySession,
    state.expectedPrivyAddress,
  ]);

  useEffect(() => {
    if (isMiniApp || !privyReady || cleanupPending || !isWalletReconnectAllowed() || (state.surface !== 'privy' && state.surface !== 'privysolana')) return;
    if (sessionStorageManager.getAutologin() !== state.surface) return;
    let mounted = true;
    const generation = getAuthGeneration();
    void sessionStorageManager.removeAutologin().then(() => {
      if (!mounted || isAuthCleanupPending() || generation !== getAuthGeneration()) return;
      loginGenerationRef.current = generation;
      privyLoginInProgressRef.current = true;
      login();
    });
    return () => { mounted = false; };
  }, [cleanupPending, isMiniApp, login, privyReady, state.surface]);

  return { privyReady, authenticated, hasSolanaWallet, logout, persistPrivyAuthenticatedAddress };
}
