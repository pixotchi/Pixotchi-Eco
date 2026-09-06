# Plant-care purchase review

Main used compact image choices with adjacent smart-wallet quantity controls. The current catalog had grown into large effect/price cards, and its selection handler explicitly scrolled to the review below the list. This change uses compact image-led tiles and a purchase dialog on every viewport.

- Item tiles start at 80px and grow together within a row for wrapping names, keeping batch controls aligned. They retain names and prices; detailed effects appear in the purchase review.
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
