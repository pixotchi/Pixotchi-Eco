# Frontend high-priority fixes — 8 September 2026

Scope: the **30 high-priority finding groups** in the September 8 audit of checkout `2d21280`, version 1.8.35. Each finding was revalidated before implementation. Some groups overlap, so this is not a claim of 30 independent root causes.

The **29 code-defect groups are fixed and revalidated**, including independent review of shared transaction recovery. All local integrated checks passed: **1,203 browser scenario/project combinations, three real-provider journeys, build, typecheck, lint and smoke checks**. **ARC-06 remains partially addressed:** local infrastructure and critical regressions are implemented, but the original broader journey/device acceptance remains open. Medium-priority implementation can begin while that explicit release-validation requirement is completed; it has not begun in this change. No changes have been committed or deployed.

## Revalidation and resolution ledger

| Category | ID | Revalidated defect or gap | Implemented resolution |
| --- | --- | --- | --- |
| Architecture | ARC-02 | Failed token reads substituted 18 decimals or SEED. | Exact, validated metadata and explicit readiness/retry across every consumer; block new spending with unknown precision while preserving already paid game recovery. |
| Architecture / verification | ARC-06 | Shared fixtures omitted real providers and journeys; the existing matrix was red. | **Partially addressed, remains open:** add real local-wallet journeys, actual-component failure/race regressions, all-theme focus coverage, deterministic fixture bootstrap and timestamps, reviewed visual references, and CI/release gates. Broader seeded gameplay, external-wallet/host and physical-device acceptance is still required. |
| Foundation | FND-01 | Performance Mode removed keyboard rings; Profile Follow separately replaced the entire composed shadow. | Remove decorative elevation while preserving ring/offset contributions; verify actual painted focus across eight themes, modes, controls and overlay return. |
| Gameplay | G01 | Fence-only restrictions disabled ordinary care approval. | Use the existing item-scoped eligibility explanation as the shared action gate; retain fence-specific restrictions. |
| Gameplay | G02 | Failed/loading ETH rename quotes silently exposed SEED actions. | Keep payment mode stable; share the identity-keyed quote hook and retain the same controller through loading/retry. |
| Gameplay | G03 | Land rename unmounted its own pending transaction controller. | Keep one controller mounted and freeze the submitted name while pending. |
| Buildings | BP-01 | Quest Return started an expiry window despite unavailable opening funds. | Fresh funding preflight before Return; per-slot simulation permits already committed payable rewards; explicit expired Reset remains available. |
| Buildings | BP-04 | An enabled raid preview could describe previous inputs while sending current inputs. | Key previews by wallet/land/target/troops, reject late results, and require the exact current preview before submission. The feature remains off by default and was enabled in regression tests. |
| Transactions | TX-01 | Intermediate staking text such as `.` threw during rendering. | Build calls only from successfully parsed bigint amounts; invalid drafts stay editable and cannot produce calls. |
| Transactions | TX-02 | Unsupported atomic-wallet capability escaped execution cleanup. | Put capability preparation inside the complete error/finally lifecycle without downgrading atomic bundles. |
| Transactions | TX-03 | Retry/custom entry bypassed readiness and ignored preflight errors. | Mandatory controller readiness, awaited veto-capable preflight, current wallet/calldata validation, stable preparation, preserved unresolved proof recovery, and wallet-generation isolation through delayed reconciliation and late send responses. |
| Transactions | TX-04 | A new mint selection could retain an earlier ETH quote. | Synchronous amount/identity invalidation and a fresh pre-submit quote; changed price requires another review. |
| Transactions | TX-05 | Selected strain objects retained old supply/price after catalog refresh. | Store selected ID and derive current catalog data; freeze submission identity and block removed/inactive/sold-out choices. |
| Transactions | TX-06 | Capped marketplace lists hid older orders and Cancel actions. | Shared incremental list reaches every order; consistent owned-order cancellation across All/Mine/price levels. |
| Transactions | TX-07 | Reopened transfer review read cleared drafts while prepared calldata persisted. | Render exact recipient, network and current/remaining/completed asset IDs from the immutable plan; preserve review through close/reload and provide explicit cancellation. |
| Transactions | TX-08 | Confirmed batches re-enabled stale executable items before refresh. | Freeze submitted subsets, retire confirmed identities immediately, coalesce receipt-aware scans and gate retry until an authoritative census succeeds. |
| Casino / Arcade | CA-01 | Box displayed Ready before a successful cooldown read. | Explicit loading/error/ready state, subject isolation, retry and resume refresh. |
| Casino / Arcade | CA-02 | SpinLeaf elapsed time enabled reveal before chain eligibility. | Authoritative block readiness and fresh simulation; local timer never authorizes submission. |
| Casino / Arcade | CA-03 | Roulette configuration failure appeared as endless loading. | Recoverable config state and retry; already paid rounds can reveal despite config/metadata outages. |
| Casino / Arcade | CA-05 | SpinLeaf expiry disappeared on close/tab change/reload. | Pre-commit deadline disclosure, persistent active/expired public identity, off-tab polling and farm-level recovery context. |
| Casino / Arcade | CA-17 | Prior outcomes could survive changed owner/asset/token context. | Scope presentation lifetime and validate receipt subject; retain raw exact payouts and their own event denomination. |
| Blackjack / Baccarat | BB-01 | Split/Surrender replaced their own preparing controller. | Preserve the same controller through delayed preparation, rejection and retry. |
| Blackjack / Baccarat | BB-02 | Incomplete Baccarat receipts became fabricated blank/zero outcomes. | Neutral unresolved-result state with retained hash, raw round details, polling and explicit recovery. |
| Blackjack / Baccarat | BB-03 | Baccarat results could belong to a previous wallet/land/token. | Immutable round subject and event-token denomination with owner/land presentation isolation. |
| Blackjack / Baccarat | BB-04 | Blackjack config/allowance errors trapped the current hand. | In-place config and allowance retry/additional approval; preserve no-new-spend paid-round actions while metadata is unavailable. |
| Social / secondary | SS-01 | Kill could proceed without a verified cooldown. | Fail closed on unknown/failed reads and check again immediately before submission. |
| Social / secondary | SS-02 | Revive fallback price and stale balance could authorize a wrong action. | Owner-scoped authoritative reads and fresh preflight; changed price requires a new review. |
| Social / secondary | SS-03 | Verify Claim accepted asynchronous results from a previous wallet. | Owner/generation-scoped state and continuations, cancellation and fresh signature/request checks. |
| Social / secondary | SS-04 | Neural Seed cleared failed sends because SDK resolution was mistaken for success. | Adapt installed SDK outcomes, retain failed draft/bubble, support retry and prevent history replacement from corrupting retry identity. |
| Social / secondary | SS-05 | Activity retained freshness/data from the previous wallet. | Fetch immediately for a new owner and fence stale requests and in-flight ownership. |

