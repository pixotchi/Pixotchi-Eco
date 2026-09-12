# Frontend fixes and revalidation — 12 September 2026

Revalidated against `9a48fe7`, then changed the working tree. This follows the [frontend audit](C:/Users/Goat/Documents/Pixotchi-Eco/docs/frontend-audit-2026-09-12.md), independently of the earlier backend audit. F01–F10 have implemented fixes. F11 has an initial extraction in each of the five identified modules; further separation of their orchestration remains incremental work.

## Revalidation and implementation

| Finding | Before | After | Why |
| --- | --- | --- | --- |
| F01 · Dialog overflow | Feedback and Mint Share actions could be outside the dialog; long announcements had the same unbounded structure. | All three use shared body/footer layout with adaptive whole-dialog scrolling. Action labels can wrap. Scroll padding keeps a focused control clear of the edge fade. Mint Share has a dismissal action even without share data. | Short windows and 200% text must preserve readable, reachable actions. |
| F02 · Warning contrast | Fixed amber text bypassed the active palette in Farmer House, item quote errors and building costs. | Those call sites use `--warning-strong`. A representative warning target now participates in the existing eight-palette contrast checks, including rendered surface backgrounds. | The checked warning text meets the suite's 4.5:1 threshold. |
| F03 · Airdrop toolbar | The heading and fixed row of controls overflowed a phone. | The heading stacks and the controls wrap; labels and padding accommodate 320 px and 200% text. | Refresh and Clear Unattempted remain fully accessible. |
| F04 · CSV picker | Load File was a nonfocusable span inside a label. | A real button activates the hidden file input. Reading errors are surfaced and the same file can be selected again. | Enter opens the picker; selecting a fixture CSV populates the textarea. |
| F05 · Lazy dialog recovery | Stake, Chat and Feedback could acknowledge nothing while their first chunk loaded; rejected imports had no local recovery. | A shared retryable dialog shell shows immediate loading, a retry action on failure, and a close control. It preserves the original focus target through handoff and retains loaded dialog state across reopening. | A valid click has visible feedback and a failed load has a recoverable path. |
| F06 · Feedback deadline | An unsettled request could leave Sending disabled indefinitely. | A 15-second AbortController deadline releases the sending state. Unmount aborts the request; duplicate in-flight submissions are gated. The draft remains available with accurate delivery-uncertain copy and no automatic resend. | A lost response is not evidence that the message was never delivered. Late responses cannot erase the retained draft. |
| F07 · Stale visual checks | Revalidation reproduced six failures in 18 dense-surface cases: chat gradient assertions and Barracks references in three contexts. The screenshot loop stopped before checking older Chat/Arcade references. | Two assertions now match the existing flat chat styling. All nine images were individually reviewed and regenerated; the subsequent run without snapshot updating passed. A broader run found and corrected one additional stale header-balance assertion. | Current styles are guarded without introducing a redesign to satisfy outdated tests. |
| F08 · Duplicate card insets | Recovery and several admin cards applied padding at both root and content. | Removed redundant content padding from the named recovery, Broadcast, Chat and AI Chat cards. | The existing Card API owns the inset once. |
| F09 · Admin confirmations | Airdrop/Broadcast used native confirm/prompt in addition to the shared modal. | Clear allocations, delete one broadcast, clean up orphaned dismissal records and delete all broadcast data use the shared confirmation component. Delete-all requires exact `DELETE ALL`; cancellation performs no mutation. | Appearance, keyboard behavior and typed confirmation follow one component. |
| F10 · Casino import graph | Building details synchronously reached all three game dialogs. | Roulette, Blackjack and Baccarat load separately on opening through the retryable shell. Production analysis confirms asynchronous boundaries for all three. | Building selection no longer needs the three game dialogs in its synchronous dependency graph. |
| F11 · Large modules | Presentation, small interaction state and domain execution shared large files. | Extracted transaction controls/context/links, swap token selection, ranking rows, Blackjack state/result presentation and public-chat unread tracking. Public entry-point exports are preserved. | These UI changes have smaller ownership boundaries while existing lifecycle, proof and transport behavior stays covered. |

The enlarged-text pass found two details beyond the initial clipping report: a fixed-height button could remain inside the viewport while its text overflowed, and the scroll fade could cover a focused label. The revised tests check text fit and focused-control geometry, not just the outer dialog box.

Primary implementations: [dialog scrolling](C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/dialog.tsx), [Feedback](C:/Users/Goat/Documents/Pixotchi-Eco/components/feedback-dialog.tsx), [Mint Share](C:/Users/Goat/Documents/Pixotchi-Eco/components/mint-share-modal.tsx), [announcements](C:/Users/Goat/Documents/Pixotchi-Eco/components/broadcast-message-modal.tsx), [retryable dialog](C:/Users/Goat/Documents/Pixotchi-Eco/components/retryable-dialog.tsx), [Airdrop](C:/Users/Goat/Documents/Pixotchi-Eco/components/admin/admin-airdrop-section.tsx), [Broadcast administration](C:/Users/Goat/Documents/Pixotchi-Eco/components/admin/admin-broadcast-section.tsx), and [CasinoPanel](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details/CasinoPanel.tsx).

## Performance and maintainability evidence

