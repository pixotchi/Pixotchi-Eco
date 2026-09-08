# Read-only cross-review: low gameplay and buildings

Reviewed 8 September 2026 against G17/G18/G19/G22/G23/G24/G28 and BP-12 through BP-19, including the shared name field, Warehouse destination picker, utility callbacks, countdown/protection integration and the original findings/fix reports. The initial review found four concrete gaps, recorded below. This reviewer changed no production source.

## Correction status

- **R1 resolved:** both rename parents now share an identity/presentation-scoped draft. Independent actual-component checks confirm a live name refresh preserves the player's draft before submission and while the input is pending/disabled. The normal successful presentation still closes.
- **R2 resolved:** the shared hook cancels old timers and checks the captured session before closing. Independent checks confirm that success delivered before close, success held until after reopen, and success delivered after switching asset identity all preserve the new draft. The completion callback reports the original submitted asset ID and name. These checks passed for both plant and land in Chromium and WebKit.
- **R4 resolved:** rechecked all four source directions after the owners' corrections. They now name Plant care; the tutorial's legitimate Town Marketplace reference and the SEED/LEAF order-book description remain intact.
- **R3 resolved:** independently rechecked after the building owner's final correction. The submitted callback is captured at preflight, and the panel compares the submitted owner/land/target and draft revision before clearing a field. The original late-completion reproduction now passes for both points and lifetime. Additional selected-plant A → B → A with the same amount retains the newer draft; a subsequent untouched submission still clears. The submitted destination, mission proof and two mounted controllers remain intact. No new concrete issue was found in the narrowed owner/land/recovery review.

The four functional corrections are cleared. The separate WebKit `ResizeObserver` warning is also resolved by a local picker-trigger scale override, independently checked with the strict 12-cycle WebKit regression. The original warning and a later ad hoc harness timeout remain recorded below.

## R1 — Rename draft is overwritten by a background name refresh

**Affected:** `components/edit-plant-name.tsx:119` and `components/edit-land-name.tsx:45` (G18).

Both parents reset `newName` and the pending flag whenever the live asset's `name` prop changes while the dialog is open. The shared field preserves all typed Unicode correctly, but a refresh or rename from another session still silently replaces a player's in-progress draft.

**Reproduction:** actual EditPlantName and EditLandName were mounted using the existing controlled gameplay fixture. Open the dialog, enter `My draft`, then update only the same asset's external name to `Changed`. Both real inputs changed to `Changed` without user input. The controlled browser run asserted this behavior.

**Correction:** initialize the draft on a new dialog presentation/asset identity, and optionally update it on external name refresh only while it is still pristine. Do not reset a pending operation merely because a live read changes the name.

## R2 — Old rename success timer dismisses a newly opened session

**Affected:** `components/edit-plant-name.tsx:136` and `components/edit-land-name.tsx:64` (G18 session handling).

The success auto-close timer is canceled only on unmount or another success. Closing and reopening the same component leaves its old timer active.

**Reproduction:** for each actual rename dialog: enter a valid draft, deliver a controlled transaction success, press Escape, reopen, enter `Next draft`, then advance the browser clock 1001ms. The newly opened dialog disappears. No contract transaction was sent.

**Correction:** cancel the timer on close/open/asset/owner changes, or capture a dialog generation and close only that still-current presentation. Preserve the transaction controller's recovery behavior independently.

## R3 — Warehouse completion deletes a newer destination's amount draft

**Affected:** `components/building-details/WarehousePanel.tsx:184` and `:212` (BP-13 selection integration).

The picker and amount fields remain editable during an operation, while each success handler unconditionally clears its current amount state. Completing an older operation can therefore delete input for the next selected plant.

**Reproduction:** actual WarehousePanel, PlantResourcePicker, WarehouseApplyTransaction adapter and application CSS were rendered with the building fixture's controlled transaction boundary. Submit 1 PTS for Basil (#2), change the picker to Clover (#3), enter 0.5 PTS, then deliver the earlier Basil success. Clover remains selected but its 0.5 draft becomes empty. The submitted call still targets Basil; this finding is loss of the newer draft, not a demonstrated misdirected transaction. The lifetime handler has the same unconditional-clear structure.

The shared controller does not supply a form-draft guard: `transaction-kit.tsx:514/794–797` invokes the current confirmation callback under its owner scope. This review did not modify the transaction infrastructure.

**Correction:** capture the submitted owner/land/plant/mode and draft revision, and clear only that unchanged draft on success. Keep authoritative resource reconciliation and mission proof handling even if the player has moved on. Do not unmount a pending controller to solve this.

## R4 — Directions still point to the old plant Marketplace label

**Affected:** `components/building-info-dialog.tsx:133`, `components/tutorial/slides.tsx:64/82`, and `components/tabs/plants-view.tsx:716` (G23/BP-14 vocabulary integration).

