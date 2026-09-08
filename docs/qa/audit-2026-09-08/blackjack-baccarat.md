# Blackjack and Baccarat frontend audit — 2026-09-08

This is a read-only source audit. No application code was changed and no wallet transaction was submitted by this audit worker. All findings below are source-derived; runtime reproduction, screenshots, measured contrast, and real-device behavior remain unverified. A source inventory cannot establish 100% runtime state coverage. The production feature flags, supported-token configuration, account/land ownership, balances, approvals, game contracts, and Blackjack randomness service all gate access to these screens.

## Scope and how these features work

Reviewed the complete `BlackjackDialog.tsx` (1,965 lines), `BaccaratDialog.tsx` (971 lines), both transaction components (403/280 lines), `PlayingCard.tsx`, the shared heading, amount field, Blackjack state/cards/events helpers, casino amount/preference/pool/reveal helpers, relevant contract adapters and ABI labels, dialog layout behavior, global card/reduced-motion CSS, and relevant existing test coverage.

`CasinoPanel` keeps both dialogs mounted and toggles their `open` prop (`components/building-details/CasinoPanel.tsx:712`, `:720`). A selected casino token controls new wagers; an active round can use a different token.

Blackjack loads the active contract snapshot, token configuration, allowance, and balance. A deal or player action first fetches authenticated server-signed randomness, then exposes a second button that submits the transaction. Receipt events update cards optimistically; fresh snapshots verify which actions are legal. It supports Hit, Stand, Double, Split, Surrender, natural Blackjack, per-hand split settlement, and reopen/resume. The dialog owns configuration, reconciliation, financial validation, transaction state, all rendering, and recovery in one component.

Baccarat selects Player/Banker/Tie and an amount, checks the token and reward pool, places a wager, waits for a reveal block, then requires a separate reveal transaction. Receipt events supply outcome/cards/payout or expiry/forfeit. Active rounds are polled every four seconds. The shared `GameTransaction` owns normal execution while the dialog maintains optimistic balance and active/result state.

## Prioritized findings

### BB-01 — P1: Split/Surrender discard the first prepared action through component remounting

**Evidence:** `components/transactions/BlackjackDialog.tsx:1855` mounts the idle secondary action group only while `txInProgress === null`; `:1901` mounts a separate group for the active Split/Surrender. `handleActionClick` sets `txInProgress` at `:1426` / `:1478`. The originating child awaits that callback before fetching randomness and storing its prepared call (`components/transactions/blackjack-transaction.tsx:133`, `:159`, `:208`). Its local `phase`/`calls` start empty at `:84`/`:86`.

**Impact:** The first Split/Surrender click replaces the initiating transaction component. Its asynchronous preparation continues on the old instance, so the newly visible component has no prepared call and starts from idle. Players can need another preparation click and can encounter an already-created server action lock. The button also changes size, location, and color during the transition. This is a high-confidence React lifecycle inference, not a browser reproduction.

**Fix:** Keep one keyed transaction controller mounted per action for the lifetime of the round. Change presentation/visibility without replacing the transaction owner, or move all preparation/execution to a round-level controller. A deferred-randomness integration test should click Split and Surrender once, resolve the request, and assert that the same visible control is ready to confirm and exactly one preparation request ran.

### BB-02 — P1: Missing Baccarat receipt data becomes a fabricated-looking completed result

**Evidence:** After one receipt refetch fails to decode a result, `components/transactions/baccarat-transaction.tsx:258` emits a success message and `:263` passes `{ transactionHash, receiptIncomplete: true }`. `components/transactions/BaccaratDialog.tsx:549` accepts it, parses missing payout as zero at `:558`, stores it as a result at `:562`, clears the active game at `:566`, and stops waiting. `:617` produces no outcome; `:743` renders ` Wins`, `:747` renders payout 0, and `:894` offers Play Again. No dialog code reads `receiptIncomplete` or exposes a retry/hash link.

**Impact:** A successful reveal whose receipt is incomplete is presented with blank outcome/face-down placeholders and a zero payout. The player cannot distinguish an unresolved display from an actual loss, and the round is no longer visibly recoverable.