`next experimental-analyze --output` succeeded before and after the changes. Walking only synchronous production `app-client` dependencies from `building-details-panel.tsx` found **1,016 modules before and 987 after**. Each of the three casino dialogs changed from synchronously reachable to an asynchronous import from CasinoPanel.

The original dialog source contributions sum to 82,647 uncompressed bytes and 26,540 compressed chunk-part bytes. These figures describe analyzer contributions, not a measured reduction in network transfer: shared modules, chunk assembly and compression affect the actual download. No LCP, INP or physical-device speed improvement is claimed. The useful verified outcome is the new load boundary and immediate loading/recovery UI.

The F11 extractions are deliberately limited:

| Existing module | Approximate lines before → after | New boundary |
| --- | ---: | --- |
| transaction-kit | 2,750 → 2,019 | [Controls](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/transaction-controls.tsx), [context](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/transaction-context.tsx), [explorer links](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/transaction-links.ts) |
| swap panel | 2,032 → 1,918 | [Token selector](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/swap-token-selector.tsx) |
| Blackjack dialog | 1,897 → 1,781 | [State and result presentation](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/blackjack-dialog-state.ts) |
| chat context | 1,757 → 1,722 | [Unread tracking](C:/Users/Goat/Documents/Pixotchi-Eco/hooks/usePublicChatUnread.ts) |
| leaderboard tab | 1,755 → 1,582 | [Ranking rows](C:/Users/Goat/Documents/Pixotchi-Eco/components/leaderboard-ranking-rows.tsx) |

Line counts include blank lines and are only a description of the extraction. The unread badge now derives its count without an extra effect/state update; redundant public-cache version updates were removed because the shared cache version already schedules the same renders. Public/AI composer isolation tests passed. The large transaction, round, quote and authentication controllers remain substantial; F11 should not be interpreted as complete decomposition of those systems.

## Verification

All commands ran locally on Windows. No application changes were committed or deployed.

| Check | Result |
| --- | --- |
| `npm run build` | Passed: production compile, TypeScript and 72 static pages. |
| `npm run typecheck` and `npm run lint` | Passed, including Base RPC checks. |
| `npm run frontend:smoke` and `npm run frontend:types` | Passed; inventory covers 33 production dialog call sites. |
| Transaction infrastructure/feedback, swap, Blackjack, app UI resilience and player-ranking smoke scripts | Passed. Two source-location assertions were moved to the extracted transaction-controls file without changing their required behavior. |
| Ten layout suites, five projects | 390 passed, 20 intentional configuration skips, zero failures. Includes contrast, focus, menus, toasts, dense surfaces, economy dialogs and transaction-button layouts. |
| Six behavior suites, phone Chromium and desktop dark | Initially 156 passed and two instances of the same outdated header-balance assertion failed. The header component was unchanged: it uses a visible token icon and screen-reader identity at all widths. The assertion now verifies both. |
| Targeted audit and Feedback cases, four projects | 44 passed, zero failures. |
| Final scroll/focus/audit/ranking rerun, three projects | 31 passed, eight intentional configuration skips, zero failures. Confirms the final scroll-padding change and the corrected ranking/balance assertion. |

The ten layout suites were `primitives`, `foundation-medium`, `foundation-low`, `focus`, `dense-surfaces`, `economy-layout`, `economy-low-dialog-layout`, `app-toaster`, `wallet-profile-layout`, and `transaction-button-layout`. Projects: `320-light`, `390-light`, `820-light`, `1440-dark`, `webkit-390-light`.

The six behavior suites were `transaction-core-p1`, `controllers`, `social-low`, `social-reliability`, `admin-medium`, and `casino-arcade-low`, on `390-light` and `1440-dark`. The final focused rerun used `320-light`, `1440-dark`, and `webkit-390-light`. Counts are per run and overlap; they are not a count of unique scenarios.

Permanent regression coverage was added to the existing [foundation-low](C:/Users/Goat/Documents/Pixotchi-Eco/tests/frontend/foundation-low.spec.ts), [social-medium](C:/Users/Goat/Documents/Pixotchi-Eco/tests/frontend/social-medium.spec.ts), and [admin-medium](C:/Users/Goat/Documents/Pixotchi-Eco/tests/frontend/admin-medium.spec.ts) suites. The [dialog inventory](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/frontend-dialog-coverage-2026-09-05.csv) now distinguishes these direct cases from shared-primitive coverage.

Direct browser probes also exercised the actual local Feedback dialog, the production Share/announcement components in the guarded QA route, and mocked admin pages. They covered 390×360, 320×568 at 200% text, desktop at 200% text, delayed/rejected dialog loading, closing before completion, retained drafts and focus, keyboard CSV selection, and a real-time 15-second stalled feedback deadline. Feedback and admin writes were intercepted; no public feedback, destructive admin action or on-chain transaction was sent.

Local evidence is under [the audit output directory](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-audit-2026-09-12): `fixes-*.txt`, the four regression JSON reports, `bundle-comparison.json`, browser probe scripts/results, and before/after screenshots. That directory is ignored by Git; the changed regression suites, reviewed image baselines and this record are the persistent handoff.

Remaining verification limits: no physical mobile-device performance profile, live transaction execution, exhaustive screen-reader evaluation, or eight-theme screenshot review of every page. The eight-theme claim applies to the tested semantic-color targets. Further F11 orchestration refactoring should remain backed by the transaction and chat behavior suites.
