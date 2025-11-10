"use client";

import { createConfig, http } from "wagmi";
import type { CreateConnectorFn } from "wagmi";
import { base } from "viem/chains";
import { SafeConnector } from "@gnosis.pm/safe-apps-wagmi";
import { getRpcConfig } from "./env-config";

const rpcConfig = getRpcConfig();
const primaryRpcEndpoint = rpcConfig.endpoints[0] || "https://mainnet.base.org";

export const SAFE_CONNECTOR_ID = "safe";

type ConnectorChains = Parameters<CreateConnectorFn>[0]["chains"];

export const createSafeConnectorInstance = (chains: ConnectorChains) =>
  new SafeConnector({
    chains: [...chains],
    options: {
      debug: false,
    },
  });

const createSafeConnector: CreateConnectorFn = (config) =>
  createSafeConnectorInstance(config.chains) as unknown as ReturnType<CreateConnectorFn>;

export const wagmiSafeConfig = createConfig({
  chains: [base],
  connectors: [createSafeConnector],
  transports: {
    [base.id]: http(primaryRpcEndpoint),
  },
  pollingInterval: 500,
  ssr: true,
});