Revalidation refined two original assumptions. SpinLeaf's last valid block is **commit + 257**, with expiry at **commit + 258**, verified against current deployed bytecode. Already committed quests must not inherit the conservative whole-pool gate: their actual reward may still be payable, so their recovery uses per-slot simulation.

## Validation

| Check | Final result |
| --- | --- |
| Full lint, Base RPC lint, TypeScript and whitespace checks | Passed. |
| Optimized production build | Passed on the settled source, including its TypeScript stage. Generated Next type imports were restored to the repository's existing development paths; a final standalone typecheck also passed. |
| Production isolation | All five QA routes return 404; app root returns 200 and production CSP remains intact. |
| High-priority domain runner | All nine checks passed, including real-component care/rename and casino/arcade harnesses. |
| Existing frontend smoke | All four suites passed, including all 33 production dialog call-site inventory contracts. |
| Existing app-fixes smoke | All ten constituent suites passed during integration. |
| Transaction-controller matrix | **294 passed**, zero failed or skipped: 21 scenarios across all 14 configured projects, including final wallet-generation recovery. |
| Layout/interaction/focus/domain matrix | **909 passed, 99 intentional skips, zero failed** in 14.2 minutes. All nine reviewed screenshot references passed without snapshot-update mode. |
| Real-provider app journeys | **3 passed** at 390/820/1440 on the final source, zero uncaught page errors and zero observed transaction-submission RPC methods. Known chat console errors remain documented. |

