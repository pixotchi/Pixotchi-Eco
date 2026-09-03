import assert from "node:assert/strict";

import {
  sendCalls,
  waitForCallsStatus,
  waitForTransactionReceipt,
} from "viem/actions";
import { useAccount, useChainId, useWalletClient } from "wagmi";
import { useShowCallsStatus } from "wagmi/experimental";

type PrivyCreateConfig = typeof import("@privy-io/wagmi")["createConfig"];
type PrivyWagmiProvider = typeof import("@privy-io/wagmi")["WagmiProvider"];
const assertPrivyTypes = <T extends PrivyCreateConfig, U extends PrivyWagmiProvider>() => true;
void assertPrivyTypes;

// Runtime imports make dependency drift fail loudly. TypeScript also verifies
// these exact installed-v2 surfaces whenever the repository is typechecked.
for (const api of [
  sendCalls,
  waitForCallsStatus,
  waitForTransactionReceipt,
  useAccount,
  useChainId,
  useWalletClient,
  useShowCallsStatus,
]) {
  assert.equal(typeof api, "function");
}

console.log("transaction package compatibility smoke passed");
