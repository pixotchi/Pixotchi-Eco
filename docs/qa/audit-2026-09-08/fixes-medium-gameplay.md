# Medium gameplay fixes — 8 September 2026

Revalidated the assigned findings against the current, uncommitted P1-fixed source. All **13 assigned gameplay findings** were still present and have fixes: G04–G12, G14–G16 and G27. FND-V2's empty-Farm action is also implemented. G13's shared quantity control is root-owned; this work integrates its invalid-draft guard. No commits, deployments, baseline updates, package changes or full build/suite were performed by this worker.

The Apple and Emil design skills informed touch targets, content-sized layout, deliberate selection feedback, and map gesture continuity. Relevant installed Next client-component documentation was read before changes.

## Revalidation, fixes and evidence

### G04 — Owner/land-scoped building presentation

**Before:** P1 request-generation checks rejected late responses but did not stop a newly selected land from displaying the old land's arrays while its read was pending. Selection retained a copied building object.

**Fix:** every verified building snapshot carries its owner/land identity. `readMatchingLandBuildings` gates both scene arrays and action selection during render, before effects run. Selection stores only a building ID and derives the current building from matching data. The existing owner/request-generation and queued-refresh protections remain. A refresh of the same land retains its matching presentation with a refreshing message; a different land exposes no previous building actions.

**Verification:** the actual `LandsView` and `BuildingGrid` were rendered with two lands, different levels, and deferred RPC reads. Switching land 1→2 immediately removes land 1's detail and tile while the second read waits. Only land 2's verified level-4 building is then selectable. Runs passed at Chromium 320/1440 and WebKit 820. Detail-panel internals were a boundary stand-in; their actions are tested by the buildings owner. This test does not claim a live two-land wallet journey.

### G05 — Honest, independently recoverable care catalogs

**Before:** the combined catalog read hid either successful part when the other failed. Deeper revalidation also found that both contract wrappers swallowed failures as empty arrays, making a query error impossible to display honestly.

**Fix:** shop and garden have independent queries, status and retry controls, with catalog-shaped loading placeholders and a distinct verified-empty state. The strict contract read wrappers now reject on failure. Existing garden callers in the AI reader already handle `Promise.allSettled`; shop's consumer is the catalog hook. Successful data remains visible when the other catalog fails, and unavailable/stale catalog data cannot authorize a purchase.

**Verification:** actual hook/catalog loading, garden-success/shop-failure, precise retry, subsequent shop recovery, and an empty refreshed garden were exercised in all three component-browser runs. No RPC failure was interpreted as a verified empty first load.

### G06 — Price, balance, allowance, config and quote recovery

**Before:** fence configuration failures were hidden behind assumed bounds; fence quote failure instructed retry without a retry control. Revival could show 100 SEED or a previous/zero balance as known after failed reads. Rename used a silent 350-SEED fallback and lacked allowance recovery. Failed land allowances became zero and looked like missing approval.

**Fix:**

- Care uses explicit query readiness for SEED allowance, fence duration rules and fence price. Invalid/unavailable rules hide the duration input and gate dependent actions. Each failed read has its own retry. Fence price/rules and ETH quotes are revalidated before submission. Ordinary care remains independent of fence restrictions.
- `useReviveReadiness` separates owner/plant-scoped price, balance and allowance reads. Unknown values render unavailable/loading rather than a price or balance guess. Failed resources have individual retry controls. Submission rechecks all three, rejects a changed price/identity, and checks the refreshed balance.
- Rename has explicit price loading/error/retry and allowance retry, with no silent fallback. SEED and ETH controllers stay mounted while their readiness changes. Rename price and, where relevant, the ETH quote are checked again before signing.
- Land allowances have owner-scoped loading/error/ready state. Failed refreshes retain the previous numeric snapshot only behind a false readiness flag. `BuildingDetailsPanel` threads readiness, explanation and retry into `UpgradePanel`; the buildings owner implemented the corresponding stable action guards.

**Verification:** injected fence-config failure→retry→verified 2–5-day bounds, fence-price failure→retry, revival-price failure/recovery and changed-price rejection, rename-price failure/recovery, rename-allowance failure/retry, and land-allowance failure/retry all passed in the component browsers. The P1 ordinary-care/fence tests were rerun successfully. The buildings owner separately reported its upgrade/readiness component regressions passing. Actual token approvals and paid outcomes were not submitted by this verification.

### G07 — Mobile building selection reveals its action region

**Before:** tapping a tile only changed state; its detail could remain below the visible viewport.

