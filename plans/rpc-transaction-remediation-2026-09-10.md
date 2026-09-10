# App-only RPC and transaction remediation

Implements audit findings **1, 3, 4, 5 and 8–16**. Solana (2), quest randomness (6), and quest cooldown contract logic (7) remain unresolved and outside this change. There are no contract deployments, liquidity changes, or economic-policy changes. Existing dependency upgrades are preserved.

## Review groups

| Group | Implementation and intended behavior |
| --- | --- |
| 1. RPC error contract | `lib/base-rpc-errors.ts` preserves bounded revert bytes and typed retry/provider-health metadata through actual Viem HTTP decoding. Infrastructure codes stay distinct from contract reverts; messages and causes cannot leak upstream credentials. |
| 2. Transaction recovery | Existing v2 pending keys retain sticky replacement meaning, original hash identity, exact asynchronous acknowledgement under submission/monitor ownership, and a separately retried captured-proof queue. Superseded actions do not run original success effects. Ordinary ambiguity remains five minutes; captured/known proofs remain thirty minutes. |
| 3. Swap protection | v3 authorizations bind one Kyber execution to reviewed integer economics, chain, sender and recipient. Decoded `swap`, `swapGeneric`, and `swapSimpleMode` calls must enforce the required floor. Approval delays revalidate without accepting weaker terms; old v2 authorizations require refresh. |
| 4. Airdrop recovery | The server prepares, persists, signs, persists the broadcasting fence, and sends only that saved operation. Recovery observes or resends the same hash. Ambiguous legacy records stay under review. Settlement checks bind the exact user operation, sender, token transfers and canonical receipt. |
| 5. Blackjack identity | Canonical uint256 IDs and persistent nonce decisions close new alias issuance. A resumable SCAN tool verifies signatures, copies one decision with CAS, and quarantines conflicts. Production issuance requires a completed inventory for the deployed signer rollout. |
| 6. Gameplay | Farmer House recovery remains available through upgrades. New single/batch starts recheck construction without clearing paid batch state. Staking compares exact bigint allowance with the submitted amount, including postapproval refresh and unknown-read recovery. |
| 7. RPC size/routing | Browser multicall budget is 2,048 bytes. A fetch adapter packs complete JSON-RPC calls by actual UTF-8 size, count and bounded concurrency. Bulk plant reads split before encoding and share a block. Ranking uses minimum finite latency. Unsupported ABI entries are removed and reviewed deployment checks cover Plant routes, Land facets, token/proxy/staking and swap routers. |

## Rollout and compatibility

1. Ship each paired client/server change together. In particular, old swap authorizations intentionally return `410 SWAP_QUOTE_EXPIRED`; the existing refresh flow obtains v3 terms. Publish the normal application build/update identity so open clients can refresh. Do not clear recovery localStorage.
2. Retain Redis records and v2 transaction storage namespaces. Invalid optional transaction metadata must not delete an otherwise recoverable proof. Do not bulk-clear pending payouts, Blackjack locks, or quarantines.
3. Follow [Blackjack rollout](blackjack-canonical-lock-rollout.md). All signer instances need the same `BLACKJACK_CANONICAL_SIGNER_ROLLOUT_ID`. A dry-run inventory report comes first; after all instances are upgraded, an explicitly applied fresh scan establishes the stable marker. Until then, production randomness issuance fails closed. Previously issued signatures cannot be revoked by the app.
4. Review ambiguous airdrops individually using the tool below. Status GET only observes; manual-review responses stop automatic polling/retry. Supplying an operation hash never authorizes a new payout. Admin imports and clears preserve every attempted, pending, claimed or uncertain record; eligible-only edits use exact CAS so they cannot overwrite a concurrent reservation.
5. Check the release deployment with the live command below. Review changed implementations and update the manifest deliberately from independently verified evidence. Never regenerate application ABIs automatically from explorer responses.
6. Rollback must retain v3 refresh behavior, readers for new transaction metadata, airdrop broadcast fences, and Blackjack canonical/quarantine enforcement. Restoring old payout retry logic or old signer instances is unsafe.

## Operator commands

