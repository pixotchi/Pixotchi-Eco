# Economy interaction-boundary regression review — 2026-09-08

Bounded review of the economy presentation diff against HEAD, concentrating on Mint, Swap, Staking and Marketplace plus their shared input/container/selection primitives. The root agent separately owns global CSS, ToggleGroup and broader theme verification.

## Confirmed regression: editable Swap card lost its border

`components/transactions/swap-amount-card.tsx:11` originally assigned the editable branch `surface-panel focus-within:border-primary` without any border width. The prior inline `SWAP_CARD_CLASS` in HEAD's `components/tabs/pixotchi-swap-panel.tsx` explicitly included `border border-border/55`. `surface-panel` in `app/globals.css:803` supplies border color but no width.

A browser check on the real compiled `/qa/economy-layout` route confirmed a 0px solid border before correction. The amount input's own 2px keyboard outline still worked; the missing boundary affected the larger editable card and made its focus border-color rule invisible. The shared editable call at `components/tabs/pixotchi-swap-panel.tsx:1819` serves the custom EVM swap presentation used by regular and smart wallets. The output call at line 1868 is read-only.

Root authorized the narrow correction: add `border` only to the editable branch. The output card retains `surface-inset` and 0px border. No amount sizing, token selection, balance/quote readiness, approval, transaction or recovery logic changed.

The existing `tests/frontend/economy-layout.spec.ts` now checks normal 1px/edge color and focused 1px/primary color, output 0px, and the existing long-value editability, keyboard outline and size/overflow behavior. The QA fixture explicitly applies its project's light/dark class; OS color preference alone does not select this application's class-based theme. Color references use separately pre-styled elements so global color transitions cannot produce an intermediate expected value.

Validation: **5/5 targeted cases passed** on 320-light, 390-dark, 820-dark, 1440-dark and webkit-390-light. Scoped ESLint and whitespace checks passed. Isolated results: `output/economy-boundary-review-results.json`, with artifacts under `output/economy-boundary-review-tests`. No full suite, server restart or snapshot update was performed.

## Other reviewed surfaces

| Surface | Evidence and judgment |
| --- | --- |
| Mint strain selection | `components/mint/mint-presentation.tsx:29` keeps explicit border width, selected border/tint, disabled state and the existing focus treatment. Flattening its surrounding group did not remove the individual control boundary. |
| Mint and Staking metrics | Mint's detail tiles and `components/staking/staking-dialog.tsx:87` are passive readouts. Their quiet inset treatment is intentional. Added metric padding does not inflate an action or obscure an input. |
| Staking amount input | `components/staking/staking-dialog.tsx:577` uses AmountField, whose Input retains explicit `border border-input` and focus ring/border at `components/ui/input.tsx:14`. |
| Marketplace amount/price inputs | `components/transactions/marketplace-dialog.tsx:580` and `:585` use the same bordered AmountField. The surrounding `surface-group` does not share the input node or cancel its border. |
| Marketplace rate rows | `components/transactions/marketplace-dialog.tsx:498`/`:543` retain visible keyboard rings; `:499`/`:544` retain selected backgrounds. These row classes are unchanged by the outer panel flattening. |
| Marketplace sections and preview | The outer panel constant at `:39` and preview at `:595` group information. Existing padded-panel spacing at `:41` remains; no additional blank spacer was introduced by the surface-class substitution. Explicit action buttons remain separate. |
| Swap token selectors | `components/tabs/pixotchi-swap-panel.tsx:174` retains an explicit border, background and focus behavior. Removing their raised shadow did not remove the selection control boundary. |
| StandardContainer variants | `components/ui/pixel-container.tsx:19` retains an explicit border for the default variant. No current call sites select its muted/transparent variants. The interactive plant tiles at `components/tabs/plants-view.tsx:580` and `:597` keep the default border plus their `surface-control` treatment. |
| Secondary action sizing | Reviewed retry/rate/clear actions use the agreed 44px touch floor. No further accidental increase beyond that policy was identified in this presentation diff. |

No additional concrete interaction-boundary regression was established in this bounded economy pass beyond the fixed Swap card and the separately reported ToggleGroup issue. This is not a claim of exhaustive runtime coverage of every wallet, market state, theme or dialog; non-Swap judgments here combine source/diff inspection with the existing audit evidence. Root independently verifies the shared theme/cascade behavior.
