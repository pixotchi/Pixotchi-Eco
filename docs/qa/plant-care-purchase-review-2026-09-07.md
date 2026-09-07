# Plant-care purchase review

Main used compact image choices with adjacent smart-wallet quantity controls. The current catalog had grown into large effect/price cards, and its selection handler explicitly scrolled to the review below the list. This change uses compact image-led tiles and a purchase dialog on every viewport.

- Item tiles start at 80px and grow together within a row for wrapping names and effects. Effects appear above prices in the same muted color, in bold. The purchase review shows the effect for the selected quantity.
- Smart-wallet quantities are edited only in the purchase review, using a grouped stepper with 32px buttons and a clearly separated count.
- Selecting an item opens the shared dialog; it does not scroll the catalog. Closing restores focus and the original scroll position.
- A garden item starts at one when explicitly opened from zero quantity. Each item's quantity is retained when closing and reopening its review.
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

## Desktop catalog width follow-up

The living-plant desktop grid retained a 640px care column after purchases moved into dialogs. Capped that column at 420px and the centered pair at 860px; the plant card retains its existing maximum width. Mobile rules and the dead-plant layout are unchanged.

Browser measurements at 1440/1920px: care card width 640 → 420px, height 614 → 602px; four points items fill the row. At 1024px, card width 464 → 420px. Phone 390px and tablet 820px card widths, heights and tile widths match the baseline exactly. No horizontal overflow at any sampled width, and the Water review still opens and closes. Changed-file ESLint passed. Evidence: `output/care-desktop-{before,after}.log`, `output/care-desktop-dialog-check.log` and `output/playwright/frontend-review-2026-09-05/care-desktop-*.png`.

## Popup-only quantity controls

Removed catalog steppers and their unused wallet/quantity props and selection-intent branch. The shared quantity selector now uses one compact design: 32px ghost buttons inside a single bordered group, with a labeled count. The review retains its 1–80 quantity limits and existing transaction/cost calculations; the close button remains 44px.

Twelve fixture checks passed across Chromium 320/390/1440px and WebKit 390px: no catalog quantity buttons, compact popup controls, minimum boundary, keyboard focus, quantities retained per item, reopen behavior, and no card overflow. Typecheck and changed-file ESLint passed. A live smart-wallet read fixture did not load a plant, so no new live cost or transaction validation is claimed. Fixture routes were removed. Evidence: `output/care-popup-quantity-*.log` and `output/playwright/frontend-review-2026-09-05/care-popup-compact-stepper.png`.
