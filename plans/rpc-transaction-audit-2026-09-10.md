**Pixotchi codebase, RPC, transaction, and deployed-contract audit — 10 September 2026**

The highest priorities are preserving reviewed swap prices, blocking currently infeasible paid Solana bridge routes, making ambiguous airdrop submissions durably recoverable, and fixing Blackjack randomness-lock aliases wherever that signer is enabled. Several additional issues affect quest rewards, transaction success reporting, approvals, and RPC reliability.

This is a findings report. Application code and contract state were not changed. No transaction was broadcast. The existing changes to package.json and package-lock.json were preserved.

**Scope and evidence**

Reviewed checkout: commit `6a2506b`, app version 1.8.35, including the existing local dependency changes. Installed versions include Next.js 16.3.4, Viem 2.56.3, Wagmi 2.19.5, and CDP SDK 1.55.0.

The main Base snapshot is block **51,136,574**, hash `0x6b47a81d5869a625408827a08aad981ab279270bc45200f325a16fe7e3d10c44`, timestamp **2026-09-10 17:48:15 UTC**, chain ID 8453. Additional trade checks identify their own block or live quote. Sources were retrieved from Blockscout and checked against actual RPC runtime bytecode: all 48 inspected addresses had code, and all 48 matched the explorer's recorded runtime at the snapshot. Forty had verified source; the remainder included proxies and unverified implementations. Matching runtime is identity evidence, not proof of contract correctness.

The [machine-readable evidence](C:/Users/Goat/Documents/Pixotchi-Eco/plans/rpc-transaction-audit-2026-09-10-evidence.json) contains routing, runtime hashes, ABI comparison, current economic configuration, trade calculations, and reproduction outcomes. The downloaded full source/API responses and additional simulations are retained in `C:/Users/Goat/AppData/Local/Temp/pixotchi-rpc-audit-2026-09-10`.

Local feature flags were inspected where relevant. They do not establish the production website's deployed environment. Findings describe reproducible behavior and failure conditions; they do not imply a historical exploit or failed player transaction was observed.

**What the application does and how it works**

Pixotchi is an onchain gardening game on Base. Plant NFTs support minting, care items, combat, revival, naming, ETH reward claims, and arcade games. Land NFTs add production buildings, warehouses, marketplace trading, staking access, quests, casino games, and barracks. SEED funds core gameplay and staking; LEAF funds progression; the PIXOTCHI creator coin funds several utilities. Redis-backed services support identity sessions, chat, missions, notifications, claims, and status. The AI assistant reads game context and does not sign transactions.

The React game shell is composed in `app/providers.tsx`, `app/(game)/page.tsx`, and the Farm/Mint/Activity/Ranking/Swap tabs. Providers choose the appropriate Wagmi/authentication configuration for Base accounts, Privy/EOA wallets, or Farcaster. The optional Solana path derives and operates a corresponding Base twin account through a bridge.

The normal read path is: component or hook → contract helper/React Query → Viem public client → same-origin `/api/rpc` → server provider pool → Base. The pool separates reads, receipts, logs, and probes, with request batching, ranking, hedging, deadlines, and circuit breakers. The proxy limits methods and request size and applies anonymous/authenticated quotas. AI reads use a separate server-side client; indexer APIs supplement onchain reads.

The write path is: feature constructs calls → shared transaction controller → wallet chain/capability checks → durable submission reservation → EOA transaction or wallet call batch → canonical Base receipt → persisted completion and scoped UI refresh. Pending records and a coordinator support cross-component/tab recovery. Writes are not normally retried through the read RPC failover pool. Swaps add quote/build endpoints; server airdrops use CDP user operations.

**Deployed contract alignment**

| Purpose | Address | Observed architecture |
|---|---|---|
| Plants | `0xeb4e16c804ae9275a655abbc20cd0658a91f9235` | PixotchiRouter; 17 active extensions from live `getAllExtensions()` |
| Lands | `0x3f1f8f0c4be4bceb45e6597afe0de861b8c3278c` | DiamondProxy; 22 active facets from live `facets()` |
| SEED | `0x546d239032b24eceee0cb05c92fc39090846adc7` | Verified PixotchiToken; current buy/sell tax 5%/5%; transaction limits disabled |
| LEAF | `0xe78ee52349d7b031e2a6633e07c037c3147db116` | Proxy; TokenERC20 implementation `0x21bDBa30AFc2B8205E8a173626346868077572FB` |
| Staking | `0xf15d93c3617525054af05338cc6ccf18886bd03a` | Clone; TokenStake implementation `0x0Fd7345f5771f18D5B0B5Faa3D02700eA0520F3D` |
| Solana adapter | `0x0a4e3a93612037084265fe49da164e73ef6fbd8c` | Verified SolanaTwinAdapterV2; matches local configuration |
| Bulk NFT router | `0x8d0538fae8b3630c487b720d7767ae46aa58cda7` | Runtime present; source unavailable in the inspected explorer response |

