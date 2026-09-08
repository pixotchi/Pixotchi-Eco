# Building panels: frontend audit, 2026-09-08

This is a read-only source audit of the 14 building host, utility, production, quest, raid, and information components listed below. Every line and rendered branch in those files was inspected. Supporting hooks, transaction guards, formatting helpers, and host layout were traced where necessary. Casino game dialogs and marketplace/staking internals belong to other audit domains. No live transactions or browser interactions were performed by this reviewer; source-confirmed behavior below must not be described as visually reproduced. The root audit owns live device verification.

## What this part of the app does

`BuildingDetailsPanel` dispatches village buildings to production/collection and town buildings to staking, warehouse application, a SEED/LEAF marketplace, Casino, Farmer House quests, and Barracks. Ordinary buildings share the upgrade/speed-up workflow. Casino and Barracks own custom instant-build workflows. Building information is another modal above the selected building. The selected land and current block originate in `lands-view.tsx`; most actions use the shared `GameTransaction` adapter and then refresh owner resources, building events, or feature-specific snapshots.

The strongest existing foundations are real bigint amount validation, a reusable labeled `AmountField`, owner/land identity fencing in warehouse and Casino, bounded quest receipt reconciliation, persistent last-quest outcomes, explicit expired-quest recovery, semantic battle-report tables, shared radio keyboard interaction, and progress bars with labels. These should survive any visual cleanup.

## Findings

### BP-01 — P1: returning from a quest can start the expiry deadline while opening its reward is blocked

Evidence: `components/building-details/FarmerHousePanel.tsx:46–48` computes `questActionsBlocked` from reward availability. The `questCommit` / “Return now” action at 163–172 has no such guard. The subsequent `questFinalize` / “Open now” action at 174–186 is disabled by it. Lines 212–219 explicitly describe the 256-block expiry window. `hooks/useQuestRewardsAvailability.ts:16–21` documents that an unavailable reward payer cannot settle the transaction.

Trigger: a completed quest is ready to return, but reward availability is unknown or insufficient. The player can successfully commit, starting the finite opening window, and arrives at a disabled opening action. If replenishment/read recovery does not happen before expiry, the reward expires. This is a source-confirmed inconsistent eligibility gate, not a claim that a live player's reward was lost during this audit.

Solution: make reward readiness a precondition of commit as well as start/open. Explain that the quest is safely waiting and the player should return when rewards can be opened. Recheck availability immediately before commit, and preserve a prominent retry/resume route for already committed quests. A delayed-reward protocol improvement is a separate product/contract decision; frontend should first stop creating the avoidable deadline.

### BP-02 — P2: quest reward-read failures become unexplained disabled actions or misleading “refilling” messages

Evidence: `hooks/useQuestRewardsAvailability.ts:87–89` converts failed multicall entries to zero. Lines 123–134 expose no error or retry state; a whole-query failure before any data leaves `isReady=false`, `isUnavailable=false`. `FarmerHousePanel.tsx:146–149` only explains `isRewardsUnavailable`; start/open are disabled for both cases. Lines 262–265 tell the player to wait for the pool to “refill or approve.”

Impact: failed reads and actual depletion are different situations, but players either get no reason for a disabled action or an operational explanation they cannot act on. In the committed state, this matters because time continues to run out.

Solution: expose `loading | ready | unavailable | error` plus retry. Render “Checking reward availability…” while unknown; “We couldn't check rewards. Retry” for read failure; use player language for an actual pause. Put the retry beside the affected action and keep the existing countdown visible.

### BP-03 — P2: Barracks background refresh repeatedly disables target selection

Evidence: `BarracksPanelV2.tsx:346–349` calls `loadTargets()` whenever `currentBlock` changes in Raid. `loadTargets` sets `targetsLoading=true` at 283–288, and the target button is disabled while that is true at 822–827. It fetches both IDs and land records before releasing the loading state. `hooks/useBarracksSnapshot.ts:9–12,39–42` independently reloads config, land state, and both reports on each block. The countdown effect adds another 15-second snapshot refresh at 409–424. `components/tabs/lands-view.tsx:903–904` enables the live block watcher when the visible land has a Farmer House or an active upgrade.

Trigger/impact: on watcher-active lands, each new block briefly disables an otherwise usable selector and changes the “available” label to “Refreshing.” Slow responses lengthen these interruptions; overlapping generations discard earlier results. The feature makes many reads even while a player only wants to choose a target or inspect troop counts. On lands without the live watcher, this particular every-block behavior does not occur.

