# Casino and Arcade frontend audit — 2026-09-08

This is a source audit, not a claim of live end-to-end transaction coverage. The root audit owns browser validation on localhost:3000. No application code was changed and no wallet transaction was submitted by this subaudit. Findings below distinguish directly observed source behavior from layout or lifecycle risks requiring a targeted runtime check. Blackjack/Baccarat details are in `blackjack-baccarat.md`; CasinoPanel host findings belong to the building-panels report.

## Scope and operating model

Arcade belongs to a selected plant: Box Game chooses one of nine seeds, optionally spends a star, submits one contract mutation, decodes PTS/lifetime, and reconciles cooldown/stars. SpinLeaf spends stars through a commit transaction, persists a browser reveal secret scoped by wallet and plant, reconstructs pending state from logs/storage, then requires a separate reveal transaction before block expiry. It presents a decorative wheel, cooldown, cost, balance, and rewards. Solana bridge wallets receive an unavailable dialog.

Casino belongs to a land with a Casino building and selected token. The host fetches supported tokens, game availability, balances, approvals and active games. Roulette has a per-selection amount, up to the configured number of distinct table selections, total wager and maximum gross payout, approval, placement, a reveal-block wait, reveal/expired settlement, and receipt-derived result. Baccarat follows a bet/commit/reveal model. Blackjack maintains an active hand with signed randomness, action permissions, split/insurance/surrender and timeout settlement. All use the shared GameTransaction adapter over the durable transaction kit, paymaster/builder capabilities, and owner-resource reconciliation.

Feature state is material: `lib/casino-feature.ts` defaults casino and Blackjack off unless flags enable them; the client uses `CLIENT_ENV` public flags (`lib/env-config.ts:50`). Blackjack additionally has server legacy-signature acknowledgement gating. Environment-dependent disabled paths were reviewed in source; current deployed enablement is not inferred from `.env.example`.

## Prioritized findings

Severity: P1 can mislead about an outcome or interrupt/reject a meaningful player action; P2 materially hurts reliability, accessibility or understanding; P3 is polish/maintenance debt. These are product priorities, not claims of formal standards certification.

### CA-01 — P1 — Box Game advertises Ready and permits play before its cooldown read succeeds

Evidence: `components/arcade/ArcadeDialog.tsx:184` initializes both cooldowns to zero. `:400`–`:467` reads them; failure at `:445` only logs a warning. `:1241`–`:1255` gates play from those numeric values, with no initial loading/error state. The stat at `:1379` consequently shows Ready while the read is unresolved or failed. The initial fetch also does not set `boxReconcilePending`.

Impact: on slow/failing RPC or a new plant, the player sees an authoritative Ready state and can open a wallet request that the contract may reject. Previously selected plant cooldown can also remain during a new plant read.

Solution: make Box cooldown a wallet/plant-keyed loading/ready/error resource, retain last known values as stale, disable fresh play until authoritative readiness, and expose Retry next to the status. Follow the existing SpinLeaf `getSpinReadState` behavior instead of treating zero as unknown.

### CA-02 — P1 — SpinLeaf reveal eligibility is based on a local delay, not the block eligibility already calculated

Evidence: `ArcadeDialog.tsx:758` calculates `commitBlock + 2 - blockNumber`; `:760` calculates expiry. `:765`–`:775` writes a reveal deadline. But `canReveal` at `:1192`–`:1197` checks only pending owner, secret, and `revealUnlockedAt` (set to now + 3000 at `:1059`). It never reads the authoritative block/unlock count or the deadline. Restored pending rounds start with `revealUnlockedAt === null`.

Impact: Stop Wheel can enable after three elapsed seconds while the required block is still unavailable, or immediately after reopening a newly committed round. This is a source-derived action-eligibility defect; its frequency depends on block/RPC timing.

Solution: track `revealEligibility: unknown | waiting | ready | expired` from chain state, disable while unknown/waiting, and show the actual block wait. A cosmetic minimum spin duration must be separate and must never authorize the transaction.