The full browser matrix is split into the nine shared/domain spec files and the transaction-controller spec so each runs against its settled source. Results are combined without double-counting targeted reruns. Browser projects are Chromium at 320/390/820/864/1024/1440 in light/dark, plus WebKit at 390/1024. The fixture matrix uses reduced motion except dedicated motion assertions; the real desktop journey exercises normal motion. Hosted GitHub jobs were updated but were not executed during this local work.

Together these two runs cover **all 1,302 configured combinations: 1,203 passed, zero failed, 99 skipped**. The skips are 88 repeated all-theme focus combinations outside the three selected engine/viewport contexts, plus 11 visual-reference combinations outside the three reviewed Windows contexts. No transaction-controller, building, economy, social, care or countdown scenario was skipped. Compared with the audit's 591 passed / 14 failed / 11 skipped, the prior failing matrix is repaired and critical-state coverage is expanded.

Reproduce with `npm run frontend:test -- --workers=2` (complete matrix), `npm run frontend:p1` (domain checks), and `npm run frontend:app` (requires the configured local test wallet). Final matrix artifacts are in `output/frontend-p1-matrix-verified` and `output/frontend-p1-core-matrix-verified`; both `.last-run.json` files report passed with no failed tests. The real journeys are in `output/playwright/app-journeys`. Exploratory interrupted runs and baseline generation are excluded from these totals.

The source and test changes preserve existing design identity and focus on correctness, recoverability and consistent behavior. Nine dense-surface references were independently compared with their originals: Barracks/Arcade capture origins were stabilized; Chat references also caught up with a compact Profile-button change already present in the audited HEAD. See the independent visual review; this was not an unreviewed acceptance of changed screenshots.

## Practical limits

- Real journeys used the existing local EOA test wallet, no plants and land #1112. They exercised all six tabs, staking drafts, exact transfer-review persistence/cancellation and reconnect on Chromium phone/tablet/desktop, including normal desktop motion. No transaction was submitted in this fix pass.
- Failure, expiry, owner-change, incomplete-receipt and rare holding scenarios use real production components/controllers with controlled I/O. These are deterministic regressions, not claims of live onchain execution for every scenario.
- Localhost chat authentication reported an SIWE domain mismatch. An earlier desktop TradingView request returned 403; that error did not recur in the final repeat. The shell remained usable, but successful authenticated chat and chart rendering were not established by these assertions. Authentication was not weakened.
- Physical phones/tablets, external wallet return, smart-wallet/paymaster execution, Farcaster/Base hosts, Solana, assistive technology and exhaustive owned-plant/building journeys remain outside this environment's runtime sign-off. ARC-06 now has reproducible real-provider and critical-state coverage; it does not certify 100% runtime/device coverage.
- Fresh frontend preflight cannot reserve liquidity, freeze mutable chain state or guarantee inclusion before a deadline. It prevents using information already known to be stale/unavailable and retains recovery when the outcome remains uncertain.

## Detailed evidence

- [Transaction core and transfer](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/fixes-transaction-core.md)
- [Mint, quotes and marketplace](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/fixes-economy.md), [batch reconciliation](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/fixes-batches.md)
- [Gameplay](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/fixes-gameplay.md)
- [Buildings](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/fixes-buildings.md)
- [Casino and Arcade](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/fixes-casino-arcade.md)
- [Blackjack and Baccarat](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/fixes-blackjack-baccarat.md)
- [Social and secondary flows](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/fixes-social.md)
- [Focus](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/fixes-foundation.md)
- [Coverage gate and remaining acceptance](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/fixes-coverage.md), [real application journeys](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/fixes-app-journeys.md), [independent visual review](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/fixes-visual-verification.md)