Solution: retain the last valid list during background refresh and distinguish first-load from refresh. Share a cached snapshot, refresh targets on opening Raid plus an appropriate stale interval/action invalidation, and check selected-target eligibility immediately before submission. Fetch reports when needed or invalidate them after a raid instead of coupling every report/config read to the block clock.

### BP-04 — P1 when preview feature enabled: raid preview can describe the previous target/troop counts while the current raid button is enabled

Evidence: in `BarracksPanelV2.tsx:351–407`, changing a valid target/count starts another request. Line 371 sets loading, but the prior `preview` remains until resolution at 381–386. `canAttack` at 535–542 checks only the stored preview status, without loading or request identity. Lines 929–945 render counts from that stored preview but label the defender with the currently selected land. The transaction at 971–982 already sends the current target/counts. `components/transactions/game-transaction.tsx:194,212–215` does not add a preview guard; submission is blocked only by an explicit disabled prop or missing calls.

Trigger: obtain a valid preview, change to another valid target or troop amount, and act before the new preview returns. The outcome/loot display belongs to the previous input while the submitted action belongs to the new input. The scope is conditional: `lib/env-config.ts:80` defaults `BARRACKS_PREVIEW_ENABLED` to false unless explicitly set true.

Solution: key each preview by attacker/defender/counts and only consider a matching resolved preview actionable. On input change, mark the old quote stale and disable the raid action until the matching response arrives. The display may preserve the old quote for continuity only if clearly marked as updating and detached from the current target label.

### BP-05 — P2: Barracks treats balance/allowance loading and failure as spend-state facts

Evidence: `BarracksPanelV2.tsx:162–182` extracts only `data` from both balance queries. Build waits for truthy balance data at 527–531 and 605–608, so a failed balance read leaves “Checking balance…” indefinitely. Training has no corresponding balance-ready gate: 532–534 and 750–774 render an approval or “Insufficient … Balance” even when no balance result exists. Allowance failure at 258–267 writes zero and marks the identity loaded, which becomes an approval requirement at 523–526. While a new allowance read is pending, `allowancesAreCurrent=false` also becomes zero at 154–156.

Impact: a known sufficient wallet can see a false shortage or redundant approval, and build has no visible retry after a failed read. This is inconsistent with the much more complete `UpgradePanel.tsx:52–81` balance loading/error/retry handling.

Solution: use explicit query status for balances and allowances; never coerce an unavailable read into a balance or permission value. Introduce one shared purchase eligibility state (checking, unavailable/retry, insufficient, approval required, ready). Keep state identity fencing. For metadata, Barracks also ignores readiness from `useTokenMetadata` at 157–160 and formats costs at 563–564; its hook defaults decimals to 18 (`hooks/useTokenMetadata.ts:28–34`), while `useTokenSymbol.ts:23` labels a failed symbol read “SEED.” The shared infrastructure audit covers this; the feature must also gate monetary displays/actions on authoritative metadata.

### BP-06 — P2: ordinary upgrades and Barracks ask for token approval before resolving an already-known shortage

Evidence: `UpgradePanel.tsx:138–154` renders PIXOTCHI approval before `hasInsufficientPixotchi`; 175–187 does the same for LEAF. `BarracksPanelV2.tsx:609–623` renders build approval before `hasBuildBalance`, and 754–769 does so for training. In contrast `CasinoPanel.tsx:520–534` checks insufficient balance before approval.

Trigger/impact: when allowance is insufficient and wallet balance is also insufficient, the primary action invites an approval transaction that cannot be followed by the promised purchase. Generic upgrades display a shortage notice below an enabled approval button, creating conflicting guidance.

Solution: after successful reads, resolve known insufficiency before offering approval. Show the amount missing and an appropriate existing acquisition route. Only render approval as the next step once the player can afford the subsequent action. Make the state order consistent for all build/upgrade/train surfaces. Also remove the unreachable “Step 2” branch in the upgrade button text (`UpgradePanel.tsx:199`): that component only renders after `needsLeafApproval` has become false.

### BP-07 — P2: built Barracks advertises “Disabled” but leaves the training purchase path active

Evidence: `BarracksPanelV2.tsx:597–600` gates building when `config.enabled` is false, and 275–280 clears raid targets for disabled configuration. After construction the header merely prints “Disabled” at 658–659. The full train/approval sequence at 750–788 has no `config.enabled` branch or disabled prop; it can render an enabled training action if queue, allowance, and balance permit it.

Impact: the same feature presents its service as disabled while still inviting a purchase. No live contract execution was attempted to characterize the resulting rejection; the inconsistent frontend guard is definite.