### CA-03 — P1 — Roulette initial config failure strands the dialog in a false loading state

Evidence: `components/transactions/CasinoDialog.tsx:300`–`:329` throws for unavailable active-game/token config reads. Catch at `:393`–`:397` logs and returns null without setting any UI load error. With config null, pool status at `:152`–`:158` is unknown; UI at `:981`–`:990` says Checking reward pool, and footer at `:1009`–`:1012` remains disabled. Retry exists only for pool error, not the upstream config failure. Initial read is one effect (`:401`–`:404`); ongoing poll requires pendingGame (`:407`).

Impact: the player cannot distinguish network failure from slow loading, cannot retry inside the dialog, and sees a misleading explanation of the unavailable action.

Solution: separate initial game/config resource state from liquidity state, expose config Retry with context-preserving recovery, and stop the skeleton/loading copy after failure. Apply the same contract to the host and other casino dialogs.

### CA-04 — P2 — Roulette confuses awaiting wallet approval with a submitted transaction

Evidence: `transaction-kit.tsx:1044`–`:1062` emits transactionPending before the first wallet-capability await or send call. Roulette maps that to walletTxPending (`CasinoDialog.tsx:692`–`:704`); its close guard then says “Transaction submitted. Please wait for confirmation” (`:722`–`:724`) even while the wallet is still awaiting player approval.

Impact: the player receives inaccurate transaction-stage feedback and can believe a bet was submitted before approving it. The table is correctly locked by the early pending status; an earlier hypothesis that it remained editable during wallet approval was checked against the shared execution code and withdrawn.

Solution: use the kit's normalized phase (awaiting wallet versus submitted with proof) for guard text, status and progression. Tell the player to confirm or reject in the wallet while awaiting approval; reserve Submitted for a known submitted request.

### CA-05 — P1/P2 — SpinLeaf does not reveal the expiry deadline before stars are forfeited

Evidence: `ArcadeDialog.tsx:760` calculates remaining expiry blocks, but uses them only at zero (`:777`–`:785`) to erase the local record/pending state and toast “Spin expired — stars forfeited.” Visible description at `:1487` says use a star/wait/stop; status at `:1497`–`:1502` says Ready to stop/Wheel spinning. Close guard at `:1283`–`:1289` only considers a transaction currently in flight; it does not explain an active committed round when closing or switching game tabs. Missing-key state `:1260` and Recheck `:1525` are the only references to waiting for expiry.

Impact: time-sensitive value loss is hidden until it happens, especially after moving from mobile wallet back to the app or switching tabs. An expired outcome is transient toast only, unlike Roulette's persistent forfeiture panel.

Solution: disclose the two transaction sequence and expiration before commit; show a persistent “Reveal within N blocks” row plus an active-round banner outside the dialog. Preserve a receipt/history-linked expired state. Warn on deliberate exit without blocking a user's ability to leave. Do not silently delete the useful recovery context before displaying the terminal outcome.

### CA-06 — P2 — Roulette combination targets require pointer precision that a mobile finger cannot provide

Evidence: `roulette-betting-table.tsx:38`–`:43` uses 16px-wide boundary strips and 16×16px junction buttons; normal number targets are 44px or wider. The inner board has `min-w-[660px]` at `:61` and horizontal overflow at `:60`, so every phone must pan the table. There are 102 combination targets plus 49 other betting targets (151 focusable choices total). Tests at `tests/frontend/primitives.spec.ts:161` verify geometric hit points, not comfortable touch selection.

Impact: Split/Corner/Street/Six-line are hard to discover, select and distinguish from adjacent bets on touch; horizontal dragging can begin at a betting surface. Keyboard users traverse a very long row of individual tab stops. This is a measured source geometry issue, not a claim that every small target necessarily violates a particular WCAG exception.