Supply credentials through the intended environment. Commands do not load production credentials implicitly. Reports contain bounded status/evidence fields, not signatures, private attempt records or raw provider errors.

```text
npm run contracts:smoke
npm run contracts:check
npm run contracts:check -- --live
```

Live checks use the central Base read client (`RPC_NODE` or `BASE_RPC_NODE`) and a single observed block. Exit 1 reports a deployment/ABI/configuration mismatch. Exit 2 reports unavailable observation/source evidence. `--allow-source-unavailable` only acknowledges missing verified source, not missing RPC observations or actual mismatches. Fixture checks are deterministic and make the existing unverified-source gaps explicit.

The airdrop reconciliation command is dry-run by default:

```text
npm run airdrop:reconcile -- --address <recipient>
npm run airdrop:reconcile -- --address <recipient> --operation-id <hash> --evidence <review-reference>
```

After reviewing proven account, allocation and settlement evidence, append `--apply --expected-sha256 <dry-run-fingerprint>`. The command revalidates evidence and changes only the exact reviewed Redis value. Inconclusive records remain under review. No reconciliation apply or production payout was run during implementation.

## Observability

Fixed-cardinality counters cover rejected swap builds/reviews, airdrop ambiguity/CAS/settlement, Blackjack quarantine, superseded transactions/acknowledgement conflicts, physical RPC request bytes, and provider failure classifications. The existing authenticated admin RPC-status endpoint includes server-instance RPC, swap and Blackjack counters. Client/process counters reset with the process; airdrop daily Redis counters expire after seven days. These are diagnostic counters, not an external monitoring deployment. They accept no credential, signature, raw response, wallet or quote labels.

## Validation

The regression suites exercise production helpers, encoded calldata, actual Viem transport, real transaction controllers in Chromium, and Lua/SCAN concurrency against disposable Redis. No production Redis data or onchain state is modified. `remediation:smoke`, `remediation:redis:smoke`, the fixture deployment check, and focused browser tests run in their own CI job.

Recorded verification:

- TypeScript, full ESLint, Base RPC hardening, and optimized Next production build passed.
- The focused RPC/swap/transaction/gameplay/deployment suite and actual gameplay-panel browser smoke passed. Existing transaction infrastructure/feedback, RPC, swap, quest, and casino smoke suites passed.
- All **74** transaction-controller browser tests passed across `390-light` and `1024-light`, covering EOA and smart-wallet submissions, replacement meanings, reload recovery, asynchronous acknowledgement, and proof persistence while receipt observation remains pending.
- Disposable Redis concurrency suites passed for payout attempt boundaries, stale admin writes, canonical Blackjack decisions, and alias reconciliation. The airdrop-card Chromium smoke confirmed manual-review records stop automatic polling and payout retry; safe retries require an explicit click.
- Live read-only deployment verification at Base block **51139332** reported **no selector, runtime, implementation, output or configuration mismatches** in the active manifest scope. The manifest tracks **326 functions across nine contracts**. Fifteen selector-output checks lack verified source and remain explicitly unknown.
- An initial live Kyber read-only build attempt returned HTTP 503. A subsequent live check using the production quote/build helpers succeeded for **0.001 ETH → USDC** and **0.001 ETH → SEED**: quote and build endpoints returned HTTP 200, and the resulting router calldata passed the new execution validation. No wallet signing or broadcasting occurred. The earlier 503 did not establish an application regression; its underlying cause was not determined.

An unrelated pre-existing `frontend:smoke` inventory step is blocked because `docs/qa/frontend-dialog-coverage-2026-09-05.csv` is absent from the repository. The first three frontend smoke stages passed. The new CI job does not depend on that missing inventory, and the focused browser tests ran successfully. No missing-fixture assertion was disabled or weakened.

The manifest preserves explicit unavailable-source findings for the active Spin V2 implementation, several administrative Land facets, and the optional batch-transfer router. Their routing/runtime checks are separate from source/output verification. The tool does not claim source verification where none exists.

Residual limits: old Blackjack signatures remain usable according to the existing contract; a browser cannot guarantee durable recovery when every storage write after wallet submission fails; Solana and the two deferred quest contract findings require separate remediation.