**Fix:** Add a distinct `settled-awaiting-receipt` state with the confirmed hash, a neutral “Result is still loading” message, retry/backoff, and an explorer link. Preserve round identity and financial data until the result is recovered. Never synthesize a zero payout or win/loss while the receipt is unknown. Test missing, delayed, and incomplete receipts independently from transaction failure.

### BB-03 — P1: Baccarat result state is not scoped to its account/land/token

**Evidence:** `result` and `expiredResult` are independent local states (`components/transactions/BaccaratDialog.tsx:206`). The account/land/token scope effect at `:327` invalidates request counters but does not reset either result. `hasResolvedRound` suppresses pending-round presentation and polling (`:213`, `:296`, `:501`). The effective display token switches to `selectedToken` as soon as a result exists (`:214`); the result stores no token identity. Parent dialogs remain mounted (`CasinoPanel.tsx:720`) and token selection deliberately preserves the current selected token (`:323`).

**Impact:** After a result, changing the selected token can display the previous payout with the new token’s symbol/logo. Resolving a resumed round in token B while token A remains selected has the same risk immediately. An old result can also suppress a newly read active round after account/land changes until Play Again clears it.

**Fix:** Store immutable round identity with the result: wallet, land, betting token, decimals, wager, bet type, round/hash. Render all result numbers against that snapshot. Reset view state on identity change; never let a result from another round suppress an active one. Test token A selected + active token B, wallet switch after a result, and land switch while the dialog stays mounted.

### BB-04 — P1/P2: Read failures and allowance recovery strand Blackjack players

**Evidence:** Initial config failures only log to the console (`components/transactions/BlackjackDialog.tsx:795`); null config maps to a permanently disabled “Loading limits...” action at `:1286`. Action synchronization stops after three attempts (`:702`, `:722`) and the only visible recovery is “Please reopen Blackjack” (`:1775`). A low allowance during Double/Split produces text and a rejecting preflight (`:1779`, `:1472`); `ApproveTransaction` exists only in the betting branch (`:1720`).

**Impact:** RPC failure is mistaken for loading, and recovery requires dismissing an active money game or navigating elsewhere to approve. A player with enough tokens cannot complete an intended Double/Split if the existing approval covers only the original wager.

**Fix:** Model loading, read failure, unsupported configuration, disconnected account, and ready states separately. Put a safe Retry action in the dialog. Provide an “Approve additional wager” control alongside the preserved active hand, then resume the intended action. Keep the last verified snapshot visible while updating.

### BB-05 — P2: Baccarat hides the reveal deadline and stake while money is pending

**Evidence:** The wager panel disappears during the active round (`components/transactions/BaccaratDialog.tsx:620`–`:621`). The active panel shows only “Active round” and a reveal-block countdown/readiness (`:754`–`:766`); it does not show bet amount, selected side, or an expiry deadline. The expiry transition changes the button to “Forfeit Expired Round” (`:887`), but the active body still says “Reveal is ready.” Closing only announces “remains active until revealed or expired” (`:603`). The pre-bet interface at `:772`–`:867` does not explain the second transaction/deadline/forfeit consequence.

**Impact:** New players do not know they must return to reveal before a deadline; returning players cannot quickly verify which amount/token/side they committed. Expiry copy contradicts the action being offered.

**Fix:** Show a persistent round summary and stepper: Bet placed → Reveal available → Result. Before placing the bet, state that a second action is required and when funds are forfeited. Show a contract-derived expiry countdown with readable time plus exact block detail if useful. Render expired status explicitly, explain that the stake is already forfeited, and label settlement accordingly.

### BB-06 — P2: Cards do not adapt to narrow and long-hand layouts

**Evidence:** `components/ui/PlayingCard.tsx:60` fixes cards at 63×96 or 37×56 px; `:139` overlaps them by 24 or 16 px. Blackjack split hands are always in one horizontal row with a 32 px gap (`BlackjackDialog.tsx:1605`) and only switch to the small variant. Baccarat always renders two columns (`BaccaratDialog.tsx:710`) with 63 px cards and 20 px overlap (`:146`). Neither hand implementation wraps, adjusts overlap based on available width, nor provides touch inspection.

