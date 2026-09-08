# Transactions, minting, swapping, staking, marketplace, and transfers audit

Audit date: 2026-09-08. Scope owner: transactions/economy audit agent. Application source was not changed.

This is a source-backed audit of the inventory below. No wallet transaction or device/browser interaction was performed by this agent. The root auditor independently reproduced TX-01 and the TX-07 confirmation-display mismatch in the live app at 390 × 844, as recorded below. Other findings marked **confirmed source** describe concrete control/data flow; they are not claims that a live chain transaction was reproduced. One installed-library experiment also verified the staking parsing exception. Runtime verification gaps are listed explicitly at the end. Older QA documents were not used as current evidence.

## What this part of the app does

Players use SEED, LEAF, ETH, PIXOTCHI, plants, and lands across minting, exchanges, staking, marketplace orders, building batches, and asset transfers. EVM feature wrappers generally pass contract calls and refresh domains to `GameTransaction`, which uses the large shared `transaction-kit` controller. It handles wallet/chain readiness, batch atomicity, execution proof, pending-intent recovery, receipts, refresh effects, callbacks, and transaction feedback. `ApprovalActionTransaction` composes token approval and a following action. Several purchase wrappers compose an ETH-to-SEED swap with approval and the final gameplay action. Solana payment uses a separate bridge path. The swap panel has its own execution/controller implementation; NFT transfer additionally persists an immutable, potentially multistep plan.

There are useful foundations: shared `AmountField`, typed amount parsing, scoped transaction effects, durable pending recovery, accessible feedback-card roles, toast timer pausing for focus/hover/visibility, reusable swap purchase builders, and explicit stale-order handling in the marketplace. The principal gaps are where feature state and the transaction controller cease to agree: invalid drafts are still parsed into calls; retries bypass readiness; quotes outlive their selection; confirmations read draft data instead of the committed plan; success resets the button before data is refreshed.

Severity: P1 = important correctness/reliability blocker; P2 = material usability/accessibility/maintainability problem; P3 = polish or smaller consistency issue. These are proposed priorities, not measurements of incident frequency.

## Findings

### TX-01 — P1 — Ordinary staking input can throw during render

**Confidence: live reproduced, confirmed source, and installed-library experiment.** The root auditor opened Stake at a 390 × 844 viewport, chose Unstake, and filled `.`. The whole game was replaced by **We hit a temporary app error**, with Try again / Go Home. No transaction was submitted. Evidence: `output/playwright/audit-2026-09-08/staking-invalid-draft.png`.

`components/staking/staking-dialog.tsx:546-549` stores raw text directly. The separate `parseAmountInput` validation at line 367 drives helper text and disabled state, but approved Stake still calls `buildStakeCall(amount)` at line 581 and Unstake always calls `buildUnstakeCall(amount)` at line 606 while rendering. `lib/contracts.ts:1128-1129` and `1138-1139` call `parseUnits` without a catch. A disabled button does not prevent evaluation of its props.

Typing an intermediate decimal `.` in Unstake, or pasting `1,5`, `-`, `abc`, or `1e2`, can therefore throw before the validation message is useful and trip the nearest error boundary. A local experiment with the installed `viem` verified all those strings throw `InvalidDecimalNumberError`; an overprecision `0.0000000000000000001` instead rounds to zero. This makes independently reparsing raw text unsafe even beyond the exception.

**Fix:** let amount builders take the already validated bigint. Build calls only from a valid, positive parsed amount; invalid drafts produce an empty call set. Preserve intermediate text for editing and present one consistent validation message. Verify typing `.`, deleting the last digit, locale paste, 19-decimal paste, Max, and switching Stake/Unstake.

### TX-02 — P1 — Unsupported wallet atomicity can leave shared transactions permanently busy

**Confidence: confirmed source.** `components/transactions/transaction-kit.tsx:1040-1043` sets the executing ref and state before capability discovery. A wallet explicitly reporting unsupported atomic batches throws at `1083-1087`. This happens before the main `try` at line 1417; its error handler at line 1662 and cleanup at line 1725 cannot run. `submit` launches `void execute()` at line 1895 without handling this rejection.

For a multiaction approval/purchase with that capability response, the player can be left with a busy/disabled action and no useful recovery feedback. This differs from an absent capability API or transport error, which the code intentionally tolerates.

