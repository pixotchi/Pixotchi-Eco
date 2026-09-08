# High-priority economy fixes — TX-04, TX-05, TX-06, TX-08

Status: all four original findings revalidated in current source and corrected. This report separates browser-tested production hooks/primitives from source-verified application integration. No wallet transaction was submitted while implementing these fixes.

| Finding | Before | After | Why this solution |
| --- | --- | --- | --- |
| TX-04 — ETH quote identity and currency drift | Mint retained an unkeyed prior quote through a 500 ms selection debounce; quote failure rendered SEED actions. | Plant and land mint use the shared quote hook. Eligibility invalidates synchronously for amount or purchase identity changes. ETH controllers remain mounted with disabled empty calls during loading/error; errors offer Retry ETH quote and an explicit Switch to SEED. | Query caching, periodic refresh and cancellation are shared instead of maintaining two independent effects. The selected payment method cannot silently change after a failed read. |
| TX-05 — obsolete selected strain | Catalog refresh replaced the list but retained a selected object with old price/supply. ETH completion used the current selection. | `useMintCatalog` stores the selected ID and derives details from each current catalog. Sold-out/inactive strains cannot submit; a removed selected ID remains unavailable until the player chooses again. Submission copies the selected strain for completion. EVM selection is disabled while the controller is pending. | Selection identity persists without retaining obsolete financial details or announcing the wrong mint result. |
| TX-06 — unreachable marketplace orders | All/Mine stopped at 48 and a price level stopped at 20, with circular overflow guidance. Owned price-level and All rows lacked Cancel. | One production list primitive exposes Load more until every order is reachable. Owned active rows in All, Mine and price levels share the same Cancel renderer and ownership/readiness gates. Cancellation invalidates the old order snapshot immediately. | The initial render stays bounded without hiding valid user assets/actions. Stable bigint IDs are used for keys and sorting without lossy number conversion. |
| TX-08 — repeatable stale batch | Success remounted controllers while the previous executable items remained during delayed scans. | Both cards freeze their submitted subset, retire confirmed identities at `confirmedSyncing`, join receipt-aware building reconciliation and remain gated during incomplete/failed scans. A shared coordinator coalesces refreshes. | The chain receipt and fresh census determine eligibility; a timer or remount no longer resets the safety boundary. Detailed implementation and validation are in [fixes-batches.md](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/fixes-batches.md). |

## Quote pre-submit policy

`useSeedPurchaseQuote.requireCurrentQuote()` refreshes the quote before signing and verifies that the purchase identity, required SEED and displayed ETH amount still match. A failed read, selection change, or changed ETH price stops submission and requires a new review. It never substitutes freshly fetched amounts into already reviewed calldata. The shared transaction controller independently checks for changed calldata/wallet after this asynchronous preflight.

The hook's new fourth `purchaseIdentity` argument is optional, preserving other callers. Mint keys include owner/network and strain. The existing 500 ms debounce, 30-second refresh and focus refetch remain; the final fresh check covers idle quotes. The transaction wrappers forward asynchronous preflight and lifecycle callbacks without creating another execution controller.

## Verification

Passed:

- `npx playwright test tests/frontend/economy-p1.spec.ts --project=390-light --project=1440-dark --project=webkit-390-light --workers=1 --reporter=list --output=output/economy-p1-tests` — **15/15 passed**. Five scenarios on each selected Chromium/WebKit viewport cover changed price and same-price identity invalidation, quote failure/retry, a changed pre-submit market quote requiring another review, catalog supply/price replacement while preserving selection, and reaching/cancelling the oldest of 101 owned orders plus order 21 at one price.
- `npx tsx smoke/balance-mint-read-state-smoke.ts` — passed; its obsolete quote-expression expectations were updated to the new gates.
- `npx tsx smoke/seed-purchase-quote-smoke.ts` — passed; independent constant-product pool calculations still validate tax, slippage, purchase size, rounding and failures.
- Scoped ESLint for mint, quote/catalog hooks, marketplace/dialog list, affected transaction wrappers, fixture and browser tests — passed.
- Batch reconciliation and existing batch quest smoke suites — passed; details in the batch report.

The development-only [economy fixture](C:/Users/Goat/Documents/Pixotchi-Eco/app/qa/economy/economy-fixtures.tsx) executes the real quote hook, catalog hook and marketplace list with deterministic read data. It performs no chain calls or wallet submissions. Its Cancel callback is a test action; the complete production cancellation calldata and authorization gate were verified in source, not sent onchain. The fixture is unavailable in production.

The available audit wallet lacks the fleet/Farmer House and marketplace order volume necessary to reproduce every complete wallet flow live. End-to-end smart-wallet signing, an actual 49+ owned-order cancellation and multi-batch execution are not claimed as live passes. Final whole-repository typecheck and integrated browser/smoke results are owned by the coordinating implementation report.

## Main files

- [Mint tab](C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/mint-tab.tsx)
- [Current catalog selection](C:/Users/Goat/Documents/Pixotchi-Eco/hooks/useMintCatalog.ts)
- [Shared quote controller](C:/Users/Goat/Documents/Pixotchi-Eco/hooks/useSeedPurchaseQuote.ts)
- [Plant ETH bundle](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/swap-mint-bundle.tsx), [land ETH bundle](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/swap-land-mint-bundle.tsx), [approval/action callback forwarding](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/approval-action-transaction.tsx)
- [Marketplace](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/marketplace-dialog.tsx), [complete order list](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/marketplace-order-list.tsx)
- [Browser regressions](C:/Users/Goat/Documents/Pixotchi-Eco/tests/frontend/economy-p1.spec.ts)

React review retained mounted controllers during quote refresh, derived current catalog data instead of duplicate state, used stable keys for incremental rows, preserved accessible disabled/selected states, and kept all deterministic fixture controls outside production routes. No new dependency or application-wide API replacement was introduced.