**Impact / sizing inference:** Three Baccarat cards occupy about 157 px including the hand padding offset. At a 390 px viewport the nested fixed paddings leave approximately 131 px per hand; at 320 px about 98 px. Multi-card results can protrude across the hand panels. Larger Blackjack hands and split hands have the same unbounded-width problem. Exact rendered overflow must be verified.

Cards also center the rank/suit (`PlayingCard.tsx:89`–`:96`) while later cards cover the right portion. A small card leaves only 21 px uncovered, so its 24 px centered suit and a two-digit rank extend beneath the next card. Fine pointers get a hover lift (`:150`); touch users do not.

**Fix:** Use top-left/bottom-right corner indices designed for overlapping cards, separate accessible card names, and a hand component that computes size/overlap from container width and card count. Stack split hands or reduce the gap on narrow screens; do not rely on hover to read cards. Verify 320/360/390, tablet split view, landscape phone, 200% zoom, both three-card Baccarat hands, and long Blackjack hands.

### BB-07 — P2: The Blackjack fallback can reveal a fake Ace of spades

**Evidence:** Active dealer hands are represented as `[upCard, 0]` (`components/transactions/BlackjackDialog.tsx:598`, `:962`). Zero is a real Ace of spades (`components/ui/PlayingCard.tsx:20`, `:44`). A settlement without dealer-card data preserves that local array (`BlackjackDialog.tsx:1019`–`:1025`), but result rendering always removes the hole-card mask (`:1599`). The parser intentionally supports result-only receipts (`lib/blackjack-events.ts:264`); this case is expressly covered in `smoke/frontend-boundaries-smoke.ts:71`.

**Impact:** Supported legacy/result-only or surrender receipts can display the hidden placeholder as a real card, potentially contradicting the reported dealer total. The UI appears to falsify game state even though the contract result may be correct.

**Fix:** Represent unknown cards with a tagged type, never a valid card ID. Keep unknown dealer cards face down and label them as unavailable after settlement, or recover their data from the confirmed receipt. Add a result-only settlement test starting from an active `[up, unknown]` dealer hand.

### BB-08 — P2: Baccarat payout previews ignore the configuration already fetched from the contract

**Evidence:** `baccaratGetConfig` returns `bankerCommissionBps` and `tiePayoutMultiplier` (`lib/contracts.ts:2981`, `:3024`). The dialog fetches the config but only uses `enabled` (`components/transactions/BaccaratDialog.tsx:396`–`:407`). Potential payouts hardcode 95% Banker profit and 9× Tie return (`:274`–`:278`); ABI labels independently hardcode the same values (`public/abi/baccarat-abi.ts:213`). A configurable payout helper already exists in `lib/baccarat-rules.mjs:29`.

**Impact:** The interface can advertise the wrong return if contract commission or tie multiplier differs from its defaults. This is a configuration-drift risk; current live settings were not verified.

**Fix:** Retain the fetched payout config and derive preview, labels, and pool exposure from one shared typed payout model. Keep returning stake, profit, commission, and total return terminology consistent.

### BB-09 — P2: Shared abbreviated minimums can be impossible to enter successfully

**Evidence:** `lib/casino-amount-input.ts:116` floors to two abbreviated decimal places. `formatCasinoLimitForToken` accepts `kind: 'min' | 'max'` but only uses it for two LEAF special cases (`:90`–`:97`). Blackjack uses the formatted minimum as the fallback field value (`BlackjackDialog.tsx:822`) while validation compares against exact `uiMinBet` (`:1289`); Baccarat uses the same formatted fallback (`BaccaratDialog.tsx:497`).

**Impact:** A configured minimum of 1,234 tokens is displayed/defaulted as `1.23K` (1,230), then rejected for being below minimum. Even the displayed “Min 1.23K” instruction can therefore fail when followed literally. This is a deterministic formatter inference; it requires a non-round configured minimum to surface.

**Fix:** Keep the input’s default and accessible min/max exact. Use directional rounding where compact display is necessary, include exact values on demand, and test that parsing every displayed minimum yields an allowed value.