Solution: derive a feature-availability state once and use it across build/train/raid. Preserve troop/report inspection while replacing unavailable mutations with one explained status. Avoid offering approval for a disabled service.

### BP-08 — P2: a built Casino hides load errors and replaces recovery information with an empty configuration message

Evidence: `CasinoPanel.tsx:339–354` catches state-read failure, clears token configuration and active-game identifiers, and stores `error`. The unbuilt branch renders that error at 549–550. The built branch at 557–727 never renders it or a retry; 601–604 says “No casino tokens are configured yet.” Stats errors similarly become null at 250–259 and disappear from the UI at 607–634.

Impact: a read failure is misrepresented as no configured games. A returning player may lose the host's visible “Resume” route because active-game state was erased. This is particularly poor when an actual game may still have an expiry deadline; no claim is made that game-dialog recovery itself is absent.

Solution: use initial loading, empty configuration, and failed refresh as separate states. Retain known active-game recovery information on transient refresh failure, clearly mark it as needing a status check, and provide retry. Stats should say unavailable instead of silently removing the section. Route active-game recovery independently of whether new-game token discovery succeeds.

### BP-09 — P2: Casino build balance failure stays on “Checking balance…” with no recovery

Evidence: `CasinoPanel.tsx:167–181` ignores balance-query errors/loading status and defines readiness as the presence of data. Lines 516–519 render the checking button until data exists. The available refetch is only called after approval at 405–410, a path a player cannot reach while checking.

Solution: reuse the same purchase readiness/error/retry treatment as BP-05. This is a second consumer of the same missing standard, not a reason to create another local loading-state implementation.

### BP-10 — P2 for noninteger build prices: Casino displays a whole-token rounded price for an exact token charge

Evidence: `CasinoPanel.tsx:111–115` rounds positive build cost to an integer token. Lines 183–185 use it for price, shortage copy, and the build button at 542. Actual eligibility compares the raw configured cost at 176–182, and `buildCasinoBuildCall` invokes the contract's build action.

Impact: a configured price of 1.4 tokens is advertised as 1; a positive sub-half-token cost is displayed as 0. This is conditional on configuration—current live prices were not checked—but the shared host explicitly supports arbitrary build-token configuration.

Solution: present a precision-safe exact or clearly bounded cost using the common token amount component. Use the same decimal metadata and formatter for cost, available balance, shortage, approval, and transaction review. Rounded summary values should never be the sole price shown on a spend action.

### BP-11 — P2: quests ask players to choose “difficulty” without showing the actual decision tradeoff

Evidence: `quest-difficulty-selector.tsx:6–9,25–30` contains only Easy/Med/Hard and hardcoded 3/6/12-hour labels. The Start section (`FarmerHousePanel.tsx:231–260`) adds no selected-difficulty reward range, outcome chances, or explanation. The information dialog (`building-info-dialog.tsx:135–143`) explains slots and generic reward types, but no difficulty tradeoff. The two-transaction/time-limited claim warning appears only after a quest reaches ready-to-commit (`FarmerHousePanel.tsx:212–219`).

Impact: duration is clear, but “Hard” implies difficulty/risk without telling a new player what changes or what they need to do to finish. Choosing an hours-long quest is a meaningful commitment even if no upfront token cost is charged.

Solution: provide a compact selected-difficulty explanation with actual configured duration and known reward/outcome ranges; distinguish random reward variance from difficulty. Show the return/open sequence and its limited opening window before starting, then retain contextual deadline guidance at return. Keep extensive probability tables in optional details rather than making the default card longer.

## Design and small-detail cleanup

These are source-visible inconsistencies and concrete design proposals. Actual clipping, contrast failure, or subjective unattractiveness should be confirmed in the root's device/theme pass before being claimed as reproduced bugs.