**Fix:** below desktop, explicit tile or utility selection reveals and focuses the named inline detail region. “Back to buildings” returns focus and scroll to the chooser. Initial loading and passive refresh do not move the player. The same inline controller stays mounted; desktop retains its side panel.

**Verification:** the actual view moves focus to “Selected building details” after tile selection and exposes Back within the viewport on phone/tablet. Back restores focus to the chooser. Desktop preserves its existing presentation. Utility selection uses the same reveal path; every individual utility action was not rerun here.

### G08 — Container-sized, fully interactive building tiles

**Before:** four fixed columns, 64px icon boxes and noninteractive/truncated labels cramped the 320px card. Utility markup mirrored the building tile separately.

**Fix:** `BuildingTile` is shared by buildings and utilities. The whole icon/label/level/status tile is interactive, names wrap, status space is consistent, and rows stretch evenly. The grid fits as many minimum-width tiles as its own container allows, dropping columns as available width or text size demands. The land-area header can also wrap without hiding its toggle.

**Verification:** actual grids passed 44px minimum target checks and internal-tile overflow checks at 320, 820 and 1440, at normal and 200% root font size. Screenshots were inspected. The grid remains readable by adding rows; no fixed four-column assumption remains. These checks cover building tiles, not all stage overlays: the pre-existing land scene badges/title still become crowded at 320px with extreme text enlargement and need their separate follow-up.

### G09 — Unknown map supply remains unknown

**Before:** a failed supply read invented at least 500 discovered plots and affected minted/unminted classification.

**Fix:** supply is nullable and carries status separately from rendering extent. Only a verified count is shown as current; owned/known plots remain identifiable, while uncertain plots are classified unknown. Supply, neighbor data and owner lookup each expose recovery. The new state is integrated into `LandsView`.

**Verification:** source and actual map component/browser failure/retry tests passed. See [the independent map report](fixes-medium-maps.md) for the exact four-context matrix and stale-supply assertions.

### G10 — Failed map images recover safely

**Before:** failed image loads resolved a truthy image object and could reach `drawImage`, bypassing the colored fallback.

**Fix:** failed sprites are nullable, drawing validates usable image dimensions, and unexpected drawing failure produces a recoverable canvas state.

**Verification:** an individual sprite request was aborted and `drawImage` failure was injected in actual canvas tests. Both recovery paths passed; see [map evidence](fixes-medium-maps.md).

### G11 — Profile stats have honest independent states

**Before:** followers/following advertised pointer/hover interaction without a handler. Owner stats were coupled; errors disappeared, and failed social requests looked like absent social data.

**Fix:** `useProfileStats` owns independent plant-count, land-count, stake and social reads keyed by normalized owner. Each group can load, fail and retry without removing the others. A null/invalid stake or EFP response is an error, not a zero. Passive relationship counts no longer advertise interaction. The profile now uses the shared `ScrollArea`; long owner identity text wraps within its row.

**Verification:** the real profile rendered known plant count and zero stake beside a failed land count; failed EFP data displayed a retry state rather than “No social data.” Retrying to verified zero followers/following renders real zero counts with a passive cursor. Phone/tablet/desktop browser runs and profile screenshots passed. Follow transaction machinery was preserved; no relationship transaction was sent.

### G12 — Twin-owned Solana plants expose rename

**Before:** the Farm could display a twin-owned plant while rename required an EVM account and returned null.

**Fix:** rename resolves the same EVM-or-Solana-twin effective owner as Plants. Its existing Solana action is reachable and retains its price readiness guard. Bridge preflight supports asynchronous feature checks, verifies wallet/action identity before wallet submission, and invalidates admission if the component unmounts while its read is pending.

**Verification:** with no EVM address and a matching twin, the real rename trigger/dialog appears. After a failed price read is retried, the bridge boundary receives exactly `setName`, plant 7 and the entered name. Existing Solana bridge storage, admission, recovery and flow smoke checks also pass. A real Solana wallet signature or Base relay completion was not exercised.

### G14 — Focal pinch and continuous pan

**Before:** releasing either finger after a pinch disabled remaining-finger panning, and zoom was centered on the viewport instead of the pinch focus.

**Fix:** the map tracks captured pointers, keeps the focal world coordinate stable, and transitions back to one-finger pan or cancellation deliberately.

**Verification:** trusted Chromium pointer gestures cover an off-center pinch, each finger-release ordering, one-finger continuation and cancellation. WebKit rendering also passed, but physical devices and native WebKit touch gestures remain unverified. See [map evidence](fixes-medium-maps.md).

