# Building panels: low-priority fixes, 2026-09-08

All eight original low groups **BP-12–BP-19** were revalidated against the medium-fixed tree. Each still had a confirmed remaining gap. Earlier rounds had already improved parts of BP-14/15/17, but none of these eight groups was fully resolved before this pass. No commits, deployments, contract writes, package/config changes, app server lifecycle changes, or visual snapshot updates were performed by this worker. Installed Next client-component guidance and the previously applied Apple/Emil design guidance informed the work.

## BP-12 — consistent panel rhythm and alignment

Before: Warehouse and Farmer House still centered dense section headings with different top padding; Barracks repeated the host's title; Casino, staking, and Marketplace centered descriptions and actions while production was left aligned.

After: detail panel entries use a common `space-y-4` rhythm with left-aligned summaries and action groups. Warehouse and Farmer House section titles follow the same scale. Barracks relies on the existing host heading, with a readable introduction and a separate actual defense value; its section controls allow wrapping at narrow widths. Casino token selection is full width and statistics align left. Staking and Marketplace retain their existing actions/dialogs with consistent full-width entry actions. Production collection remains separated from the data summary by its existing action divider.

Why: readers can follow title → current information → action in the same direction without nested, competing centered headings. This changes presentation, not transaction ownership or eligibility.

Evidence/checks: production component regressions pass; the actual Warehouse/picker renders with the app's real stylesheet at 320, 820, and 1440 pixels without horizontal overflow. Root's FND-12 semantic class rename was preserved (`surface-detail`/`surface-subpanel`). Limit: these isolated viewport checks do not certify every surrounding Dashboard composition.

## BP-13 — selected, keyboard-accessible, searchable Warehouse destination

Before: the Warehouse dropdown repeated image/name/countdown markup, offered no checked selection state, and rendered every plant with no search or collection bound.

After: `PlantResourcePicker` owns the reusable selected-plant row, visible field label/current value, full-name title and accessible name, menu width matching, and 64px target rows. Shared Radix radio items expose the current plant with a visible indicator and `aria-checked`. Collections over 12 plants offer name/ID search; the first 50 matches render initially, with explicit Show more pagination. Small lists retain native menu typeahead. Keyboard opening focuses search when available; ArrowDown enters results, ArrowUp/Tab can return to search, and Escape closes and restores focus. An unavailable owner selection closes the menu and resets query/pagination. Warehouse's existing owner/read fencing and selected destination/amount guards remain unchanged.

Why: the destination is clear, and large wallets can find a plant without rendering an unbounded image/countdown list immediately.

Evidence/checks: actual Warehouse, picker, shared dropdown/input/button, and warehouse transaction-call adapter pass 131-plant search, 50/100-row pagination, selected radio state, name typeahead in an eight-plant wallet, empty search, keyboard selection, Escape focus return, exact selected destination, and over-cap lifetime rejection. Long names, matching menu/trigger widths, 64px rows, and page bounds pass at 320 light, 820 dark, and 1440 light. Art is stubbed; no onchain transaction is submitted.

## BP-14 — player-facing quest states and production purpose

Before: Farmer House still displayed Ready to commit/Committed beside Return/Open actions. Its labels also drove conditional branches, making a wording edit a potential behavior change. Three production descriptions repeated implementation details instead of resource purpose. Reward-read failure and pause explanations were already improved in the high/medium rounds.

After: status labels are Ready to return and Loot bag ready. Branches and reconciliation compare the underlying quest state keys independently of display copy, preserving Return's fresh funding guard and committed Open's per-slot simulation. The repeated adjacent Loot bag ready label was removed. Building information describes each production building briefly and derives this level's resource purpose from the selected building's configured points/lifetime fields. Farmer House information uses Start → Return → Open vocabulary and lists all five possible reward types.

Why: status and action language agree, and future copy edits cannot silently change recovery branching.

