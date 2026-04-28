"use client";

import {
  custom,
  createWalletClient,
  fromHex,
  getAddress,
  isAddress,
  numberToHex,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { ConnectorNotConnectedError } from "@wagmi/core";
import { createConnector } from "wagmi";
import { base } from "viem/chains";
import { ensureLocalTestWallet } from "./local-test-wallet";
import { isLocalTestAuthAllowed } from "./local-test-mode";
import { createResilientTransport } from "./rpc-transport";

function getTestAccount() {
  const wallet = ensureLocalTestWallet();
  return privateKeyToAccount(wallet.privateKey);
}

function normalizeMessageParam(value: unknown): string | { raw: Hex } {
  if (typeof value === "string" && /^0x[0-9a-fA-F]*$/.test(value)) {
    return { raw: value as Hex };
  }

  return String(value ?? "");
}

function assertLocalTestAllowed() {
  if (!isLocalTestAuthAllowed()) {
    throw new Error("Local test wallet is only available on localhost in development.");
  }
}

function parseOptionalBigInt(value: unknown, field: string): bigint | undefined {
  if (typeof value === "undefined" || value === null) {
    return undefined;
  }

  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(value);
  }

  if (typeof value === "string" && value.length > 0) {
    return BigInt(value);
  }

  throw new Error(`Invalid local test transaction ${field}.`);
}

function parseOptionalNonce(value: unknown): number | undefined {
  if (typeof value === "undefined" || value === null) {
    return undefined;
  }

  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }

  if (typeof value === "string" && value.length > 0) {
    return Number(BigInt(value));
  }

  throw new Error("Invalid local test transaction nonce.");
}

async function sendLocalTestTransaction(params: unknown): Promise<Hex> {
  const request = Array.isArray(params) ? params[0] : null;
  if (!request || typeof request !== "object") {
    throw new Error("Local test transaction request is missing.");
  }

  const transaction = request as {
    chainId?: Hex | number;
    data?: Hex;
    from?: Address;
    gas?: Hex | bigint | number;
    gasPrice?: Hex | bigint | number;
    maxFeePerGas?: Hex | bigint | number;
    maxPriorityFeePerGas?: Hex | bigint | number;
    nonce?: Hex | number;
    to?: Address;
    value?: Hex | bigint | number;
  };
  const account = getTestAccount();
  const from = transaction.from ? getAddress(transaction.from) : getAddress(account.address);

  if (from !== getAddress(account.address)) {
    throw new Error("Local test wallet can only send transactions from its configured account.");
  }

  if (!transaction.to || !isAddress(transaction.to)) {
    throw new Error("Local test transaction is missing a valid recipient.");
  }

  if (transaction.chainId) {
    const requestedChainId =
      typeof transaction.chainId === "number"
        ? transaction.chainId
        : fromHex(transaction.chainId, "number");
    if (requestedChainId !== base.id) {
      throw new Error(`Local test wallet only supports Base (${base.id}).`);
    }
  }

  const walletClient = createWalletClient({
    account,
    chain: base,
    transport: createResilientTransport(),
  });

  const transactionRequest: Record<string, unknown> = {
    account,
    chain: base,
    data: transaction.data,
    to: getAddress(transaction.to),
  };

  const gas = parseOptionalBigInt(transaction.gas, "gas");
  const gasPrice = parseOptionalBigInt(transaction.gasPrice, "gasPrice");
  const maxFeePerGas = parseOptionalBigInt(transaction.maxFeePerGas, "maxFeePerGas");
  const maxPriorityFeePerGas = parseOptionalBigInt(
    transaction.maxPriorityFeePerGas,
    "maxPriorityFeePerGas",
  );
  const nonce = parseOptionalNonce(transaction.nonce);
  const value = parseOptionalBigInt(transaction.value, "value");

  if (transaction.data) transactionRequest.data = transaction.data;
  if (gas !== undefined) transactionRequest.gas = gas;
  if (gasPrice !== undefined) transactionRequest.gasPrice = gasPrice;
  if (maxFeePerGas !== undefined) transactionRequest.maxFeePerGas = maxFeePerGas;
  if (maxPriorityFeePerGas !== undefined) {
    transactionRequest.maxPriorityFeePerGas = maxPriorityFeePerGas;
  }
  if (nonce !== undefined) transactionRequest.nonce = nonce;
  if (value !== undefined) transactionRequest.value = value;

  return walletClient.sendTransaction(transactionRequest as any);
}