The inspected core Plant, Land, staking, LEAF, casino, Baccarat, Blackjack, Fence, and Barracks ABI signatures generally match active routing and available verified output types. There is no broad wrong-contract/wrong-chain mismatch. Small stale ABI entries are recorded in finding 16. SpinGameV2 selectors are active, but source was unavailable through the inspected explorer, limiting semantic verification of that implementation. Primary references: [Plant router](https://base.blockscout.com/address/0xeb4e16c804ae9275a655abbc20cd0658a91f9235?tab=contract), [Land diamond](https://base.blockscout.com/address/0x3f1f8f0c4be4bceb45e6597afe0de861b8c3278c?tab=contract).

**1. P1 — Building a swap can silently reduce the minimum the player reviewed**

Code: [engine.ts:246](C:/Users/Goat/Documents/Pixotchi-Eco/lib/swap/engine.ts:246), [response.ts:74](C:/Users/Goat/Documents/Pixotchi-Eco/lib/swap/response.ts:74), [quote-token.ts:31](C:/Users/Goat/Documents/Pixotchi-Eco/lib/swap/quote-token.ts:31), [swap panel:1221](C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/pixotchi-swap-panel.tsx:1221).

The build endpoint always obtains a fresh Kyber route. The signed quote binds the input and route identity but omits output guarantees. The client parser checks pair/input/kind, then executes the new transaction. The existing unchanged-review check covers an expired quote refresh, not this unconditional build-time requote.

Reproduction using the actual parser: a reviewed minimum of `992500` accepted a built minimum of `496250` for the same input and pair. A market decline between review and build therefore resets slippage protection to a worse price without another review. Both direct and smart-wallet paths consume the built transaction.

**Recommended fix:** sign the reviewed minimum and recipient with the quote; enforce those terms at build time and against decoded executable calldata. Reject worsening terms and require renewed review. Permit improvements that still satisfy the original floor. For multi-step swaps, carry an end-to-end output constraint rather than protecting each independently requoted leg without a final guarantee.

**Regression check:** change price between quote and build, including after approval and before a second leg; execution must never open a wallet request whose effective final minimum is below the reviewed floor.

**2. P1 — The configured paid Solana mint route is currently infeasible**

Code: [solana-quote.ts:143](C:/Users/Goat/Documents/Pixotchi-Eco/lib/solana-quote.ts:143), [useSolanaBridge.ts:484](C:/Users/Goat/Documents/Pixotchi-Eco/hooks/useSolanaBridge.ts:484), [bridge service:200](C:/Users/Goat/Documents/Pixotchi-Eco/lib/solana-bridge-service.ts:200).

The app treats a positive adapter estimate as executable and returns `isEstimate: false`. The deployed adapter estimates required input by linearly scaling fixed 1 WETH and 1 WSOL probes. That is not a reverse quote for the actual amount and does not establish route capacity. See `getWsolForSeed`, source lines 153–183, in the [verified adapter](https://base.blockscout.com/address/0x0a4e3a93612037084265fe49da164e73ef6fbd8c?tab=contract).

At block **51,136,668**, its WSOL/USDC pool held **0.000751611 WSOL and 0.077679 USDC**. Same-block forward quotes through the exact configured routers returned:

| Strain | Adapter-required SEED | Quoted SOL | Actual forward SEED before tax |
|---|---:|---:|---:|
| 1 / 4 | 10 | 1.161293701 | 9.828575606 |
| 2 | 20 | 2.322587404 | 9.831750367 |
| 3 | 40 | 4.645174809 | 9.833401243 |
| 5 | 500 | 58.064685125 | 9.834671147 |

All fail the required output even before SEED's 5% tax. The normal 10-SEED case produces only about **9.3371 net SEED**. Source, adapter prices, both forward routers, and actual pool reserves corroborate this result.

The user signs the Solana leg before the Base action executes, so bridge fees or asset movement can precede the Base failure. Permanent loss was not established; recovery depends on bridge transfer/call semantics. Existing failure records should be retained. Solana is enabled locally; production website flags were not checked.

**Recommended fix:** reject infeasible paid bridge quotes before signing; restore a viable liquidity route; replace linear estimates with exact reverse quoting or bounded forward search that accounts for tax. Verify execution feasibility before bridging. More SOL or a weaker minimum cannot repair this pool's capacity.

**Regression check:** replay the recorded reserves, require a blocked quote, and verify valid and insufficient-liquidity cases before any Solana signature.

**3. P1 — Ambiguous airdrop recovery can create a second payout after the deduplication window**

Code: [airdrop-claim-state.ts:42](C:/Users/Goat/Documents/Pixotchi-Eco/lib/airdrop-claim-state.ts:42), [claim route:342](C:/Users/Goat/Documents/Pixotchi-Eco/app/api/airdrop/claim/route.ts:342).

If CDP accepts a payout and the process dies before its operation ID is persisted, the record remains pending without a proof. Once the lease expires, the app retries with the same idempotency key indefinitely and overwrites the original timestamp. CDP's documented deduplication window is 24 hours, not indefinite. [CDP idempotency documentation](https://docs.cdp.coinbase.com/api-reference/v2/idempotency).

The actual reservation helper accepted a 48-hour-old pending record, reused its key, and erased its original age. Inspection and a mock of installed CDP SDK 1.55.0 also confirmed that the high-level `sendUserOperation` prepares a new operation on each invocation, applying idempotency only at broadcast. A changed nonce can produce a different prepared hash. Within the key window, different request parameters can be rejected; beyond it, the old key does not provide an enduring duplicate-payment guarantee.

**Recommended fix:** prepare the operation, durably save its identity and immutable first-submission time before broadcasting, then reconcile or rebroadcast that exact operation. Ambiguous legacy records require reconciliation before another payment, especially beyond the provider window. A durable payout identifier enforced onchain would give stronger protection than a time-limited API key alone.

**Regression check:** crash before/after broadcast and before/after proof persistence, advance beyond 24 hours, and verify recovery never prepares a second economic payout without proving the first did not occur.

**4. P1, conditional — Blackjack accepts multiple randomness locks for the same land and nonce**

Code: [random route:65](C:/Users/Goat/Documents/Pixotchi-Eco/app/api/blackjack/random/route.ts:65), [validation:421](C:/Users/Goat/Documents/Pixotchi-Eco/app/api/blackjack/random/route.ts:421), [lock use:545](C:/Users/Goat/Documents/Pixotchi-Eco/app/api/blackjack/random/route.ts:545).

`landId` accepts decimal strings with leading zeros. Redis uses the original string, while contract reads and signature payloads use its numeric value. `1`, `01`, and `001` therefore acquire three locks for the same onchain land/nonce, permitting multiple random seeds and a choice among them. Authentication and CAS do not unify those identities.

Revalidated with the actual normalization/key logic and the numeric verifier in `LibBlackjack.sol` from the [active Blackjack facet](https://base.blockscout.com/address/0x435cd34c9b41e98b1781a47c0b90f5b008e08bf2?tab=contract). This requires the casino, Blackjack, and legacy-signature acknowledgement gates. All are enabled in the local configuration; production website exposure is unverified. It is separate from the already documented weakness of unsigned economic inputs.

**Recommended fix:** normalize once with `BigInt(landId).toString()` and use the canonical value for every lock, cleanup, lookup, and signed message, or reject noncanonical strings. Plan for already-issued alias signatures before reenabling the service; changing only future key formatting does not revoke existing signatures.

**Regression check:** all equivalent spellings must share one decision and one random result, including concurrent requests and cleanup paths.

**5. P2 — Farmer House upgrades hide time-sensitive quest claims**

Code: [building-details-panel.tsx:90](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details-panel.tsx:90), [upgrade control:212](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details-panel.tsx:212), [FarmerHousePanel.tsx:194](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details/FarmerHousePanel.tsx:194).

The global upgrading gate replaces the Farmer House panel, including the only finalize/reset controls. An upgrade is permitted while a committed quest exists. The deployed quest logic still permits finalization during construction, but the app removes access until an upgrade that can outlast the **256-block reward window** finishes. A committed reward can expire unless the player bypasses the UI or completes the upgrade early.

Revalidated by tracing the only finalize controls and upgrade guards, then checking `LibQuest.finalizeQuest` and `LibTown.getBuildingLevel`: the contract's existing-quest eligibility does not prohibit upgrades. This is not the same as village production, which correctly returns zero during an upgrade.

**Recommended fix:** keep existing quest status/finalize/reset controls available during construction. Gate new quest starts/slots separately according to intended contract behavior.

**Regression check:** commit a quest, begin an upgrade, and finalize through the normal UI before expiry.

**6. P2 — Quest finalization can use zero current-block randomness**

The active `questFinalize` selector `0xf987ae07` resolves to [QuestFacet 0x69B87…9Cc4](https://base.blockscout.com/address/0x69B87aa1D358EF59Be93de7DF6Fe3923C7AA9Cc4?tab=contract). Its verified `src/libs/LibQuest.sol:132` accepts `block.number >= pseudoRndBlock`, then reads `blockhash(pseudoRndBlock)` at line 146. The current block's hash is unavailable and returns zero. [Solidity blockhash semantics](https://docs.soliditylang.org/en/latest/units-and-global-variables.html).

A read-only `eth_call` at block 51,136,574 with synthetic committed-quest storage and `pseudoRndBlock` equal to the current block returned `[true, 0, 3000000000000000000]`: a hard quest awarded the deterministic minimum **3 SEED**. This was a state-override simulation, not an actual player's claim. Targeting the block immediately after commit permits selection of that outcome. It proves bias, not that minimum SEED always has the highest market value.

**Recommended fix:** upgrade the finalization facet to require `block.number > pseudoRndBlock`, handle zero randomness defensively, and preserve the valid historical-hash window. Domain-separate random derivation by land/slot/quest to avoid correlated outcomes; that alone does not solve all blockhash-based randomness limitations.

**Regression check:** current block fails; next block succeeds; the `+256` boundary remains usable; expired quests follow the intended reset path.

**7. P2 — Medium and hard quests receive the easy cooldown**

In the same verified `LibQuest.sol:165–167`, finalization resets `quest.difficulty` to EASY before selecting `cooldownInBlocks`. Live configuration is **21,600 / 32,400 / 43,200 blocks** for easy/medium/hard, but all use **21,600**. Rewards are computed before the reset, so the intended higher reward multiplier remains with an unintentionally shorter cooldown.

**Recommended fix:** capture the completed difficulty or cooldown before mutating the quest, then compute the next eligible block. This requires a contract change. The current UI correctly counts down the stored cooldown; it is not an independently incorrect countdown display.

**Regression check:** verify reward multipliers and cooldowns independently for all three difficulties against the recorded configuration.

**8. P2 — A different replacement transaction can complete the original game intent**

Code: [transaction-kit.tsx:1271](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/transaction-kit.tsx:1271).

Viem distinguishes equivalent repricing from replacement with different destination/value/calldata. The controller only rejects reason `cancelled`; reason `replaced` persists the new hash and accepts its successful receipt as success for the original action.

Executing the actual extracted receipt-controller function with SDK replacement callbacks yielded: repriced accepted, replaced accepted, cancelled rejected. The SDK's installed implementation independently confirms those meanings. Original-action notifications, refresh effects, and callbacks can run despite that action not executing.

**Recommended fix:** mark a non-equivalent replacement as superseding the original action. Persist the disposition with the replacement proof so reload/recovery cannot reinterpret it as original success. Equivalent repricing may continue normally. The same persistence requirement applies to cancellation.

**Regression check:** repricing, unrelated replacement, cancellation, and reload immediately after each replacement callback.

**9. P2 — A stale acknowledgement can erase a refreshed pending-transaction blocker**

Code: [pending-evm-transaction.ts:1124](C:/Users/Goat/Documents/Pixotchi-Eco/lib/pending-evm-transaction.ts:1124), [delete comparison:1205](C:/Users/Goat/Documents/Pixotchi-Eco/lib/pending-evm-transaction.ts:1205), [acknowledgement:1230](C:/Users/Goat/Documents/Pixotchi-Eco/lib/pending-evm-transaction.ts:1230).

After a wallet returns a proof, finalization refreshes the stored reservation and then writes the proof. If the latter storage write fails, a fresh hard blocker remains. A stale UI snapshot can nevertheless acknowledge it because age is checked on the old argument while deletion compares only attempt/proof, ignoring the new timestamp.

Two independent executions of the actual helpers with an injected write failure produced: old UI phase `stale`, durable phase `hard`, acknowledgement `true`, remaining record `null`. This can remove durable recovery and allow a later duplicate submission after reload or from another controller. It requires the storage-failure/stale-snapshot sequence; ordinary successful proof persistence is not affected.

**Recommended fix:** validate the current durable record's age and revision while acknowledging, coordinate with finalization, and retain/retry persistence of the known proof. A refreshed reservation that represents a known submission should retain the stronger known-proof recovery window.

**Regression check:** fail the proof write after refreshing the reservation, acknowledge with an older snapshot, and verify the durable blocker survives.

**10. P2 — RPC wrapping discards actionable error data and bypasses intended receipt backoff**

Code: [base-rpc.ts:1040](C:/Users/Goat/Documents/Pixotchi-Eco/lib/base-rpc.ts:1040), [error class:1110](C:/Users/Goat/Documents/Pixotchi-Eco/lib/base-rpc.ts:1110), [proxy sanitizer:450](C:/Users/Goat/Documents/Pixotchi-Eco/app/api/rpc/route.ts:450), [wait classification:116](C:/Users/Goat/Documents/Pixotchi-Eco/lib/transaction-lifecycle.ts:116).

Upstream errors are wrapped without numeric RPC codes, revert bytes, or a safe causal classification. A real transport/proxy test with mocked upstream code 3 and revert data produced HTTP 200 with JSON-RPC error code **-1**, generic text, and no revert data. Simulations lose useful contract diagnostics. Wrapping an already retryable BaseRpcError can also change `retryable` to false.

Separately, a Viem receipt timeout is recognized as unresolved before wrapping and unrecognized afterward because lifecycle classification checks generic message text. The local receipt retry loop exits. Cross-review established that the coordinator retains the proof and restarts recovery after 250 ms: the consequence is backoff bypass/monitoring churn, not permanent abandonment or automatic rebroadcast.

**Recommended fix:** define a bounded safe error envelope preserving numeric code, revert bytes where applicable, and structured retry/category information. Preserve it across nested wrapping and use it in monitors. Do not restore raw upstream causes that may contain credential-bearing URLs.

**Regression check:** upstream → transport → API → browser/monitor tests for a contract revert, timeout, rate limit, and nested wrapping; verify both diagnostics and retry spacing.

**11. P2 — Staking mistakes a positive allowance for a sufficient allowance**

Code: [contracts.ts:1252](C:/Users/Goat/Documents/Pixotchi-Eco/lib/contracts.ts:1252), [staking API:33](C:/Users/Goat/Documents/Pixotchi-Eco/app/api/staking/info/route.ts:33), [staking-dialog.tsx:398](C:/Users/Goat/Documents/Pixotchi-Eco/components/staking/staking-dialog.tsx:398).

The composite read collapses allowance into `allowance > 0`. The UI hides approval and enables staking from that Boolean. A residual allowance of 1 SEED while staking 10 SEED leaves an insufficient-allowance transaction and no approval action. The [verified active TokenStake implementation](https://base.blockscout.com/address/0x0Fd7345f5771f18D5B0B5Faa3D02700eA0520F3D?tab=contract) transfers the full requested amount; the live staking token is SEED.

**Recommended fix:** preserve exact bigint allowance through API serialization and compare it with the entered amount. Test zero, partial, exact, and unlimited approvals.

**12. P2 — SEED's displayed minimum is higher than its encoded swap minimum**

Code: [engine.ts:384](C:/Users/Goat/Documents/Pixotchi-Eco/lib/swap/engine.ts:384), [slippage calculation:780](C:/Users/Goat/Documents/Pixotchi-Eco/lib/swap/engine.ts:780).

Even without changing prices, display uses `gross × 0.95 × 0.9925`, while the build adds tax/slippage into 575 bps, encoding `gross × 0.9425`. A live quote/build decoded with the [deployed Kyber router ABI](https://base.blockscout.com/address/0x6131B5fae19EA4f9D964eAc0408E4408b66337b5?tab=contract) gave displayed minimum **295.193041302717507549 SEED**, encoded minimum **295.075637203034602536 SEED**. The discrepancy is **0.117404099682905013 SEED** for that trade. Read-only execution of the built calldata succeeded.

**Recommended fix:** derive display and transaction protection from one authoritative integer floor; verify it against calldata. If constrained to integer basis points, round toward stronger protection. Fix this alongside finding 1, but retain a separate unchanged-price regression because review binding alone will not correct the arithmetic.

**Further confirmed capacity and efficiency findings**

13. **P2, capacity:** [base-rpc-policy.ts:14](C:/Users/Goat/Documents/Pixotchi-Eco/lib/base-rpc-policy.ts:14) derives the HTTP cap as if Viem's 8,192-byte batch size bounded the entire encoded multicall. It counts only inner calldata. Actual Viem serialization of 1,000 four-byte reads produced **384,264 JSON bytes**, exceeding the **338,944-byte** proxy limit and receiving HTTP 413. No current screen reaching that volume was established. Bound actual aggregate/request bytes and call count, including HTTP batching; test real serialization rather than the present algebra-only assertion.

14. **P3, efficiency:** [base-rpc-policy.ts:130](C:/Users/Goat/Documents/Pixotchi-Eco/lib/base-rpc-policy.ts:130) finds the first finite latency instead of the minimum. Identical 1,000-ms/100%-success and 100-ms/87.5%-success samples reverse ranking when endpoint configuration order changes. Use the finite minimum and test order invariance except genuine ties.

15. **P2, reliability:** [base-rpc.ts:421](C:/Users/Goat/Documents/Pixotchi-Eco/lib/base-rpc.ts:421) scans formatted errors for HTTP-status substrings before excluding deterministic failures. A contract revert containing an address ending in `0429` was classified as provider-health failure because Viem includes request parameters in its message. Ordinary reverts can penalize a healthy provider. Use typed HTTP/RPC fields and narrowly scoped error details; test incidental digits in addresses/calldata.

16. **P3, ABI hygiene:** the router has no active `getKillCooldownSeconds` or `isKillCooldownEnabled` selectors, and the Land ABI retains the unrouted `questStorageUpdate`. The AI tool actually calls the missing cooldown getter at [ai-read-tools.ts:863](C:/Users/Goat/Documents/Pixotchi-Eco/lib/ai-read-tools.ts:863), then falls back to 3,600 seconds. This is a guaranteed failed read, not proof that the fallback value is wrong. Remove unsupported calls or use explicit version/capability information. Add a deployment manifest and a read-only selector/output check for functions actually used by the app.

**Verification and corrections after independent review**

Passing checks: `npm run typecheck`, `rpc:smoke`, `lint:base-rpc`, `production-fixes:smoke`, `transaction-infra:smoke`, `transaction-feedback:smoke`, `swap:smoke`, `quest:smoke`, `casino:smoke`, and `solana:smoke`. The RPC smoke logs a missing-Redis message in its isolated environment and still passes; it is not a live Redis integration check. Several existing tests validate source patterns and fixtures, which explains why transport-boundary and deployed-state failures remain undetected.

Validation combined code-path review, installed SDK implementation checks, controlled runtime reproductions, live fixed-block reads, source/runtime matching, and a read-only synthetic contract simulation. Chrome failed to launch for the attempted transaction browser reproduction, so no browser end-to-end pass is claimed. The replacement branch was instead executed from actual source and checked against Viem semantics.

Independent review removed or narrowed misleading conclusions: wrapped receipt failures do not permanently abandon the transaction; the quest UI correctly displays stored cooldown; the Solana evidence does not prove permanent fund loss; and unrelated raw ABI entries were not mistaken for Plant functions. Existing protections against owner changes, ambiguous submissions, unsafe automatic rebroadcast, and credential exposure were accounted for.

A casino bankroll concern was inspected but is not reported as an observed failed payout: wagers depend on later access to an external reward pool, and no currently insufficient live allowance or failed payout was established. The known legacy Blackjack signature limitation remains separate from the new alias-lock bug. The audit does not claim complete semantic verification of unverified contracts or the entire bridge protocol.

**Suggested implementation order**

First, enforce reviewed swap floors and prevent infeasible bridge submissions. Repair airdrop proof persistence and canonicalize Blackjack lock identities before relying on those payout/signing paths. Then preserve quest claim access, upgrade the quest finalization logic, and correct replacement and pending-record recovery. Address staking approval and the shared RPC error contract next. Finish with serialization limits, ranking, provider-health classification, and automated deployed-ABI checks.

Contract fixes require an authorized deployment/upgrade process and tests against the actual active facets. Frontend guard fixes are useful immediate mitigations, but they do not correct the deployed quest algorithms or adapter quoting implementation.