### BB-10 — P2: Blackjack’s two-step transaction process is not understandable from its visible controls

**Evidence:** The first button prepares randomness (`components/transactions/blackjack-transaction.tsx:126`); after ready it renders a separate `TransactionButton` requiring another click (`:377`–`:395`). The ready button uses the same action label, or the parent’s “Dealing...” (`BlackjackDialog.tsx:1734`). During any prepared action the visible turn text says “Retry the prepared action, or reopen after the lock clears” (`:1327`–`:1331`). Expiration text exposes “prepared” and “lock” implementation terms (`:901`).

**Impact:** Players cannot tell whether to wait, click again, approve a wallet prompt, or reopen the game. The ordinary prepared state looks like an error-retry instruction. Available sibling actions disappear and the remaining action stretches/repositions, increasing visual instability.

**Fix:** Use explicit player language and one stable interaction area: “Preparing Hit…” → “Confirm Hit” → “Confirm in wallet” → “Waiting for confirmation” → “Your turn”. Show expiry only when actionable and preserve the original action/bet details. Prefer one click plus wallet confirmation where the transaction architecture permits it.

### BB-11 — P2: Active Blackjack hands omit the current stake and active-hand emphasis

**Evidence:** Once `uiPhase === 'playing'`, the balance/amount section at `BlackjackDialog.tsx:1684` disappears. The footer shows turn text and only mentions a wager amount when funding is insufficient (`:1767`–`:1783`). Hand 1/Hand 2 have identical styling; `CardHand` has no active-hand prop (`components/ui/PlayingCard.tsx:105`). Double and Surrender labels do not explain the extra wager or partial refund (`BlackjackDialog.tsx:1839`, `:1884`).

**Impact:** Players must remember their financial exposure and infer which small split hand they are acting on from footer text. New players cannot understand cost-changing decisions at the point of action.

**Fix:** Keep stake, token, available balance, total committed amount, and active hand visible during play. Mark the active hand with both a label and a restrained visual border. Explain “Double: adds X” and “Surrender: returns X” through concise supporting text and accessible labels; show net round outcome separately from gross payout.

### BB-12 — P2: Amount-field validation bypasses the shared accessible feedback API

**Evidence:** `AmountField` supports associated `error`, `hint`, `balance`, `aria-invalid`, and described-by content (`components/ui/amount-field.tsx:22`). Neither game passes those props. Blackjack renders error and limits as unrelated siblings (`BlackjackDialog.tsx:1688`–`:1698`); Baccarat renders general errors separately (`BaccaratDialog.tsx:871`) and amount problems exclusively as disabled footer buttons (`:919`–`:934`). Blackjack errors outside betting also have no `role="alert"` (`:1760`).

**Impact:** Keyboard and screen-reader players do not receive errors/constraints in association with the focused input. The primary action continuously changes from “Deal” into unrelated error messages, making the action less predictable. Blackjack’s limits additionally use 12 px `text-white/40` (`:1697`), a low-contrast presentation requiring rendered measurement.

**Fix:** Pass exact constraints and validation through `AmountField`’s existing API. Keep the action label stable, set an accessible disabled reason, and announce asynchronous failures in one status region. Use semantic game-text tokens that meet small-text contrast requirements.

### BB-13 — P2: Baccarat’s loading failures masquerade as an unsupported token

**Evidence:** A failed initial read sets a general error (`BaccaratDialog.tsx:443`–`:447`) but leaves `tokenConfig` null. `tokenDisabled = !tokenConfig?.supported || !tokenConfig.enabled` (`:295`) treats missing config as disabled; the visible message says the selected token is not enabled (`:872`), while the footer instructs “Select a supported token” (`:907`). There is a dedicated reward-pool retry (`:842`) but no game/config retry.

**Impact:** A healthy supported token appears unsupported after a network failure. The player is instructed to change a choice that may be correct and cannot retry the failed operation directly.

**Fix:** Distinguish config loading/error/unsupported/disabled states. Show “Baccarat data unavailable” with Retry for read failures; only label the token unsupported after a successful read proves it.

### BB-14 — P2/P3: Result language, hierarchy, and rules are inconsistent

