# Runtime evidence and verification — 8 September 2026

Checkout `2d21280`, app 1.8.35. Existing localhost:3000 development server. No app source edits, production deployment or snapshot acceptance. Browser sessions for this audit are separate from the user's normal browser.

## Automated verification

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed, exit 0. |
| `npm run frontend:smoke` | Passed all four suites: quality, recovery, boundaries and dialog inventory. |
| `npm run frontend:test -- --workers=2 --reporter=list` | **591 passed, 14 failed, 11 skipped**, 616 scheduled contexts, 19.2 minutes; exit 1. |

The scheduled count is 44 test cases × 14 project configurations. The tests visit `/qa/frontend`, not the real game shell. The visual test is intentionally skipped outside its three reviewed Windows contexts. Project defaults use reduced motion, with a specific notification-icon test also exercising normal motion and performance settings. This is not full game-motion validation.

The initial failures were three Barracks screenshot comparisons and eleven WebKit failures. Ten WebKit failures occurred before their named assertion because the fixture readiness marker was not present within five seconds. The same-care-item test failed its first dialog visibility assertion, before exercising reopen. All 14 failed contexts were investigated and rerun serially: ten of eleven behavior contexts passed; roulette reached 20 correct selections before the whole-test timeout. A locale/timezone hydration mismatch affects the fixture; repeated Chromium visual differences are a one-pixel alignment offset. WebKit visual comparison and full roulette coverage remain unresolved. See [test failure analysis](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/test-failure-analysis.md) for exact results and evidence. **The original suite remains red.** Passing individual reruns does not retroactively make it a clean release run.

Original failure artifacts remain in [output/frontend-tests](C:/Users/Goat/Documents/Pixotchi-Eco/output/frontend-tests). Reruns use separate output directories and did not replace or accept baselines. No production build, complete lint run, real-device performance benchmark or accessibility certification was performed in this audit.

## Current runtime coverage

| Area | Inspected in the running app | Important limits |
| --- | --- | --- |
| Main navigation and six tabs | Farm, Mint, Activity, Ranking, Swap and About at 320×568, 820×1180, 1440×900, 844×390; navigation continuity; responsive chrome and density | Initial tab screenshots sample current data, not every filter/outcome. About/320 initial capture hit the developer overlay; use the corrected capture. |
| Wallet and transfer | Account/balances/airdrop display; Performance Mode; NFT picker; self-address draft; one-land review; close/reopen; safe cancellation | No transfer sent; embedded-wallet export, third-party login and batch transfer execution untested. |
| Staking | Stake/Unstake, balance/reward display, empty/invalid draft; full app failure and recovery | No staking mutation submitted; invalid draft reproduced in actual Unstake. |
| Lands | Land #1112; village/town grids; warehouse empty-plant state; production info; map/neighbor detail; unbuilt buildings and batch entry states; mobile/desktop follow-up | One owned land cannot demonstrate multi-land races or all levels/quest/raid/casino states. See gameplay addendum for the exact live matrix. |
| Production transaction | One Solar Panels collection; receipt and warehouse/XP reconciliation | Does not validate every transaction adapter or wallet routing mode. |
| Plants and care | Current zero-plant empty state; care components in existing fixture suite; deep source review | Current demo has no owned plant. No new care/fence/revive/attack/arcade transaction or live-plant browser coverage is claimed. |
| Mint / Swap | Loaded strain catalog, prices, shortage state, SEED/ETH exchange form, market/chart layout | Demo is a regular wallet; stale smart-wallet ETH quote findings are source-derived. No mint or swap submitted. |
| Chat / Neural Seed | Public/AI dialog, missing-session screen, Refresh session attempt and layout at 390px | Local session was unavailable; no public message or AI prompt sent. SDK failure semantics were independently probed without network messaging. This is not proof production authentication fails. |
| Themes | All eight themes selected and visually inspected on About at 390px, with the theme menu open | Not all themes × all dialogs; normal motion and real contrast/transparency preferences need further device checks. |
| Ancillary routes | Separate source and runtime review of login, status, admin gate, missing route and missing share; 11 additional captures | Status redirected to the public deployment, so its runtime results are not attributed to this exact checkout. Authenticated admin workflows and actual valid mint-share result untested. See architecture addendum. |

All main-tab metric captures reported document width within the viewport and no over-wide button/input/tab content under the probe used. This does **not** rule out inner clipping, vertical overflow, bad touch targets, hidden content, tiny typography or game-state-specific overflow; the map and building-grid findings demonstrate the distinction.

## Reproduced defects

### V01 — Unstake input crashes the whole game

