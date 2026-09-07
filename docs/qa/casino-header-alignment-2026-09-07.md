# Casino header and roulette alignment

Compared the casino dialogs with local `main`: the refactor added an opaque, bordered heading row; main kept the title accessible but visually hidden and displayed the game artwork behind the close control.

- The shared `GameDialogHeading` now has a transparent background, no divider and a visually hidden title for Roulette, Blackjack and Baccarat. The close control retains its 44px target, sticky reachability and each game's existing close guards. Its row still keeps the first betting field clear.
- Roulette Total and Max use explicit flex alignment for the label, token icon and amount. Token icons cannot shrink, and long amounts can wrap without overflowing their column.
- Browser-only RPC routing exposed a public land with a built casino to the local test wallet. All transaction/signing RPC methods were blocked; no bet was submitted. Routes were removed after checking.
- Inspected all three real game dialogs at 320, 390, 820 and 1440px. Their header backgrounds were transparent and borders zero. A selected 10 SEED roulette bet showed Total 10 and Max 360; measured vertical centers of the Total label, icon and amount matched, with no overflow.
- Existing Chromium/WebKit tests cover reachable close controls at enlarged text sizes and narrow heights, the transparent game header, and roulette removal controls with long amounts.

Evidence: `output/casino-polish-check.log`, `output/casino-polish-tests.log` and `output/playwright/frontend-review-2026-09-05/casino-polish-*.png`.

## Descriptive bet rows

Straight bets now read `Number 23` for both newly selected bets and restored onchain bets. Each row uses the current betting token's icon next to its amount, including accessible token text. Combination and outside-bet labels are unchanged. The amount still wraps for extreme values and removal controls retain their 44px targets.

Verified the real roulette UI with a selected `Number 23` bet and SEED icon at 320, 390, 820 and 1440px using the same read-only browser fixture. No transaction was submitted. Chromium's long-amount/removal tests passed at three widths. WebKit's first run timed out loading the fixture before reaching the test; its isolated rerun passed. Evidence: `output/casino-bet-description*.log` and `output/playwright/frontend-review-2026-09-05/casino-bet-description-*.png`.
