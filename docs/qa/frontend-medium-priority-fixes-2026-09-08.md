# Frontend medium-priority fixes — 8 September 2026

Scope: the **87 medium-priority finding groups** from the September 8 audit, revalidated against the preserved high-priority starting tree. These are audit groups with overlapping root causes, not 87 independent defects. The 33 low-priority groups are outside this round.

**Completed:** all 87 groups are revalidated. **86 have medium-round fixes; CA-12 was already resolved and was verified again.** Independent reviews and integrated checks are complete. The 33 low-priority findings have not been started; the code is ready for that round.

## Category coverage

| Category | Original groups | Resolution report |
| --- | ---: | --- |
| Architecture, authentication and admin | 9 | [Evidence](audit-2026-09-08/fixes-medium-architecture.md) |
| Shared controls, typography and responsive layout | 12 | [Evidence](audit-2026-09-08/fixes-medium-foundation.md) |
| Farm, plants, lands and maps | 14 | [Evidence](audit-2026-09-08/fixes-medium-gameplay.md) |
| Buildings, quests and training | 9 | [Evidence](audit-2026-09-08/fixes-medium-buildings.md) |
| Mint, swap, staking and marketplace | 5 | [Evidence](audit-2026-09-08/fixes-medium-economy.md) |
| Roulette, Box and SpinLeaf | 9 | [Evidence](audit-2026-09-08/fixes-medium-casino-arcade.md) |
| Blackjack and Baccarat | 10 | [Evidence](audit-2026-09-08/fixes-medium-blackjack-baccarat.md) |
| Chat, activity, profiles, claims and onboarding | 19 | [Evidence](audit-2026-09-08/fixes-medium-social.md) |

## Revalidation ledger

Every row links to the before/after reasoning, chosen solution and bounded verification. CA-12 was already resolved in the high-priority round and was rechecked. BP-02 was partly resolved previously; revalidation found remaining batch error/retry and pause-guidance gaps, addressed in this medium round. Supporting reports cover [map interaction](audit-2026-09-08/fixes-medium-maps.md), [Tasks/tutorial](audit-2026-09-08/fixes-medium-tasks-tutorial.md), [economic read authority](audit-2026-09-08/fixes-medium-economic-reads.md) and [admin ownership](audit-2026-09-08/fixes-medium-admin.md).

