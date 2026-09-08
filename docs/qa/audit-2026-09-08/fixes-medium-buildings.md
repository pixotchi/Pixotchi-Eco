# Building panels: medium fixes, 2026-09-08

Scope: the nine original P2 groups **BP-02, BP-03, BP-05, BP-06, BP-07, BP-08, BP-09, BP-10, BP-11**. The P1 implementation was the starting point. No contract writes, commits, deployments, package changes, or snapshot updates were performed by this worker. AGENTS.md, the installed Next client-component guide, Apple design, Emil design engineering, React best-practices, and Playwright guidance were consulted. This is a source/behavior completion report; the root task owns final integrated type/build, device screenshots, and full regression results.

## Revalidation and implementation

### BP-02 — distinguish unavailable quest reads from insufficient funding

Revalidation: P1 already made failed multicalls explicit and added a Farmer House retry. The remaining batch consumer could still leave disabled actions unexplained and described actual insufficiency as an operational wallet refill/approval task.

Fix: Farmer House and batch now explain checking versus failed availability and offer Retry. A valid insufficient result uses player-facing pause guidance. Existing committed loot remains accessible through its per-slot simulation; start/Return require known funding. The shared reader throws on any failed balance/allowance, unresolved payer, or invalid configuration instead of inventing zero. The submitted batch/fee recovery branches remain mounted during these reads.

Verification: `building-guards.spec.ts` covers failed/read-retry and committed simulation recovery; the actual Farmer House component smoke covers configuration/availability failure and retry. `quest-funding-read-smoke.mjs` fails each of the four funding reads independently. The existing batch coordinator smoke passed. Limitation: a read may succeed and liquidity may change afterward; no frontend check reserves funds.

### BP-03 — keep raid target selection usable during background reads

Revalidation: the P1 preview identity repair did not remove per-block target/config/report polling or the target picker's refreshing-disable condition.

Fix: target discovery runs when Raid opens and every 30 seconds while relevant; it retains the last list and selection during refresh and exposes failed reads with Retry. A background refresh cannot overlap itself. The snapshot hook retains same-land data, separates loading/error, polls every 30 seconds independently of currentBlock, and only loads reports when History opens or an explicit action asks for them. Submit freshly checks target eligibility before preserving the P1 current-preview check.

Verification: the production Barracks/snapshot hook fixture advances eight block updates without extra target/config/report reads, verifies reports on History, holds a 30-second target response while the menu stays open and enabled, changes selection, and rejects a freshly ineligible target before any send. Limitation: the latest eligibility can change after preflight; the contract remains authoritative.

### BP-05 — explicit Barracks balance and approval readiness

Revalidation: failed allowance reads and training's unknown balance still appeared as zero/shortage/approval after P1.

Fix: `getBuildingPurchaseReadiness` and `PurchaseReadinessNotice` share the checking, read error, shortage, approval-required, and ready decisions with Casino. Unknown allowance remains undefined and is fenced by wallet, land, and token. Monetary amounts require authoritative metadata. Retry sits beside the affected read state. Exact required, available, and missing amounts use one formatter.

Verification: actual Barracks build/train covers missing balance, failed balance/allowance, retry, shortage before approval, and a late old-wallet allowance that cannot unlock a new wallet. Its production approval/controller survives a held wallet request plus a failed 30-second snapshot refresh; the troop, amount, and tab controls stay disabled during the attempt, one wallet call completes, and failed feature reads still block later training.

### BP-06 — affordability before approvals, with controller continuity

Revalidation: ordinary LEAF upgrades and PIXOTCHI speed ups still offered approval before a known shortage. Barracks had the same ordering. Gameplay's new allowance status also needed a compatible generic UpgradePanel consumer.

