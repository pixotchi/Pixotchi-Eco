# Follow-up review of frontend regressions

Compared the frontend remediation commits with `6f7ddf0`, the version before this change set. This is a targeted regression review, not a claim of complete runtime coverage.

## Additional regressions confirmed and fixed

The new `PlantCareLayout` coupled scrolling and focus to the selected item ID. That introduced two interaction failures:

1. For smart wallets, increasing another item's quantity also selects that item. The effect then scrolled to and focused the review, interrupting further quantity entry.
2. Selecting the same item again did not change its ID, so clicking its tile could not return focus to the review.

The catalog now distinguishes an explicit review request from a quantity edit. Both update the selected item, but only the explicit review request scrolls and focuses the review. Repeated clicks on the same item also work. Two browser tests reproduced the failures before the fix; those tests and the existing catalog test passed in all 14 browser/viewport/theme contexts (42 checks).

## Older issue also fixed

At narrow desktop/tablet Mint widths, the Sold badge competed with the strain name and remaining supply for horizontal space. Flora's label disappeared and the badge overlapped the count at 864px. The same side-by-side markup exists in `6f7ddf0`, so this is not attributed to the remediation.

Sold/Base badges now occupy the secondary line below the strain name. Live checks at 320, 390, 864, 1024 and 1440px showed no badge/name overlap or document overflow. The 390px and 864px screenshots were visually inspected.

## Review and verification performed

- Reviewed changed contract validators, shared card/dialog layout, care and mint interfaces, selected resource controllers, chat history parsing, and swap lifecycle/layout changes.
- Encoded and decoded sample results with the actual app ABIs before passing them to eight Barracks V1/V2 normalizers, the quest-slot parser and the Blackjack snapshot parser. All ten accepted their ABI-decoded sample. This checks the response-shape boundary; it does not exercise every possible game state or chain transaction.
- All ten existing `app-fixes:smoke` suites passed. The production-fixes suite retains its existing missing-Redis diagnostic while using stubs.
- Visited Farm, Mint, Activity, Ranking, Swap and About at 390, 864 and 1440px with the local test wallet. No document horizontal overflow was measured. Inspected selected captures, including the rendered tablet chart; the first mobile Mint capture was still loading, so the later focused Mint check supplies that evidence.
- TypeScript and focused ESLint checks passed after the fixes.
- The suspicious Barracks refresh pattern also exists before the remediation; this pass did not establish a new regression there.

No additional contract-response mismatch was confirmed in the sampled parsers. Third-party chart support requests logged HTTP 403 errors while the chart itself rendered; those errors are not counted as app regressions. Real wallet/provider sheets, every casino commit/reveal/expiry branch, all themes on all physical devices, and all external service failures have not been exhaustively exercised. No transactions, chat messages, push or deployment were submitted during this review.

Ignored local evidence: `output/care-focus-before.log`, `output/care-focus-after.log`, `output/regression-app-smokes.log`, `output/regression-audit-typecheck.log`, `output/regression-audit-lint.log`, `output/regression-mint-lint.log`, `output/audit-live.log`, `output/audit-mint-final.log`, and captures under `output/playwright/frontend-review-2026-09-05/audit-*.png`.