| ID | Revalidated finding | Resolution status | Evidence |
| --- | --- | --- | --- |
| ARC-01 | Tab navigation resets the player's selected view and filters | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-architecture.md) |
| ARC-03 | Disconnect erases presentation/accessibility preferences | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-architecture.md) |
| ARC-04 | Failed Solana bootstrap can offer an incompatible EVM login | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-architecture.md) |
| ARC-05 | Auth errors do not have persistent, actionable screen state | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-architecture.md) |
| ARC-07 | A global any alias hides the most fragile boundaries | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-architecture.md) |
| ARC-08 | Large controllers and duplicated loading/cleanup policies make consistency expensive | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-architecture.md) |
| ARC-09 | Privy's modal theme is disconnected from the app theme | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-architecture.md) |
| ARC-10 | Status page has no freshness/overall summary and refresh can remain blocked | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-architecture.md) |
| ARC-11 | Admin UI still bypasses shared accessible form and selection contracts | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-architecture.md) |
| FND-02 | P2: The information color still doubles as fill and small text, with insufficient contrast | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-foundation.md) |
| FND-03 | P2: Success button text does not meet ordinary-text contrast in six themes | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-foundation.md) |
| FND-04 | P2: Dropdown lists do not have a safe available-height default | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-foundation.md) |
| FND-05 | P2: The purchase quantity control is an exception to the touch system and scales poorly to its range | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-foundation.md) |
| FND-06 | P2: A native share-link field bypasses the mobile field-size protection | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-foundation.md) |
| FND-07 | P2: Exact token amounts are exposed only through hover-style inspection | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-foundation.md) |
| FND-08 | P2/P3: Scroll fading depends on unrelated DOM mutations and does not reliably register portaled bodies | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-foundation.md) |
| FND-V1 | P2: Tablet portrait retains a phone-width content column | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-foundation.md) |
| FND-V2 | P2: Empty Farm gives an instruction without a path to perform it | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-foundation.md) |
| FND-V3 | P2 design judgment: The verification promotion overwhelms Mint's primary task | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-foundation.md) |
| FND-V4 | P2 design judgment: Small-screen swap allocates too much height to empty amount stages | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-foundation.md) |
| FND-A1 | P2: The horizontally scrolling balance group cannot receive keyboard focus | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-foundation.md) |
| G04 | P2: A land switch temporarily displays and allows selecting the previous land's buildings | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-gameplay.md) |
| G05 | P2: Plant-care catalog failure/loading is rendered as a blank card | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-gameplay.md) |
| G06 | P2: Several essential read failures have no honest state or recovery action | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-gameplay.md) |
| G07 | P2: Mobile building browsing hides the result of a selection below the grid | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-gameplay.md) |
| G08 | P2: Mobile building grid has no small-container layout and truncates important labels | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-gameplay.md) |
| G09 | P2: The map invents a supply number when the real read fails | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-gameplay.md) |
| G10 | P2: Map image fallback can throw instead of falling back | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-gameplay.md) |
| G11 | P2: Profile stats advertise interaction they do not implement; network errors disappear | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-gameplay.md) |
| G12 | P2: Pure Solana users cannot reach the implemented rename bridge | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-gameplay.md) |
| G13 | `quantity-selector.tsx:32,48` exposes 32px decrement/increment buttons and an output-only value; care permits up to 80 (`item-details-panel.tsx:415`). Buying 80 from a quantity of 1 takes 79 taps, and targets are smaller than the app's 44px controls. | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-gameplay.md) |
| G14 | `land-map-canvas.tsx:373-388,408-415,445-450`: second finger switches pan off; releasing either finger leaves pan off with one finger still down. Pinch only changes zoom, so zoom is around the viewport centre rather than the gesture focus. | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-gameplay.md) |
| G15 | `plant-care-catalog.tsx:23-28` only admits garden items with positive points/lifetime and shop items whose English names contain `fence` or `shield`. Anything outside those inferred categories vanishes. Item purchase routing repeats the name heuristic (`item-details-panel.tsx:88-89`). | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-gameplay.md) |
| G16 | `plants-view.tsx:133-135` stores the selected catalog object while `useItemCatalogs` refetches every 60 seconds (`hooks/useItemCatalogs.ts:15-17`). An open review can retain old price/effects while the catalog itself updates. | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-gameplay.md) |
| G27 | P2, visually reproduced: map neighbor details collapse owner names into vertical fragments on a small phone | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-gameplay.md) |
| BP-02 | P2: quest reward-read failures become unexplained disabled actions or misleading “refilling” messages | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-buildings.md) |
| BP-03 | P2: Barracks background refresh repeatedly disables target selection | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-buildings.md) |
| BP-05 | P2: Barracks treats balance/allowance loading and failure as spend-state facts | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-buildings.md) |
| BP-06 | P2: ordinary upgrades and Barracks ask for token approval before resolving an already-known shortage | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-buildings.md) |
| BP-07 | P2: built Barracks advertises “Disabled” but leaves the training purchase path active | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-buildings.md) |
| BP-08 | P2: a built Casino hides load errors and replaces recovery information with an empty configuration message | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-buildings.md) |
| BP-09 | P2: Casino build balance failure stays on “Checking balance…” with no recovery | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-buildings.md) |
| BP-10 | P2 for noninteger build prices: Casino displays a whole-token rounded price for an exact token charge | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-buildings.md) |
| BP-11 | P2: quests ask players to choose “difficulty” without showing the actual decision tradeoff | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-buildings.md) |
| TX-09 | Several economy views treat failed reads as zero, empty ownership, or valid stale data | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-economy.md) |
| TX-10 | Default swap configuration hides the minimum received and cost summary | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-economy.md) |
| TX-11 | Transaction feedback and recovery drift between features | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-economy.md) |
| TX-12 | Selection and focus states are not consistently available beyond color | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-economy.md) |
| TX-14 | Large mixed-responsibility components let policy drift recur | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-economy.md) |
| CA-04 | Roulette confuses awaiting wallet approval with a submitted transaction | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-casino-arcade.md) |
| CA-06 | Roulette combination targets require pointer precision that a mobile finger cannot provide | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-casino-arcade.md) |
| CA-07 | The betting UI omits the rules and information needed to make an informed selection | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-casino-arcade.md) |
| CA-08 | SpinLeaf can present success with no recoverable result; negative toast values lose their minus sign | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-casino-arcade.md) |
| CA-09 | The Box chooser remains interactive while its transaction is pending | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-casino-arcade.md) |
| CA-10 | Cooldown timing and state copy drift between Arcade games | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-casino-arcade.md) |
| CA-11 | Selection semantics and sizing differ across adjacent game controls | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-casino-arcade.md) |
| CA-12 | Token metadata errors can enable a game with fallback decimals | Already resolved; revalidated | [Report](audit-2026-09-08/fixes-medium-casino-arcade.md) |
| CA-13 | Input preferences can overwrite an in-progress Roulette draft after a background pool update | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-casino-arcade.md) |
| BB-05 | P2: Baccarat hides the reveal deadline and stake while money is pending | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-blackjack-baccarat.md) |
| BB-06 | P2: Cards do not adapt to narrow and long-hand layouts | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-blackjack-baccarat.md) |
| BB-07 | P2: The Blackjack fallback can reveal a fake Ace of spades | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-blackjack-baccarat.md) |
| BB-08 | P2: Baccarat payout previews ignore the configuration already fetched from the contract | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-blackjack-baccarat.md) |
| BB-09 | P2: Shared abbreviated minimums can be impossible to enter successfully | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-blackjack-baccarat.md) |
| BB-10 | P2: Blackjack’s two-step transaction process is not understandable from its visible controls | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-blackjack-baccarat.md) |
| BB-11 | P2: Active Blackjack hands omit the current stake and active-hand emphasis | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-blackjack-baccarat.md) |
| BB-12 | P2: Amount-field validation bypasses the shared accessible feedback API | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-blackjack-baccarat.md) |
| BB-13 | P2: Baccarat’s loading failures masquerade as an unsupported token | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-blackjack-baccarat.md) |
| BB-14 | P2/P3: Result language, hierarchy, and rules are inconsistent | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-blackjack-baccarat.md) |
| SS-06 | Chat history failure is rendered as a successful empty conversation | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-07 | AI runtime and fetch responses are not consistently scoped to the owner | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-08 | Public-chat unread state does not reflect messages read while the dialog is open | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-09 | Desktop Activity pagination scrolls the wrong feed | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-10 | Activity errors remove useful rows and offer no retry | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-11 | Activity state changes when the same device crosses the tablet breakpoint | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-12 | The Activity feed mislabels Blackjack pushes/returns as wins | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-13 | Activity's personal language and rendering robustness remain inconsistent | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-14 | Tasks still shows confident incomplete/zero progress when it cannot know the answer | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-15 | Farmer's Tasks tells the player what to do without helping them get there | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-16 | First Care can claim Tasks was explored when no task dialog can appear | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-17 | Feedback validation and in-flight editing can lose the user's work | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-18 | Tutorial changes need clearer progress and a lighter first-run path | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-19 | Claim recovery screens are operational dead ends | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-20 | Several pieces of copy contradict the actual outcome/action | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-21 | Secret Garden's touch interaction does not install on first open | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-22 | Secret Garden is not contained for short landscape viewports | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-23 | Several dense secondary screens bypass the established touch/type scale | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |
| SS-24 | Broadcast takes control for 15 seconds without saying why or how long | Fixed and verified | [Report](audit-2026-09-08/fixes-medium-social.md) |