**Evidence:** The shared `GameDialogHeading` visually hides the game title and renders only Close (`components/transactions/game-dialog-heading.tsx:9`–`:14`). Blackjack’s initial screen therefore starts with “Bet amount”; Baccarat starts with “Bet On”, without a visible game name or help. Baccarat’s result headline uses the winning side regardless of whether the player won (`BaccaratDialog.tsx:743`–`:747`), while Blackjack says a direct result. “Payout”, “Potential”, “return”, “3:2 Payout”, “Push”, “No win”, and “Wins” are used at different levels. The dialog has no accessible visible explanation of Baccarat third-card rules, Banker commission, tie pushes, or Blackjack action rules.

**Impact:** This is especially confusing after interruptions, for new players, and when revisiting a pending game. A heading such as “Banker Wins” can celebrate a player’s loss. Visual title removal also makes large desktop surfaces feel anonymous.

**Fix:** A compact visible game title, restrained help/rules control, current token/round status, and one result language model: “You won X”, “Bet returned”, “You lost X”, followed by the game’s factual outcome. Keep optional rules one action away. Preserve the game artwork while using consistent typography and spacing.

### BB-15 — P3: Feature-owned styling and duplicated controllers create maintenance drift

**Evidence:** Blackjack repeats nearly identical transaction wiring for Hit, Stand, Double, Split, Surrender and duplicates the latter two for their pending states (`BlackjackDialog.tsx:1791`–`:1940`). Each game defines its own action/footer class strings (`BlackjackDialog.tsx:81`–`:91`, `BaccaratDialog.tsx:66`–`:73`). Baccarat uses `size="full"` with a feature-owned inner scroller (`:682`, `:700`); Blackjack uses shared `layout="game"` surface scrolling (`:1570`) instead. `BaccaratHandArea` reimplements the shared CardHand concept with differing gap, height, hover lift, and no perspective ancestor (`BaccaratDialog.tsx:117`–`:178`; compare `PlayingCard.tsx:138`). Baccarat’s `BET_OPTIONS` still contains unused payout/accent/selected classes (`:75`–`:108`) after its table appearance was replaced.

**Impact:** Changes to focus, button dimensions, animation, loading, scrolling, and financial feedback must be propagated manually. Current code already contains the remount bug, different approval recovery, different result handling, and different scroll ownership. The 1,965-line Blackjack dialog is difficult to reason about as a collection of interacting state variables and async refs.

**Fix:** Extract a round controller/state machine and independently testable presentation for each game; share financial-read status, token-aware amount feedback, GameShell, card-hand sizing, footer, transaction phase labels, and result summary primitives. Keep game-specific rules explicit. Remove dead presentation data and repeated comments after behavior is captured by tests. Do not make a generic mega-game component.

### BB-16 — P3: Natural Blackjack settlement skips the client mission-progress submission

**Evidence:** Settlement tracking in `components/transactions/blackjack-transaction.tsx:304` requires `mode === "action"`. A natural Blackjack can settle directly in deal mode (`BlackjackDialog.tsx:918`) and never execute another action.

**Impact:** The frontend does not submit `s3_play_casino_game` mission proof for a game completed on the initial deal. Whether another backend mechanism eventually credits it was not verified.

**Fix:** Track all confirmed settled rounds, independent of whether settlement happened in deal or action mode. Deduplicate by the settled transaction/round identifier. Verify client and backend mission behavior for natural Blackjack.

## Existing strengths to retain

- Shared Dialog supports focus containment, named dialogs, visual-viewport sizing and safe areas. Both money dialogs prevent accidental backdrop dismissal and guard pending-wallet close attempts.
- Card components have accessible card names and grouped/list semantics. Both games announce settled results. Baccarat’s custom radio group implements roving focus, arrow keys, Home/End, and 44 px minimum target heights.
- Global CSS respects reduced-motion preferences before hydration (`app/globals.css:615`) and the app motion toggle. Do not incorrectly report deal-card animation as missing reduced-motion handling.
- Blackjack validates card IDs and trusted action flags, rejects stale incompatible snapshots, deduplicates pending reads, aborts scoped work, and preflights actions against a new snapshot. Those protections must survive refactoring.
- Casino amounts use bigint-safe parsing, token precision, and persisted per-game/token preferences. Baccarat fails closed until the payout-pool read is known and provides a retry for that specific failure.
- Blackjack receipt parsing filters the emitting contract address and deduplicates logs. Baccarat tries one direct receipt refetch before presenting its fallback; the gap is the fallback state, not absence of any retry.

