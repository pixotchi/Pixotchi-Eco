# Visual regression follow-up — September 8, 2026

Following the missing segmented-control outline, this focused review compared the accumulated audit changes with HEAD. Two additional regressions were confirmed and corrected.

| Area | Before | After |
| --- | --- | --- |
| Editable Swap amount card | Its surface supplied a border colour but no border width. Browser measurement confirmed 0px; the focus colour change had no visible border to paint. | Explicit 1px border, with the existing primary colour on focus. The read-only output retains its flat treatment. |
| Map artwork failure | Warning and legend occupied overlapping coordinates. At 320px, the warning began at y=129.6 and the legend at y=133.6, both over the canvas. | Warning occupies a separate, bounded scrollable row above the measured map viewport. Legend and zoom controls belong to that viewport. Retry preserves the canvas node and map position. |

Validation:

- Swap: five focused existing browser cases passed at Chromium 320/390/820/1440 and WebKit 390, including visible keyboard focus and long amount editing. Independent computed-style checks covered eight themes at 390 and 1440; normal/focused borders were 1px and the output border remained 0px. Light/dark screenshots were inspected.
- Map: the new full-modal failure case reproduced the collision before the fix. Both existing map smoke runners passed at Chromium 320/820/1440 and WebKit 390. Checks include normal/200% text, warning/legend/control separation, retry reachability, canvas identity and retained position. Chromium also exercises touch scrolling and map gestures. Final 320px screenshots were independently inspected.
- TypeScript, scoped lint, and whitespace checks passed.

The source review also covered shared container/input/menu styles, palette-class renames, theme selection, chat, wallet/profile, mint, staking, marketplace, building/care controls, and map controls. No other concrete regression was established in those reviewed changes. Passive metrics and informational groups intentionally keep their flatter appearance.

This is a focused regression review, not a renewed claim of complete runtime coverage of every game state or physical device. The existing audit acceptance limitations remain applicable. No transactions were submitted, and no changes were committed or pushed.

Evidence: `output/affordance-border-review.log`, `output/economy-boundary-review-results.json`, `output/map-notice-before.log`, `output/map-notice-after.log`, `output/map-notice-medium-regression.log`, and `output/map-artwork-notice-320-{100,200}.png`. These are ignored local QA artifacts. The [economy review](audit-2026-09-08/review-economy-boundary-regressions.md) records additional source evidence.