Solution: preserve the table for overview and desktop use, but add a clear Bet type selector and a mobile selection sheet with large number/combination rows, payout and amount. Use roving keyboard navigation for the table, not 151 tab stops. Retain at least a 44px product touch target where feasible without overlapping adjacent bets.

### CA-07 — P2 — The betting UI omits the rules and information needed to make an informed selection

Evidence: `game-dialog-heading.tsx:8`–`:13` renders only an sr-only title and close button. Roulette has no visible title in its body (`CasinoDialog.tsx:845` onward). `PlacedBet.payout` is created at `:530` and hydrated at `:347`, but `roulette-bet-list.tsx:7`–`:35` does not consume/display it. The entire rules hint is `roulette-betting-table.tsx:133`: Edges/split/intersections/corner/top edge/street/six line. Amount label is Bet per selection (`CasinoDialog.tsx:955`), but next line says only Min/Max (`:971`), while the maximum is actually a total-wager cap (`:505`). Summary labels Total and Max at `:889`–`:890` do not explain that Max includes returned principal.

Impact: new players must infer what the game is, how a combination behaves, payout odds, why a second bet rejects, and whether Max means profit or gross return. This is especially weak after the host description scrolls out of view.

Solution: persistent visible Roulette heading/token, short How to play disclosure, selection-specific “Pays 35:1” (or correct multiplier), explicit “Minimum per selection / Maximum total stake,” and “Maximum return including stake.” Add exact gross return and net result to settled rounds. Keep help in the dialog and at the point of decision.

### CA-08 — P2 — SpinLeaf can present success with no recoverable result; negative toast values lose their minus sign

Evidence: `spin-game-transaction.tsx:129`–`:138` decodes logs. If absent, `:173` toasts Spin complete and still calls completion at `:177`. Parent clears pending state at `ArcadeDialog.tsx:950`–`:954`, then selects a random visual reward index if the result index is unavailable (`:927`–`:928`, `:1640`–`:1648`), and displays no result panel because resultDetails is not populated. Negative PTS/lifetime are formatted using Math.abs with positive-only '+' prefix (`spin-game-transaction.tsx:144`–`:154`), so negative values read as unsigned positive-looking amounts. The permanent panel formats a minus correctly (`ArcadeDialog.tsx:1535`), creating disagreement between feedback channels.

Solution: use an explicit confirmed/result-unavailable state, fetch the canonical receipt/logs, and provide a receipt/Activity link until decoded. Never synthesize a reward index as if it were known. Share a signed reward formatter and use neutral/warning feedback for zero/negative outcomes. Box already has a clearer “Check Activity for the reward” fallback (`box-game-transaction.tsx:126`).

### CA-09 — P2 — The Box chooser remains interactive while its transaction is pending

Evidence: nine seed buttons at `ArcadeDialog.tsx:1202`–`:1234` never receive a disabled prop; clicking changes selected box and clears its result. The star controls correctly disable for pending/reconciliation (`:1353`, `:1374`), and the game selector is inert for transaction pending (`:1306`), but the primary choice does not follow the same rule.

Impact: the footer can show Box 8 while the pending wallet/transaction is actually opening Box 3. The resulting PTS are then visually associated with the changed box.

Solution: freeze box choice in the same immutable round snapshot as star mode, disable the grid during preparation/confirmation/reconciliation, and label the eventual result with the actual submitted box and cost.

### CA-10 — P2 — Cooldown timing and state copy drift between Arcade games

Evidence: Box decrements seconds per interval tick (`ArcadeDialog.tsx:460`–`:473`) while SpinLeaf uses a timestamp deadline (`:1170`–`:1174`). A background-throttled/suspended browser therefore leaves Box's local countdown behind elapsed time until another read. Spin footer heading uses `spinRead.title` (`:1567`), which is Ready to Spin whenever metadata is loaded (`lib/spin-read-state.ts:8`), even if the body reports cooldown, missing stars, or unavailable local storage.

