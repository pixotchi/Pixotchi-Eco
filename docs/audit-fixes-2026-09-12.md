# Follow-up audit fixes — 12 September 2026

All ten original findings were reproduced against baseline `3468699` before changes. This document records the fixes and their operating limits. No deployment, transactions, paid model requests, or live notification sends were performed.

| Finding | Change | Regression evidence |
| --- | --- | --- |
| F01 — Public staking reads bypass RPC quotas | Both staking endpoints enforce a shared Redis-backed IP/global budget before contract reads. Composite reads cost five units; balance reads cost one. Quota outages return 503. Rejected IP traffic cannot drain the later global bucket. | Handler tests reach the limit and confirm zero additional provider reads; accounting outages reject requests. |
| F02 — Incomplete staking rankings appear successful | Enumerate and read balances at a single block, distinguish getter bounds from transport failures, reject incomplete multicalls, and fail visibly with 503. Versioned Redis cache owns the 15-minute freshness window; HTTP responses use no-store. | Pinned-block, empty-array, zero-slot, partial-batch and RPC-outage fixtures. Read-only Base check confirmed this deployment's getter returns an empty EVM revert for an out-of-range index. |
| F03 — Chat admission races | A single Lua operation validates cooldown and duplicate rules, then stores the message and index together. Optional client request IDs make transport retries idempotent. Legacy reads/deletion and new-key index recovery remain supported. | Real isolated Redis: 16 concurrent submissions produce one message; retries return that same message; duplicate text admits at most three wallets; wrong-type storage consumes no admission. Actual service tests cover SDK decoding, index recovery and admin deletion. |
| F04 — Redis history double-decoding | Parse strings once, accept SDK-deserialized objects, and validate notification history records. | Actual installed Upstash SDK response decoding, serialized rows and malformed rows. |
| F05 — Delivery evidence disappears on persistence errors | Count and retain each acknowledged batch before progress callbacks. Attach accumulated delivery evidence to later errors, including pruning failures; retain the completed response if final campaign persistence fails. | Callback, later batch, pruning and post-send persistence failures preserve acknowledged delivery counts. |
| F06 — Solana timeout starts too late | One deadline covers initial confirmation, signature polling, finalized-height checks, expiry reconciliation and polling delays. Timeout remains pending evidence and cannot trigger a late success callback. | Stalled initial/polling/expiry RPC fixtures, late resolution and existing Solana lifecycle tests. |
| F07 — Sponsorship inferred from the wrong setting | Context and transaction execution share a validated paymaster URL resolver. A public CDP client key alone does not enable sponsorship. Optional sponsorship never makes swap Max spend the ETH gas reserve. | Configuration matrix, gas-reserve guard and transaction browser regressions. |
| F08 — AI treats reservations as completed claims | Read both Verify indexes and use the canonical pair classifier. Expose completion, retryability and blocking state separately; unavailable storage is an error. | Unclaimed, processing, retryable, completed, inconsistent-pair and unavailable-store fixtures. |
| F09 — Each AI step reuses the remaining budget | A shared provider middleware checks input plus output allowance before every planning, generation, tool-loop, streaming or continuation call. Output is capped to the remaining allowance. Unknown usage retains its reservation; provider calls denied before admission refund the request reservation. | Real AI SDK generation, streaming and tool-loop fixtures; near-limit admission; unknown-usage retry rejection; full production instructions and 42 schemas fit the normal allowance. |
| F10 — Historical AI costs use today's provider price | Remove the unsupported historical-price calculation. The API returns null and the admin UI displays “Unavailable” with a provider-billing explanation. | Mixed historical model fixture preserves token totals without reporting false zero spend; admin parser accepts unknown cost. |

## Operating details

- Public staking limits are 300 work units per IP per minute and 12,000 globally per minute. They require working Redis accounting. Requests without an IP share an `unknown` bucket.
- The staking snapshot supports up to 100,000 array entries and fails rather than silently truncating a larger deployment. Only an actual bounds panic or the deployed getter's empty contract revert denotes the end; transport failures never do.
- Chat keeps its existing 24-hour message retention, 3-second cooldown and 30-second duplicate window. New client request IDs are scoped to the sending wallet. The legacy admin ID/time selector refuses ambiguous matches.
- AI normally reserves up to 131,072 tokens, capped by the wallet's remaining daily allowance. Each invocation estimates input conservatively from UTF-8 bytes, schemas and framing, then limits output. Final accounting uses reported provider usage; interrupted or unmeasured work keeps the conservative charge. This is application quota protection, not an authoritative provider billing limit. Media requests are rejected because their input cost cannot be inferred from a URL.
- Notification delivery and Redis cannot be one cross-provider transaction. A process crash or sustained Redis outage after a vendor accepted a send still requires reconciliation; these fixes preserve available acknowledgments and do not add automatic resend.
- Accurate historical dollar totals require per-generation billing data, including routed model, input/output/cache rates and actual provider charges. This change deliberately represents missing cost data as unavailable.

## Validation

Focused offline checks: `npm run audit:fixes:smoke`.

Redis integration: `npm run audit:regressions` creates an isolated Docker Redis by default. This Windows run used an ephemeral Redis 8.0.5 process inside WSL at loopback port 16389, selected through `AUDIT_TEST_REDIS_PORT`; no application `.env` was loaded. The service tests only permit network calls to the local Redis bridge.

Passed: focused regressions, isolated Redis integration, lint (plus a final check of changed files), standalone typecheck, production build, `app-fixes:smoke`, `remediation:smoke`, `frontend:smoke`, the stake-cache compatibility check, and all 74 transaction browser checks across the 390px and 1024px fixtures.

The new focused suite is included in the transaction-remediation CI job. Generated audit/build copies under `output/` are excluded from TypeScript source discovery so stale copies cannot be compiled as application code.
