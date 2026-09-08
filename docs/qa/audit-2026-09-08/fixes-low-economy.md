# Low-priority economy follow-up — 2026-09-08

## TX-13 — Control and responsive layout drift

Revalidated the original transactions audit against the completed medium tree. The marketplace's approval and create controls still forced 40px height; the wallet balance refresh was 32px and its secondary labels were 10px. Mint still used a Solana dropdown and separate review framing while EVM used strain cards. Land price, token, and availability occupied a fixed three-column layout. The Swap fixed-height feedback issue had already been resolved under TX-11; its growing recovery notice was revalidated, without adding a second implementation.

Changes:

- Marketplace primary, approval, refresh, rate helpers, and retry controls now use a minimum 44px target. Transaction labels can grow and wrap, including long values at enlarged text sizes. Staking retry and footer actions follow the same policy.
- BalanceCard uses a 44×44 refresh target and readable 12px secondary labels. Exact quantities remain in the shared amount disclosure; root also raised that disclosure's target to 44px after the actual-style check found 32–40px targets.
- `MintStrainPicker` is shared by Base and Solana. It exposes pressed state and retains inactive, sold-out, Base-only, and pending restrictions. `MintReview` provides the same confirmation hierarchy; wallet-specific execution remains in its original controller.
- Land details wrap as an image and a flexible detail group. When enlarged text leaves insufficient room beside the image, the details move below it. Price and action text can wrap without hiding precision or overflowing. Mint metrics also adapt to available content width.

The changes are presentation-only: quote identity and fresh-price review, selected currency, read readiness, submitted snapshots, receipt reconciliation, and order ownership/cancellation logic are preserved.

## FND-V5 — Calmer economy hierarchy

Applied root's shared roles: `surface-group` for internal selection/review and order sections; `surface-inset` for passive previews and metrics; `surface-panel` for a flat balance boundary and editable swap amount. Removed nested decorative gradients and shadows from economy information wrappers and inactive swap selectors. Pressed selections, focus, primary actions, error states, and task-level Card/TabCard boundaries remain clear. Root owns the shared CSS and resolved the old `surface-inset` name collision.

## Validation

- 21 distinct real-style layout scenarios passed across 320, 820, and 1440px: six existing Swap checks, six real Staking/Marketplace dialog checks, and nine shared Mint checks. Normal and 200% text size are covered. The final Mint suite passed 9/9 after correcting the narrow enlarged-text land layout; the explicit 320px enlarged-text action-reachability check also passed.
- 16 existing economic read and P1 quote/catalog/owned-order scenarios passed on 390px. These cover retained read errors, replacement wallet identity, approvals, cancellation recovery, quote changes before signing, catalog refresh, and older owned orders.
- Scoped ESLint and whitespace checks passed. No new `any` or `UntypedValue` types were introduced.
- Real local-test-wallet screenshots were inspected at 320, 820, and 1440px: `output/p3-economy-mint-*.png` and `output/p3-economy-swap-*.png`. Earlier `output/p2-economy/` captures provide the medium-round visual baseline. The live wallet profile refresh measured 44×44; its screenshot is `output/p3-economy-balances-1440.png`.
- Mocked-read production dialogs and enlarged-text Mint screenshots are under `output/p3-economy-layout-final/`, `output/p3-economy-mint-final/`, and `output/p3-economy-enlarged-final/`. Only I/O and final wallet execution are substituted in dialog checks; compiled app styles and production components are used.

Limitations: browser viewport/text emulation is not physical-device or wallet-vendor coverage. No live transaction was needed for these layout fixes. Shared source edits caused a temporary development error during captures; final screenshots were retaken after recovery. A temporary QA-only BalanceCard mount lacked its required provider; it was removed and the real wallet profile was measured instead. No shared configuration, server lifecycle, deployment, or commit was changed.

## Final real-app Mint status correction

The final real-wallet phone capture exposed a gap in the initial outer-overflow checks: Flora's short `Sold` badge wrapped as `Sol` / `d` inside a narrow strain card. After root's primary matrix finished, applied the separately reviewed presentation patch: raise the strain grid minimum from 6.5rem to 8rem, keep `Sold`/`Base` badge text whole, and let the card image/text wrap with a 4rem text basis when enlarged text leaves insufficient horizontal room. This preserves wallet restrictions, selected state and submission locks, without reducing text size.

The existing normal/200% layout scenarios now await the actual font and measure DOM Range rectangles for all four short status badges across both wallet examples. Each badge must have exactly one text line and remain within its card; button-level overflow alone is insufficient. The existing selection, wallet restriction and pending-lock scenario remains unchanged.

- **42/42 cases passed across all 14 configured projects**, including Chromium 320/390/820/864/1024/1440 in light/dark and WebKit 390-light/1024-dark. Normal and 200% text geometry plus existing interaction checks ran in a separate output configuration with the existing dev server. Results: `output/mint-status-layout-final-results.json`; screenshots: `output/mint-status-layout-final-tests`.
- **Six settled real-app captures passed** at 390/820/1440 and 100%/200% text, using the Local Test Wallet UI. In every capture `Sold` has one line, fits within its card, remains disabled, and the document stays within viewport width. Public geometry and screenshots: `output/playwright/mint-status-final/public-results.json` and `{390,820,1440}-mint-{100,200}pct.png` / corresponding `-strains-` images. The 390px normal screenshot directly verifies the original defect is resolved. At enlarged text, the full picker can extend beyond the viewport; element screenshots can include fixed app chrome, so geometry checks and full viewport captures are recorded together.
- Scoped ESLint passed for the component and test. No transaction, message, server restart, snapshot update or controller change was needed. Source was frozen after these checks.

Related final tab review: `output/final-tab-screenshot-review.md` documents all 18 original tab screenshots and the settled live follow-up. It ruled out the initial missing ETH image/blank chart as persistent issues and identified Activity's missing plant ID separately; the social owner owns that correction.
