# Blackjack and Baccarat P1 fixes — 2026-09-08

Scope: BB-01, BB-02, BB-03, BB-04. All four findings were revalidated against the current implementation and fixed. No finding was withdrawn. No live wager, approval, or reveal transaction was submitted during this fix work. The deterministic browser tests mount the real dialogs and real preparation/receipt logic, replacing wallet/RPC/host adapters and presentation primitives.

## BB-01 — prepared Split/Surrender controller replacement

**Revalidated:** the original dialog rendered separate idle and in-progress Split/Surrender subtrees. The first preparation callback changed `txInProgress`, replacing the component owning the unresolved randomness request. The first response therefore populated an unmounted controller.

**Fix:** one stable secondary action row owns each action, with action keys and conditional visibility. Primary actions now also have explicit keys. Preparation rejects duplicate in-flight requests, handles preflight rejection inside its error boundary, and invalidates deferred results when its owner/land/action/token identity changes. Current phase and feature readiness are forwarded into the shared transaction controller. The parent permits its own prepared Deal to remain confirmable.

**Behavioral verification:** click Split or Surrender, hold the randomness promise, resolve it, and assert the existing visible control becomes confirmable after exactly one preparation request. The harness also checks the prepared Deal button remains enabled after the parent marks Deal in progress.

## BB-02 — incomplete Baccarat receipt displayed as a settled zero payout

**Revalidated:** the transaction adapter emitted `receiptIncomplete: true`, but the original dialog ignored it, defaulted missing payout to zero, cleared the active round, and exposed Play Again.

**Fix:** an immutable settlement record distinguishes a confirmed reveal awaiting its receipt from a complete outcome. Missing/partial receipts show neutral loading copy, retain the committed wager/side/token identity and transaction link, disable duplicate reveal/new wagers, and retry receipt retrieval automatically with bounded delays and an explicit retry control. Financial balance adjustments and completion callbacks run once, after a complete result. The receipt parser validates the emitting contract, owner, land, betting token, card counts/IDs, and outcome; decoded zero payouts remain valid, while absent amounts remain unknown.

**Behavioral verification:** missing receipt → neutral status/link/no Play Again/no fabricated zero → result-only partial receipt stays unresolved → full result/cards recover to the exact outcome and payout. Pure tests additionally cover legitimate zero payout, expiry, wrong emitter/owner/land/token, and invalid/missing cards.

## BB-03 — previous result leaking across owner/land/token scope

**Revalidated:** the original dialog retained unscoped result state on wallet/land changes and formatted a resolved round against `selectedToken`, including when an active round used a different token.

**Fix:** wallet/land changes remount the dialog controller by owner scope. Before reveal, the committed round stores owner, land, token, wager, bet type, reveal block, and available verified symbol/decimals. Result display uses that snapshot, never another selected token's precision. A selected-token change dismisses a completed prior result; an unresolved confirmed receipt retains its recovery context. Deferred receipt work stops on disposal and cannot populate a new owner's controller.

**Behavioral verification:** token A selected with an active token B round settles to `19.5 BETA` using B's six decimals. Wallet and land changes discard prior result UI and present the current active round. Pure parser checks reject other owner/land/token events.

## BB-04 — unrecoverable Blackjack reads and additional allowance

**Revalidated:** config failure left null config displayed as indefinite loading. Exhausted action reads told players to reopen. Additional-wager allowance failure had no approval control in the active hand. Approval confirmation also optimistically assumed unlimited allowance before verification.

**Fix:** config loading, unsupported configuration, failure and ready states are explicit. A Retry game data action reruns config/token/balance/action reads while preserving the hand. Double/Split expose in-place additional-wager approval and allowance verification. Unknown/low allowance keeps additional wagers disabled; confirmed approval is followed by bounded reads and actionable retry instead of invented unlimited allowance. Preflight fails closed on failed balance/allowance refresh.

**Metadata recovery refinement:** new/additional spending (Deal/Double/Split) requires verified metadata. Paid-round actions (Hit/Stand/Surrender/Baccarat Reveal) remain available during a token metadata outage. Both receipt parsers retain raw confirmed payout bigint values, show denomination as unavailable, and use verified precision when available. They do not assume 18 decimals or invent a zero payout to finish a paid round.

**Behavioral verification:** initial config failure/retry; insufficient allowance/approval; delayed failed allowance reads remain disabled until explicit verification succeeds; unknown metadata blocks Double/Split but allows Stand preparation/confirmation; Baccarat reveals with unknown decimals, stores the raw payout, and displays `19.5 BETA` after metadata recovers. Pure Blackjack settlement test confirms the raw payout and known-precision parsing agree.

## Files and checks

- [BlackjackDialog.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/BlackjackDialog.tsx), [blackjack-transaction.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/blackjack-transaction.tsx), [blackjack-events.ts](C:/Users/Goat/Documents/Pixotchi-Eco/lib/blackjack-events.ts)
- [BaccaratDialog.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/BaccaratDialog.tsx), [baccarat-transaction.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/baccarat-transaction.tsx), [baccarat-result.ts](C:/Users/Goat/Documents/Pixotchi-Eco/lib/baccarat-result.ts)
- `node scripts/test-casino-p1.mjs` — passed all 11 real-component browser checks; no unhandled browser errors.
- `npx tsx smoke/baccarat-result-smoke.ts` — passed.
- `npx tsx smoke/blackjack-paid-recovery-smoke.ts` — passed.
- Targeted ESLint over all changed game/helper/test files — passed without warnings.
- `npx tsc --noEmit --pretty false` — passed after shared metadata/controller integration.

The harness verifies interaction/state correctness in isolated Chromium, not real wallet signing, live randomness authorization, physical devices, visual layout, or production contract behavior. Shared Transaction/GameTransaction integration has separate owner tests and the root's integrated validation. Medium-priority card layout, rule language, deadline presentation and visual redesign remain outside this change.