## State and device coverage ledger

The following states were traced through their source branches, not executed. This ledger is the runtime verification backlog.

| Surface | Source states traced | Required runtime validation |
|---|---|---|
| Blackjack entry | Casino/Blackjack flag off, no config, supported/disabled token, disconnected wallet, balance loading, amount empty/invalid/below/above bounds, insufficient balance, approval required, approved | Distinguish read failure from loading; field errors and screen-reader announcement; wallet-connect recovery |
| Blackjack preparation | Idle, async preflight, randomness preparation, ready-to-confirm, pending wallet, confirmed, rejection/failure, action lock, prepared expiry, closing while prepared/pending | One visible stable control; exactly one prepare for Split/Surrender; keyboard focus; cancellation/retry copy |
| Blackjack active | Hit/Stand/Double/Split/Surrender availability, insufficient additional balance/approval, trusted-state syncing/retry exhausted, external-wallet active game, open/close/resume, stale empty/split snapshot | Long hands; hand 2 transition; in-place retry/approval; no phantom dealer card |
| Blackjack results | Natural Blackjack, win/loss/push/bust/surrender, single hand, split mixed results, result-only/duplicate/missing receipts, Play Again | Exact token/payout, net outcome, cards matching totals, natural Blackjack mission |
| Baccarat entry | Policy off, loading/error, global disabled, unsupported/disabled token, pool loading/error/limited, disconnected, amount validation, balance/approval | Separate errors from unsupported state; exact min/max; config-based payout previews |
| Baccarat active | Place pending/success/failure, awaiting active snapshot, reveal locked/ready, another-wallet round, expiry, close/resume | Stake/side/token persistence, reveal/expiry countdown, deadline clarity, active-round recovery |
| Baccarat results | Player/Banker/Tie win, tie push, loss, expiry/forfeit, missing cards, missing entire receipt, Play Again, switch token/wallet/land | Never show unknown as zero loss/win; result identity; previous result must not hide a new active round |
| Narrow phone | 320, 360, 390 px portrait, short viewport, virtual keyboard | Two/three-card Baccarat, long/split Blackjack, stable footer, readable indices, no horizontal overflow |
| Tablet | 768/820 px, split-screen, touch portrait/landscape | Container-based layout rather than viewport-only breakpoint; hand density, title/controls hierarchy |
| Desktop | 1024/1440+ px, keyboard only, 200% zoom | Fixed 34rem modal density, focus continuity, card hover not essential, low-contrast text, status hierarchy |
| Accessibility | Screen reader, reduced motion, text zoom, coarse pointer | Error association, asynchronous phase announcements, visible focus, card reading order, all controls reachable |

## Test coverage gap

The existing frontend browser tests do not reference Blackjack/Baccarat dialogs. `tests/frontend/dense-surfaces.spec.ts:52` checks an arcade readout fixture, not these game flows. There are useful pure state/parser tests (`smoke/frontend-quality-smoke.ts:131`, `smoke/frontend-boundaries-smoke.ts:68`) and casino hardening/pool tests. `smoke/blackjack-split-turn-smoke.ts:17` transcribes UI derivations instead of mounting the production controller. `smoke/production-fixes-smoke.ts:1459` and `:1547` assert source strings/layout tokens. Those checks cannot detect transaction-owner remounting, keyboard focus, incomplete-result rendering, or token/result identity drift.

Add deterministic provider/contract/receipt fixtures that mount the real dialogs and advance their controllers through the states above. Prioritize BB-01 through BB-04, then phone card layout and deadline/financial clarity. Once these are reliable, capture approved 390 px touch, 820 px tablet, and 1440 px keyboard screenshots for key active and result states; do not substitute betting-only screenshots for the full round.
