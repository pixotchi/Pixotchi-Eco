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

## Combination bets on the table

- Removed the separate combination picker. The same 57 splits, 22 corners, 12 streets and 11 six-line choices are now buttons on the table itself, using the existing canonical combination definitions.
- Splits occupy shared number edges, corners occupy four-number intersections, and streets/six-lines occupy the top edge. Targets use 16px boundary bands; edge segments stop before junction targets. No table width, cell height, grid gap or outer-bet dimension was increased. Number centers remain straight-bet targets.
- Small neutral markers indicate selectable areas; selected targets turn amber. Each target has a descriptive accessible name, keyboard activation, focus ring and disabled state. A brief instruction replaces the picker.
- Eight Chromium/WebKit regression cases checked all 37 straight-number centers, geometric hit testing for all 102 combinations, representative selections and payloads, keyboard selection, selected markers and locked-state disabling. Typecheck, changed-file ESLint and the frontend-quality smoke test passed.
- Read-only live-game fixtures selected Number 23, Split 1–2, Corner 1/2/4/5, Street 4–6 and Six Line 7–12; reviewed at 320, 390, 820 and 1440px. No transaction was submitted, and fixture routes were removed.
- Chromium touch-event simulation dragged across a split target: horizontal scroll moved from 0 to 180px without placing a bet. A subsequent tap selected Split 10–11. This is emulated touch input, not a physical-phone check.

Evidence: `output/roulette-table-*.log`, `output/roulette-combinations-live.log`, `output/roulette-combination-touch.log`, and `output/playwright/frontend-review-2026-09-05/roulette-combinations-*.png`.