Solution: use timestamp/chain-based countdown helpers with a visibility-resume read and a single derived status object for headline, explanation, footer and CTA. “Ready” should mean all requirements are satisfied, not just metadata loaded.

### CA-11 — P2 — Selection semantics and sizing differ across adjacent game controls

Evidence: Roulette combinations expose aria-pressed (`roulette-betting-table.tsx:33`) but straight, column, dozen and outside selections express state only by color/ring (`:24`–`:28`, `:81`–`:127`). Arcade's star choice is a custom radiogroup of ordinary buttons (`ArcadeDialog.tsx:1336`–`:1378`), without a radio-group keyboard model/roving focus; controls use h-8 and text-[11px] (`:1345`, `:1366`). Box grid aria-pressed is good (`:1218`–`:1219`).

Solution: use the existing tested toggle-group/radio primitive for mutually exclusive star mode with arrow-key selection, provide >=44px touch presentation, and expose selected state consistently on all roulette choices. Keep focus visibly distinct from selected state. An icon/ring alone must not be the only selection feedback.

### CA-12 — P2 — Token metadata errors can enable a game with fallback decimals

Evidence: `CasinoDialog.tsx:127` uses `useTokenMetadata`; parsing at `:493`, total calculation at `:195`, and active bet hydration at `:346` all use its decimals. Input/action readiness at `:250` and `:1004`–`:1065` has no metadata-ready/error gate. `hooks/useTokenMetadata.ts:29`–`:38` discards read status and defaults to 18. The architecture audit owns this cross-app finding.

Impact: a supported non-18-decimal token with failed/pending metadata can be displayed or parsed at the wrong scale, often causing confusing limit rejection. Existing balance query readiness is insufficient to prove the separate metadata query is authoritative.

Solution: one keyed token metadata resource exposing ready/error and exact decimals; gate amount entry and contract call preparation on it, retain token identity in all result snapshots, and present a retry for metadata failure.

### CA-13 — P2 — Input preferences can overwrite an in-progress Roulette draft after a background pool update

Evidence: reward-pool balance refetches every 10s while open (`CasinoDialog.tsx:149`). `offeredMaxBet` depends on it (`:160`–`:167`), and the loadBetPreference effect depends on offeredMaxBet and replaces currentBetAmount (`:444`–`:454`). The store effect ignores incomplete input (`lib/casino-bet-preferences.ts:62`), so a user editing a partial number while the liquidity cap changes may have an older stored value restored/clamped.

Solution: initialize preferences once per token/round identity, never overwrite dirty/focused input on a background refetch, and expose a non-destructive validation message when the current draft exceeds a changed cap. User intent should survive resource refreshes.

### CA-14 — P3 — The pre-submit callback contract is misleading and cannot veto execution

Evidence: SpinLeaf's handleCommitButtonClick returns after saying “No transaction was prepared” on a storage write failure (`ArcadeDialog.tsx:966`–`:973`). GameTransaction passes it as a void callback (`game-transaction.tsx:212`); the transaction kit calls the callback inside try/catch then unconditionally `execute()` (`transaction-kit.tsx:1887`–`:1895`). Normal enabled SpinLeaf rendering already requires the same durable-record boolean, so this branch is not demonstrated to be reachable through its current normal button. This is a latent API/maintenance mismatch, not a reproduced loss-of-secret submission.

Solution: keep observational click callbacks clearly separate from a typed async preflight returning a validated immutable intent or handled build failure; a failed precondition must stop execution. Put any last-moment durability validation in that preflight. Add a targeted storage-disappears-between-render-and-click check before advertising the stronger safety guarantee.

### CA-15 — P3 — The SpinLeaf wheel communicates little about actual rewards