| ID | Observation / evidence | Proposed direction |
|---|---|---|
| BP-12, P3 | Building wrappers use different entry density/alignment: Warehouse has centered heading plus a top divider and `pt-4` (154–159), Farmer House centered heading with `pt-2` (135–136), Barracks repeats “Barracks” under the existing host title (650–659), and production begins directly with a data list. | Define a consistent building header, summary, action group, and secondary-details rhythm. Use left alignment for dense information and reserve centered states for true empty/loading presentations. Remove the second Barracks heading. |
| BP-13, P3 | The same plant picker is a custom image/name/countdown composition in Warehouse (168–212); selected dropdown rows have no checked/selected indicator. Barracks target rows explicitly say “Selected” (845–862); Casino token rows do too (76–97,587–595). | Use a shared asset picker with a visible label, current selection, consistent selected-row affordance, keyboard/typeahead behavior, matching menu width, and a clear large-collection strategy. Preserve Warehouse's 64px touch rows and truncation. |
| BP-14, P3 | Quest labels say “Ready to commit” / “Committed” (FarmerHouse 73), while actions say “Return now” / “Open now.” Reward pause copy discusses a wallet being approved (148,264). Village info descriptions repeat “Current rates and upgrade requirements are read from the selected land” for three distinct buildings (building-info-dialog 94,98,102). | Use the player action vocabulary in status labels (“Ready to return”, “Loot bag ready”). Describe the player's next step rather than a contract implementation. Give each production building one short explanation of its resource purpose. |
| BP-15, P3 | Duration is “lifetime,” “minutes,” “time,” and “Plant Lifetime” across Warehouse, ProductionSummary, and info; buttons say “Apply PTS” but “Add time” for a parallel operation (Warehouse 223,251). Quest uses “Med” and 10px duration text (selector 8,29), Barracks uses multiple 11px uppercase labels (83–85,108,658). | Establish content tokens for resource names, units, button verbs, labels, capitalization, and dense metadata. Choose one medium label and make the actionable duration readable. Use compact typography sparingly rather than letting every nested panel set its own scale. |
| BP-16, P3 | The raid preview hardcodes “Includes 10% home base bonus” (Barracks 958), but building information says **up to** 10%, dependent on production upgrades (info 372); the header itself derives a percentage (Barracks 191–194,659). | Say “Includes the target's home defense bonus” or show its actual percentage from the authoritative preview/config. Do not label a maximum as an always-applied amount. |
| BP-17, P3 | Casino host says 256 blocks are “~10 mins” (CasinoPanel 562), while quests say “about 8½ minutes (256 blocks)” (FarmerHouse 213); the shared Base conversion is 2 seconds/block (`lib/utils.ts:72–75`). Casino information calls all games “provably fair onchain randomness” (info 148) although its Blackjack description says server-signed randomness (51,54). | Derive all block-based deadline estimates from one formatter and use per-game recovery text. Align the Casino heading with each game's actual mechanism; the Casino domain auditor covers game-specific details. |
| BP-18, P3 | Barracks initial loading is only a spinning icon (549–553); Casino does the same (468–475). Farmer House has visible “Loading...” (137–138), while Warehouse already uses a labeled ResourceState (162–164). Barracks information error has no retry (building-info-dialog 323–329). | Reuse labeled ResourceState/loading and retry patterns. Match the visual height to the content being replaced to reduce layout shifts, and expose status to assistive technology. |
| BP-19, P3 | “History” is a section label (Barracks 670) that contains only Last Attack and Last Defense (1001–1017). | Rename to “Latest reports” unless a paginated battle history is implemented. It is a useful product expectation correction, not evidence that the contract stores more history. |

## Maintainability and drift

1. **Purchase decisions are duplicated and already diverging.** Upgrade, Barracks build, Barracks train, and Casino build separately implement balance/allowance/config gates. BP-05/06/07/09 are consequences. Build a shared *state resolver* and composed action presentation; preserve each action's different transaction call and approval token rather than forcing every feature into a large generic component.
2. **Post-transaction side effects have several authorities.** Production success uses a raw `buildings:refresh` event and mission payload (`ProductionPanel.tsx:36–47`); Warehouse duplicates the same mission payload/event structure for points and lifetime (226–237,254–265); Farmer House has local refresh/reconcile loops (93–117) and a mission payload (249–258); Barracks performs snapshot/allowance/target retries plus shared dispatch (426–448). Some actions also declare shared owner-resource effects. Audit and consolidate authoritative invalidation and mission proof handling so a new mutation does not need to copy several partial refresh recipes.
3. **Formatting duplicates have real precision drift.** `building-info-dialog.tsx:162–173` defines local `formatBarracksPoints` (2 decimals) and percentage formatting (2 fractional digits), while `lib/barracks-view.ts:77–78,93–98` defines the same named concepts at 4 decimals and 1 fractional percentage digit. Casino has its own whole-price formatter (111–115), and Farmer House its own duration function (84–92), despite shared bigint duration utilities. Consolidate semantic formatters and explicitly request a compact/exact mode where appropriate.
4. **Feature subpanels still combine several independent controllers.** BarracksPanelV2 is 1,023 lines; CasinoPanel is 729 lines; building-info-dialog is 625 lines. Extract Barracks training/raid/report sections around a shared snapshot/query controller, and Casino build/token/recovery/status sections around a shared host controller. Reuse typed presentation models; do not split merely by line count.
5. **Current browser fixtures cover helpful pieces, not these whole workflows.** `app/qa/frontend/dense-surface-fixtures.tsx:27–29` renders only `BarracksReportCard` under the Barracks fixture; `tests/frontend/dense-surfaces.spec.ts:10–27,65–72` verifies/report-screenshots that component. Searches of `tests`, `smoke`, and `app/qa` found full-panel names in source-based smoke checks, but no browser fixture mounting the actual FarmerHousePanel, WarehousePanel, BarracksPanelV2, CasinoPanel, or UpgradePanel. This does not negate the smoke suite; it explains why the runtime branch differences above need targeted interactive coverage.

