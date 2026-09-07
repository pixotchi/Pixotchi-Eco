# Plant-care purchase review

Main used compact image choices with adjacent smart-wallet quantity controls. The current catalog had grown into large effect/price cards, and its selection handler explicitly scrolled to the review below the list. This change uses compact image-led tiles and a purchase dialog on every viewport.

- Item tiles start at 80px and grow together within a row for wrapping names and effects, keeping batch controls aligned. Effects appear above prices in the same muted color, in bold. The purchase review shows the effect for the selected quantity.
- Smart-wallet catalog steppers are 28px, with non-overlapping targets and an item-specific accessible group name. The review keeps 44px quantity controls.
- Selecting an item opens the shared dialog; it does not scroll the catalog. Closing restores focus and the original scroll position. Editing a catalog quantity does not open the dialog.
- A garden item starts at one when explicitly opened from zero quantity. The selected quantity remains shared between the catalog and review.
- The review uses the existing purchase/approval, SEED/ETH/Solana, fence quote, balance, and receipt components. It stays the same mounted dialog across viewport changes. Existing transaction infrastructure owns durable pending purchases.

## Verification

- Existing catalog/care regression tests updated for the dialog interaction: opening, closing, reopening the same item, focus return, scroll preservation, and quantity editing. Checked 320px light, 390px dark, and 1440px dark projects.
- Browser catalog checks covered light/dark themes at 320, 390, 820, and 1440px.
- Full purchase UI checked at 320, 390, 820, and 1440px plus 844 × 390 landscape, with no horizontal overflow and preserved catalog scroll.
- Browser-only RPC fixtures exposed an existing public plant to the local test wallet and simulated smart-wallet detection. Read-only prices and plant data came from the existing RPC path; signing/broadcast requests were blocked in the fixture. All routes were removed afterward. No purchase was submitted.
- Smart-wallet quantities 2–6 updated total cost and effects correctly. Two Water items displayed 51.75 SEED and +24h lifetime. Insufficient-balance behavior remained intact.
- Fence duration input remained visible and retained a two-day draft across resize. Quote loading was sampled; a completed fence purchase was not performed.

Local evidence: `output/care-modal-*.log` and `output/playwright/frontend-review-2026-09-05/care-*.png`.

Final validation: all 12 targeted regression cases, ESLint, typecheck, and production build passed.

## Dialog consistency and keyboard follow-up

- The purchase review uses the shared dialog surface, header, title, close control, scrollable body and focus restoration. Its padding now uses the standard dialog default, replacing the compact override.
- A keyboard simulation exposed a shared positioning bug: at a 390 × 844 layout viewport with only 410px visible, the sheet ended at y=828 and the fence input at y=667. The existing height cap alone did not move the frame above the keyboard.
- Shared dialog frames now use the visual viewport height and vertical offset. A separate visual-viewport scroll listener follows keyboard panning without changing the shell's browser-chrome padding. Pinch zoom remains excluded from layout sizing. Fence labels and duration bounds wrap as groups on narrow screens.
- Browser-only smart-wallet/plant fixtures checked the real fence UI at 320, 390, 820 and 1440px. With a simulated 410px visible height and a subsequent 65px pan, the panel and focused input stayed inside the visible area and retained the two-day draft. Phone inputs used the existing 16px text and numeric keyboard hint. These are simulated keyboard checks, not physical iOS/Android keyboard tests; fence quote completion and transactions remain unverified.
- All catalog items were checked at those four widths in light/dark themes: no tile overflow, effects bold, effect/price colors identical. Examples: Water +12h lifetime; Fertilizer +137.5 PTS; Dream Dew +180 PTS and +2d lifetime.
- Regression coverage includes both bottom-sheet and centered-form positioning during keyboard shrink/pan, other dialog spacing modes, enlarged text, nested dismissal, focus return and catalog interactions in Chromium and WebKit.

Follow-up evidence: `output/care-effects-*.log`, `output/care-keyboard-{before,after}.log`, and `output/playwright/frontend-review-2026-09-05/care-{effects,keyboard}-*.png`.

Follow-up validation: 36 targeted Chromium/WebKit regression cases, ESLint for changed source/tests, typecheck and production build passed.