Fix: ordinary upgrades check actual shortage first, show the amount missing, remove obsolete step labels, and accept explicit allowance readiness/error/retry from the parent. Barracks and Casino follow the shared readiness order. `useBuildingApproval` pins the current wallet/land/action/token and retains the same approval controller across changing read results. Approval adapters forward lifecycle updates. Unresolved submitted proof remains owned, and success remains visible through the controller's brief completion interval before the next readiness branch appears.

Verification: `upgrade-affordability-smoke.mjs` passes 17 production component scenarios for both currencies, unknown/error balances, unknown/error allowances, shortages, exact affordability, and max-level behavior. The interactive fixture additionally runs the actual UpgradePanel, LeafApproveTransaction, GameTransaction, and Transaction controller through a held approval plus a new balance failure: one submission, retained success feedback, then a disabled purchase/read-retry state. The same real controller checks pass for Barracks and Casino. Limitation: this work does not redesign the overall building-navigation lifecycle; durable transaction recovery remains the core controller's responsibility when a user leaves the panel entirely.

### BP-07 — paused Barracks gates all new spending

Revalidation: built Barracks still exposed training/approval when its configuration disabled the service.

Fix: one feature-availability decision gates build, training, and raid; inspection remains available. New submissions read current configuration before execution. A changed build token/cost or selected troop token/cost/training duration refreshes the snapshot and asks the player to review again. Pending approvals keep their controller even if polling subsequently reports a pause or failure.

Verification: fixture shows paused service with no approval, rejects a pause discovered only at Train submission, and rejects a training-duration-only admin change without sending. Limitation: admin configuration can still change after the final read or while a wallet confirmation is open.

### BP-08 — Casino recovery and statistics survive read errors

Revalidation: the host's configuration catch still cleared active games and represented failed discovery as an empty token list. Statistics errors disappeared.

Fix: token configuration, each paid round, and statistics load independently and retain same-owner/land/token information on failed refresh. Initial unknown round reads have explicit Check actions; known active rounds keep Resume even if token configuration fails. A strict opt-in `casinoGetSupportedTokens({ throwOnError: true })` distinguishes valid empty from failed discovery without changing other consumers' default API behavior. Failed stats retain prior data with an explicit error and retry.

Verification: actual Casino host recovery is exercised at 320, 820, and 1440 pixels under cold configuration failure and later round-read failure. Additional checks cover cold unknown round recovery, statistics retry, valid empty configuration, and a late old-land response that cannot create a recovery action in the new land. Casino dialog internals are tested by the casino/blackjack workers. Limitation: this isolated host harness mocks the game dialogs and does not certify their full layout.

### BP-09 — Casino build balance errors are recoverable

Revalidation: a failed initial balance could still stay at Checking indefinitely.

Fix: the same purchase readiness resolver/notice used by Barracks exposes balance failure and Retry, retains allowance as unknown on failure, and never offers approval based on an unsuccessful read.

Verification: actual Casino build covers failed balance/allowance, successful retry, insufficient balance before approval, and a held production approval that survives a new balance error without losing its wallet/receipt feedback. A continuing failed balance gates later spending.

### BP-10 — show the exact configured build charge

Revalidation: the whole-token Casino formatter advertised an inexact amount for fractional costs; the contract call and affordability checks use raw integer units.

Fix: build price, button, available balance, and shortage use the same precision-safe token formatter with authoritative decimals. Barracks uses the same exact monetary treatment. Build preflight also compares current configured token/cost with the reviewed values.

Verification: both real hosts render **1.400001 TEST** for a six-decimal configured cost, including the Build button, and assess shortage with exact raw units. Metadata failure remains a new-spend gate from P1. Limitation: these are deliberately noninteger fixture prices, not a claim that the current deployed Casino build price is fractional.

### BP-11 — authoritative quest terms and matching funding policy

Revalidation: P1 retained hardcoded 3/6/12-hour selector labels and no selected tradeoff or pre-start opening warning. The reward-readiness thresholds also claimed to represent one maximum payout but were stale constants. Read-only Base verification at block **51037418** returned configured durations 5400/10800/21600 blocks and multipliers 1/2/3, with base SEED 1–4, LEAF 5000–16667, lifetime 3600–28800 seconds, points 1–33, and XP 1–5.

