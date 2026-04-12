"use client";

import {
  usePrivy,
  useLogin,
  useLogout,
  useModalStatus,
} from "@privy-io/react-auth";
import { useCallback, useEffect, useMemo, useReducer, useRef } from "react";
import toast from "react-hot-toast";
import { getAddress, stringToHex } from "viem";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { useFrameContext } from "@/lib/frame-context";
import { clearAppCaches } from "@/lib/cache-utils";
import {
  clearPublicChatSession,
  createBasePublicChatSession,
  getCurrentPublicChatSession,
  requestBasePublicChatNonce,
} from "@/lib/chat-auth-client";
import { clearConfirmedMiniAppSession } from "@/lib/confirmed-miniapp-session";
import {
  clearMiniAppBypassCookies,
} from "@/lib/miniapp-bypass";
import { sessionStorageManager } from "@/lib/session-storage-manager";
import {
  AuthConnectionState,
  AuthControllerState,
  AuthSurface,
  DEFAULT_AUTH_SURFACE,
  resolvePreferredAuthSurface,
} from "@/lib/auth-surface";

const AUTH_CACHE_PREFIXES = [
  "wagmi",
  "_wagmi",
  "walletconnect",
  "wc@",
  "privy",
  "@privy",
  "ock",
  "coinbase",
];

type AuthControllerAction =
  | { type: "hydrate-surface"; surface: AuthSurface }
  | { type: "set-surface"; surface: AuthSurface | null }
  | { type: "set-expected-privy-address"; address: string | null }
  | { type: "set-base-authenticated-address"; address: string | null }
  | { type: "set-base-auth-status"; status: AuthControllerState["baseAuthStatus"] }
  | { type: "set-mini-connect-retrying"; value: boolean }
  | { type: "set-secure-session-state"; state: AuthControllerState["secureSessionState"] }
  | { type: "set-error"; message: string | null }
  | { type: "set-connection-state"; state: AuthConnectionState };

const initialState: AuthControllerState = {
  surface: null,
  surfaceInitialized: false,
  expectedPrivyAddress: null,
  baseAuthenticatedAddress: null,
  baseAuthStatus: "idle",
  isMiniConnectRetrying: false,
  secureSessionState: "unneeded",
  errorState: null,
  connectionState: "disconnected",
};

function reducer(
  state: AuthControllerState,
  action: AuthControllerAction,
): AuthControllerState {
  switch (action.type) {
    case "hydrate-surface":
      return {
        ...state,
        surface: action.surface,
        surfaceInitialized: true,
      };
    case "set-surface":
      return {
        ...state,
        surface: action.surface,
      };
    case "set-expected-privy-address":
      return {
        ...state,
        expectedPrivyAddress: action.address,
      };
    case "set-base-authenticated-address":
      return {
        ...state,
        baseAuthenticatedAddress: action.address,
      };
    case "set-base-auth-status":
      return {
        ...state,
        baseAuthStatus: action.status,
      };
    case "set-mini-connect-retrying":
      return {
        ...state,
        isMiniConnectRetrying: action.value,
      };
    case "set-secure-session-state":
      return {
        ...state,
        secureSessionState: action.state,
      };
    case "set-error":
      return {
        ...state,
        errorState: action.message,
      };
    case "set-connection-state":
      return {
        ...state,
        connectionState: action.state,
      };
    default:
      return state;
  }
}