## Integrated verification

**Final resolved browser coverage: 2,942 passing scenario/project combinations and 110 intentional skips across 14 projects.** The initial broad run recorded 2,939 passes and three fixture failures; both corrected fixture cases then passed all 14 projects (28 corrective checks, counted without duplication). No unresolved fixture failure remains. This is a case-by-project count, not a claim of 2,942 distinct player journeys or 100% device coverage. The raw run and corrective results are preserved in [the verification record](audit-2026-09-08/medium-verification.json).

Completed checks on the integrated source:

| Check | Result |
| --- | --- |
| Production build and TypeScript | Pass |
| Full ESLint and Base RPC rules | Pass |
| Type-boundary ceiling | Pass: 624 existing escapes across 120 files; no new-file escapes |
| Shared frontend/domain/recovery/dialog smokes | Pass; all 33 production dialog call sites inventoried |
| App auth/owner/identity/UI/Spin/Swap smoke aggregate | Pass |
| High-priority domain/component regression runner | Pass |
| Medium-priority component runner, including shared quest funding | Pass |
| Quest, status and live read-only AI tool checks | Pass |
| Production isolation | Pass: all seven QA routes return 404; production CSP retained |
| Actual Local Test Wallet journeys | Phone and tablet pass; desktop passes on recheck and three subsequent consecutive runs |
| File integrity | Diff check and strict UTF-8 decoding pass |

The real app journeys open all six tabs, verify keyboard balances/tablet width/exact amount inspection, exercise invalid staking drafts, recover an unchanged owned-land transfer review and disconnect/reconnect. They submit no transactions and record no storage, trace or video. The first desktop run stayed connected after its final second disconnect; a complete recheck and three repeated runs passed. No uncaught page error or reproducible source cause was found; this observation is retained rather than attributed to an unproven HMR cause.

The broad matrix initially found an obsolete Barracks fixture that only showed errors after clearing cached data (two projects), and a First Care test that clicked a reloaded server-rendered button before hydration (one project). The fixture now shows retained data with an explicit last-known error/retry state; the reload test waits for the existing readiness marker and asserts the selected owner. Each corrected case passes all 14 projects. No production behavior was weakened to pass these tests.

Independent reviews also found and resolved late Base authentication, Privy hydration, chat/session/history ownership, Airdrop uncertainty, pending building approvals, and admin response/query-targeting defects. Detailed feature reports contain the before/after decisions, focused measurements and review boundaries.

## Limits and remaining release acceptance

Viewport/engine emulation is not physical iPhone, iPad, Android or wallet-host certification. The high-round ARC-06 acceptance gap remains open for broader seeded gameplay, external wallet handoff and physical devices. Real local-wallet journeys exercise available assets; deterministic component tests cover unavailable game states with mocked wallet/RPC/API boundaries.

Blackjack resumed split reads do not include historical Double stakes. The app explicitly labels its lower-bound committed total and suppresses an exact net result when it cannot establish that history. Unknown game receipt data remains recoverable and never becomes a fabricated result. Deployed contract-source verification limits are detailed in the casino reports.

The type-boundary gate ratchets per-file legacy escape counts; it does not claim elimination of every legacy type escape or large feature component. Extreme text-size crowding in the existing land-scene overlays remains part of the separate low-priority follow-up, distinct from the repaired building tiles and map details.

No changes have been committed or deployed. This medium round sends no real notifications or onchain transactions.