Evidence: six reward configs are read (`ArcadeDialog.tsx:663`–`:674`) and stored, but the wheel draws the same `spinleaf.png` at all six positions (`:1442`–`:1465`). The maintained `onRewardConfigUpdate` prop is declared but not used by SpinGameTransaction (`spin-game-transaction.tsx:36`–`:41`, destructuring at `:43`–`:56`). Copy alternates SpinLeaf, Spin Leaf, Stop Wheel, Stop the Wheel, reveal and claim (`ArcadeDialog.tsx:1417`, `:1567`, `:1604`, `:1638`; `spin-game-transaction.tsx:103`).

Solution: show actual reward previews or an accessible reward list, label the second action Reveal result consistently, explain the animation does not require skillful stop timing, pluralize stars from configured cost, and remove the unused config callback. Preserve the playful character art while making the player's action/outcome understandable.

### CA-16 — P3 — Game infrastructure still duplicates domain rules and carries large view/controllers

Evidence: ArcadeDialog 1,675 lines; CasinoDialog 1,082; BlackjackDialog 1,965; BaccaratDialog 971. Repeated failure-status sets exist in Arcade/Casino/transaction wrappers; Roulette decoding is repeated within `casino-transaction.tsx:61`–`:109` and `:204`–`:264`; red-number rules appear in `EuropeanRouletteWheel.tsx:16`, casino ABI and casino-hardening-rules. Box wrapper defines a local ABI at `box-game-transaction.tsx:14`–`:62` while Arcade imports the canonical BOX_GAME_ABI. Payout is stored but unused in roulette list. UI layout, polling, receipt parsing, recovery, wallet guards and formatting live in the same game components.

Solution: extract game-specific state controllers with discriminated round states, a shared game shell/header/footer, keyed resource hooks, immutable result snapshots, common amount/allowance status, and pure event parsers. Keep roulette/Baccarat/Blackjack rules separate behind typed adapters; do not force different game protocols into a generic boolean soup. Remove dead props/state only after behavior coverage.

### CA-17 — P1/P2 — Roulette and Arcade results survive a change in the subject they describe

Evidence: Roulette stores only `{ number, won, payout }` (`CasinoDialog.tsx:109`), with no wallet/land/token/decimals identity. Scope change at `:277`–`:295` invalidates requests, and config/open change at `:438`–`:442` clears bets/errors, but neither clears result/expiredResult. Rendering at `:923` formats the retained payout with the current tokenDecimals/tokenSymbol. CasinoPanel keeps the dialog mounted (`components/building-details/CasinoPanel.tsx:704`). Arcade's identity reset at `ArcadeDialog.tsx:246`–`:254` clears spin secret/metadata but not `resultDetails` or `boxResultDetails`; opening also changes the seed (`:365`) without clearing the previous box result. The companion Baccarat finding BB-03 describes the same broader result-identity problem.

Impact: reopening Roulette on a different token can relabel the prior payout in the new currency; changing a plant can show the previous plant's Box/Spin reward. In Roulette this is financial misinformation even if the underlying transaction was correct. Exact reachability through every host navigation path requires a host integration check, but the mounted component state and current-token rendering are explicit.

Solution: retain wallet/land-or-plant/token/decimals/wager/seed/transaction identity with every result snapshot and render it against that snapshot. Reset active presentation on context change, or deliberately label it as a previous result with its actual subject. Never let current selector state relabel a historical outcome.

## Device, visual and accessibility review