Evidence/checks: actual Farmer House fixtures show the new statuses with the original Return/Open controls; quest result/expiry smoke and owner-race checks pass. Production information shows the configured plant-points/lifetime purpose. Limit: descriptions do not claim fixed resource allocations if an administrator changes a building's configuration.

## BP-15 — consistent resource and action vocabulary

Before: Warehouse paired Apply PTS with Add time, and labels mixed points/lifetime/time without consistently naming the plant resource. Production and information used varying resource labels. The medium round had already changed Med to Medium and made quest-duration labels 12px, but Barracks still used several 11px uppercase metadata labels.

After: Warehouse uses Plant points / Plant lifetime, explicit PTS/minutes units, and parallel Apply points / Apply lifetime actions. Production rows and building information use the same plant resource names. Barracks metadata uses readable `text-xs` with sentence-case labels, and new quest action labels use `text-sm`. Full precision, balance/error decisions, and selected-destination calculations are preserved.

Why: resource names and action verbs carry the same meaning across the readout and the form, without implying a different time resource or operation.

Evidence/checks: the actual Warehouse transaction adapter still targets the selected plant; over-cap lifetime remains blocked; production/resource-purpose checks pass. Root was notified to update the shared negative production-row assertion to the new label so that assertion remains meaningful. Limit: this pass standardizes the assigned building domain, not every resource label elsewhere in the app.

## BP-16 — accurate raid defense-bonus copy

Before: an enabled raid preview said it always included a 10% home-base bonus, although the defender's actual bonus depends on its building levels.

After: preview says **Includes the target's home defense bonus**. The player's own header continues to show its computed percentage; no unsupported defender percentage is invented.

Why: the maximum possible bonus must not be presented as a guaranteed actual value.

Evidence/checks: `building-p2-components-smoke.mjs --preview` mounts the real enabled preview branch and verifies the target-specific wording after a matching troop preview. All prior raid input identity/eligibility checks pass in the same run. Limit: no new live raid or deployed defense calculation was performed for this copy fix.

## BP-17 — shared time estimates and per-game mechanism guidance

Before: Casino still said all active bets expired after 256 blocks (~10 minutes), while quests used a separately hardcoded ~8½-minute estimate. The Casino information summary incorrectly called every game onchain randomness. The host's mechanism sentence had already been partly corrected in P1.

After: Casino identifies Roulette/Baccarat's 256-block reveal window using the shared block estimate (`~8m 32s`) and directs the player to the deadline shown in the game; Blackjack explicitly follows its own current-action timer. Information describes Roulette/Baccarat block-based randomness and Blackjack's verified server-signed cards. Farmer House, its difficulty summary, and batch difficulty labels use the existing shared `formatUpgradeDuration`/duration utilities and existing window constants. The local Farmer House seconds formatter was removed. Exact blocks and the final eligible block message remain visible; expiry semantics are unchanged.

Why: the same block count should produce the same estimate, and Blackjack must not inherit another game's expiry promise.

Evidence/checks: actual Farmer House Return/committed branches retain correct actions and show the shared `~8m 32s (256 blocks)` estimate. Existing result/expiry boundary smoke passes. The Blackjack/Baccarat owner confirmed that Baccarat remains valid through revealBlock + 256 inclusive and that Blackjack has distinct signed/current-action timing. Limit: wall-clock estimates remain estimates; the game-specific block/timer state and contracts remain authoritative.

## BP-18 — labeled loading and in-place information retry

Before: Barracks and Casino initially rendered only a spinner; Farmer House used a generic Loading line. Barracks information required closing/reopening after a rules-read failure. Warehouse already had labeled read states.

After: each host uses a labeled ResourceState explaining what is loading, with a modest minimum height to reduce sudden collapse. Barracks information has a retry action in its failed state and a named loading state while checking current rules. Retrying preserves the open dialog. Cancellation still ignores an obsolete/closed read.

