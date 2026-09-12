"use client";

import { useCallback } from 'react';
import { createAuthAttempt, type AuthAttempt } from '@/lib/auth/auth-attempt';
import type { AuthWalletConnector, ConnectAuthWallet } from '@/lib/auth/wallet-adapter-contract';
import { getAddress, stringToHex } from 'viem';
import { createSiweMessage } from 'viem/siwe';
import { getAuthErrorCode as getErrorCode, getAuthErrorMessage as getErrorMessage } from '@/lib/auth-presentation-data';
import { type AuthSurface } from '@/lib/auth-surface';
import { createBasePublicChatSession, requestBasePublicChatNonce } from '@/lib/chat-auth-client';
import { sessionStorageManager } from '@/lib/session-storage-manager';
import { type BaseAuthPayload, type WalletRpcProvider, extractBasePayload, getPrimaryAccountAddress, readWalletProvider, readWalletRecord, readWalletSignature, summarizeBaseAccounts } from '@/lib/auth/base-wallet-boundary';

const BASE_PERSONAL_SIGN_TIMEOUT_MS = 12_000;
const COINBASE_WALLET_SIGNING_UNAVAILABLE_MESSAGE =
  "This Coinbase Wallet profile could not sign in. Open in your system browser, use a different Coinbase Wallet profile/device, or reset the Coinbase Wallet session.";

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  message: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(message));
    }, timeoutMs);
  });

  try {
    return await Promise.race([promise, timeoutPromise]);
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

/** Owns Base/legacy wallet SIWE negotiation and validates every wallet-returned payload. */
export function useBaseWalletAuthentication<C extends AuthWalletConnector>({ connectAsync, normalizedAddress, persistBaseAuthenticatedAddress, surface }: {
  connectAsync: ConnectAuthWallet<C>;
  normalizedAddress: string | null;
  persistBaseAuthenticatedAddress: (address: string | null) => Promise<void>;
  surface: AuthSurface | null;
}) {
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
    [],
  );

  const isInvalidBaseSiweMessageError = useCallback(
    (error: unknown): boolean => getErrorMessage(error, "").toLowerCase().includes("invalid siwe message"),
    [],
  );

  const isInvalidBaseAuthenticationSignatureError = useCallback(
    (error: unknown): boolean =>
      getErrorMessage(error, "").toLowerCase().includes("invalid base authentication signature"),
    [],
  );

  const shouldUseLegacyBaseFallback = useCallback(
    (error: unknown): boolean =>
      isUnsupportedBaseMethodError(error) || isInvalidBaseSiweMessageError(error),
    [isInvalidBaseSiweMessageError, isUnsupportedBaseMethodError],
  );

  const isAlreadyConnectedError = useCallback(
    (error: unknown): boolean =>
      getErrorMessage(error, "").toLowerCase().includes("connector already connected"),
    [],
  );

  const logBaseClientDiagnostic = useCallback(
    async (stage: string, details: Record<string, unknown>) => {
      try {
        await fetch("/api/chat/auth/base/debug", {
          body: JSON.stringify({
            ...details,
            stage,
            surface,
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
    [surface],
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
      provider: WalletRpcProvider;
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
      const rawSignature = await withTimeout(
        params.provider.request({
          method: "personal_sign",
          params: [stringToHex(message), checksummedAddress],
        }),
        BASE_PERSONAL_SIGN_TIMEOUT_MS,
        COINBASE_WALLET_SIGNING_UNAVAILABLE_MESSAGE,
      );

      const signature = readWalletSignature(rawSignature);
      if (!signature) {
        throw new Error("Coinbase Wallet did not return a valid signature.");
      }

      return {
        address: params.baseAddress.toLowerCase(),
        message,
        signature,
      };
    },
    [buildFallbackSiweMessage],
  );

  const completeBaseAuthentication = useCallback(
    async (baseConnector: C, ownedAttempt?: AuthAttempt) => {
      const attempt = ownedAttempt ?? createAuthAttempt();
      try {
        attempt.assertCurrent();
        const nonce = await attempt.run(() => requestBasePublicChatNonce());
        attempt.assertCurrent();
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

        let payload: BaseAuthPayload | null = null;
        let baseProvider: WalletRpcProvider | null = null;
        let withCapabilitiesError: unknown = null;

        const getBaseProvider = async () => {
          if (!baseProvider) {
            baseProvider = readWalletProvider(await attempt.run(() => baseConnector.getProvider()));
            attempt.assertCurrent();
          }

          return baseProvider;
        };

        const submitBasePayload = async (nextPayload: {
          address: string;
          message: string;
          signature: `0x${string}`;
        }) => {
          attempt.bindAddress(nextPayload.address);
          attempt.assertCurrent();
          await attempt.run(() => sessionStorageManager.setPendingBaseChatAuth(nextPayload));
          attempt.assertCurrent();
          try {
            await attempt.run(() => createBasePublicChatSession(nextPayload, attempt.signal, attempt.assertCurrent));
            attempt.assertCurrent();
          } catch (error) {
            attempt.assertCurrent();
            await attempt.run(() => sessionStorageManager.clearPendingBaseChatAuth().catch((storageError) => {
              console.warn(
                "Failed to clear pending Base auth after rejected payload:",
                storageError,
              );
            }));
            throw error;
          }
          await attempt.run(() => sessionStorageManager.clearPendingBaseChatAuth());
          attempt.assertCurrent();
          await attempt.run(() => persistBaseAuthenticatedAddress(nextPayload.address));
        };

        try {
          // Generic Wagmi Connector erases connector-specific capability options.
          // Keep the negotiated request typed here and validate its result below.
          const connectParameters = { capabilities: { signInWithEthereum }, connector: baseConnector, withCapabilities: true as const };
          const connectResult = await attempt.run(() => connectAsync(connectParameters));

          attempt.assertCurrent();
          payload = extractBasePayload(connectResult, normalizedAddress);
          if (!payload) {
            void logBaseClientDiagnostic("withCapabilities-empty", {
              connectorId: baseConnector?.id ?? null,
              connectorName: baseConnector?.name ?? null,
              normalizedAddress,
              resultAccountSummary: summarizeBaseAccounts(readWalletRecord(connectResult)?.accounts),
              resultKeys:
                connectResult && typeof connectResult === "object"
                  ? Object.keys(connectResult)
                  : [],
            });
          }
        } catch (error) {
          attempt.assertCurrent();
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
          const provider = await attempt.run(() => getBaseProvider());

          if (!provider?.request) {
            throw new Error("Base provider unavailable.");
          }

          if (!baseAddress) {
            const connectedAccounts = await attempt.run(() => provider.request({
              method: "eth_accounts",
            }));
            attempt.assertCurrent();
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
              payload = await attempt.run(() => createPersonalSignBasePayload({
                baseAddress,
                ...(domain ? { domain } : {}),
                issuedAt,
                nonce,
                provider,
                ...(uri ? { uri } : {}),
              }));
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
              const authResult = await attempt.run(() => provider.request({
                method: "wallet_connect",
                params: [
                  {
                    capabilities: {
                      signInWithEthereum,
                    },
                    version: "1",
                  },
                ],
              }));

              attempt.assertCurrent();
              payload = extractBasePayload(authResult, baseAddress);
              if (!payload) {
                void logBaseClientDiagnostic("wallet_connect-empty", {
                  connectorId: baseConnector?.id ?? null,
                  connectorName: baseConnector?.name ?? null,
                  normalizedAddress: baseAddress,
                  resultAccountSummary: summarizeBaseAccounts(readWalletRecord(authResult)?.accounts),
                  resultKeys:
                    authResult && typeof authResult === "object"
                      ? Object.keys(authResult)
                      : [],
                });
              }
            } catch (error) {
              attempt.assertCurrent();
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
                payload = await attempt.run(() => createPersonalSignBasePayload({
                  baseAddress,
                  ...(domain ? { domain } : {}),
                  issuedAt,
                  nonce,
                  provider,
                  ...(uri ? { uri } : {}),
                }));
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

        attempt.assertCurrent();
        if (!payload) {
          throw new Error("Base authentication was not completed.");
        }

        try {
          await attempt.run(() => submitBasePayload(payload));
        } catch (error) {
          attempt.assertCurrent();
          if (!isInvalidBaseAuthenticationSignatureError(error)) {
            throw error;
          }

          const provider = await attempt.run(() => getBaseProvider());
          if (!provider?.request) {
            throw error;
          }

          try {
            const fallbackPayload = await attempt.run(() => createPersonalSignBasePayload({
              baseAddress: payload.address,
              ...(domain ? { domain } : {}),
              issuedAt,
              nonce,
              provider,
              ...(uri ? { uri } : {}),
            }));

            await attempt.run(() => submitBasePayload(fallbackPayload));
          } catch (fallbackError) {
            void logBaseClientDiagnostic("same-provider-fallback-error", {
              connectorId: baseConnector?.id ?? null,
              connectorName: baseConnector?.name ?? null,
              errorCode: getErrorCode(fallbackError),
              message: getErrorMessage(fallbackError, "Base personal_sign fallback failed."),
              normalizedAddress: payload.address,
            });
            throw fallbackError;
          }
        }
      } finally { if (!ownedAttempt) attempt.dispose(); }
    },
    [
      connectAsync,
      createPersonalSignBasePayload,
      isAlreadyConnectedError,
      isInvalidBaseAuthenticationSignatureError,
      logBaseClientDiagnostic,
      normalizedAddress,
      persistBaseAuthenticatedAddress,
      shouldUseLegacyBaseFallback,
    ],
  );

  const completeLegacyBaseAuthentication = useCallback(
    async (legacyConnector: C, ownedAttempt?: AuthAttempt) => {
      const attempt = ownedAttempt ?? createAuthAttempt();
      try {
        attempt.assertCurrent();
        const nonce = await attempt.run(() => requestBasePublicChatNonce());
        attempt.assertCurrent();
        const domain = typeof window !== "undefined" ? window.location.host : undefined;
        const uri = typeof window !== "undefined" ? window.location.origin : undefined;
        const issuedAt = new Date().toISOString();
        let baseAddress = normalizedAddress;

        if (!baseAddress) {
          try {
            const result = await attempt.run(() => connectAsync({
              chainId: 8453,
              connector: legacyConnector,
            }));
            baseAddress =
              getPrimaryAccountAddress(readWalletRecord(result)?.accounts)?.toLowerCase() ?? null;
          } catch (error) {
            if (!isAlreadyConnectedError(error)) {
              throw error;
            }
          }
        }

        const provider = readWalletProvider(await attempt.run(() => legacyConnector.getProvider()));
        attempt.assertCurrent();

        if (!provider?.request) {
          throw new Error("Coinbase Wallet provider unavailable.");
        }

        if (!baseAddress) {
          const connectedAccounts = await attempt.run(() => provider.request({
            method: "eth_accounts",
          }));
          baseAddress = getPrimaryAccountAddress(connectedAccounts)?.toLowerCase() ?? null;
        }

        if (!baseAddress) {
          throw new Error("Coinbase Wallet account unavailable.");
        }

        const payload = await attempt.run(() => createPersonalSignBasePayload({
          baseAddress,
          ...(domain ? { domain } : {}),
          issuedAt,
          nonce,
          provider,
          ...(uri ? { uri } : {}),
        }));

        attempt.bindAddress(payload.address);
        await attempt.run(() => sessionStorageManager.setPendingBaseChatAuth(payload));
        attempt.assertCurrent();
        await attempt.run(() => createBasePublicChatSession(payload, attempt.signal, attempt.assertCurrent));
        attempt.assertCurrent();
        await attempt.run(() => sessionStorageManager.clearPendingBaseChatAuth());
        attempt.assertCurrent();
        await attempt.run(() => persistBaseAuthenticatedAddress(payload.address));
      } finally { if (!ownedAttempt) attempt.dispose(); }
    },
    [
      connectAsync,
      createPersonalSignBasePayload,
      isAlreadyConnectedError,
      normalizedAddress,
      persistBaseAuthenticatedAddress,
    ],
  );

  return { completeBaseAuthentication, completeLegacyBaseAuthentication, shouldUseLegacyBaseFallback, logBaseClientDiagnostic };
}