| Surface | Source behavior | Review consequence |
| --- | --- | --- |
| Arcade mobile | Max 28rem / 94vw dialog, 3-column box grid, 64px tiles, 224px outer wheel, body scroll, sticky footer | Reasonable base geometry; needs live 320px/landscape/keyboard check for nested scrolling and persistent CTA. Long footer helper text truncates instead of wraps (`ArcadeDialog:1566`–`:1573`). |
| Arcade tablet/desktop | Still max 28rem; header becomes row at sm, tile height 80px, wheel 240px | Intentionally compact single-task presentation; no need to stretch merely to fill desktop. Content prioritization matters more than width. |
| Roulette mobile | 96vw dialog, wheel above bets, 660px horizontal table; 12px/11px supporting text | The phone view requires vertical scrolling plus horizontal table panning and nested bet-list scrolling; precision combinations and absent scroll help are the main deficits. |
| Roulette tablet | Two-column upper area begins at md; table remains near its minimum column width | Test 768/820px and split-screen widths, not only desktop/phone presets. |
| Roulette desktop | Max 60rem / 960px dialog; 192px wheel and bet panel, table max820px | Space is available for visible heading, rules and meaningful wager summary rather than further visual decoration. |
| Casino results | Dark background art; many explicit white/green/red/amber colors, compact typography and pill payouts | Game identity can stay dark, but validate contrast on the actual art, light/dark themes, long exact payouts and text zoom. Theme consistency should come from shared hierarchy and controls, not replacing every game with generic cards. |
| PlayingCard/CardHand | 63×96 or37×56 cards; negative horizontal spacing; centered-only ranks and suits; desktop hover lifts cards | Touch has no hover reveal. Center glyphs can overlap neighboring cards, especially small cards and rank10; targeted maximum-hand screenshot needed. Corner indices or a non-overlapping mobile fan would be more legible. |
| Motion | Roulette uses imperative RAF, page visibility pause, reduced-motion/performance checks and a settle timeout fallback | Good existing work worth preserving. SpinLeaf uses CSS suppression from globals; validate both instant and animated result transitions rather than removing them. |
| Dismissal | Game heading close is44px and sticky; roulette blocks backdrop and prevents Escape on active rounds but allows explicit close with toast | Usable intentional close exists despite a stale comment claiming no visible close (`CasinoDialog:832`). Unify copy/behavior across money games; explain saved active rounds without trapping users. |
| Feedback | Roulette announces pending/result via live status; Arcade reward panel uses shared primitive; list removal has44px targets | Keep these gains. Audit persistent errors/unknown results separately from toast success; do not announce every cosmetic wheel tick. |

## Existing good foundations to retain

- Roulette computes gross maximum payout using contract-aligned winning-number logic, prevents unsupported zero combinations, and bounds wagers by liquidity.
- Roulette state refresh uses scope/generation invalidation to resist stale wallet/token/land responses; reveal failure retains active-game recovery.
- SpinLeaf persists a versioned wallet/plant-scoped secret, migrates older records, bounds log lookback, and retains the secret on reveal failure.
- Transaction execution is centralized in GameTransaction/transaction-kit with authoritative receipt proof and owner-resource reconciliation. This is the correct place to unify lifecycle guards.
- Dialog primitives provide sticky footers, minimum close targets, descriptions and focus infrastructure. Cards have accessible names; number targets and bet removal use explicit labels.
- Existing frontend tests cover roulette point geometry, list removal, long token values, Spin metadata failure and Arcade stat wrapping across useful width/theme presets.

## Reviewed file and flow inventory

Directly read end-to-end in this subaudit:

