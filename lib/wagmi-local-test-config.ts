"use client";

import { createConfig } from "wagmi";
import { base } from "viem/chains";
import { createResilientTransport, getPrimaryRpcEndpoint } from "./rpc-transport";
import { getDataSuffix } from "./builder-code";
import { localTestConnector } from "./local-test-connector";

const primaryRpc = getPrimaryRpcEndpoint();
const baseWithRpc = {
  ...base,
  rpcUrls: {
    default: { http: [primaryRpc] },
    public: { http: [primaryRpc] },
  },
};

const baseTransport = createResilientTransport();
const dataSuffix = getDataSuffix() as `0x${string}` | undefined;

export const wagmiLocalTestConfig = createConfig({
  chains: [baseWithRpc],
  transports: {
    [base.id]: baseTransport,
  },
  ...(dataSuffix ? { dataSuffix } : {}),
  connectors: [localTestConnector()],
  pollingInterval: 300_000,
  ssr: true,
});