The actual farm section is `Plant care` (`plants-view.tsx:785`), while these directions still call it the plant Marketplace or promise marketplace access after revival. The Town Marketplace is now explicitly the SEED/LEAF order book, so “buy a Fence from the Marketplace” can send a player to the wrong section.

**Correction:** name `Plant care on the Farm tab` when directing players to care items/fences, and say that revival restores access to plant care. Retain Marketplace for the land order book.

## Other reviewed paths

No additional concrete defect was found in the checked paths:

- Shared UTF-8 field validation retains the full typed draft and accurately distinguishes blank/short/long names with associated feedback.
- EmptyFarm selects the requested mint type and dispatches shell navigation.
- The dead-plant guide focuses the actual revival region; claim consequences are presented once and do not invent a numeric reset level.
- AssetTitle uses equal side columns and a wrapping center; owner identity wrapping remains present.
- Warehouse filtering, bounded pagination, checked state, small-list typeahead and selected call destination match the implementation/report. Unknown owner data hides the form and closes the picker.
- Batch utility callbacks select an actual production building or Farmer House through the existing selection handler.
- Quest display labels are independent of state keys; shared block estimates and the inclusive final eligible block are retained.
- Barracks/Casino/Farmer House labeled loading, Barracks in-place rules retry, target defense wording and Latest reports labeling match the intended changes.
- `usePlantProtection` cancels scheduled callbacks on selection cleanup, checks the current owner/plant scope, deduplicates observed expiries and performs no post-await update to another selection. No new issue was found beyond the already-passing dedicated low-round owner-switch/visibility/deadline checks.

## Evidence and limits

The initial five rename assertions (initial plant-only confirmation plus both parent cases for each of the two races) and Warehouse pending-draft reproduction ran in Chromium against actual components with controlled external reads/completion. They confirmed the original failures before correction.

After correction, the independent rename runner passed **16 cases**: Chromium and WebKit at 390 × 844, each with plant and land parents, each covering live refresh before/during submission, a previously scheduled success timer after reopen, held success after reopen, and asset identity change before held success. The actual preflight callback ran before controlled completion. Every case checked the relevant input/pending state; success cases also checked the original submitted ID/name. No browser page errors were reported in this rename run.

The independent Warehouse correction runner passed both points and lifetime groups in Chromium, including destination change, selection A → B → A, untouched-draft clearing, original submitted destination/proof, and the two mounted controllers. An additional WebKit run and one bounded repeat also passed those functional groups, but each failed the final generic page-error assertion with `ResizeObserver loop completed with undelivered notifications.` The repeat's recorded stage was `picker Basil` (the helper spans opening, searching and selecting); the browser supplied an empty stack. The observable path includes PlantResourcePicker, shared DropdownMenuContent/useScrollFade, and Radix/Floating UI positioning observers. That is a candidate path, not an established causal source. No warning was suppressed and no speculative production edit was made. The exact replay is preserved at `output/review-warehouse-r3-webkit.mjs` and was passed to the building owner for the root-authorized bounded diagnosis.

**Final observer correction:** the building owner's controlled comparison reproduced the warning with both the original picker and with scroll-fade observation removed. Removing the trigger's pointer-down scale change eliminated it across 12 cycles: the menu matches its trigger width, so scaling that measured anchor during pointer-down changes the width supplied to Popper/Floating UI during release. The production correction is limited to `active:scale-100` and an explanatory comment on `PlantResourcePicker`'s trigger; shared Button, DropdownMenu, scrolling and positioning behavior remain unchanged. This reviewer checked that narrow source change and independently ran `node smoke/building-p3-components-smoke.mjs --webkit-picker`: **12 open/search/select cycles passed in WebKit at 390 × 844, with the strict page-error assertion passing and zero warnings filtered.** The observer finding is resolved.

One requested final rerun of the saved ad hoc R3 replay stopped earlier, at its first Apply points click (line 75), because the button remained disabled for the harness's 8-second timeout. That run did not reach its final observer assertion and is not counted as a pass. It is distinct from the earlier independently passing R3 functional sequences and the subsequently passing permanent picker regression. The permanent harness now awaits its committed fixture revision after reset; this reviewer made no source/harness edit or additional broad test run to address the ad hoc sequencing failure.

These independent checks used ephemeral stdin-built fixtures; the saved Warehouse replay is a verification artifact. No source fixture, screenshot/snapshot, application server or production transaction was changed by this reviewer. The rename boundary was controlled on the normal EVM path; this re-review does not separately certify a live wallet/bridge transaction.

The remaining paths were independently source-reviewed against the original findings and existing focused test assertions, not rerun as a full suite or certified on physical hardware. Root and the gameplay/building owners received all four findings with evidence before this report was written.