- `components/arcade/ArcadeDialog.tsx`: selector, Box grid/default seed/star mode/read/reconcile/disabled/result, Spin metadata/log hydration/storage/preparation/commit/wait/reveal/expiry/missing secret/read-error/result, Solana, dismissal, both footer branches.
- `components/arcade/arcade-stat-line.tsx`: semantic dl, wrapping, numeric alignment and tone.
- `components/transactions/CasinoDialog.tsx`: flags, metadata, balance/pool limits, approval, active hydration, all betting/reveal/status/close/error/result/footer branches.
- `components/transactions/roulette-betting-table.tsx`: all 37 straight positions, split/street/corner/six-line target generation, zero, columns, dozens, six outside bets, selection and disabled states.
- `components/transactions/roulette-bet-list.tsx`: empty/list/long amount/max-height/removal/clear/lock.
- `components/transactions/game-dialog-heading.tsx`: close/name/position.
- `components/transactions/casino-transaction.tsx`: call construction, status/failure callbacks, result/expired decode, receipt fallback, mission feedback.
- `components/transactions/spin-game-transaction.tsx`: commit/reveal, secret call readiness, event extraction, reward feedback, intent scoping.
- `components/transactions/box-game-transaction.tsx`: seed/star calls, event result fallback, mission feedback and ABI duplication.
- `components/transactions/game-transaction.tsx`: adapter contract, capabilities, reconciliation, callbacks, success ownership, inline/toast modes, disabled CTA.
- `components/ui/EuropeanRouletteWheel.tsx`: all animation, visibility/reduced motion, number geometry, result-settle and render paths.
- `components/ui/PlayingCard.tsx`: face/back labels, card sizing, hand overlap, dealing, values/status.
- `lib/casino-feature.ts`, `casino-policy.ts`, `casino-client.ts`: flag and visibility rules.
- `lib/casino-amount-input.ts`, `casino-bet-preferences.ts`, `casino-pool-solvency.ts`, `casino-hardening-rules.mjs`, `roulette-bet-options.ts`: amount grammar/compact formats, min/max, storage, liquidity, reveal and winning-bet rules, all combination generation.
- `lib/spin-read-state.ts`, `spin-metadata.ts`, `spin-pending-storage.ts`: ready/error behavior, parse validation, storage migration and retention.

Focused supporting reads: transaction-kit preparation/status/button callbacks; globals reduced-motion/performance styles; usePerformanceMode; casino feature flags; primitive/dense-surface tests and Playwright projects. The architecture audit covers useTokenMetadata. BlackjackDialog, BaccaratDialog, blackjack-transaction, baccarat-transaction and related helpers were separately assigned to `blackjack-baccarat.md`. CasinoPanel and BuildingInfoDialog host presentation were cross-reviewed by the building-panels auditor.

Source-covered state matrix: wallet absent/present/changed, Solana gate; casino flag off/on and per-game disabled; unknown/loading/failing/ready resource; approval absent/sufficient/reconciling; insufficient stars/balance/liquidity; min/max/bet-limit/duplicate selection; pending preparation/submission; known/unknown reveal block; active round from another wallet; expired round; failed/rejected/reverted transaction; missing/partial receipt; successful zero/positive/negative outcome; repeated round; reopen/switch token/plant/land; missing secret/storage denied; reduced motion/performance/hidden tab.

Not exercised live by this subaudit: actual mobile wallet sheets, real chain timing/expiry, every Blackjack action and split hand, Baccarat receipt-incomplete recovery, rejected allowance transactions, keyboard virtual viewport/safe areas, screen reader announcement order, touch hit accuracy on physical devices, color contrast sampled against rendered art. Source coverage is extensive but does not establish 100% UI/UX or transaction coverage.

## Proposed implementation sequence and acceptance

1. Fix known outcome/eligibility and scope bugs first (Baccarat/Blackjack companion findings, CA-01–03, CA-05, CA-08, CA-12, CA-17). Acceptance must cover delayed reads, rejected wallets, missing receipts and switching token/wallet/land with an active round; state must never invent Ready or a winner.
2. Extract stable round controllers and immutable submitted/result snapshots while preserving game-specific rules. Consolidate resource/error/allowance/clock behavior. Add actual dialog fixtures for each terminal/transient state; the current primitive fixtures do not validate the production dialog's lifecycle.
3. Redesign Roulette touch bet placement with a type-first accessible selector, visible game name/rules, exact stake/return summary and larger targets. Use the table as an optional spatial view. Verify 320/390/768/820/1024/1440 widths, landscape and200% text zoom, keyboard and touch.
4. Refine game presentation: compact but readable hierarchy, stable footer placement, consistent amount/currency/Stars copy, real reward previews, signed result formatting and persistent pending/expired banners. Preserve pixel art and purposeful motion.
5. Establish a full-game verification matrix with mocked RPC/wallet timing plus a demo wallet smoke path; existing screenshots/geometry checks are a useful start but cannot certify these workflows.