Fix: read all three difficulty configurations and the reward ranges at the same observed block through the declared contract getters. The pure selector receives prepared duration strings, and the adjacent summary explains actual selected duration/multiplier, five possible reward ranges, randomized outcome, and the two transactions plus 256-block opening deadline **before Start**. Invalid settings expose Retry and block new starts. Seed/Leaf values require actual token metadata; points/XP follow the verified contract units. No unverified per-difficulty cooldown promise was added: local finalize code resets difficulty before its cooldown lookup.

The same one-maximum-payout reserve policy is preserved, but derives required SEED/LEAF from fresh maximum ranges times the largest configured multiplier, regardless of which difficulty is largest. At the verified configuration this is **12 SEED / 50,001 LEAF**, each covered by both payer balance and allowance. New single/batch starts compare the reviewed configuration against the **same fresh snapshot** used for funding, avoiding a second-read terms mismatch. That snapshot also publishes the newly observed terms for review. Return refreshes funding without starting a deadline blindly; committed Open retains independent per-slot simulation and expired Reset remains available.

The read-only AI quest-readiness consumer now reuses the shared snapshot and policy rather than hardcoded wallets/thresholds. It retains its response keys and custody redaction, tells players to wait before Return during unavailability, and explains that existing loot bags retain their Open simulation check. `availableForLootBags` means that check remains accessible, not a liquidity guarantee; the tool's limitations state this explicitly.

Verification: production Farmer House/configuration/funding hooks show configured durations and multiplier-adjusted ranges, reject changed reviewed terms, and recover failed settings/availability. Pure tests cover exact thresholds, every insufficient balance/allowance boundary, changed maximum ranges, a non-Hard highest multiplier, invalid settings, and duration-only changed terms. Shared-reader tests verify the same-block setting reads, payer rotation, failed settings, four failed funding reads, changed reserve, and the AI consumer's reuse/redaction. The six quest/raid guard browser tests pass in three projects (18 total), including an increased reward range discovered during Return preflight and a configuration outage with committed recovery.

Limitation: settings and funding can change after preflight; payouts remain determined by the contract at opening. The read-only live getter check is not deployed-bytecode equivalence proof. Production mutations were not submitted.

## Verification record and integration notes

- `node smoke/building-p2-components-smoke.mjs`: **15 scenario groups passed**. It mounts production Barracks, Casino, Farmer House, Upgrade, query hooks, and UI primitives. The approval continuity cases use actual approval adapters, GameTransaction, and Transaction with only wallet/RPC/provider boundaries controlled. Other action-call scenarios use a submission spy. This behavior harness does not load Tailwind, so its viewport cases do not certify visual spacing.
- `node smoke/upgrade-affordability-smoke.mjs`: **17 scenarios passed**.
- `node smoke/quest-funding-read-smoke.mjs`: passed.
- `npx tsx smoke/building-transaction-guards-smoke.ts`, `smoke/batch-quest-smoke.ts`, and `smoke/owner-resource-races-smoke.ts`: passed.
- `npx playwright test tests/frontend/building-guards.spec.ts --project=390-light --project=820-dark --project=webkit-390-light --workers=2`: **18 passed**; uses the root-owned localhost:3000 dev server.
- Targeted ESLint for owned panels, hooks, readers/helpers, adapters, and regressions: passed after the final test-variable rename.

Narrow shared edits were coordinated: gameplay supplied allowance readiness props through BuildingDetailsPanel; root supplied the semantic info token and viewport menu primitive, consumed by the batch quest/Barracks changes. The QA frontend selector receives deterministic string labels and remains usable without live RPC or a query provider. The P1 report explicitly links this medium threshold revalidation so its historical constants are not mistaken for current behavior. No whole-suite/build or visual screenshot claims are made here; those belong to root's final integration report.
