# Low-priority frontend remediation — 2026-09-08

**All 33 low-priority finding groups are resolved and revalidated.** The initial audit now has **149 of 150 groups resolved within the recorded verification scope**. ARC-06 remains open for broader seeded real-provider journeys, external-wallet handoff and physical-device acceptance; the initial audit does not yet have complete release clearance.

Thirty-one groups received implementations in this round. G17 and G19 were already addressed in the medium round and were revalidated here. Findings overlap in root cause, so these counts are audit groups rather than independent defects or a percentage of application coverage.

| Category | Original low groups | Detailed revalidation and solution |
| --- | ---: | --- |
| Shared foundation, visual hierarchy and accessibility | 7 | [Foundation](audit-2026-09-08/fixes-low-foundation.md), [Base mark](audit-2026-09-08/fixes-low-base-mark.md), [social presentation](audit-2026-09-08/fixes-low-social.md) |
| Gameplay, maps, care and time | 11 | [Gameplay](audit-2026-09-08/fixes-low-gameplay.md), [maps/time](audit-2026-09-08/fixes-low-maps-time.md) |
| Building panels | 8 | [Building panels](audit-2026-09-08/fixes-low-buildings.md) |
| Economy and transaction presentation | 1 | [Economy](audit-2026-09-08/fixes-low-economy.md) |
| Casino and Arcade | 3 | [Casino/Arcade](audit-2026-09-08/fixes-low-casino-arcade.md) |
| Blackjack and Baccarat | 2 | [Blackjack/Baccarat](audit-2026-09-08/fixes-low-blackjack-baccarat.md) |
| Social infrastructure | 1 | [Social](audit-2026-09-08/fixes-low-social.md) |
| **Total** | **33** | [Exact original finding inventory](audit-2026-09-08/low-findings.json) |

The implementation consolidates typography, panels, dialog APIs, theme metadata, motion geometry, game surfaces, asset fields/pickers, time/resource vocabulary and social data ownership. Existing player artwork and reward mechanisms are retained. New controls expose their state and exact values, and unavailable actions explain the next useful step.

Independent reviews additionally reproduced draft/session races in rename and Warehouse flows, chat send/history ownership errors, stalled/late wallet reconnection, and enlarged-text clipping in header/theme/wallet controls. Those corrections are included in the corresponding domain reports, [auth follow-up](audit-2026-09-08/fixes-final-auth.md), [Wallet Profile layout follow-up](audit-2026-09-08/fixes-final-wallet-layout.md) and [independent gameplay/building review](audit-2026-09-08/cross-review-low-gameplay-buildings.md). The shared [frontend design contract](frontend-design-contract.md) records the component policies to prevent future drift.

## Integrated verification

The [machine-readable verification record](audit-2026-09-08/low-verification.json) contains source hashes, commands, scope, raw artifact paths and retained failed attempts. The primary matrix and subsequent targeted corrections are separate checkpoints; a second complete matrix on the final patched tree was not run.

| Check | Result and scope |
| --- | --- |
| Primary browser matrix | **3,767 passed, 110 intentionally skipped, one failed**, across 3,878 combinations, 29 specification files and 14 projects. The raw run exited 1 and remains recorded that way. |
| Resolution of the matrix failure | The WebKit Base-mark test read SVG fills before React committed an already-fired timer update. Awaiting the visible commit fixes the test; production code is unchanged. **42/42** cases across all 14 projects and **30/30** repeats of the failing case passed, with the exact pause/work-count/unmount assertions retained. |
| Mint final correction | **42/42** focused cases passed across all 14 projects. Six actual-app checks at 390/820/1440px and normal/200% text confirmed whole, contained status badges and no horizontal page overflow. |
| Activity final correction | **112/112** affected checks passed. A subsequent fixture-only type correction passed **28/28** new identity cases across all 14 projects. These counts overlap. Actual settled records at 390/820/1440px had valid IDs in all 138 affected public-feed records, with collapsed and expanded rows inspected. |
| Final real-app journeys | **6/6 passed**: connect/reconnect and signed-out recovery at phone, tablet and desktop widths, real server-accepted Base SIWE sessions, six tabs, explicit app themes, safe staking drafts and cancelled self-transfer review. Zero uncaught page errors. See [the final app report](audit-2026-09-08/verification-final-post-correction-app.md). |
| Domain and smoke gates | High-, medium- and low-priority domain runners, app-fixes smoke and frontend smoke passed at the primary checkpoint; their exercised behavior is unaffected by the subsequent ten changed files. Final Activity and social reliability smoke checks also passed. |
| Static quality | Full lint passed after production corrections; later fixture/smoke edits passed scoped lint. Final TypeScript passed after the build. The type-boundary ceiling remains 611 existing escape hatches across 115 files, without an increase. Strict UTF-8 and introduced-whitespace checks passed. |
| Production build and isolation | Optimized build passed, including TypeScript and all 72 generated pages. The release check confirmed **all seven QA routes return 404**, root returns 200 and production CSP remains intact. |
| Visual references | All nine dense-surface reference images are byte-for-byte unchanged from the medium checkpoint. The three configured Windows baseline cases passed in the primary matrix. |

