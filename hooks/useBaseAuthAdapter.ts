"use client";

import { type Dispatch, useCallback, useEffect, useRef } from 'react';
import type { AuthWalletConnector, ConnectAuthWallet } from '@/lib/auth/wallet-adapter-contract';
import toast from 'react-hot-toast';
import { type AuthControllerState } from '@/lib/auth-surface';
import { type AuthControllerAction } from '@/lib/auth-controller-state';
import { createAuthAttempt, type AuthAttempt } from '@/lib/auth/auth-attempt';
import { isAuthCleanupPending, isWalletReconnectAllowed, useAuthCleanupPending } from '@/lib/auth-cleanup';
import { getCurrentPublicChatSession } from '@/lib/chat-auth-client';
import { clearDisconnectedChatSession } from '@/lib/disconnect-wallet-identity';
import { BASE_CHAT_SESSION_REFRESH_REQUEST_EVENT, emitBaseChatSessionRefreshResult, parseBaseChatRefreshRequest, type BaseChatSessionRefreshReason } from '@/lib/base-chat-session-refresh';
import { sessionStorageManager } from '@/lib/session-storage-manager';
import { getAuthErrorCode, getAuthErrorMessage } from '@/lib/auth-presentation-data';
import { useBaseWalletAuthentication } from '@/hooks/useBaseWalletAuthentication';
import { isLocalTestAuthAllowed } from '@/lib/local-test-mode';
import { ensureLocalTestWallet } from '@/lib/local-test-wallet';

