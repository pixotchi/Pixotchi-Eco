/** Minimal connector contract used by protocol adapters, independent of a UI SDK. */
export type AuthWalletConnector = { id: string; name: string; getProvider: () => Promise<unknown> };
export type WalletConnectRequest<C extends AuthWalletConnector> = {
  connector: C;
  chainId?: number;
  withCapabilities?: boolean;
  capabilities?: { signInWithEthereum: {
    chainId: string; nonce: string; issuedAt: string; statement: string; version: string; domain?: string; uri?: string;
  } };
};
export type ConnectAuthWallet<C extends AuthWalletConnector> = (request: WalletConnectRequest<C>) => Promise<unknown>;