1. Open Stake from the header at 390×844.
2. Choose Unstake.
3. Enter `.` into “Amount to unstake (SEED)”.
4. The game becomes “We hit a temporary app error”, with Try again/Go Home; no transaction submission is needed.

[Normal staking dialog](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/staking-390.png), [crash](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/staking-invalid-draft.png). Try again recovered the shell. Source/root cause and proposed fix: TX-01 in [transactions](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/transactions.md).

### V02 — Transfer review count changes after reopening

1. Wallet → Transfer Assets.
2. Enter the connected test wallet's own address, select land #1112 and Continue.
3. Review shows Lands **1 / 1**.
4. Escape, reopen Wallet → Transfer Assets.
5. Confirm Transfer remains, but now says Lands **0 / 1**.

[Before](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/transfer-review-before.png), [reopened](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/transfer-review-reopened.png). The retained nonzero prepared plan/call construction is source-confirmed; the visible count mismatch is live-reproduced. Confirm & Send was never clicked and no transfer transaction was submitted. Back cancelled the prepared plan and returned to an empty selection. See TX-07.

### V03 — Farm forgets Lands on tab return

From Farm select Lands, visit Swap, then return to Farm. Plants is selected instead of Lands. This was reproduced on ordinary web with the Local Test Wallet. ARC-01 traces URL cleanup and context synchronization. This is not the older responsive draft-loss issue; it is current tab-navigation state loss.

### V04 — Performance Mode removes functional focus

Open Wallet Profile, turn Performance Mode on and press Tab to “Refresh balances”. The element is focused, but computed `box-shadow` is `none` and outline is `rgb(16, 84, 158) none 2px`. The variant also suppresses the normal outline. [Screenshot](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/performance-focus.png). Performance Mode was returned to off afterward. See FND-01.

Additional small-screen building/map reproductions are documented in the live addendum to [gameplay](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/gameplay.md), with screenshots under [gameplay-live](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/gameplay-live).

## Authorized transaction

One onchain action was initiated through the real app's **Collect** button for land **#1112, Solar Panels**. It called `villageClaimProduction(1112, 0)` on the land contract `0x3f1f8f0c4be4bceb45e6597afe0de861b8c3278c` with zero native value.

Receipt: **success (`0x1`)**, block **51,020,518**, gas used **115,466**. [Base transaction](https://basescan.org/tx/0xb22a7a2770cc9b94699f7a6419250e72a1b0311c6437a4c2a453f91d9e650546). The receipt was independently fetched through the local RPC proxy and saved as [collection-receipt.json](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/collection-receipt.json).

Before collection the production card showed roughly **1,291.13 stored PTS**, the warehouse **0 PTS**, and land **10 XP**. After confirmation and refresh the warehouse showed **1,291.17 PTS**, land **11 XP**, and stored production **<0.01 PTS**. The small difference between the pre-click production capture and collected amount reflects the later collection time; no exact equality of those separately timed displays is asserted. The app presented “Transaction confirmed / Updating your game…” before the data reconciled.

[Before](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/collect-before.png), [after](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/collect-after.png). No wager, transfer, rename, upgrade, paid mint, swap, public chat, feedback or administrative mutation was submitted by this audit.

## Accessibility sampling

Agent-browser's axe-core 4.12.1 inspected About and Wallet Profile at 390px in Light. About reported two issues: a skipped heading level at “Join our Community” and a horizontally scrollable Token balances group without keyboard access. Both persisted in the settled rerun. Wallet reported zero automatic violations in the inspected state. Both runs left gradient-related contrast checks incomplete; Wallet also had an incomplete ARIA check.

Raw evidence: [About](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/axe-about-390.json), [About settled](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/axe-about-390-settled.json), [Wallet](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/axe-wallet-390.json). Automatic zero-violation results do not certify accessibility, and incomplete contrast checks are not passes. Foundation token-contrast calculations are described separately from rendered-pixel or device evidence.

## Evidence limitations and retained state

- Local test authentication, tutorial dismissal, theme choice and Performance Mode were used for inspection; themes ended on Light and Performance Mode off in the primary audit session.
- Theme choices intentionally keep the menu open. Failed attempts by the capture loop to reopen its hidden trigger are automation mistakes, not app defects; the eight screenshots still show the selected theme and current app surface.
- Screenshots, snapshots, metric probes and receipts are under `output/playwright/audit-2026-09-08`. Not every screenshot represents a unique state, and early development-overlay images are explicitly excluded where relevant.
- The successful collection is the only newly verified full transaction journey. Source findings on advanced games, smart-wallet payment paths, owner races and interrupted recovery require their dedicated scenarios before runtime sign-off.
- No browser-session/private-key export was created for the deliverable. The source inventory and reports do not include environment secret values.