Why: players know what is pending and have an immediate next action after a failed read.

Evidence/checks: controlled held reads in the real three hosts expose labeled statuses. The actual information dialog passes loading → failed rules → Retry → current rules without closing. Warehouse's unknown destination remains noninteractive. The G28 owner's later Mint CTA/hidden unavailable form changes were preserved, with its provider mocked in the isolated test. Limit: these are controlled read failures, not live RPC incident reproductions.

## BP-19 — correctly scoped report navigation

Before: History implied a full record but displayed only the latest outgoing and incoming report.

After: the section is **Latest reports**. Its underlying key and report loading behavior remain unchanged.

Why: the label accurately describes the available record.

Evidence/checks: actual Barracks component tests open Latest reports and confirm reports load at that point rather than on every block. No pagination or historical data availability is implied.

## Verification and remaining limits

Final cross-review also reproduced a Warehouse integration race: a submitted Basil operation could finish after the player selected Clover and erase Clover's newer amount. The adapter now retains the submitted callback through confirmation; the panel clears only an unchanged draft revision scoped to its owner, land, plant and resource mode. Editing and returning to the same value also preserves the newer draft. Controllers remain mounted, canonical reconciliation is unchanged, and matching recovered-call callbacks still work. Same-owner mission proof remains tied to the submitted callback even after a land change; an old owner completion cannot mutate the replacement owner's draft. The building information destination now consistently names Plant care on the Farm tab.

The independent WebKit replay then exposed a ResizeObserver warning while opening/searching this picker. Controlled observer instrumentation located Floating UI's `autoUpdate`, with the width-matched menu first measuring the trigger at its pressed scale of 0.985 and correcting its width after pointer release. An A/B fixture still warned with `useScrollFade` removed entirely; keeping only this trigger at `active:scale-100` eliminated the warning across twelve repeated selections. That local override preserves resting layout, color feedback and vertical press feedback. Shared dropdown/observer code was not changed, and no page errors were suppressed.

- `node smoke/building-p3-components-smoke.mjs`: **six scenario groups passed**, using production Warehouse/picker/info/production components and `app/globals.css` compiled directly with PostCSS/Tailwind. The added held-confirmation group checks both resource modes across target, edited-and-restored amount, wallet and land changes, unchanged-draft clearing, original submitted target and stable controller mount counts. The final runner is independent of an application server and passes in its isolated fixture server. Viewport/theme checks: 320 light, 820 dark, 1440 light. Evidence: `output/playwright/low-buildings/warehouse-{width}.png` and `warehouse-picker-{width}.png`. The 320px closed/open picker evidence was visually inspected. Images are controlled stubs; wallet/RPC submission is controlled; Next font loading is outside this standalone fixture.
- `node smoke/building-p3-components-smoke.mjs --webkit-picker`: **twelve repeated WebKit 390px open/search/select cycles passed**, with all page errors still failing the run. The independent held-success replay (`output/review-warehouse-r3-webkit.mjs`) also passed both resource modes and its strict page-error assertion after the trigger fix. This focused mode does not claim the entire Chromium harness has been certified on WebKit.
- `node smoke/building-p2-components-smoke.mjs --preview`: **18 scenario groups passed**, preserving actual approval controller lifetime, exact purchase readiness, paid-game recovery, current raid preview, and quest funding/terms guards, plus the new status/loading/preview-copy checks. Its behavioral fixture does not load Tailwind and is not a visual spacing assertion.
- `npx tsx smoke/quest-ui-smoke.ts` and `smoke/owner-resource-races-smoke.ts`: passed.
- Targeted ESLint: passed for owned low-round panels, picker, summary, building-info dialog, batch duration consumer, and both component regression scripts.

Root owns final integration/build/full suite and broader device screenshots. No full suite/build or app server restart was run here. These eight original low groups are fixed; this report does not claim universal live device/state coverage or certify unrelated game internals.