/** Owns signed Base/test sessions, restoration, failure cleanup and autologin. */
export function useBaseAuthAdapter<C extends AuthWalletConnector & { type?: string }>({ state, dispatch, isMiniApp, normalizedAddress, isEvmConnected, isWalletConnecting, isWalletReconnecting, connectAsync, connectors, disconnect }: {
  state: AuthControllerState;
  dispatch: Dispatch<AuthControllerAction>;
  isMiniApp: boolean;
  normalizedAddress: string | null;
  isEvmConnected: boolean;
  isWalletConnecting: boolean;
  isWalletReconnecting: boolean;
  connectAsync: ConnectAuthWallet<C>;
  connectors: readonly C[];
  disconnect: () => Promise<void>;
}) {
  const cleanupPending = useAuthCleanupPending();
  const isConnected = state.surface === 'base'
    ? Boolean(isEvmConnected && normalizedAddress && state.baseAuthenticatedAddress === normalizedAddress)
    : state.surface === 'test' && isLocalTestAuthAllowed() && isEvmConnected;
  const baseAutologinAttemptRef = useRef(false);
  const baseAuthInFlightRef = useRef(false);
  const baseSessionCheckRef = useRef<{
    address: string;
    result: "invalid" | "valid";
  } | null>(null);
  const baseSessionRecoveryAttemptRef = useRef<string | null>(null);

  const currentScopeRef = useRef({ address: normalizedAddress, surface: state.surface });
  currentScopeRef.current = { address: normalizedAddress, surface: state.surface };
  const attemptsRef = useRef(new Set<AuthAttempt>());
  const authOperationRef = useRef<AuthAttempt | null>(null);
  const startAttempt = useCallback(() => {
    const attempt = createAuthAttempt(() => currentScopeRef.current);
    attemptsRef.current.add(attempt);
    return attempt;
  }, []);
  const finishAttempt = useCallback((attempt: AuthAttempt) => {
    attemptsRef.current.delete(attempt);
    attempt.dispose();
  }, []);
  const finishAuthOperation = useCallback((attempt: AuthAttempt) => {
    if (authOperationRef.current === attempt) {
      authOperationRef.current = null;
      baseAuthInFlightRef.current = false;
      dispatch({ type: 'set-base-auth-status', status: 'idle' });
    }
    finishAttempt(attempt);
  }, [dispatch, finishAttempt]);
  useEffect(() => {
    let superseded = false;
    for (const attempt of attemptsRef.current) {
      attempt.checkScope();
      if (!attempt.isCurrent()) superseded = true;
    }
    if (superseded) {
      authOperationRef.current = null;
      baseAuthInFlightRef.current = false;
      dispatch({ type: 'set-base-auth-status', status: 'idle' });
    }
  }, [cleanupPending, dispatch, normalizedAddress, state.surface]);
  useEffect(() => () => {
    authOperationRef.current = null;
    for (const attempt of attemptsRef.current) { attempt.abort(); attempt.dispose(); }
    attemptsRef.current.clear();
  }, []);

  const persistBaseAuthenticatedAddress = useCallback(async (nextAddress: string | null) => {
    dispatch({ type: "set-base-authenticated-address", address: nextAddress });

    if (!nextAddress) {
      await sessionStorageManager.removeBaseAuthenticatedAddress();
      return;
    }

    await sessionStorageManager.setBaseAuthenticatedAddress(nextAddress);
  }, [dispatch]);

  const getErrorMessage = getAuthErrorMessage;
  const getErrorCode = getAuthErrorCode;

  const { completeBaseAuthentication, completeLegacyBaseAuthentication, shouldUseLegacyBaseFallback, logBaseClientDiagnostic } = useBaseWalletAuthentication<C>({
    connectAsync, normalizedAddress, persistBaseAuthenticatedAddress, surface: state.surface,
  });

  const recoverBasePublicChatSession = useCallback(
    async (options: {
      clearAutologinOnFailure?: boolean;
      clearAutologinOnSuccess?: boolean;
      disconnectOnFailure?: boolean;
      reason: BaseChatSessionRefreshReason;
      reportFailure?: boolean;
      toastOnFailure?: boolean;
    }): Promise<{ message?: string; ok: boolean }> => {
      const isSiweSurface = state.surface === "base" || state.surface === "test";
      const surfaceLabel = state.surface === "test" ? "test wallet" : "Base";

      if (isMiniApp || !isSiweSurface) {
        return {
          message: "Chat session recovery is only available on signed EVM wallet surfaces.",
          ok: false,
        };
      }

      if (!isEvmConnected || !normalizedAddress) {
        return {
          message: `Connect your ${surfaceLabel} to restore the chat session.`,
          ok: false,
        };
      }

      if (baseAuthInFlightRef.current || isAuthCleanupPending()) {
        return {
          message: `${surfaceLabel} authentication is already in progress.`,
          ok: false,
        };
      }

      const base = state.surface === "test"
        ? (connectors || []).find(
            (connector) => connector?.id === "localTest" || connector?.type === "localTest",
          )
        : (connectors || []).find((connector) => connector.id === "baseAccount") ||
          (connectors || [])[0];
      const legacyBase = state.surface === "base"
        ? (connectors || []).find(
            (connector) => connector.id === "coinbaseWalletSDK",
          )
        : null;

      if (!base) {
        return {
          message: `${surfaceLabel} connector unavailable.`,
          ok: false,
        };
      }

      const attempt = startAttempt();
      authOperationRef.current = attempt;
      baseAuthInFlightRef.current = true;
      dispatch({ type: "set-base-auth-status", status: "authenticating" });

      try {
        try {
          await attempt.run(() => completeBaseAuthentication(base, attempt));
        } catch (error) {
          if (legacyBase && shouldUseLegacyBaseFallback(error)) {
            void logBaseClientDiagnostic("legacy-fallback-selected", {
              baseConnectorId: base?.id ?? null,
              legacyConnectorId: legacyBase?.id ?? null,
              errorCode: getErrorCode(error),
              message: getErrorMessage(error, "Base auth failed."),
              normalizedAddress,
              reason: options.reason,
            });
            await attempt.run(() => completeLegacyBaseAuthentication(legacyBase, attempt));
          } else {
            throw error;
          }
        }

        if (options.clearAutologinOnSuccess) {
          await attempt.run(() => sessionStorageManager.removeAutologin());
        }

        baseSessionCheckRef.current = {
          address: normalizedAddress,
          result: "valid",
        };
        baseSessionRecoveryAttemptRef.current = null;
        dispatch({ type: "set-base-auth-status", status: "idle" });
        dispatch({ type: "set-error", message: null });

        return { ok: true };
      } catch (error) {
        if (!attempt.isCurrent()) return { ok: false, message: 'This sign-in attempt is no longer current.' };
        if (options.clearAutologinOnFailure || options.clearAutologinOnSuccess) {
          await attempt.run(() => sessionStorageManager.removeAutologin().catch((storageError) => {
            console.warn(
              "Failed to clear Base autologin after auth failure:",
              storageError,
            );
          }));
        }

        await attempt.run(() => sessionStorageManager.clearPendingBaseChatAuth().catch((storageError) => {
          console.warn(
            "Failed to clear pending Base auth after auth failure:",
            storageError,
          );
        }));
        await attempt.run(() => clearDisconnectedChatSession(attempt.signal).catch((chatError) => {
          console.warn("Failed to clear Base chat session after auth failure:", chatError);
        }));
        await attempt.run(() => persistBaseAuthenticatedAddress(null).catch((storageError) => {
          console.warn("Failed to clear persisted Base auth after auth failure:", storageError);
        }));

        baseSessionCheckRef.current = {
          address: normalizedAddress,
          result: "invalid",
        };
        baseSessionRecoveryAttemptRef.current = normalizedAddress;
        dispatch({ type: "set-base-auth-status", status: "idle" });

        const fallbackMessage = shouldUseLegacyBaseFallback(error)
          ? "This Coinbase Wallet version could not complete Sign in with Base. Update the app, open in your system browser, or use Privy."
          : `${surfaceLabel} authentication failed. Please try again.`;
        const message = getErrorMessage(error, fallbackMessage);

        if (options.reportFailure) {
          dispatch({ type: "set-error", message });
        }

        void logBaseClientDiagnostic("base-session-recovery-failed", {
          baseConnectorId: base?.id ?? null,
          legacyConnectorId: legacyBase?.id ?? null,
          errorCode: getErrorCode(error),
          message,
          normalizedAddress,
          reason: options.reason,
        });

        if (options.toastOnFailure) {
          toast.error(message);
        }

        if (options.disconnectOnFailure) {
          try {
            await disconnect();
          } catch (disconnectError) {
            console.warn(
              "Failed to disconnect Base wallet after auth failure:",
              disconnectError,
            );
          }
        }

        return {
          message,
          ok: false,
        };
      } finally {
        finishAuthOperation(attempt);
      }
    },
    [
      startAttempt,
      finishAuthOperation,
      dispatch,
      completeBaseAuthentication,
      completeLegacyBaseAuthentication,
      connectors,
      disconnect,
      getErrorCode,
      getErrorMessage,
      isEvmConnected,
      isMiniApp,
      logBaseClientDiagnostic,
      normalizedAddress,
      persistBaseAuthenticatedAddress,
      shouldUseLegacyBaseFallback,
      state.surface,
    ],
  );

  const isBaseAuthPending =
    !isMiniApp &&
    (state.surface === "base" || state.surface === "test") &&
    state.baseAuthStatus !== "idle";

  useEffect(() => {
    if (!state.surfaceInitialized) {
      return;
    }

    if (state.surface === "base" || state.surface === "test") {
      dispatch({
        type: "set-base-authenticated-address",
        address: sessionStorageManager.getBaseAuthenticatedAddress(),
      });
      return;
    }

    dispatch({ type: "set-base-authenticated-address", address: null });
  }, [dispatch, state.surface, state.surfaceInitialized]);

  useEffect(() => {
    if (
      !state.surfaceInitialized ||
      isMiniApp ||
      (state.surface !== "base" && state.surface !== "test")
    ) {
      baseSessionCheckRef.current = null;
      baseSessionRecoveryAttemptRef.current = null;
      dispatch({ type: "set-base-authenticated-address", address: null });
      dispatch({ type: "set-base-auth-status", status: "idle" });
      baseAuthInFlightRef.current = false;
      return;
    }

    if (!isEvmConnected || !normalizedAddress) {
      baseSessionCheckRef.current = null;
      baseSessionRecoveryAttemptRef.current = null;
      if (!baseAuthInFlightRef.current) {
        dispatch({ type: "set-base-auth-status", status: "idle" });
      }
      return;
    }

    const currentCheck = baseSessionCheckRef.current;
    const alreadyValidated =
      currentCheck?.address === normalizedAddress &&
      ((currentCheck.result === "valid" &&
        state.baseAuthenticatedAddress === normalizedAddress) ||
        (currentCheck.result === "invalid" &&
          state.baseAuthenticatedAddress !== normalizedAddress));

    if (alreadyValidated || baseAuthInFlightRef.current) {
      return;
    }

    const attempt = startAttempt();
    let cancelled = false;
    dispatch({ type: "set-base-auth-status", status: "checking" });

    void (async () => {
      try {
        const session = await attempt.run(() => getCurrentPublicChatSession());
        const sessionAddress = session?.address?.toLowerCase() ?? null;

        if (cancelled || !attempt.isCurrent()) {
          return;
        }

        if (session?.provider === "base" && sessionAddress === normalizedAddress) {
          baseSessionCheckRef.current = {
            address: normalizedAddress,
            result: "valid",
          };
          baseSessionRecoveryAttemptRef.current = null;
          await attempt.run(() => persistBaseAuthenticatedAddress(normalizedAddress));
          return;
        }

        if (session) {
          await attempt.run(() => clearDisconnectedChatSession(attempt.signal).catch((error) => {
            console.warn("Failed to clear stale chat session while checking Base auth:", error);
          }));
        }

        await attempt.run(() => persistBaseAuthenticatedAddress(null));

        const shouldAttemptRecovery =
          state.baseAuthenticatedAddress === normalizedAddress &&
          baseSessionRecoveryAttemptRef.current !== normalizedAddress;

        if (!shouldAttemptRecovery) {
          baseSessionCheckRef.current = {
            address: normalizedAddress,
            result: "invalid",
          };
          return;
        }

        baseSessionRecoveryAttemptRef.current = normalizedAddress;
        const recovery = await attempt.run(() => recoverBasePublicChatSession({
          disconnectOnFailure: false,
          reason: "session-validation",
          reportFailure: false,
          toastOnFailure: false,
        }));

        if (cancelled || !attempt.isCurrent()) {
          return;
        }

        baseSessionCheckRef.current = {
          address: normalizedAddress,
          result: recovery.ok ? "valid" : "invalid",
        };
        if (recovery.ok) {
          baseSessionRecoveryAttemptRef.current = null;
        }
      } catch (error) {
        if (!cancelled && attempt.isCurrent()) {
          console.warn("Failed to check Base authentication session:", error);
          baseSessionCheckRef.current = {
            address: normalizedAddress,
            result: "invalid",
          };
          await attempt.run(() => persistBaseAuthenticatedAddress(null));
        }
      } finally {
        if (!cancelled && attempt.isCurrent() && !baseAuthInFlightRef.current) {
          dispatch({ type: "set-base-auth-status", status: "idle" });
        }
      }
    })();

    return () => {
      cancelled = true;
      attempt.abort();
      finishAttempt(attempt);
    };
  }, [
    startAttempt,
    finishAttempt,
    dispatch,
    isEvmConnected,
    isMiniApp,
    normalizedAddress,
    persistBaseAuthenticatedAddress,
    recoverBasePublicChatSession,
    state.baseAuthenticatedAddress,
    state.surface,
    state.surfaceInitialized,
  ]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }

    const handleBaseChatSessionRefreshRequest = async (event: Event) => {
      const detail = parseBaseChatRefreshRequest((event as CustomEvent<unknown>).detail);

      if (!detail?.requestId) {
        return;
      }

      if (isMiniApp || (state.surface !== "base" && state.surface !== "test")) {
        emitBaseChatSessionRefreshResult({
          message: "Chat session recovery is unavailable on this auth surface.",
          requestId: detail.requestId,
          status: "ignored",
        });
        return;
      }

      const recovery = await recoverBasePublicChatSession({
        disconnectOnFailure: false,
        reason: detail.reason,
        reportFailure: false,
        toastOnFailure: false,
      });

      emitBaseChatSessionRefreshResult({
        ...(recovery.message ? { message: recovery.message } : {}),
        requestId: detail.requestId,
        status: recovery.ok ? "success" : "error",
      });
    };

    window.addEventListener(
      BASE_CHAT_SESSION_REFRESH_REQUEST_EVENT,
      handleBaseChatSessionRefreshRequest as EventListener,
    );
    return () => {
      window.removeEventListener(
        BASE_CHAT_SESSION_REFRESH_REQUEST_EVENT,
        handleBaseChatSessionRefreshRequest as EventListener,
      );
    };
  }, [isMiniApp, recoverBasePublicChatSession, state.surface]);

  useEffect(() => {
    if (state.surface !== "base" || isConnected) {
      baseAutologinAttemptRef.current = false;
    }
  }, [isConnected, state.surface]);

  useEffect(() => {
    if (isConnected) {
      return;
    }

    if ((state.surface === "base" || state.surface === "test") && isBaseAuthPending) {
      return;
    }

    const handleAutologin = async () => {
      if (!isWalletReconnectAllowed() || baseAuthInFlightRef.current) return;
      const attempt = startAttempt();
      authOperationRef.current = attempt;
      baseAuthInFlightRef.current = true;
      try {
        const storedAuto = sessionStorageManager.getAutologin();
        if (state.surface === "test" && storedAuto === "test" && isLocalTestAuthAllowed()) {
          const testConnector = (connectors || []).find(
            (connector) => connector?.id === "localTest" || connector?.type === "localTest",
          );

          if (!testConnector) {
            return;
          }

          try {
            ensureLocalTestWallet();
            await attempt.run(() => connectAsync({ connector: testConnector }));
            await attempt.run(() => completeBaseAuthentication(testConnector, attempt));
          } finally {
            // ChatProvider treats the autologin marker as an auth-readiness
            // signal. Always settle it, including failed local SIWE attempts,
            // so chat can leave its bounded bootstrap wait and show recovery.
            if (attempt.isCurrent() && storedAuto === "test") {
              await attempt.run(() => sessionStorageManager.removeAutologin());
            }
          }
          return;
        }

        if (!storedAuto) {
          return;
        }

        const auto = storedAuto === "coinbase" ? "base" : storedAuto;

        if (auto === "test") {
          await attempt.run(() => sessionStorageManager.removeAutologin());
        } else if (auto === "base" && state.surface === "base") {
          if (baseAutologinAttemptRef.current) {
            return;
          }

          const base =
            (connectors || []).find((connector) => connector.id === "baseAccount") ||
            (connectors || [])[0];
          const legacyBase = (connectors || []).find(
            (connector) => connector.id === "coinbaseWalletSDK",
          );

          if (!base) {
            return;
          }

          baseAutologinAttemptRef.current = true;
          baseAuthInFlightRef.current = true;
          if (attempt.isCurrent()) {
            dispatch({ type: "set-base-auth-status", status: "authenticating" });
          }

          try {
            if (!attempt.isCurrent()) {
              return;
            }

            try {
              await attempt.run(() => completeBaseAuthentication(base, attempt));
            } catch (error) {
              if (legacyBase && shouldUseLegacyBaseFallback(error)) {
                void logBaseClientDiagnostic("legacy-fallback-selected", {
                  baseConnectorId: base?.id ?? null,
                  legacyConnectorId: legacyBase?.id ?? null,
                  errorCode: getErrorCode(error),
                  message: getErrorMessage(error, "Base auth failed."),
                  normalizedAddress,
                });
                await attempt.run(() => completeLegacyBaseAuthentication(legacyBase, attempt));
              } else {
                throw error;
              }
            }

            await attempt.run(() => sessionStorageManager.removeAutologin());
            if (attempt.isCurrent()) {
              dispatch({ type: "set-base-auth-status", status: "idle" });
            }
          } catch (error) {
            if (!attempt.isCurrent()) return;
            await attempt.run(() => sessionStorageManager.removeAutologin().catch((storageError) => {
              console.warn("Failed to clear Base autologin after auth failure:", storageError);
            }));
            await attempt.run(() => sessionStorageManager.clearPendingBaseChatAuth().catch((storageError) => {
              console.warn("Failed to clear pending Base auth after auth failure:", storageError);
            }));
            await attempt.run(() => clearDisconnectedChatSession(attempt.signal).catch((chatError) => {
              console.warn("Failed to clear Base chat session after auth failure:", chatError);
            }));
            await attempt.run(() => persistBaseAuthenticatedAddress(null).catch((storageError) => {
              console.warn("Failed to clear persisted Base auth after auth failure:", storageError);
            }));
            if (attempt.isCurrent()) {
              dispatch({ type: "set-base-auth-status", status: "idle" });
            }

            const fallbackMessage = shouldUseLegacyBaseFallback(error)
              ? "This Coinbase Wallet version could not complete Sign in with Base. Update the app, open in your system browser, or use Privy."
              : "Base authentication failed. Please try again.";

            dispatch({ type: "set-error", message: getErrorMessage(error, fallbackMessage) });
            void logBaseClientDiagnostic("autologin-failed", {
              baseConnectorId: base?.id ?? null,
              legacyConnectorId: legacyBase?.id ?? null,
              errorCode: getErrorCode(error),
              message: getErrorMessage(error, fallbackMessage),
              normalizedAddress,
            });
            try { await disconnect(); } catch (disconnectError) { console.warn('Failed to disconnect Base wallet after auth failure:', disconnectError); }
            toast.error(getErrorMessage(error, fallbackMessage));
            baseAutologinAttemptRef.current = false;
            throw error;
          } finally {
            if (attempt.isCurrent()) baseAuthInFlightRef.current = false;
          }
        }
      } catch (error) {
        if (attempt.isCurrent()) console.error("Failed to handle autologin:", error);
      } finally { finishAuthOperation(attempt); }
    };

    void handleAutologin();

  }, [
    startAttempt,
    finishAuthOperation,
    dispatch,
    completeBaseAuthentication,
    completeLegacyBaseAuthentication,
    connectAsync,
    connectors,
    disconnect,
    getErrorCode,
    getErrorMessage,
    isBaseAuthPending,
    isConnected,
    logBaseClientDiagnostic,
    normalizedAddress,
    persistBaseAuthenticatedAddress,
    shouldUseLegacyBaseFallback,
    state.surface,
    cleanupPending,
  ]);

  const isRestoringBaseSession =
    !isMiniApp &&
    state.surface === "base" &&
    !isConnected &&
    Boolean(state.baseAuthenticatedAddress) &&
    (isWalletConnecting || isWalletReconnecting || state.baseAuthStatus === "checking");

  return { persistBaseAuthenticatedAddress, isBaseAuthPending, isRestoringBaseSession };
}