Chromium configurations cover 320, 390, 820, 864, 1024 and 1440px in light/dark; WebKit covers 390-light and 1024-dark. The 110 skipped combinations are deliberate project restrictions: 88 full-palette focus, 11 palette contrast and 11 dense-baseline cases outside their three representative configurations. Skips are not passes. Enlarged text, selected normal/reduced/performance motion, focus and real-style component geometry have the explicit coverage recorded in the domain reports.

The final source checkpoint is **848 source/config/test files**, SHA-256 `81dabdcaa4098e96aefc965e793efd11ef53d0d01c00940ec3daf7eb7cd3aa8e`, unchanged after the production build. It excludes generated `next-env.d.ts`, documentation, output, temporary/environment files and binary assets. The primary checkpoint was independently preserved before the ten later source/test changes. Local output evidence is ignored by Git; these tracked reports retain the results and their limits.

## Final details caught during integration

Mint's original outer-overflow assertion missed a short `Sold` badge splitting into two lines inside a contained card. The corrected grid lets icon/text reflow and keeps short badges whole. Tests now count the actual text rectangles with loaded fonts, and actual-app screenshots confirm the original phone defect is gone.

Activity's public query omitted `nftId` for Played, ItemConsumed and ShopItemPurchased records, although the personal query requested it. Restoring the fields also prevents distinct same-name/same-time game records from being incorrectly deduplicated. Shared metadata and collapsed/expanded renderers handle genuinely missing IDs neutrally; an absent Attack identity cannot imply a win. A projection regression exercises the real service query, and malformed/known-zero/large-ID cases exercise the production client and renderers. The initial fixture omitted required quantity/map props; correcting those inputs cleared TypeScript and the 28-case rerun.

Settled live checks ruled out the initially absent Swap ETH icon and blank chart as persistent rendering defects. The chart appeared in the inspected screenshots; an automated detector used the wrong iframe host and reached its timeout, so no load-time claim is made. Earlier stale catalog/rename expectations, fixture CSS bundling, Activity smoke assertions and the independent race/observer reproductions remain documented alongside their corrective passes.

The actual-app journeys submitted no paid operation. The three normal journeys recorded no transaction submission methods and each recorded four GET `/api/chat/auth/session` 401 responses; signed-session assertions passed before and after reconnect. Those observations have no phase timestamps. The recovery-only cases do not collect a separate HTTP/RPC-method census. Browser emulation and these bounded real-provider reads do not establish every wallet, contract, native host or physical-device state.

## Initial audit status

The [150-group closure ledger](audit-2026-09-08/audit-closure.json) preserves every original finding ID: 146 groups implemented across the three rounds, three prior-round fixes revalidated, and **ARC-06 partially addressed and open**. Its remaining work includes seeded real-provider mint/care/building/claim/swap/marketplace/transfer/staking/casino/chat and interruption journeys, external wallet/host handoff, and physical-device/assistive-technology acceptance. The [coverage register](audit-2026-09-08/final-coverage-register.md) distinguishes actual app/provider checks, controlled production-code tests, presentation checks and source smoke tests. Viewport and WebKit emulation do not certify physical phones/tablets or native wallet handoff.

No commit, push or deployment is part of this round; the user owns the push.
