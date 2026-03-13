"use client";

import { createConnector, ChainNotConfiguredError } from "wagmi";
import {
  getAddress,
  numberToHex,
  SwitchChainError,
  UserRejectedRequestError,
} from "viem";
import { createBaseAccountSDK, type ProviderInterface } from "@base-org/account";
import {
  clearPublicChatSession,
  createBasePublicChatSession,
  requestBasePublicChatNonce,
} from "@/lib/chat-auth-client";
import { sessionStorageManager } from "@/lib/session-storage-manager";

type CreateProviderOptions = Parameters<typeof createBaseAccountSDK>[0];

type BaseAccountConnectorParameters = CreateProviderOptions & {
  /**
   * Human-friendly name shown in wallet lists.
   * Defaults to "Sign in with Base".
   */
  displayName?: string;
};

const USER_REJECTION_PATTERN =
  /(user closed modal|accounts received is empty|user denied|request rejected)/i;

type WalletConnectResult = {
  accounts?: Array<{
    address: `0x${string}`;
    capabilities?: {
      signInWithEthereum?: {
        message?: string;
        signature?: `0x${string}`;
      };
    };
  }>;
};

export function baseAccountConnector(
  parameters: BaseAccountConnectorParameters = {}
) {
  return createConnector((config) => {
    let provider: ProviderInterface | null = null;
    let accountsChanged: ((accounts: string[]) => void) | undefined;
    let chainChanged: ((chainId: string | number) => void) | undefined;
    let disconnect: ((error?: unknown) => void) | undefined;
    let lastKnownAccounts: `0x${string}`[] = [];

    const metadata: CreateProviderOptions = {
      appName: parameters.appName ?? "Pixotchi Mini",
      appLogoUrl: parameters.appLogoUrl ?? null,
      appChainIds: parameters.appChainIds ?? config.chains.map((chain) => chain.id),
      preference: parameters.preference,
      subAccounts: parameters.subAccounts,
      paymasterUrls: parameters.paymasterUrls,
    };

    const getOrCreateProvider = async () => {
      if (!provider) {
        const sdk = createBaseAccountSDK(metadata);
        provider = sdk.getProvider();
      }
      return provider;
    };

    const requestAccounts = async (method: "eth_accounts" | "eth_requestAccounts") => {
      const baseProvider = await getOrCreateProvider();
      const accounts = (await baseProvider.request({
        method,
      })) as string[];

      const normalized = accounts.map((account) => getAddress(account));
      if (normalized.length > 0) {
        lastKnownAccounts = normalized;
      }

      return normalized;
    };

    const requestWalletConnectAuth = async (requestedChainId?: number) => {
      const baseProvider = await getOrCreateProvider();
      const chainHex = numberToHex(requestedChainId ?? config.chains[0]?.id ?? 8453);
      let nonce: string | null = null;

      try {
        nonce = await requestBasePublicChatNonce();
      } catch (error) {
        console.warn("[base-account] Failed to fetch Base auth nonce, falling back to wallet connect only:", error);
      }

      if (!nonce) {
        return requestAccounts("eth_requestAccounts");
      }

      const domain = typeof window !== "undefined" ? window.location.host : undefined;
      const uri = typeof window !== "undefined" ? window.location.origin : undefined;

      const response = (await baseProvider.request({
        method: "wallet_connect",
        params: [
          {
            version: "1",
            capabilities: {
              signInWithEthereum: {
                chainId: chainHex,
                nonce,
                ...(domain ? { domain } : {}),
                ...(uri ? { uri } : {}),
                statement: "Sign in to Pixotchi",
              },
            },
          },
        ],
      })) as WalletConnectResult;

      const walletConnectAccounts = (response.accounts ?? []).map((account) => getAddress(account.address));
      const primaryAccount = response.accounts?.[0];
      const siweCapability = primaryAccount?.capabilities?.signInWithEthereum;

      if (!primaryAccount?.address || !siweCapability?.message || !siweCapability.signature) {
        throw new Error("Base authentication was not completed.");
      }

      try {
        await sessionStorageManager.setPendingBaseChatAuth({
          address: getAddress(primaryAccount.address),
          message: siweCapability.message,
          signature: siweCapability.signature,
        });
      } catch (error) {
        console.warn("[base-account] Failed to persist Base chat auth payload for retry:", error);
      }

      try {
        await createBasePublicChatSession({
          address: getAddress(primaryAccount.address),
          message: siweCapability.message,
          signature: siweCapability.signature,
        });
      } catch (error) {
        console.warn("[base-account] Base chat session bootstrap failed:", error);
      }

      const providerAccounts = await requestAccounts("eth_accounts").catch(() => []);
      const nextAccounts = providerAccounts.length > 0 ? providerAccounts : walletConnectAccounts;
      if (nextAccounts.length > 0) {
        lastKnownAccounts = nextAccounts;
      }

      return nextAccounts;
    };

    return {
      id: "baseAccount",
      name: parameters.displayName ?? "Sign in with Base",
      type: "base-account",

      async connect({ chainId, withCapabilities } = {}) {
        try {
          const baseProvider = await getOrCreateProvider();
          const accounts = await requestWalletConnectAuth(chainId);

          if (!accountsChanged) {
            accountsChanged = this.onAccountsChanged.bind(this);
            baseProvider.on("accountsChanged", accountsChanged);
          }
          if (!chainChanged) {
            chainChanged = this.onChainChanged.bind(this);
            baseProvider.on("chainChanged", chainChanged);
          }
          if (!disconnect) {
            disconnect = this.onDisconnect.bind(this);
            baseProvider.on("disconnect", disconnect);
          }

          let currentChainId = await this.getChainId();
          if (chainId && currentChainId !== chainId) {
            const chain = await this.switchChain({ chainId }).catch((error) => {
              if (error.code === UserRejectedRequestError.code) throw error;
              return { id: currentChainId };
            });
            currentChainId = chain?.id ?? currentChainId;
          }

          return {
            accounts: (withCapabilities
              ? accounts.map((address) => ({ address, capabilities: {} }))
              : accounts) as any,
            chainId: currentChainId,
          };
        } catch (error) {
          if (
            error instanceof Error &&
            USER_REJECTION_PATTERN.test(error.message)
          ) {
            throw new UserRejectedRequestError(error);
          }
          throw error;
        }
      },

      async disconnect() {
        const baseProvider = await getOrCreateProvider();
        lastKnownAccounts = [];
        await sessionStorageManager.clearPendingBaseChatAuth().catch((error) => {
          console.warn("[base-account] Failed to clear pending Base chat auth on disconnect:", error);
        });
        if (accountsChanged) {
          baseProvider.removeListener("accountsChanged", accountsChanged);
          accountsChanged = undefined;
        }
        if (chainChanged) {
          baseProvider.removeListener("chainChanged", chainChanged);
          chainChanged = undefined;
        }
        if (disconnect) {
          baseProvider.removeListener("disconnect", disconnect);
          disconnect = undefined;
        }
        try {
          await baseProvider.disconnect();
        } catch {
          // Provider may throw if already disconnected – ignore.
        }
      },

      async getAccounts() {
        const accounts = await requestAccounts("eth_accounts");
        return accounts.length > 0 ? accounts : lastKnownAccounts;
      },

      async getChainId() {
        const baseProvider = await getOrCreateProvider();
        const chainId = (await baseProvider.request({
          method: "eth_chainId",
        })) as string;
        return Number(chainId);
      },

      async getProvider() {
        return getOrCreateProvider();
      },

      async isAuthorized() {
        try {
          const accounts = await this.getAccounts();
          return accounts.length > 0;
        } catch {
          return false;
        }
      },

      async switchChain({ addEthereumChainParameter, chainId }) {
        const chain = config.chains.find((target) => target.id === chainId);
        if (!chain) {
          throw new SwitchChainError(new ChainNotConfiguredError());
        }

        const baseProvider = await getOrCreateProvider();
        try {
          await baseProvider.request({
            method: "wallet_switchEthereumChain",
            params: [{ chainId: numberToHex(chain.id) }],
          });
          return chain;
        } catch (error: any) {
          if (error?.code === 4902) {
            try {
              const blockExplorerUrls =
                addEthereumChainParameter?.blockExplorerUrls ??
                (chain.blockExplorers?.default.url
                  ? [chain.blockExplorers.default.url]
                  : []);

              const rpcUrls =
                addEthereumChainParameter?.rpcUrls?.length
                  ? addEthereumChainParameter.rpcUrls
                  : [chain.rpcUrls.default?.http[0] ?? ""];

              await baseProvider.request({
                method: "wallet_addEthereumChain",
                params: [
                  {
                    blockExplorerUrls,
                    chainId: numberToHex(chainId),
                    chainName:
                      addEthereumChainParameter?.chainName ?? chain.name,
                    iconUrls: addEthereumChainParameter?.iconUrls,
                    nativeCurrency:
                      addEthereumChainParameter?.nativeCurrency ??
                      chain.nativeCurrency,
                    rpcUrls,
                  },
                ],
              });
              return chain;
            } catch (addError) {
              throw new UserRejectedRequestError(addError as Error);
            }
          }
          throw new SwitchChainError(error);
        }
      },

      onAccountsChanged(accounts: string[]) {
        if (accounts.length === 0) {
          lastKnownAccounts = [];
          this.onDisconnect();
          return;
        }
        const normalizedAccounts = accounts.map((account) => getAddress(account));
        const accountChanged =
          normalizedAccounts.length !== lastKnownAccounts.length ||
          normalizedAccounts.some((account, index) => account !== lastKnownAccounts[index]);

        lastKnownAccounts = normalizedAccounts;

        if (accountChanged) {
          void sessionStorageManager.clearPendingBaseChatAuth().catch((error) => {
            console.warn("[base-account] Failed to clear pending Base chat auth after account change:", error);
          });
          void clearPublicChatSession().catch((error) => {
            console.warn("[base-account] Failed to clear public chat session after account change:", error);
          });
        }
        config.emitter.emit("change", {
          accounts: lastKnownAccounts,
        });
      },

      onChainChanged(chainId: string | number) {
        const normalized = Number(chainId);
        config.emitter.emit("change", { chainId: normalized });
      },

      async onDisconnect(_error?: unknown) {
        lastKnownAccounts = [];
        await sessionStorageManager.clearPendingBaseChatAuth().catch((error) => {
          console.warn("[base-account] Failed to clear pending Base chat auth on disconnect:", error);
        });
        await clearPublicChatSession().catch((error) => {
          console.warn("[base-account] Failed to clear public chat session on disconnect:", error);
        });
        config.emitter.emit("disconnect");
        const baseProvider = await getOrCreateProvider();
        if (accountsChanged) {
          baseProvider.removeListener("accountsChanged", accountsChanged);
          accountsChanged = undefined;
        }
        if (chainChanged) {
          baseProvider.removeListener("chainChanged", chainChanged);
          chainChanged = undefined;
        }
        if (disconnect) {
          baseProvider.removeListener("disconnect", disconnect);
          disconnect = undefined;
        }
      },
    };
  });
}