export function localTestConnector() {
  let connected = false;
  let connectedChainId: number = base.id;

  return createConnector<any>((config) => ({
    id: "localTest",
    name: "Local Test Wallet",
    type: "localTest",

    async setup() {
      connectedChainId = config.chains[0]?.id ?? base.id;
    },

    async connect<withCapabilities extends boolean = false>({
      chainId,
      withCapabilities,
    }: {
      chainId?: number;
      isReconnecting?: boolean;
      withCapabilities?: boolean | withCapabilities;
    } = {}) {
      assertLocalTestAllowed();

      if (chainId && chainId !== connectedChainId) {
        await this.switchChain?.({ chainId });
      }

      const account = getTestAccount();
      connected = true;

      const accounts = withCapabilities
        ? [{ address: getAddress(account.address), capabilities: {} }]
        : [getAddress(account.address)];

      return {
        accounts: accounts as any,
        chainId: connectedChainId,
      };
    },

    async disconnect() {
      connected = false;
    },

    async getAccounts() {
      if (!connected) {
        throw new ConnectorNotConnectedError();
      }

      return [getAddress(getTestAccount().address)];
    },

    async getChainId() {
      return connectedChainId;
    },

    async isAuthorized() {
      return isLocalTestAuthAllowed();
    },

    async switchChain({ chainId }) {
      assertLocalTestAllowed();

      const chain = config.chains.find((candidate) => candidate.id === chainId);
      if (!chain) {
        throw new Error(`Chain ${chainId} is not configured for local test wallet.`);
      }

      connectedChainId = chainId;
      config.emitter.emit("change", { chainId });
      return chain;
    },

    onAccountsChanged(accounts: string[]) {
      if (accounts.length === 0) {
        this.onDisconnect();
        return;
      }

      config.emitter.emit("change", {
        accounts: accounts.map((account) => getAddress(account as Address)),
      });
    },

    onChainChanged(chainId: string | number) {
      connectedChainId = typeof chainId === "number" ? chainId : Number(chainId);
      config.emitter.emit("change", { chainId: connectedChainId });
    },

    async onDisconnect() {
      connected = false;
      config.emitter.emit("disconnect");
    },

    async getProvider() {
      const request = async ({ method, params }: { method: string; params?: unknown }) => {
        assertLocalTestAllowed();
        const account = getTestAccount();
        const address = getAddress(account.address);

        if (method === "eth_chainId") {
          return numberToHex(connectedChainId);
        }

        if (method === "eth_accounts") {
          return connected ? [address] : [];
        }

        if (method === "eth_requestAccounts") {
          connected = true;
          return [address];
        }

        if (method === "wallet_switchEthereumChain") {
          type Params = [{ chainId: Hex }];
          connectedChainId = fromHex((params as Params)[0].chainId, "number");
          config.emitter.emit("change", { chainId: connectedChainId });
          return null;
        }

        if (method === "personal_sign") {
          type Params = [Hex | string, Address];
          const [message] = params as Params;
          return account.signMessage({ message: normalizeMessageParam(message) });
        }

        if (method === "eth_sign") {
          type Params = [Address, Hex | string];
          const [, message] = params as Params;
          return account.signMessage({ message: normalizeMessageParam(message) });
        }

        if (method === "eth_signTypedData_v4") {
          type Params = [Address, string];
          const [, typedData] = params as Params;
          return account.signTypedData(JSON.parse(typedData));
        }

        if (method === "wallet_getCapabilities") {
          return {};
        }

        if (method === "wallet_watchAsset") {
          return true;
        }

        if (method === "eth_sendTransaction") {
          return sendLocalTestTransaction(params);
        }

        if (method === "wallet_sendCalls") {
          throw new Error("Local test wallet does not support wallet_sendCalls.");
        }

        throw new Error(`Local test wallet does not support ${method}.`);
      };

      return custom({ request })({ retryCount: 0 });
    },
  }));
}