### G15 — One care capability model, including unknown items

**Before:** catalog filters silently dropped garden items without positive points/lifetime and shop items outside an English name heuristic. Routing repeated that heuristic.

**Fix:** `lib/care-catalog.ts` centralizes purchase kind, effects, grouping and material revision. Declared item category/capability takes precedence; legacy name adaptation remains in this one boundary because the current onchain catalog supplies names but no explicit fence capability. Presentation and purchase routing consume the same model. “More care items” retains additions instead of silently dropping them. Selection and quantities use type/ID identity.

**Verification:** a zero-effect garden item and a newly added non-protection shop item remain selectable in actual catalog tests. Ordinary garden care is never routed as a fence by its display name. The legacy adapter is a documented compatibility limit; adding explicit onchain capability metadata would remove its remaining name dependency.

### G16 — Review uses current catalog data and rejects changed intent

**Before:** an open care review kept a copied item object while catalog refetches could change its price/effects.

**Fix:** `useCareSelection` stores type/ID plus the revision the player reviewed, then derives the item from current catalog data. Material changes are announced, show updated details, and require “Use updated details” before buying. Removal shows an unavailable review with recovery. Preflight refetches the selected catalog and rejects changed selection, price or effects; ETH/fence quotes are also current and identity-bound. The shared transaction controller retains the submitted calldata snapshot. The repeated SEED purchase render branches now use one approval/action controller and one verified completion handler.

**Verification:** a visible catalog update disables the old review; accepting the update permits another attempt. A second price change during preflight rejects the attempt with zero boundary submissions. An unchanged refreshed revision reaches exactly one purchase submission boundary. Item removal cannot retain an enabled old action. All three component-browser contexts passed. Frontend revalidation cannot prevent a contract price changing after signing; an onchain maximum-cost parameter would be required for that guarantee.

### G27 — Small-screen map neighbor details remain reachable

**Before:** the neighbor card pushed part of its owner/Profile controls outside the 320px map.

**Fix:** details use a width-constrained dock with wrapping content, independent dismissal and reachable controls.

**Verification:** actual map dialogs passed 320px and 200% text tests plus tablet/desktop checks. See [map evidence](fixes-medium-maps.md).

### FND-V2 — Empty Farm leads to the appropriate Mint view

**Fix:** both empty-owned-asset views use `EmptyFarm`, a content-sized explanation and one “Get your first plant/land” button. The button selects the correct mint type through `FarmView` and dispatches the shell's typed navigation event, supporting both URL-backed web and local Mini App navigation. Costs remain reviewable before any mint action.

**Verification:** actual empty-Farm components dispatch Mint navigation with the requested land type. The shell event consumer is owned/tested by the architecture worker. A new real-provider mint or paid transaction was not performed.

### Shared G13 integration

The root-owned `QuantitySelector` now reports invalid drafts. `ItemDetailsPanel` uses that validity to gate every payment route with a readable reason and resets it when item identity changes. The control remounts for a different type/ID, preventing another item's invalid draft from following the selection. Root owns the direct quantity-input regression and completion record.

## Completed checks and artifacts

- `node smoke/gameplay-medium-components-smoke.mjs`: passed Chromium 320×720, WebKit 820×1180 and Chromium 1440×900. It runs actual production views/hooks/Radix/components and app CSS/fonts. RPC, account/transport, EFP infrastructure and nested building-panel boundaries are deterministic substitutes. It uses no live wallet.
- `node smoke/gameplay-p1-components-smoke.mjs`: passed Chromium 390 and WebKit 1440. G01–G03 remain verified. Expectations were updated for the now-stable disabled care controller and rename's added asynchronous quote revalidation; the behavior assertions remain.
- `npx tsx smoke/solana-bridge-flow-smoke.ts`: passed.
- Targeted ESLint on all worker-owned changes: passed without warnings. `git diff --check` on the principal gameplay changes: passed.
- The independent map harness passed four browser/viewport contexts and targeted ESLint, as recorded in `fixes-medium-maps.md`.
- Twelve component screenshots: `output/medium-gameplay/`; eight map screenshots: `output/medium-maps/`. Existing `output/p2-baseline` and screenshot references were not altered.

This is bounded component/read-boundary verification. It does not upgrade the previously documented live-wallet coverage to a pass for unvisited plants, paid transactions, full mobile keyboards, every wallet family or all physical devices. The real-app journey report remains a separate evidence set with its existing localhost chat/SIWE and TradingView limitations.