**Fix:** put all preparation and execution after entering busy state inside one outer `try/catch/finally`. Represent unsupported atomicity as a terminal, actionable preflight result. Keep the requirement that dependent calls remain atomic. Verify explicit unsupported, absent capabilities, discovery failure, supported batch, and unmount during discovery.

### TX-03 — P1 — Toast retry bypasses the feature's current disabled and validation state

**Confidence: confirmed source.** `components/transactions/game-transaction.tsx:194-214` applies feature `disabled` and empty-call checks to `TransactionButton`; `Transaction` does not receive the feature readiness predicate. `transaction-kit.tsx:2523-2530` renders a toast **Try again** button that directly calls `submit()`. `submit` at `1864-1895` checks wallet/recovery conditions but does not reapply the feature's disabled state. It also catches and merely logs exceptions from the before-submit callback at `1891-1894`, then executes anyway.

After a failure, the player can change an amount, selection, acknowledgment, allowance, or other prerequisite so the main button is disabled, while the toast can still launch submission against current calls. This creates two submission contracts in the same UI. The exact resulting revert or invalid intent depends on the feature.

**Fix:** make controller-level `canSubmit`/preflight mandatory and use it for every entry point, including retry. A rejected preflight must stop execution. After an editable draft changes, retry should return to review or require revalidation instead of directly submitting. Add a regression case for a failure followed by invalid amount/unchecked acknowledgment and a toast retry.

### TX-04 — P1 — ETH mint quotes are not tied to the current strain and can silently fall back to SEED

**Confidence: confirmed source.** In `components/tabs/mint-tab.tsx:121-124`, the quote state contains amounts without strain/amount identity. The plant quote effect at `503-553` delays work by 500 ms (`548`); it does not immediately clear the prior quote when the selected strain changes. The selection updates at line 918. `showEthPlantMint` at line 856 can consequently remain true briefly, while the transaction at `993-1007` combines the new `selectedStrain.id`/SEED requirement with the old quote's ETH amount. There is also no timed idle refresh in this effect.

Quote errors clear the quote (`526-539`). The alternate render paths at `1034-1099` then offer SEED approval/mint even though ETH mode is selected. Land mint uses the same broad pattern (`556-598`, `1252-1289`). A player sees the chosen payment method drift instead of an explicit quote failure, and a rapid strain change can produce an incorrectly priced bundle.

**Fix:** use the existing amount-keyed `hooks/useSeedPurchaseQuote.ts` pattern (or one shared quote controller) with input identity, expiry, explicit loading/error states, and pre-submit refresh. Retain the chosen currency across errors. Show a Retry quote action and an explicit user-controlled currency switch. Invalidate eligibility synchronously when strain/cost changes.

### TX-05 — P1 — Mint selection retains an obsolete catalog object after refresh

**Confidence: confirmed source.** `components/tabs/mint-tab.tsx:369-375` updates the strain list but uses `setSelectedStrain(prev => prev ?? availableStrains[0])`. A selected object therefore retains its previous supply/price after a successful mint or catalog refresh. The current list can disagree with the selected details and action. There is no corresponding selected-strain sold-out gate in `showEthPlantMint` (`856`) or the token transaction paths (`1071-1098`).

The ETH success handler uses the current selection (`1000`) whereas the token path snapshots the submitted strain (`1074`, `1086`). EVM selection remains editable while a transaction is pending, so its result/share presentation can refer to a different strain from the submitted one.

**Fix:** store the selected strain ID and derive the current object from the latest catalog. Block with a clear explanation when it becomes unavailable or sold out. Keep a separate immutable submitted selection for transaction progress and completion. Verify supply exhaustion, price changes, and changing selection while awaiting wallet/receipt.

### TX-06 — P1 — Marketplace truncation makes some orders and cancellations unreachable

**Confidence: confirmed source.** `components/transactions/marketplace-dialog.tsx:34-35` limits global lists to 48 and price-level lists to 20. A selected price uses `list.slice(0, 20)` at line 666 and directs overflow to All orders at line 722. All/Mine are sorted and sliced at `765-770`, with overflow guidance pointing back to price levels at line 879. Neither view provides pagination or load more.

An old order at a busy price can be absent from both lists. In particular, Mine hides older owned orders beyond the cap, while owned price-level rows offer only disabled **Your order** (`674-682`) rather than the Cancel action available in All/Mine (`821-830`). Players can lose UI access to cancel a valid live order.

