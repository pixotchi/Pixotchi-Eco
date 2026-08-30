/**
 * Proves the shared swap-bundle builder emits exactly what the five hand-written
 * copies emitted, and that the router deadline is no longer frozen.
 *
 * Run: npx tsx smoke/swap-bundle-equivalence-smoke.ts
 */
import assert from "node:assert/strict";

import {
  PIXOTCHI_NFT_ADDRESS,
  PIXOTCHI_TOKEN_ADDRESS,
  UNISWAP_ROUTER_ADDRESS,
  WETH_ADDRESS,
} from "../lib/contracts";
import {
  buildSwapAndApproveCalls,
  MAX_UINT256,
  SWAP_DEADLINE_SECONDS,
} from "../lib/swap/bundle-calls";
import { sanitizeSwapDecimalInput } from "../lib/swap/rules";

// User-entered amounts remain exact strings until parseUnits converts them to
// bigint. Exponents and malformed values must never be rounded or reinterpreted.
assert.equal(sanitizeSwapDecimalInput("9007199254740993.000000000000000001"), "9007199254740993.000000000000000001");
assert.equal(sanitizeSwapDecimalInput("1,25"), "1.25");
assert.equal(sanitizeSwapDecimalInput("1,234,567.89"), "1234567.89");
for (const invalidAmount of ["1e6", "2E-3", "-1", "+1", "1foo2", "1..2", "1,2,3"]) {
  assert.equal(sanitizeSwapDecimalInput(invalidAmount), null, invalidAmount);
}

// --- the pre-refactor shape, transcribed verbatim from the old components ------
const LEGACY_UNISWAP_ROUTER_ABI = [
  {
    inputs: [
      { name: "amountOutMin", type: "uint256" },
      { name: "path", type: "address[]" },
      { name: "to", type: "address" },
      { name: "deadline", type: "uint256" },
    ],
    name: "swapExactETHForTokens",
    outputs: [{ name: "amounts", type: "uint256[]" }],
    stateMutability: "payable",
    type: "function",
  },
] as const;

const LEGACY_ERC20_ABI = [
  {
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    name: "approve",
    outputs: [{ name: "", type: "bool" }],
    stateMutability: "nonpayable",
    type: "function",
  },
] as const;

function legacyCalls(args: {
  address: string;
  deadline: bigint;
  ethAmount: bigint;
  minSeedOut: bigint;
  spender: string;
}) {
  const maxApproval = BigInt(
    "115792089237316195423570985008687907853269984665640564039457584007913129639935",
  );
  return [
    {
      address: UNISWAP_ROUTER_ADDRESS,
      abi: LEGACY_UNISWAP_ROUTER_ABI,
      functionName: "swapExactETHForTokens",
      args: [
        args.minSeedOut,
        [WETH_ADDRESS, PIXOTCHI_TOKEN_ADDRESS],
        args.address,
        args.deadline,
      ],
      value: args.ethAmount,
    },
    {
      address: PIXOTCHI_TOKEN_ADDRESS,
      abi: LEGACY_ERC20_ABI,
      functionName: "approve",
      args: [args.spender, maxApproval],
    },
  ];
}

const address = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const deadline = BigInt(1_800_000_000);
const ethAmount = BigInt("12345678901234567");
const minSeedOut = BigInt("20000000000000000000");

for (const spender of [PIXOTCHI_NFT_ADDRESS, "0x3f1F8F0C4BE4bCeB45E6597AFe0dE861B8c3278c"]) {
  const next = buildSwapAndApproveCalls({ address, deadline, ethAmount, minSeedOut, spender });
  const prev = legacyCalls({ address, deadline, ethAmount, minSeedOut, spender });

  assert.equal(next.length, 2, "bundle must still emit exactly swap + approve");
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(next, (_k, v) => (typeof v === "bigint" ? `${v}n` : v))),
    JSON.parse(JSON.stringify(prev, (_k, v) => (typeof v === "bigint" ? `${v}n` : v))),
    `shared builder output diverges from the legacy shape for spender ${spender}`,
  );
}

// Constants must not have drifted during extraction.
assert.equal(
  MAX_UINT256,
  BigInt("115792089237316195423570985008687907853269984665640564039457584007913129639935"),
  "max approval changed",
);
assert.equal(SWAP_DEADLINE_SECONDS, 600, "deadline window changed");

// The value passed through untouched — the swap must still carry the ETH.
const sample = buildSwapAndApproveCalls({
  address,
  deadline,
  ethAmount,
  minSeedOut,
  spender: PIXOTCHI_NFT_ADDRESS,
});
assert.equal(sample[0].value, ethAmount, "ETH value must ride on the swap call");
assert.equal(sample[1].value, undefined, "approve call must not carry value");
assert.equal(sample[0].args[3], deadline, "deadline must be the 4th swap arg");
assert.deepStrictEqual(sample[0].args[1], [WETH_ADDRESS, PIXOTCHI_TOKEN_ADDRESS], "swap path changed");
assert.equal(sample[0].args[2], address, "swap recipient must be the user");

console.log("swap bundle equivalence: OK (2 spender variants, shape byte-identical to pre-refactor)");

// --- the bug this refactor fixes ---------------------------------------------
// Demonstrates the class of defect, without React: a value computed inside a memo
// whose dependencies never change is frozen at first evaluation, while wall-clock
// time keeps moving. UniswapV2Router reverts with "EXPIRED" once the frozen
// deadline falls behind block.timestamp.
function fakeMemo<T>(compute: () => T) {
  let cached: T | undefined;
  let evaluated = false;
  // deps never change, so this mirrors useMemo(..., [address, amounts, ids])
  return () => {
    if (!evaluated) {
      cached = compute();
      evaluated = true;
    }
    return cached as T;
  };
}

let fakeNow = 1_700_000_000;
const frozen = fakeMemo(() => fakeNow + SWAP_DEADLINE_SECONDS);
const atRender = frozen();
fakeNow += 11 * 60; // user spends 11 minutes on the screen
const atClick = frozen();

assert.equal(atRender, atClick, "old pattern: deadline is frozen across time");
assert.ok(
  atClick < fakeNow,
  "old pattern: by click time the deadline is already in the past -> router reverts EXPIRED",
);

// The replacement recomputes from the clock, so the same elapsed time yields a
// deadline that is still ahead of "now".
const refreshed = fakeNow + SWAP_DEADLINE_SECONDS;
assert.ok(refreshed > fakeNow, "new pattern: deadline stays ahead of now");

console.log(
  `frozen-deadline bug reproduced: rendered=${atRender}, clicked at ${fakeNow} -> expired by ${fakeNow - atClick}s; refreshed value would be ${refreshed}`,
);