export function useAppAuthController() {
  const fc = useFrameContext();
  const isMiniApp = Boolean(fc?.isInMiniApp);
  const [state, dispatch] = useReducer(reducer, initialState);
  const {
    address,
    isConnected: isEvmConnected,
    isConnecting: isWalletConnecting,
    isReconnecting: isWalletReconnecting,
  } = useAccount();
  const { disconnect } = useDisconnect();
  const { connect, connectAsync, connectors } = useConnect();
  const { ready: privyReady, authenticated, user } = usePrivy();
  const { isOpen: isPrivyModalOpen } = useModalStatus();
  const { logout } = useLogout();

  const normalizedAddress = address?.toLowerCase() ?? null;
  const privySessionResetRef = useRef(false);
  const baseAutologinAttemptRef = useRef(false);
  const baseAuthInFlightRef = useRef(false);

  const hasSolanaWallet = useMemo(() => {
    if (!authenticated || !user) {
      return false;
    }

    return (
      user.linkedAccounts?.some(
        (account: any) => account.type === "wallet" && account.chainType === "solana",
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
  }, []);

  const persistBaseAuthenticatedAddress = useCallback(async (nextAddress: string | null) => {
    dispatch({ type: "set-base-authenticated-address", address: nextAddress });

    if (!nextAddress) {
      await sessionStorageManager.removeBaseAuthenticatedAddress();
      return;
    }

    await sessionStorageManager.setBaseAuthenticatedAddress(nextAddress);
  }, []);

  const resetPrivySession = useCallback(
    async (message?: string) => {
      if (privySessionResetRef.current) {
        return;
      }

      privySessionResetRef.current = true;

      try {
        await sessionStorageManager.removeAutologin();
        await persistPrivyAuthenticatedAddress(null);
        await clearPublicChatSession().catch((error) => {
          console.warn("Failed to clear public chat session during Privy reset:", error);
        });

        if (authenticated && logout) {
          try {
            await logout();
          } catch (error) {
            console.warn("Privy logout during session reset failed:", error);
          }
        }

        try {
          disconnect();
        } catch (error) {
          console.warn("Wallet disconnect during Privy session reset failed:", error);
        }

        dispatch({ type: "set-error", message: message ?? null });
        if (message) {
          toast.error(message);
        }
      } finally {
        setTimeout(() => {
          privySessionResetRef.current = false;
        }, 250);
      }
    },
    [authenticated, disconnect, logout, persistPrivyAuthenticatedAddress],
  );

  const switchAuthSurface = useCallback(
    async (nextSurface: AuthSurface) => {
      if (typeof window === "undefined") {
        return;
      }

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
      await clearPublicChatSession().catch((error) => {
        console.warn("Failed to clear public chat session before surface switch:", error);
      });
      clearConfirmedMiniAppSession("surface-switch");
      clearMiniAppBypassCookies();

      if (authenticated && logout) {
        await logout().catch((error) => {
          console.warn("Privy logout failed before surface switch:", error);
        });
      }

      try {
        disconnect();
      } catch (error) {
        console.warn("Wallet disconnect failed before surface switch:", error);
      }

      await sessionStorageManager.clearAuthState().catch((error) => {
        console.warn("Failed to clear auth state before surface switch:", error);
      });

      await clearAppCaches({
        onlyPrefixes: AUTH_CACHE_PREFIXES,
      });

      await sessionStorageManager.setAuthSurfaceAndAutologin(nextSurface);
      dispatch({ type: "set-surface", surface: nextSurface });
      dispatch({ type: "set-error", message: null });

      const url = new URL(window.location.href);
      url.searchParams.set("surface", nextSurface);
      window.location.replace(url.toString());
    },
    [
      authenticated,
      disconnect,
      logout,
      persistBaseAuthenticatedAddress,
      persistPrivyAuthenticatedAddress,
    ],
  );

  const getErrorMessage = useCallback((error: unknown, fallback: string) => {
    if (error instanceof Error && error.message.trim()) {
      return error.message;
    }

    if (typeof error === "string" && error.trim()) {
      return error;
    }

    if (error && typeof error === "object") {
      const candidate =
        (error as { message?: unknown }).message ??
        (error as { error?: { message?: unknown } }).error?.message;

      if (typeof candidate === "string" && candidate.trim()) {
        return candidate;
      }
    }

    return fallback;
  }, []);

  const getErrorCode = useCallback((error: unknown): number | null => {
    if (!error || typeof error !== "object") {
      return null;
    }

    const direct = (error as { code?: unknown }).code;
    if (typeof direct === "number") {
      return direct;
    }

    const nested = (error as { error?: { code?: unknown } }).error?.code;
    return typeof nested === "number" ? nested : null;
  }, []);

  const isUnsupportedBaseMethodError = useCallback(
    (error: unknown): boolean => {
      const code = getErrorCode(error);
      if (code === 4100 || code === 4200 || code === -32004) {
        return true;
      }

      const message = getErrorMessage(error, "").toLowerCase();
      return (
        message.includes("request method is not supported") ||
        message.includes("requested method is not supported") ||
        message.includes("method is not supported") ||
        (message.includes("wallet_connect") && message.includes("not supported"))
      );
    },
    [getErrorCode, getErrorMessage],
  );

  const isInvalidBaseSiweMessageError = useCallback(
    (error: unknown): boolean => getErrorMessage(error, "").toLowerCase().includes("invalid siwe message"),
    [getErrorMessage],
  );

  const shouldUseLegacyBaseFallback = useCallback(
    (error: unknown): boolean =>
      isUnsupportedBaseMethodError(error) || isInvalidBaseSiweMessageError(error),
    [isInvalidBaseSiweMessageError, isUnsupportedBaseMethodError],
  );

  const isAlreadyConnectedError = useCallback(
    (error: unknown): boolean =>
      getErrorMessage(error, "").toLowerCase().includes("connector already connected"),
    [getErrorMessage],
  );

  const getPrimaryAccountAddress = useCallback((accounts: unknown): string | null => {
    if (!Array.isArray(accounts) || accounts.length === 0) {
      return null;
    }

    const primaryAccount = accounts[0];
    if (typeof primaryAccount === "string" && primaryAccount) {
      return primaryAccount;
    }

    if (
      primaryAccount &&
      typeof primaryAccount === "object" &&
      typeof (primaryAccount as { address?: unknown }).address === "string"
    ) {
      return (primaryAccount as { address: string }).address;
    }

    return null;
  }, []);

  const summarizeBaseAccounts = useCallback((accounts: unknown) => {
    if (!Array.isArray(accounts)) {
      return {
        isArray: false,
        type: typeof accounts,
      };
    }

    return accounts.map((account) => {
      if (typeof account === "string") {
        return { kind: "string", value: account };
      }

      if (!account || typeof account !== "object") {
        return { kind: typeof account };
      }

      const capabilities = (account as { capabilities?: Record<string, unknown> }).capabilities;
      const siweCapability = capabilities?.signInWithEthereum as
        | { message?: unknown; signature?: unknown }
        | undefined;

      return {
        address:
          typeof (account as { address?: unknown }).address === "string"
            ? (account as { address: string }).address
            : null,
        capabilityKeys: capabilities ? Object.keys(capabilities) : [],
        hasSiweCapability: Boolean(siweCapability),
        messageType: typeof siweCapability?.message,
        signatureType: typeof siweCapability?.signature,
        kind: "object",
      };
    });
  }, []);

  const logBaseClientDiagnostic = useCallback(
    async (stage: string, details: Record<string, unknown>) => {
      try {
        await fetch("/api/chat/auth/base/debug", {
          body: JSON.stringify({
            ...details,
            stage,
            surface: state.surface,
          }),
          cache: "no-store",
          credentials: "same-origin",
          headers: {
            "Content-Type": "application/json",
          },
          keepalive: true,
          method: "POST",
        });
      } catch {
        // Ignore diagnostic delivery failures.
      }
    },
    [state.surface],
  );

  const buildFallbackSiweMessage = useCallback(
    (params: {
      address: string;
      chainId: number;
      domain?: string;
      issuedAt: string;
      nonce: string;
      statement: string;
      uri?: string;
    }) =>
      createSiweMessage({
        address: getAddress(params.address),
        chainId: params.chainId,
        domain: params.domain || "localhost",
        issuedAt: new Date(params.issuedAt),
        nonce: params.nonce,
        statement: params.statement,
        uri: params.uri || "http://localhost:3000",
        version: "1",
      }),
    [],
  );

  const createPersonalSignBasePayload = useCallback(
    async (params: {
      baseAddress: string;
      domain?: string;
      issuedAt: string;
      nonce: string;
      provider: {
        request: (request: {
          method: string;
          params: unknown[];
        }) => Promise<unknown>;
      };
      uri?: string;
    }) => {
      const message = buildFallbackSiweMessage({
        address: params.baseAddress,
        chainId: 8453,
        domain: params.domain,
        issuedAt: params.issuedAt,
        nonce: params.nonce,
        statement: "Sign in to Pixotchi",
        uri: params.uri,
      });

      const checksummedAddress = getAddress(params.baseAddress);
      const signature = await params.provider.request({
        method: "personal_sign",
        params: [stringToHex(message), checksummedAddress],
      });

      if (typeof signature !== "string") {
        throw new Error("Coinbase Wallet did not return a valid signature.");
      }

      return {
        address: params.baseAddress.toLowerCase(),
        message,
        signature: signature as `0x${string}`,
      };
    },
    [buildFallbackSiweMessage],
  );

  const completeBaseAuthentication = useCallback(
    async (baseConnector: any) => {
      const nonce = await requestBasePublicChatNonce();
      const domain = typeof window !== "undefined" ? window.location.host : undefined;
      const uri = typeof window !== "undefined" ? window.location.origin : undefined;
      const issuedAt = new Date().toISOString();
      const signInWithEthereum = {
        chainId: "0x2105",
        nonce,
        ...(domain ? { domain } : {}),
        issuedAt,
        ...(uri ? { uri } : {}),
        statement: "Sign in to Pixotchi",
        version: "1",
      };

      const extractBasePayload = (
        authResult: unknown,
        fallbackAddress?: string | null,
      ): {
        address: string;
        message: string;
        signature: `0x${string}`;
      } | null => {
        const primaryAccount = Array.isArray((authResult as any)?.accounts)
          ? (authResult as any).accounts[0]
          : null;
        const capabilityAddress =
          typeof primaryAccount === "string"
            ? primaryAccount.toLowerCase()
            : typeof primaryAccount?.address === "string"
              ? primaryAccount.address.toLowerCase()
              : fallbackAddress?.toLowerCase() ?? null;
        const siweCapability =
          typeof primaryAccount === "string"
            ? null
            : primaryAccount?.capabilities?.signInWithEthereum;

        if (
          siweCapability &&
          typeof siweCapability === "object" &&
          typeof (siweCapability as { message?: unknown }).message === "string" &&
          typeof (siweCapability as { signature?: unknown }).signature !== "string"
        ) {
          throw new Error((siweCapability as { message: string }).message);
        }

        if (
          !capabilityAddress ||
          typeof siweCapability?.message !== "string" ||
          typeof siweCapability?.signature !== "string"
        ) {
          return null;
        }

        return {
          address: capabilityAddress,
          message: siweCapability.message,
          signature: siweCapability.signature as `0x${string}`,
        };
      };

      let payload: {
        address: string;
        message: string;
        signature: `0x${string}`;
      } | null = null;
      let withCapabilitiesError: unknown = null;

      try {
        const connectResult = await connectAsync({
          capabilities: {
            signInWithEthereum,
          },
          connector: baseConnector,
          withCapabilities: true,
        } as any);

        payload = extractBasePayload(connectResult, normalizedAddress);
        if (!payload) {
          void logBaseClientDiagnostic("withCapabilities-empty", {
            connectorId: baseConnector?.id ?? null,
            connectorName: baseConnector?.name ?? null,
            normalizedAddress,
            resultAccountSummary: summarizeBaseAccounts((connectResult as any)?.accounts),
            resultKeys:
              connectResult && typeof connectResult === "object"
                ? Object.keys(connectResult as Record<string, unknown>)
                : [],
          });
        }
      } catch (error) {
        if (!isAlreadyConnectedError(error)) {
          void logBaseClientDiagnostic("withCapabilities-error", {
            connectorId: baseConnector?.id ?? null,
            connectorName: baseConnector?.name ?? null,
            errorCode: getErrorCode(error),
            message: getErrorMessage(error, "Base authentication failed."),
            normalizedAddress,
          });
          if (shouldUseLegacyBaseFallback(error)) {
            withCapabilitiesError = error;
          } else {
            throw error;
          }
        }
      }

      if (!payload) {
        let baseAddress = normalizedAddress;
        const provider =
          typeof baseConnector?.getProvider === "function"
            ? await baseConnector.getProvider()
            : baseConnector?.provider;

        if (!provider?.request) {
          throw new Error("Base provider unavailable.");
        }

        if (!baseAddress) {
          const connectedAccounts = await provider.request({
            method: "eth_accounts",
          });
          baseAddress = getPrimaryAccountAddress(connectedAccounts)?.toLowerCase() ?? null;
        }

        if (!baseAddress) {
          throw new Error("Base account unavailable.");
        }

        if (withCapabilitiesError) {
          try {
            void logBaseClientDiagnostic("same-provider-fallback-selected", {
              connectorId: baseConnector?.id ?? null,
              connectorName: baseConnector?.name ?? null,
              message: getErrorMessage(withCapabilitiesError, "Base capability auth failed."),
              normalizedAddress: baseAddress,
            });
            payload = await createPersonalSignBasePayload({
              baseAddress,
              ...(domain ? { domain } : {}),
              issuedAt,
              nonce,
              provider,
              ...(uri ? { uri } : {}),
            });
          } catch (fallbackError) {
            void logBaseClientDiagnostic("same-provider-fallback-error", {
              connectorId: baseConnector?.id ?? null,
              connectorName: baseConnector?.name ?? null,
              errorCode: getErrorCode(fallbackError),
              message: getErrorMessage(fallbackError, "Base personal_sign fallback failed."),
              normalizedAddress: baseAddress,
            });
            throw withCapabilitiesError;
          }
        }

        if (!payload) {
          let walletConnectError: unknown = null;

          try {
            const authResult = await provider.request({
              method: "wallet_connect",
              params: [
                {
                  capabilities: {
                    signInWithEthereum,
                  },
                  version: "1",
                },
              ],
            });

            payload = extractBasePayload(authResult, baseAddress);
            if (!payload) {
              void logBaseClientDiagnostic("wallet_connect-empty", {
                connectorId: baseConnector?.id ?? null,
                connectorName: baseConnector?.name ?? null,
                normalizedAddress: baseAddress,
                resultAccountSummary: summarizeBaseAccounts((authResult as any)?.accounts),
                resultKeys:
                  authResult && typeof authResult === "object"
                    ? Object.keys(authResult as Record<string, unknown>)
                    : [],
              });
            }
          } catch (error) {
            walletConnectError = error;
            void logBaseClientDiagnostic("wallet_connect-error", {
              connectorId: baseConnector?.id ?? null,
              connectorName: baseConnector?.name ?? null,
              errorCode: getErrorCode(error),
              message: getErrorMessage(error, "Base wallet_connect failed."),
              normalizedAddress: baseAddress,
            });
          }

          if (!payload) {
            try {
              void logBaseClientDiagnostic("same-provider-fallback-selected", {
                connectorId: baseConnector?.id ?? null,
                connectorName: baseConnector?.name ?? null,
                message: walletConnectError
                  ? getErrorMessage(walletConnectError, "Base wallet_connect failed.")
                  : "Base capability auth returned no SIWE payload.",
                normalizedAddress: baseAddress,
              });
              payload = await createPersonalSignBasePayload({
                baseAddress,
                ...(domain ? { domain } : {}),
                issuedAt,
                nonce,
                provider,
                ...(uri ? { uri } : {}),
              });
            } catch (fallbackError) {
              void logBaseClientDiagnostic("same-provider-fallback-error", {
                connectorId: baseConnector?.id ?? null,
                connectorName: baseConnector?.name ?? null,
                errorCode: getErrorCode(fallbackError),
                message: getErrorMessage(fallbackError, "Base personal_sign fallback failed."),
                normalizedAddress: baseAddress,
              });
              if (walletConnectError) {
                throw walletConnectError;
              }
            }
          }
        }
      }

      if (!payload) {
        throw new Error("Base authentication was not completed.");
      }

      await sessionStorageManager.setPendingBaseChatAuth(payload);
      await createBasePublicChatSession(payload);
      await sessionStorageManager.clearPendingBaseChatAuth();
      await persistBaseAuthenticatedAddress(payload.address);
    },
    [
      connectAsync,
      createPersonalSignBasePayload,
      getErrorCode,
      getErrorMessage,
      getPrimaryAccountAddress,
      isAlreadyConnectedError,
      logBaseClientDiagnostic,
      normalizedAddress,
      persistBaseAuthenticatedAddress,
      shouldUseLegacyBaseFallback,
      summarizeBaseAccounts,
    ],
  );

  const completeLegacyBaseAuthentication = useCallback(
    async (legacyConnector: any) => {
      const nonce = await requestBasePublicChatNonce();
      const domain = typeof window !== "undefined" ? window.location.host : undefined;
      const uri = typeof window !== "undefined" ? window.location.origin : undefined;
      const issuedAt = new Date().toISOString();
      let baseAddress = normalizedAddress;

      if (!baseAddress) {
        try {
          const result = await connectAsync({
            chainId: 8453,
            connector: legacyConnector,
          } as any);
          baseAddress =
            getPrimaryAccountAddress((result as any)?.accounts)?.toLowerCase() ?? null;
        } catch (error) {
          if (!isAlreadyConnectedError(error)) {
            throw error;
          }
        }
      }

      const provider =
        typeof legacyConnector?.getProvider === "function"
          ? await legacyConnector.getProvider()
          : legacyConnector?.provider;

      if (!provider?.request) {
        throw new Error("Coinbase Wallet provider unavailable.");
      }

      if (!baseAddress) {
        const connectedAccounts = await provider.request({
          method: "eth_accounts",
        });
        baseAddress = getPrimaryAccountAddress(connectedAccounts)?.toLowerCase() ?? null;
      }

      if (!baseAddress) {
        throw new Error("Coinbase Wallet account unavailable.");
      }

      const payload = await createPersonalSignBasePayload({
        baseAddress,
        ...(domain ? { domain } : {}),
        issuedAt,
        nonce,
        provider,
        ...(uri ? { uri } : {}),
      });

      await sessionStorageManager.setPendingBaseChatAuth(payload);
      await createBasePublicChatSession(payload);
      await sessionStorageManager.clearPendingBaseChatAuth();
      await persistBaseAuthenticatedAddress(payload.address);
    },
    [
      connectAsync,
      createPersonalSignBasePayload,
      getPrimaryAccountAddress,
      isAlreadyConnectedError,
      normalizedAddress,
      persistBaseAuthenticatedAddress,
    ],
  );

  const { login } = useLogin({
    onComplete: ({ loginAccount }) => {
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
    onError: () => {
      if (state.surface === "privy" && !sessionStorageManager.hasRecentPrivyLogoutIntent()) {
        void resetPrivySession("Privy login was cancelled. Please sign the message to continue.");
      }
    },
  });

  const isConnected = useMemo(() => {
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
    hasSolanaWallet,
    isEvmConnected,
    isMiniApp,
    normalizedAddress,
    privyReady,
    state.baseAuthenticatedAddress,
    state.surface,
    state.surfaceInitialized,
  ]);

  const isWebPrivySurface = !isMiniApp && state.surface === "privy";
  const isBaseAuthPending =
    !isMiniApp && state.surface === "base" && state.baseAuthStatus !== "idle";

  useEffect(() => {
    const nextState: AuthConnectionState =
      isConnected
        ? "connected"
        : isWalletConnecting || isWalletReconnecting || state.baseAuthStatus !== "idle"
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
  }, [isConnected, isWalletConnecting, isWalletReconnecting, state.baseAuthStatus]);

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

  useEffect(() => {
    if (!state.surfaceInitialized) {
      return;
    }

    if (state.surface === "base") {
      dispatch({
        type: "set-base-authenticated-address",
        address: sessionStorageManager.getBaseAuthenticatedAddress(),
      });
      return;
    }

    dispatch({ type: "set-base-authenticated-address", address: null });
  }, [state.surface, state.surfaceInitialized]);

  useEffect(() => {
    if (!state.surfaceInitialized || isMiniApp || state.surface !== "base") {
      dispatch({ type: "set-base-authenticated-address", address: null });
      dispatch({ type: "set-base-auth-status", status: "idle" });
      baseAuthInFlightRef.current = false;
      return;
    }

    if (!isEvmConnected || !normalizedAddress) {
      if (!baseAuthInFlightRef.current) {
        dispatch({ type: "set-base-auth-status", status: "idle" });
      }
      return;
    }

    if (state.baseAuthenticatedAddress === normalizedAddress || baseAuthInFlightRef.current) {
      return;
    }

    let cancelled = false;
    dispatch({ type: "set-base-auth-status", status: "checking" });

    void (async () => {
      try {
        const session = await getCurrentPublicChatSession();
        const sessionAddress = session?.address?.toLowerCase() ?? null;

        if (cancelled) {
          return;
        }

        if (session?.provider === "base" && sessionAddress === normalizedAddress) {
          await persistBaseAuthenticatedAddress(normalizedAddress);
          return;
        }

        if (session) {
          await clearPublicChatSession().catch((error) => {
            console.warn("Failed to clear stale chat session while checking Base auth:", error);
          });
        }

        await persistBaseAuthenticatedAddress(null);
      } catch (error) {
        if (!cancelled) {
          console.warn("Failed to check Base authentication session:", error);
          await persistBaseAuthenticatedAddress(null);
        }
      } finally {
        if (!cancelled && !baseAuthInFlightRef.current) {
          dispatch({ type: "set-base-auth-status", status: "idle" });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    isEvmConnected,
    isMiniApp,
    normalizedAddress,
    persistBaseAuthenticatedAddress,
    state.baseAuthenticatedAddress,
    state.surface,
    state.surfaceInitialized,
  ]);

  useEffect(() => {
    if (!isWebPrivySurface || !privyReady || !authenticated || !normalizedAddress) {
      return;
    }

    if (state.expectedPrivyAddress) {
      return;
    }

    void persistPrivyAuthenticatedAddress(normalizedAddress);
  }, [
    authenticated,
    isWebPrivySurface,
    normalizedAddress,
    persistPrivyAuthenticatedAddress,
    privyReady,
    state.expectedPrivyAddress,
  ]);

  useEffect(() => {
    if (!isWebPrivySurface || !privyReady || authenticated || !isEvmConnected || isPrivyModalOpen) {
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
    if (authenticated || isEvmConnected) {
      return;
    }

    void sessionStorageManager.clearPrivyLogoutIntent();
  }, [authenticated, isEvmConnected]);

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
    if (state.surface !== "base" || isConnected) {
      baseAutologinAttemptRef.current = false;
    }
  }, [isConnected, state.surface]);

  useEffect(() => {
    if (isConnected) {
      return;
    }

    if (state.surface === "base" && isBaseAuthPending) {
      return;
    }

    let mounted = true;

    const handleAutologin = async () => {
      try {
        const storedAuto = sessionStorageManager.getAutologin();
        if (!storedAuto) {
          return;
        }

        const auto = storedAuto === "coinbase" ? "base" : storedAuto;

        if (auto === "privy" && state.surface === "privy" && privyReady) {
          await sessionStorageManager.removeAutologin();
          if (mounted) {
            login();
          }
        } else if (auto === "privysolana" && state.surface === "privysolana" && privyReady) {
          await sessionStorageManager.removeAutologin();
          if (mounted) {
            login();
          }
        } else if (auto === "base" && state.surface === "base") {
          if (baseAutologinAttemptRef.current) {
            return;
          }

          const base =
            (connectors || []).find((connector: any) => connector.id === "baseAccount") ||
            (connectors || [])[0];
          const legacyBase = (connectors || []).find(
            (connector: any) => connector.id === "coinbaseWalletSDK",
          );

          if (!base) {
            return;
          }

          baseAutologinAttemptRef.current = true;
          baseAuthInFlightRef.current = true;
          if (mounted) {
            dispatch({ type: "set-base-auth-status", status: "authenticating" });
          }

          try {
            if (!mounted) {
              return;
            }

            try {
              await completeBaseAuthentication(base as any);
            } catch (error) {
              if (legacyBase && shouldUseLegacyBaseFallback(error)) {
                void logBaseClientDiagnostic("legacy-fallback-selected", {
                  baseConnectorId: base?.id ?? null,
                  legacyConnectorId: legacyBase?.id ?? null,
                  errorCode: getErrorCode(error),
                  message: getErrorMessage(error, "Base auth failed."),
                  normalizedAddress,
                });
                await completeLegacyBaseAuthentication(legacyBase as any);
              } else {
                throw error;
              }
            }

            await sessionStorageManager.removeAutologin();
            if (mounted) {
              dispatch({ type: "set-base-auth-status", status: "idle" });
            }
          } catch (error) {
            try {
              disconnect();
            } catch (disconnectError) {
              console.warn("Failed to disconnect Base wallet after auth failure:", disconnectError);
            }

            await sessionStorageManager.removeAutologin().catch((storageError) => {
              console.warn("Failed to clear Base autologin after auth failure:", storageError);
            });
            await sessionStorageManager.clearPendingBaseChatAuth().catch((storageError) => {
              console.warn("Failed to clear pending Base auth after auth failure:", storageError);
            });
            await clearPublicChatSession().catch((chatError) => {
              console.warn("Failed to clear Base chat session after auth failure:", chatError);
            });
            await persistBaseAuthenticatedAddress(null).catch((storageError) => {
              console.warn("Failed to clear persisted Base auth after auth failure:", storageError);
            });
            if (mounted) {
              dispatch({ type: "set-base-auth-status", status: "idle" });
            }

            const fallbackMessage = shouldUseLegacyBaseFallback(error)
              ? "This Coinbase app version could not complete Sign in with Base. Update the app, open in your system browser, or use Privy."
              : "Base authentication failed. Please try again.";

            dispatch({ type: "set-error", message: getErrorMessage(error, fallbackMessage) });
            void logBaseClientDiagnostic("autologin-failed", {
              baseConnectorId: base?.id ?? null,
              legacyConnectorId: legacyBase?.id ?? null,
              errorCode: getErrorCode(error),
              message: getErrorMessage(error, fallbackMessage),
              normalizedAddress,
            });
            toast.error(getErrorMessage(error, fallbackMessage));
            baseAutologinAttemptRef.current = false;
            throw error;
          } finally {
            baseAuthInFlightRef.current = false;
          }
        }
      } catch (error) {
        console.error("Failed to handle autologin:", error);
      }
    };

    void handleAutologin();

    return () => {
      mounted = false;
    };
  }, [
    completeBaseAuthentication,
    completeLegacyBaseAuthentication,
    connectors,
    disconnect,
    getErrorCode,
    getErrorMessage,
    isBaseAuthPending,
    isConnected,
    logBaseClientDiagnostic,
    login,
    normalizedAddress,
    persistBaseAuthenticatedAddress,
    privyReady,
    shouldUseLegacyBaseFallback,
    state.surface,
  ]);

  const isRestoringBaseSession =
    !isMiniApp &&
    state.surface === "base" &&
    !isConnected &&
    Boolean(state.baseAuthenticatedAddress) &&
    (isWalletConnecting || isWalletReconnecting || state.baseAuthStatus === "checking");

  const handleMiniAppReconnect = useCallback(() => {
    if (state.isMiniConnectRetrying) {
      return;
    }

    dispatch({ type: "set-mini-connect-retrying", value: true });
    try {
      const farcasterConnector =
        (connectors || []).find((connector: any) => {
          const id = (connector?.id ?? "").toString().toLowerCase();
          const name = (connector?.name ?? "").toString().toLowerCase();
          return id.includes("farcaster") || name.includes("farcaster");
        }) || (connectors || [])[0];

      if (farcasterConnector) {
        connect({ connector: farcasterConnector as any });
      } else {
        window.location.reload();
      }
    } catch (error) {
      console.warn("Mini app reconnect failed, reloading:", error);
      window.location.reload();
    } finally {
      setTimeout(() => {
        dispatch({ type: "set-mini-connect-retrying", value: false });
      }, 1200);
    }
  }, [connect, connectors, state.isMiniConnectRetrying]);

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
    isWalletConnecting,
    isWalletReconnecting,
    normalizedAddress,
    privyReady,
    state,
    switchAuthSurface,
  };
}