**Fix:** add pagination or load-more with complete Mine coverage; use stable order IDs and direct order lookup. Offer Cancel on owned orders in every view. Keep the price summary distinct from a complete order list and remove the circular guidance. Verify 49+ owned orders and 21+ orders at one price.

### TX-07 — P1 — Reopening an NFT transfer confirmation can display zero assets while retaining nonzero calldata

**Confidence: confirmation-display mismatch live reproduced; retained submission payload confirmed by source only.** At 390 × 844, the root auditor used Local Test Wallet, chose one land (#1112) with the wallet's own address as recipient, and continued to review. The confirmation displayed **Lands 1/1**. After Escape and reopening Wallet → Transfer, **Confirm Transfer** persisted but displayed **Lands 0/1**. Evidence: `output/playwright/audit-2026-09-08/transfer-review-before.png` and `output/playwright/audit-2026-09-08/transfer-review-reopened.png`. **Confirm & Send was never clicked and no transfer was submitted.** Back cancelled the prepared plan and restored an empty selection. The live test verifies the misleading count, not an executed mismatched transfer.

`components/transactions/transfer-assets-dialog.tsx:622-652` captures selected NFT IDs in `activePlan`. Closing at `905-910` preserves an active confirmation plan. However, the closed-state loading effect at `351-358` clears the draft selected ID arrays. On reopen, the hydration effect returns early for the same wallet registry key (`255-299`, especially `257`), and the refresh at `397-398` only filters the now-empty arrays.

Confirmation counts at `1067-1075` read those draft arrays, but execution uses the retained `activePlan` at `705-726`. The reviewed amount can therefore disagree with the submitted assets after close/reopen. Even normally, the final review only shows counts, not the exact IDs/names being sent.

**Fix:** render every confirmation detail from the immutable active plan and current step: exact assets, recipient, network, already completed steps, and remaining assets. Separate draft selection from the committed plan. Verify close/reopen, reload, wallet change, partial success, cancellation, and recovery before allowing another send.

### TX-08 — P1 — Batch success reenables actions before the successful items are removed

**Confidence: confirmed source; chain-level consequences require runtime verification.** In `components/transactions/batch-claim-card.tsx`, a loading scan replaces the UI only when there are no prior items (`259`). Success changes `txKey` (`431`) to remount the controller and starts an async scan (`439`) while the old claimable list remains. The action at `417-454` has no scan-loading disable gate. It also emits `buildings:refresh` (`441`), which its listener (`191`) handles with another scan. Its transaction refresh domains at line 419 omit buildings/lands.

The player can briefly submit the same claim batch again, including another displayed 500 PIXOTCHI charge, before the refreshed building list arrives. `batch-quest-start-card.tsx` similarly changes `txKey` (`381`) while a refresh event (`404`) is debounced by 900 ms (`88`, `253-268`); its action (`682`) is not disabled by scan state. A subsequent submission can still contain buildings just started on quests.

**Fix:** synchronously retire confirmed IDs and hold subsequent batch actions until the relevant source has reconciled. Use one coalesced refresh owner and explicit controller reset, rather than a keyed remount as a lifecycle reset. Make **this batch cost** and **remaining total cost** explicit: claim displays one cost at line 414 while disclosing splitting at `367-368`; quests explicitly charge once per run (`580-583`). Show rewards for the same subset that will execute.

### TX-09 — P2 — Several economy views treat failed reads as zero, empty ownership, or valid stale data

**Confidence: confirmed source.** These paths need the same explicit loading/unavailable/ready-zero state model:

| Surface | Evidence | Player consequence | Required change |
| --- | --- | --- | --- |
| Swap balances | `components/tabs/pixotchi-swap-panel.tsx:413-449` does not retain `useBalance` errors; `466`, `471-485` fall back to zero; insufficient state `503-508`, label `1785` | RPC failure can appear as no funds with no balance Retry | Preserve error state; label unavailable; retry reads and gate only on trusted data |
| Staking | `components/staking/staking-dialog.tsx:231-244` retains stale/default data on refresh failure; action gates `372-374` omit `refreshError`; approval `568` only checks loading/address | Failed initial load can still offer approval; old balance/allowance can keep actions enabled; metrics show default zero | Gate all actions on a complete trusted snapshot and label last-known values |
| Marketplace balances | `components/transactions/marketplace-dialog.tsx:218-222` sets an error without invalidating balance ownership/freshness; `153` checks identity; create `624-634` and take `713`, `804` omit `balanceError` | An error banner can coexist with actionable stale balances/allowances | Reuse the explicit freshness invalidation already used for orders at `167` |
| Batch quests | `components/transactions/batch-quest-start-card.tsx:232-236` logs whole-scan failure, records scanned IDs, and provides no error state | Initial RPC failure can render No Farmer House (`459`, `475-478`); stale prior rows can remain actionable | Surface Retry and distinguish no buildings from unavailable data; partial failure text at `508-514` needs in-place Retry |

`components/balance-card.tsx` already distinguishes resource errors more clearly and is a useful starting point for a shared balance presentation contract.

### TX-10 — P2 — Default swap configuration hides the minimum received and cost summary

**Confidence: confirmed source; actual runtime environment flag not checked by this agent.** `components/tabs/pixotchi-swap-panel.tsx:1727` gates the summary behind `CLIENT_ENV.SWAP_QUOTE_SUMMARY_ENABLED`. Minimum received, slippage, and tax rows are built at `1730-1737` and only rendered at `1952-1972` under that flag. `lib/env-config.ts:65` requires the environment value to be exactly `true`; `.env.example:96` sets it to `false`.

In the shipped default configuration, the player can see the estimated receive amount without the compact minimum guarantee/cost breakdown immediately before Swap.

**Fix:** always show minimum received and any fee/tax in the primary review. Put route mechanics and advanced settings in expandable details. Show quote updating/expiry and re-review if the execution quote changes materially.

### TX-11 — P2 — Transaction feedback and recovery drift between features

**Confidence: confirmed source.** The shared transaction feedback supports durable recovery and explorer access. The separate swap execution path displays truncated execution text (`components/tabs/pixotchi-swap-panel.tsx:334`) and clears execution steps 2.2 seconds after success (`1357-1360`); there is no explorer anchor in that panel. Its recovery menu is under More options (`2006`). Progress and completion deserve a stable transaction reference, especially when a player changes tabs.

Several feature handlers also call `toast.error` while the default `GameTransaction` global feedback remains enabled: examples include mint `1002`, `1093`, `1220`, `1283`; marketplace approval `587-588`; batch claim `453`. One failed action can produce both feature and shared feedback with different wording/lifetimes.

Shared pending text is inferred from button substrings: `components/transactions/transaction-kit.tsx:317-329` checks `stake` at line 322, so **Unstake** and **Approve SEED for Staking** can both become **Staking...** despite different contract actions.

**Fix:** choose one feedback owner per transaction; pass structured outcome/action metadata and explicit pending labels. Keep a durable, accessible last-transaction link with clear submitted/confirmed/reconciled distinctions. Preserve feature-specific guidance within the common presentation rather than stacking separate toasts.

### TX-12 — P2 — Selection and focus states are not consistently available beyond color

**Confidence: confirmed source.** The swap amount input explicitly removes focus outline/ring at `components/tabs/pixotchi-swap-panel.tsx:173-174`, while its card class at line 169 has no `focus-within` replacement. This overrides the broad input focus fallback in `app/globals.css:1253-1259`. Keyboard users can lose an obvious focus marker on the most important field.

Mint strain buttons (`components/tabs/mint-tab.tsx:915-923`) indicate selection through styling without `aria-pressed` or radio state. Marketplace Sell LEAF/SEED (`components/transactions/marketplace-dialog.tsx:538-543`) and Mine/All (`755-756`) likewise rely on button variant rather than explicit selection semantics.

**Fix:** apply a visible focus-within boundary around the amount card; preserve native focus as fallback. Use shared radio/toggle/tab primitives with correct selected state and appropriate keyboard behavior. Verify keyboard-only navigation, screen-reader labels and state, high contrast, and forced colors.

### TX-13 — P3 — Economy controls and layout density have avoidable cross-surface drift

**Confidence: source-confirmed dimensions; actual device appearance requires visual verification.** Marketplace create/approve buttons enforce `h-10 min-h-10` (`580`, `603`, `623`), while take/cancel use 44 px actions. Balance refresh is 32 px square (`components/balance-card.tsx:324`) without an evident larger hit area; secondary figures/labels use 10 px in several balance-card regions (`258`, `287`, `300`). These inconsistencies make frequent mobile controls less forgiving and increase visual density.

The swap feedback wrapper reserves a fixed `h-7` plus top padding (`components/tabs/pixotchi-swap-panel.tsx:2029`) for arbitrary nonempty messages. Long errors can need multiple lines on a narrow viewport; this needs measured checking, not an assumed screenshot defect. Mint's land price row uses a fixed 5 rem first column and two additional columns (`components/tabs/mint-tab.tsx:1135`), with a nonwrapping flex price area (`1147`), another narrow-device stress case.

Solana mint and EVM mint have divergent selection/review structures (dropdown versus card grid, different nested surfaces and spacing). Product requirements may justify different wallet actions, but shared selection, price, review, and result layouts would make the same task feel consistent.

**Fix:** define action/control sizes, hit-area rules, readable secondary typography, responsive price-stack behavior, and content-driven feedback height in shared primitives. Tune visual spacing after correctness fixes, using the device/state matrix below.

### TX-14 — P2 — Large mixed-responsibility components let policy drift recur

**Confidence: confirmed source.** `transaction-kit.tsx` is roughly 2,550 lines; swap panel 2,041; mint 1,384; transfers 1,258; marketplace 893; staking 647. Each mixes substantial state, remote reads, transaction assembly, controller behavior, error mapping, and JSX. The bugs above occur at those boundaries rather than because a single visual primitive is missing.

Approvals repeat constants/ABIs/policy among `approve-transaction`, `leaf-approve-transaction`, `approval-action-transaction`, marketplace, and staking. Some use unlimited approval while swap paths use purchase-specific amounts, with little consistent permission wording. Mint and other ETH purchases have both bespoke quote effects and the reusable `useSeedPurchaseQuote` controller. Mission-result retry/feedback is repeated across purchase wrappers. `SmartWalletTransaction` is now a compatibility wrapper over `GameTransaction`; preserve compatibility while consolidating behavior.

**Fix:** extract model hooks for trusted balances/allowances, keyed quotes, immutable reviewed intents, and feature-specific call builders. Keep one stable transaction controller with readiness and recovery policy. Compose small review/status primitives around it. Share approval policy and permission wording. Retain semantic feature wrappers where they add real domain meaning; avoid replacing meaningful domain code with an excessively generic configuration system.

## Related findings owned by the gameplay audit

These were discussed with the plants/lands owner and should not be double-counted in a consolidated report:

- `item-details-panel.tsx:697-704` applies fence-only approval gates to non-fence item purchases, blocking some life purchases when allowance is required.
- `edit-plant-name.tsx:352-392` can switch from selected ETH payment to SEED actions when its ETH quote is unavailable.
- `edit-land-name.tsx:69`, `90`, `132-147` changes `canSubmit` to false from its before-submit callback and conditionally unmounts the transaction component. Shared lifecycle dispatch skips certain callbacks after unmount (`transaction-kit.tsx:625`, `710`, `1688`), so the feature can lose feedback or keep a local pending state. Keep the controller mounted and disable the button instead.
- Revive/land read errors default to apparently authoritative prices or allowances. Use the same trusted-resource model as TX-09.

## Reviewed source inventory

The following scoped files were reviewed. This means source inspection, not every runtime state was executed. Casino and game transaction implementations were assigned to another owner. The generic `game-transaction.tsx` wrapper was inspected only to verify shared lifecycle integration.

| Area | Files |
| --- | --- |
| Shared transactions | `components/transactions/transaction-kit.tsx`; `transaction-feedback-card.tsx`; `transaction-recovery-options.tsx`; `global-transaction-toast.tsx`; `disabled-transaction.tsx`; `smart-wallet-transaction.tsx` |
| Approvals and basic actions | `components/transactions/approval-action-transaction.tsx`; `approve-transaction.tsx`; `leaf-approve-transaction.tsx`; `attack-transaction.tsx`; `kill-transaction.tsx`; `revive-transaction.tsx`; `buy-item-transaction.tsx`; `bundle-buy-transaction.tsx`; `claim-rewards-transaction.tsx`; `warehouse-apply-transaction.tsx` |
| Building and batch actions | `components/transactions/building-claim-transaction.tsx`; `building-speedup-transaction.tsx`; `building-upgrade-transaction.tsx`; `batch-claim-card.tsx`; `batch-quest-start-card.tsx` |
| Mint and naming wrappers | `components/transactions/mint-transaction.tsx`; `land-mint-transaction.tsx`; `plant-name-transaction.tsx`; `land-name-transaction.tsx` |
| Swap purchase wrappers | `components/transactions/swap-buy-item-bundle.tsx`; `swap-fence-purchase-bundle.tsx`; `swap-land-mint-bundle.tsx`; `swap-mint-bundle.tsx`; `swap-plant-name-bundle.tsx` |
| Marketplace, bridge, transfer | `components/transactions/marketplace-dialog.tsx`; `marketplace-order-summary.tsx`; `solana-bridge-button.tsx`; `transfer-assets-dialog.tsx` |
| Tabs | `components/tabs/mint-tab.tsx`; `swap-tab.tsx`; `pixotchi-swap-panel.tsx`; `pixotchi-swap-panel.strings.ts` |
| Staking, balances, layout | `components/staking/staking-dialog.tsx`; `staking-provider.tsx`; `components/balance-card.tsx`; `components/swap-amount-layout.tsx` |
| Quote hooks | `hooks/useSwapQuote.ts`; `hooks/useSeedPurchaseQuote.ts` |

Supporting implementation inspected: `components/transactions/game-transaction.tsx` integration; `components/ui/amount-field.tsx`; `lib/transaction-feedback.ts`; `lib/transaction-lifecycle.ts`; `lib/amount-input.ts`; relevant builders in `lib/contracts.ts`; `lib/env-config.ts`; `lib/swap/constants.ts`; `lib/swap/seed-purchase-quote.ts`; relevant focus CSS in `app/globals.css`; example quote-summary environment flag in `.env.example`.

## Runtime verification still required

This agent did not open a browser, attach a wallet, initiate a transaction, or measure responsive pixels. Root's independently observed staking crash is included in TX-01 and transfer review count mismatch in TX-07; neither reproduction submitted a transaction. Other root browser work is separate evidence. Source coverage must not be presented as 100% state/device coverage. In particular, financial execution depends on contracts, balances, wallet capability responses, RPC state, feature flags, and bridge services that static inspection cannot fully prove.

1. **Input and keyboard:** staking intermediate text/paste/Max; swap focus and token reversal; dropdown selection; quote updates during typing; screen-reader selected state and status announcements; 200% text/zoom.
2. **Wallets:** disconnected/read-only demo, EOA, supported atomic smart wallet, explicitly unsupported atomic capability, wrong chain, reconnect/account switch, signature rejection, wallet modal closed, and Solana bridge paths.
3. **Lifecycle:** failure then edited-invalid draft then toast Retry; signature/receipt delays; close/reopen and tab switches while pending; full reload; transaction replaced/reverted; successful chain receipt followed by refresh failure; sticky recovery and explorer link.
4. **Mint:** rapid strain switching within 500 ms; idle quote expiry; quote/RPC failure; different prices/supply updates; sold out after refresh; currency selection unchanged on quote error; success while selecting another strain.
5. **Marketplace:** more than 48 global/owned orders and more than 20 at one price; cancellation from each presentation; balance failure after a successful snapshot; partial fills, stale order, allowance changes, and long numeric amounts.
6. **Transfer:** multiple plants/lands; exact IDs in review; close/reopen confirmation; partial execution; account changes; old persisted plan recovery; recipient correction; acknowledgment and retry paths.
7. **Batch actions:** successful first batch with delayed refresh; rapid next submission; single/partial/whole scan failures; multiple remaining batches and their total charges/rewards.
8. **Devices:** 320/390 px phones, 768/1024 px tablets in both orientations, 1440 px desktop; touch and keyboard; long errors, long token amounts, narrow price rows, on-screen keyboard, safe-area edges, dialog scroll/footer visibility. Fixed-height message overflow and dense price columns above remain hypotheses until measured.

## Proposed implementation sequence

1. Fix the render exception, outer execution cleanup, controller-level retry validation, and immutable transfer review first. Add focused regressions around those concrete failures.
2. Unify keyed quote ownership, catalog selection identity, complete marketplace access, and post-success batch reconciliation. Introduce explicit unavailable/stale states across money/asset reads.
3. Normalize review and feedback: selected currency, exact assets, minimum received, cost for this submission, transaction reference, explicit pending labels, and one feedback owner. Correct focus and selection semantics alongside this work.
4. Consolidate model/controller boundaries and visual primitives; then conduct the complete device/fault-state matrix with captured evidence. Refine typography, spacing, control sizes, and long-content behavior from those measured screens.
