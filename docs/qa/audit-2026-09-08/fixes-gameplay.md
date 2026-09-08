# Gameplay high-priority fixes — 2026-09-08

## Scope and result

G01, G02 and G03 were revalidated against the current checkout before editing. All three defects still existed. They are now fixed in the production components, with focused browser behavior tests against those actual components. No onchain purchase or rename was submitted during this fix work.

## G01 — ordinary care blocked by fence restrictions

**Revalidation:** the shared SEED approval branch separately disabled on `fenceV2BlockedByV1`, `fenceV2Bounds.todCapBreached` and fence quote state, although those values describe the plant's fence eligibility even when the selected item is ordinary garden care. The visible `disabledMessage` already scoped fence restrictions to `isFenceItem`, so the button and its explanation disagreed.

**Fix:** the approval branch now consumes the existing item-scoped `disabledMessage`, alongside dead-plant and empty-calldata guards. This removes the second, divergent eligibility implementation instead of adding another set of item-kind checks. Fence purchasing still uses the same fence-specific lifetime, V1, duration and quote restrictions.

**Verified behavior:** actual `ItemDetailsPanel` and `ApprovalActionTransaction` render an enabled ordinary-care approval for low lifetime, V1 fence and both conditions together, on regular and smart-wallet routes. Tests inspect the resulting approval/action call names: regular wallets get approval, smart wallets get approval plus garden purchase. Fence purchases remain disabled with the correct explanation for low lifetime and an active V1 fence.

## G02 — plant rename silently switched ETH users to SEED

**Revalidation:** ETH rendering and affordability depended on a non-null quote. Loading or failure therefore selected the SEED approval/action branch despite active ETH mode.

**Fix:** select `usesEthPayment` independently of quote availability. The entire ETH action remains in one exclusive branch, with explicit loading, unavailable, retry, insufficient-balance and ready labels. SEED notices are likewise limited to SEED mode. Replace the one-off effect with `useSeedPurchaseQuote`, keyed by amount and wallet/plant identity. Keep the ETH transaction component mounted while a quote is loading, failing or retrying; pass no usable ETH amount and disable it until ready. Its start callback freezes the submitted name while pending, and rejection restores editing.

**Verified behavior:** with the real quote hook and React Query, a deferred quote and failed quote never expose a SEED approval; retry recovers without changing the transaction component instance. The actual swap/name bundle receives the buffered ETH amount, full SEED minimum and current name. The pending name input is disabled; simulated rejection restores the action and input. Explicit SEED mode still exposes the SEED approval route.

**Remaining separate scope:** the existing fallback plant rename price and allowance failure/retry policy belong to medium-priority G06. This fix does not claim to resolve those read-state policies or add a new free-rename protocol path.

## G03 — land rename unmounted its own controller

**Revalidation:** `canSubmit` included `!isTransactionPending`, and the controller rendered only when `canSubmit` was true. Its first click set pending true and replaced the controller with a plain button.

**Fix:** keep `LandNameTransaction` mounted across invalid, ready and pending states. Update its disabled state and label instead of replacing its component tree. Disable the name input during submission so the visible draft cannot drift from the submitted name.

**Verified behavior:** unchanged names are disabled; a valid name enables submission. The exact same transaction component instance survives the first click, simulated wallet rejection, retry and simulated success. Rejection re-enables editing/submission; success reports the correct land/name and closes the dialog after its existing success delay.

## Validation

- `node smoke/gameplay-p1-components-smoke.mjs` — passed in Chromium at 390 × 844 and WebKit at 1440 × 900.
- `npx eslint components/item-details-panel.tsx components/edit-plant-name.tsx components/edit-land-name.tsx components/transactions/swap-plant-name-bundle.tsx smoke/gameplay-p1-components-smoke.mjs` — passed.
- Shared quote-hook changes are owned by the economy fixes; transaction execution/lifecycle checks are owned by the transaction-core fixes. Full repository typecheck and regression integration are reported by the coordinating audit task.

The browser harness bundles the production components, Radix dialogs, React Query hook, approval routing and swap calldata builder. It replaces wallet/context reads, RPC responses and the final transaction transport with controlled boundaries. It performs no network RPC or transaction submission, adds no app route and changes no snapshots. Its minimal CSS supports interaction rather than visual assertions. These are component behavior checks, not physical-device or live-wallet end-to-end tests.

## Files

- [Care details](C:/Users/Goat/Documents/Pixotchi-Eco/components/item-details-panel.tsx)
- [Plant rename](C:/Users/Goat/Documents/Pixotchi-Eco/components/edit-plant-name.tsx)
- [Land rename](C:/Users/Goat/Documents/Pixotchi-Eco/components/edit-land-name.tsx)
- [ETH rename bundle](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/swap-plant-name-bundle.tsx)
- [Behavior regression script](C:/Users/Goat/Documents/Pixotchi-Eco/smoke/gameplay-p1-components-smoke.mjs)