## Full assigned-source coverage

| File | Branches/flows inspected |
|---|---|
| `components/building-details-panel.tsx` | Empty selection, building title/info, global upgrading gate, unbuilt production/market/quests, all town dispatch cases, feature flags, generic vs custom upgrades, footer. |
| `components/building-info-dialog.tsx` | All 9 building definitions, Casino's three information tabs, production active/upgrading rates, utility features, upgrade costs, Barracks config loading/error/rules/troop tiles, row wrapping structure. |
| `components/building-details/UpgradePanel.tsx` | Max level, unbuilt/build, upgrading progress/time, LEAF/PIXOTCHI checking/error/retry/shortage/approval/action, success/error effects. |
| `components/building-details/ProductionPanel.tsx` | Positive accumulated resource collection, no-claim state, receipt mission update, shared summary. |
| `components/building-details/production-summary.tsx` | Daily and stored points/lifetime, zero-row filtering, bigint/resource formatting, wrapping. |
| `components/building-details/WarehousePanel.tsx` | Wallet changes/race fencing, plant initial/retry/error/empty/selection, points decimals, integer minutes, max/invalid/over-cap states, both transactions and mission effects. |
| `components/building-details/FarmerHousePanel.tsx` | Scope/storage changes, load/error/retry, reward readiness, available/cooldown/in-progress/ready/committed/expired states, start/commit/finalize/reset, deadline/progress, last outcome, reconciliation. |
| `components/building-details/quest-difficulty-selector.tsx` | Three difficulty options, duration/icon/text, radio keyboard composition, selected styling; shared ToggleGroup inspected. |
| `components/building-details/BarracksPanelV2.tsx` | Not loaded/error/disabled/unbuilt/build, balance and allowance reads/identity/approval, troops/queue/train, raid target fetch/selection/errors/counts/preview/submit/cooldowns, history switch, timers and refresh. |
| `components/building-details/barracks-report.tsx` | Null/error/retry, empty, outgoing/incoming win/loss, no-survivor hidden intelligence, loot/settlement/timestamp. |
| `components/building-details/barracks-battle-table.tsx` | Table/caption/headers/counts/casualties, hidden values, long values and wrapping. |
| `components/building-details/CasinoPanel.tsx` | Identity fencing, build config/balance/approval/submit, token configs/selection/stats, error/empty/loading, active-game resume, game feature/policy gates and host dialog props. Game internals delegated. |
| `components/building-details/MarketplacePanel.tsx` | Description/open state/dialog props; marketplace internals delegated. |
| `components/building-details/StakeHousePanel.tsx` | Description/typed staking event entry; staking internals delegated. |

## Verification needed for release confidence

The next useful validation is a state-driven browser fixture for the real panels, not more happy-path screenshots. At 320/390px mobile, 768/1024px tablet and 1280/1440px desktop, exercise: reward read failure/depletion at commit; an already committed quest with a failed pool read; slow and failed Barracks balance/allowance reads; disabled Barracks with an empty training queue; every-block target refresh while the picker is open; preview-enabled target/count changes with delayed responses; Casino initial/refresh failure with an active round; noninteger build prices and non-18-decimal tokens; warehouse long plant names/large collections/max validation; wallet/land switches during reads. Include touch, keyboard, dark/light themes, text zoom, and reduced motion. Source coverage of all branches is complete for this assignment; runtime coverage remains explicitly separate.

The gameplay audit later completed a bounded live pass at 320×568, 390×844 and 1440×900. See `gameplay.md`, “Live follow-up,” and `output/playwright/audit-2026-09-08/gameplay-live/`. It verifies actual unbuilt Farmer House/Barracks/Casino states, Warehouse with no plants, production display, building information and gated batch states. It does not reproduce the active quest/raid/game findings above: the demo land has those buildings unbuilt. No transactions were submitted by that worker.
