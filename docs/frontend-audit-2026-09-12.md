# Pixotchi frontend audit — 12 September 2026

Audited revision: `9a48fe7` (`Polish login panel layout and auth actions`), app version `1.8.35`. This is a new frontend audit, separate from the earlier backend audit and its fixes. No application source was changed during this audit.

**Follow-up:** findings were revalidated and implementation work completed in the working tree. See the [frontend fix record](C:/Users/Goat/Documents/Pixotchi-Eco/docs/frontend-fixes-2026-09-12.md) for changes, regression evidence, and the remaining incremental scope of F11. The observations and line references below describe the original audited revision.

## Assessment

The main game has a coherent visual system: rounded panels, blue interaction accents, restrained surface gradients, Coinbase Sans for interface text, and pixel artwork/type for game identity. The reviewed Farm, Mint, Activity, Ranking, and Swap layouts adapt reasonably across narrow phones, tablets, and desktop. A redesign is not the immediate need.

There are **11 actionable findings: seven P2 issues and four P3 improvements**. The first fixes should restore reachable dialog actions on short screens, correct theme-dependent warning contrast, and repair the Airdrop page's mobile and keyboard controls. Loading/recovery behavior and outdated visual checks follow. No P0/P1 frontend issue was established by the checks performed; this is not a certification of every transaction or device state.

The audit combined a source inventory, targeted code review, real-page browser inspection, component fixtures, and existing regression suites. It inventories 323 frontend-scoped source files, including 229 component files and roughly 64,000 lines, within 712 scanned source files. Inventory coverage does not mean every line or every possible rendered state received manual review.

## What the application does and how it works

Pixotchi is an onchain gardening game on Base. Players connect a wallet, mint plant and land NFTs, care for plants, manage production and quests, interact with other players, and use game currencies and rewards. Land buildings add warehouse, marketplace, staking, Barracks, casino, and other mechanics. The app also includes swaps, rankings, activity history, arcade games, public chat, an AI assistant, tutorials, feedback, and an administrative dashboard.

| Layer | Implementation and role |
| --- | --- |
| Framework and entry | Next.js `16.3.5`, React `19.3.0`, TypeScript and Tailwind 4. [Root layout](C:/Users/Goat/Documents/Pixotchi-Eco/app/layout.tsx:1) supplies fonts, theme initialization, metadata and viewport settings. The game route layout supplies a login fallback while client providers initialize. Installed Next.js documentation was consulted for current component boundaries, lazy loading and fonts. |
| Session and host support | [Providers](C:/Users/Goat/Documents/Pixotchi-Eco/app/providers.tsx:445) coordinate React Query, Wagmi/Privy, smart wallets, balances, themes, chat and game services. The app supports ordinary web use and Farcaster/Base Mini App contexts, with optional Solana bridge flows. |
| Main interface | [Game page](C:/Users/Goat/Documents/Pixotchi-Eco/app/(game)/page.tsx:76) owns tab navigation, wallet entry and responsive shell behavior. Farm, Mint, Activity, Ranking and Swap are primary destinations; About is reachable through Settings. Web navigation synchronizes state with the URL. |
| Feature loading | Tabs use retryable lazy resources, first-visit gates and idle prefetching. React `Activity` retains visited views while suspending hidden effects. [Farm](C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/dashboard-tab.tsx:15) applies a similar boundary between Plants and Lands. |
| Data and actions | Hooks and shared contexts read contract/API state through React Query and Wagmi. Next API routes provide RPC/indexer access and server services such as chat, notifications, missions and claims, with Redis used by several services. Wallet actions pass through shared transaction infrastructure and feature-specific dialogs. |
| Transaction feedback | [Transaction kit](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/transaction-kit.tsx:1) coordinates execution and feedback with shared lifecycle/recovery helpers. Pending, unknown and confirmed outcomes are differentiated; persisted proofs support recovery. This machinery should be preserved when simplifying views. |
| Visual system | [Global styles](C:/Users/Goat/Documents/Pixotchi-Eco/app/globals.css:105), shared buttons/cards/dialogs, semantic colors, typography, radii and motion tokens define most styling. Eight palettes are supported: light, dark, green, yellow, red, pink, blue and violet. |

## Findings at a glance

P2 means a reproducible usability/accessibility defect, a concrete recovery gap, or a regression-check failure worth fixing in normal planned work. P3 means consistency or maintainability work, or a performance opportunity requiring measurement. “After” describes the recommended result, not an implemented change.

| ID / priority | Before | After | Why |
| --- | --- | --- | --- |
| F01 · P2 | Feedback and Mint Share clip actions when the dialog is taller than the available viewport. | Use the shared scroll layout, with whole-content scrolling when necessary. | Essential actions must remain visible and reachable on short screens and with enlarged text. |
| F02 · P2 | Some warning text uses fixed amber shades that fail against theme backgrounds. | Use semantic warning ink and verify the actual background. | Status and recovery instructions become difficult to read in several themes. |
| F03 · P2 | Airdrop header actions extend beyond the phone viewport and are clipped. | Stack the heading and wrap the actions at narrow widths. | A destructive action is partly offscreen at 320 and 390 px. |
| F04 · P2 | Airdrop “Load File” looks like a button but is a nonfocusable span. | Provide a real keyboard-operable file-picker control. | Keyboard users cannot activate the CSV picker. |
| F05 · P2 | First-open lazy dialogs can provide no visible acknowledgement during chunk loading. | Show an immediate loading surface and offer recovery on load failure. | Slow connections make a valid click appear ineffective. |
| F06 · P2 | A stalled feedback request has no application-level deadline or cancellation. | Bound the request and retain the draft with an accurate recoverable status. | “Sending…” can remain disabled while the request never settles. |
| F07 · P2 | Dense-surface checks disagree with current styling and screenshot baselines. | Review the intended design, then align assertions and approved references. | Eight selected browser checks fail; the visual gate is not clean. |
| F08 · P3 | Several cards apply root padding and repeat padding in their content. | Choose one padding owner through the existing Card API. | Equivalent cards have inconsistent 16/32/40 px content insets. |
| F09 · P3 | Airdrop/Broadcast use native confirm/prompt alongside a shared confirmation dialog. | Route equivalent confirmations through the existing component. | Appearance, copy, state handling and maintenance vary across admin sections. |
| F10 · P3 | The building-details import graph includes all casino game dialogs statically. | Split seldom-used game dialogs at their entry points and measure the result. | Opening an unrelated building reaches a broader client module graph than necessary. |
| F11 · P3 | Several large modules combine domain orchestration, presentation and interaction state. | Extract cohesive feature boundaries incrementally. | Small UI changes require navigating and retesting large, coupled files. |

### F01 — Dialog actions are clipped on short screens and with enlarged text

**Evidence: reproduced in the browser using production components.**

[Feedback](C:/Users/Goat/Documents/Pixotchi-Eco/components/feedback-dialog.tsx:99) and [Mint Share](C:/Users/Goat/Documents/Pixotchi-Eco/components/mint-share-modal.tsx:218) place ordinary content inside the default custom dialog layout without a scroll body. The [shared surface](C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/dialog.tsx:333) limits height and uses `overflow-hidden`; adaptive scrolling is opt-in at line 169.

| Case | Visible surface bottom | Action position | Result |
| --- | --- | --- | --- |
| Feedback, 390 × 360, normal text | 342 px | Send Feedback: 400–444 px | Entire action below the clipping edge |
| Feedback, 320 × 568, 200% root text size | 540 px | Send Feedback: 1280–1368 px | Action and substantial form content clipped |
| Mint Share, 390 × 360, normal text | 342 px | Not now: 453–497 px | Dismissal action clipped |
| Mint Share, 320 × 568, 200% root text size | 540 px | Not now: 1129–1217 px | Dismissal action clipped |

Feedback fits at 390 × 844 with normal text. This explains why an ordinary phone screenshot misses the problem. Mint Share also hides the normal close icon; Escape remained available in the fixture, so this is not being reported as an inescapable modal.

Use `layout="form"`/`"detail"` with `DialogBody` and `DialogFooter` where appropriate. Enable adaptive whole-content scrolling when fixed header/footer content would consume the available space. [Broadcast Message](C:/Users/Goat/Documents/Pixotchi-Eco/components/broadcast-message-modal.tsx:131) has the same unscrolled custom-content pattern and should be checked with a long announcement; its failure was not separately reproduced.

Acceptance: open these exact components at 390 × 360 and 320 × 568 with enlarged text; reach every action using both scrolling and keyboard focus. Repeat on a physical phone with the software keyboard open. Increasing the surface's maximum height alone is insufficient.

Evidence: [Feedback screenshot](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-audit-2026-09-12/feedback-390-360-1x.png), [Mint Share screenshot](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-audit-2026-09-12/mint-share-390-360-1x.png), [Feedback measurements](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-audit-2026-09-12/feedback-inspection.txt), [Mint Share measurements](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-audit-2026-09-12/mint-share-inspection.txt).

The enlarged-text probe changes root font size; it is not a physical-device or browser-zoom certification. It nevertheless exposes real content loss relevant to [WCAG's text-resizing requirement](https://www.w3.org/WAI/WCAG22/Understanding/resize-text.html).

### F02 — Hardcoded warning colors bypass theme contrast guarantees

**Evidence: exact source classes measured against their rendered CSS palette values.**

In [FarmerHousePanel](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details/FarmerHousePanel.tsx:225), “Loot bag expired; reset required” uses `text-amber-700`. Another [instruction](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details/FarmerHousePanel.tsx:306) uses `text-amber-800`. Both sit inside the solid `bg-card` quest surface defined at line 35.

| Pair | Measured contrast |
| --- | --- |
| Amber 700 / dark card | 2.80:1 |
| Amber 800 / dark card | 1.98:1 |
| Amber 700 / six colored-theme cards | 4.25:1–4.48:1 |

These small instructions need 4.5:1 under [WCAG normal-text contrast guidance](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html). The measurement used a rendered palette probe with the exact class/background pair, not a live expired quest.

Use the existing semantic warning ink, as nearby quest messages already do, and check all eight palettes. Also review [Solana quote error](C:/Users/Goat/Documents/Pixotchi-Eco/components/item-details-panel.tsx:410) and [building upgrade cost](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-info-dialog.tsx:610) amber utilities. Those are additional candidates; their final composited backgrounds were not measured here, and the Farmer House ratios must not be applied to their gradient surfaces.

Evidence: [palette results and probe](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-audit-2026-09-12/contrast-inspection.txt).

### F03 — Airdrop actions are clipped at mobile widths

**Evidence: reproduced on the actual admin page with mocked API responses.**

The [Airdrop header](C:/Users/Goat/Documents/Pixotchi-Eco/components/admin/admin-airdrop-section.tsx:25) keeps a large heading and both actions on one nonwrapping flex row. At 320 and 390 px viewport widths, “Clear Unattempted” extends to approximately x=497 px. The page clips the excess, leaving the action partly hidden. It fits at 820 and 1440 px.

Stack the heading and action group on phones; allow the group to wrap. Ensure each complete label and hit area remains inside the viewport. A root `scrollWidth <= innerWidth` assertion is insufficient: the root passed this check while a descendant was clipped.

Evidence: [390 px screenshot](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-audit-2026-09-12/admin-airdrop-390.png), [measurements](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-audit-2026-09-12/admin-inspection.txt).

### F04 — CSV “Load File” cannot receive keyboard focus

**Evidence: source and rendered control semantics.**

The [file control](C:/Users/Goat/Documents/Pixotchi-Eco/components/admin/admin-airdrop-section.tsx:133) is a label containing a `display:none` file input and `Button asChild` wrapping a span. The resulting label/span has no keyboard activation or tab stop. Mouse activation works through the label; keyboard activation does not. The browser probe confirmed no focusable input/button in this control at all four inspected widths.

Use a real `type="button"` trigger calling the file input through a ref, or a visually hidden, focusable file input with an appropriate visible focus treatment. Verify Tab → Enter/Space opens the picker and that cancelling leaves focus in a sensible place. No actual file was submitted during this audit.

### F05 — Lazy dialog opening lacks immediate feedback and local recovery

**Evidence: Stake behavior reproduced with delayed chunk responses; related call sites inspected.**

[StakingProvider](C:/Users/Goat/Documents/Pixotchi-Eco/components/staking/staking-provider.tsx:7) loads the dialog through `dynamic` without a loading component. Opening sets `loaded` and `open`, but nothing visible appears while its module is unavailable. On a fresh page, with new chunk responses delayed by four seconds, the 300 ms probe found zero dialogs, no `aria-busy`, and the unchanged “Stake” label. The dialog appeared after loading completed. This is a controlled loading test, not a measured production latency claim.

[ChatButton](C:/Users/Goat/Documents/Pixotchi-Eco/components/chat/chat-button.tsx:12) and [Feedback's lazy import](C:/Users/Goat/Documents/Pixotchi-Eco/components/game-settings-menu.tsx:18) use similar missing-fallback patterns. Their slow-load states were not separately reproduced.

Reuse the existing [wallet-profile loader](C:/Users/Goat/Documents/Pixotchi-Eco/app/(game)/page.tsx:421) and [loading/retry dialog](C:/Users/Goat/Documents/Pixotchi-Eco/app/(game)/page.tsx:864) approach. A persistent shell can acknowledge the click, own focus/close behavior, show loading, and recover from an import failure. Optional pointer/focus prefetching can improve speed but does not replace a visible loading state.

Evidence: [probe result](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-audit-2026-09-12/lazy-dialog-inspection.txt).

### F06 — Feedback has no bounded recovery from a stalled request

**Evidence: source-verified failure path; no feedback message was sent.**

[submitFeedback](C:/Users/Goat/Documents/Pixotchi-Eco/components/feedback-dialog.tsx:65) uses `fetch` without an abort signal or application deadline. `feedbackLoading` resets only once that promise settles. Closing and reopening the mounted dialog does not cancel the request or reset its busy state. If the connection stalls, the UI remains “Sending…” and disabled until the browser/network eventually resolves it.

Add a bounded request lifecycle and accurate error/unknown-delivery copy while preserving the existing draft and dialog-revision protections. A timeout does not prove the server failed to receive a message; do not automatically resend. Verify using an intercepted request that never completes, then a controlled timeout/error and a reopened dialog. Keep the existing protection against clearing a newer draft when an older request completes.

### F07 — The visual regression gate is out of sync

**Evidence: eight failures in the selected browser runs.**

Five failures come from [dense-surfaces.spec.ts](C:/Users/Goat/Documents/Pixotchi-Eco/tests/frontend/dense-surfaces.spec.ts:49) requiring a `linear-gradient` on chat bubbles. The current [bubble component](C:/Users/Goat/Documents/Pixotchi-Eco/components/chat/chat-message-bubble.tsx:25) explicitly uses a flat mixed-color background. A later assertion also expects a gradient on the profile button. This is a concrete test/source disagreement, not evidence that adding gradients is the correct design decision.

Three more failures occur at the Barracks screenshot assertion in [the same suite](C:/Users/Goat/Documents/Pixotchi-Eco/tests/frontend/dense-surfaces.spec.ts:80), in Chromium 390-light/1440-dark and WebKit 390-light. The inspected WebKit diff concentrates around troop labels/numbers and text rendering; the actual image does not establish a new overflow bug. Review those references deliberately before accepting replacements. These tests are included in the frontend quality workflow.

Keep behavioral checks for semantic tables, long values, readable text, focus and action sizing. Align style assertions and screenshot references with the approved current design, then rerun. Do not restore an old look solely to satisfy a stale assertion or bulk-update baselines without inspection.

The [32-dialog coverage inventory](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/frontend-dialog-coverage-2026-09-05.csv:1) explicitly maps many dialogs only to shared primitive tests. That is useful bookkeeping but does not exercise their content layout. Add targeted cases for the F01 production components; the shared tests passed while those call sites clipped.

Evidence: [Chromium report](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-audit-2026-09-12/regressions.json), [tablet/WebKit report](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-audit-2026-09-12/webkit-tablet-regressions.json), [Barracks actual](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-audit-2026-09-12/barracks-webkit-actual.png), [diff](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-audit-2026-09-12/barracks-webkit-diff.png).

### F08 — Card padding still has two owners in several call sites

**Evidence: source-defined spacing.**

[Card](C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/card.tsx:4) explicitly owns padding; its default is `p-4`. Nevertheless, [claim recovery](C:/Users/Goat/Documents/Pixotchi-Eco/components/claim-recovery-card.tsx:16), [Broadcast statistics](C:/Users/Goat/Documents/Pixotchi-Eco/components/admin/admin-broadcast-section.tsx:208), and [AI Chat statistics](C:/Users/Goat/Documents/Pixotchi-Eco/components/admin/admin-ai-chat-section.tsx:176) also add `p-4` to `CardContent`. [Chat statistics](C:/Users/Goat/Documents/Pixotchi-Eco/components/admin/admin-chat-section.tsx:91) add `p-6`.

At the normal 16 px root size, those combinations create 32 or 40 px insets, versus the standard 16 px, excluding borders. The repeated padding also consumes scarce mobile width. Choose root `padding="none"` when children intentionally own spacing, or remove the child inset. Review the named cases visually; do not mechanically remove every `CardContent` padding override, since some may be intentional.

### F09 — Destructive admin confirmations have duplicate UI paths

**Evidence: source-verified inconsistency.**

[Airdrop](C:/Users/Goat/Documents/Pixotchi-Eco/components/admin/admin-airdrop-section.tsx:40) and [Broadcast](C:/Users/Goat/Documents/Pixotchi-Eco/components/admin/admin-broadcast-section.tsx:119) call browser `confirm`; Broadcast's bulk deletion also calls [prompt](C:/Users/Goat/Documents/Pixotchi-Eco/components/admin/admin-broadcast-section.tsx:178). Other admin sections use [AdminConfirmationDialog](C:/Users/Goat/Documents/Pixotchi-Eco/components/admin/admin-confirmation-dialog.tsx:19), which already supports exact-text confirmation.

Use the existing component for equivalent admin actions, keeping the existing confirmation language, matching requirement and mutation guards. Native dialogs are not inherently inaccessible; the issue is inconsistent presentation and duplicated confirmation behavior. No destructive action was executed during inspection.

### F10 — Building selection reaches a broad static import graph

**Evidence: source import graph; production bundle impact is unmeasured.**

[BuildingDetailsPanel](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details-panel.tsx:14) statically imports all specialized panels. [CasinoPanel](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details/CasinoPanel.tsx:41) in turn statically imports Roulette/Casino, Blackjack and Baccarat dialogs. Consequently, the lazy building-details boundary still reaches all three game modules even when another building is selected. Conditional rendering alone does not create a code-splitting boundary.

Start by loading each casino game at its launch point with the visible loading/retry behavior described in F05. Consider separate expensive building-panel boundaries if bundle analysis supports it. Measure production chunks and first building-open responsiveness before and after. No downloaded-byte, LCP or INP saving is claimed from source line counts or development-server behavior.

### F11 — Large feature modules raise the cost of safe UI changes

**Evidence: source structure and measured file size; not a measured rendering defect.**

| Module | Approximate lines | Suggested first boundary |
| --- | ---: | --- |
| [transaction-kit](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/transaction-kit.tsx:1) | 2,751 | Wallet execution adapters and feedback presentation, preserving shared lifecycle/proof invariants |
| [swap panel](C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/pixotchi-swap-panel.tsx:1) | 2,033 | Amount/token form, quote/review state and execution integration |
| [BlackjackDialog](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/BlackjackDialog.tsx:1) | 1,898 | Round state transitions and rendering of hands/actions |
| [chat context](C:/Users/Goat/Documents/Pixotchi-Eco/components/chat/chat-context.tsx:1) | 1,758 | Public-chat session/transport and AI conversation lifecycle, retaining explicit shared identity boundaries |
| [leaderboard tab](C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/leaderboard-tab.tsx:1) | 1,756 | Ranking families and reusable row/read-state presentation |

The problem is mixed responsibilities and broad change impact, not a universal maximum file length. Extract one cohesive boundary when changing that feature, preserve current behavior, and reuse existing regression coverage. Avoid a wholesale rewrite or replacing domain-specific states with an overly generic component. The concrete duplicated UI patterns to address first are F05, F08 and F09.

## Review of the wider visual and interaction system

| Area | Assessment |
| --- | --- |
| Fonts and hierarchy | Local Regular/Medium/Bold font files and centralized type classes are established. The `font-semibold` mapping to Medium is intentional. Pixel typography on names and branding fits the artwork; ordinary controls use the interface font. No new global font-loading or hierarchy defect was established. |
| Colors and gradients | Surface/radius/elevation tokens provide consistent framing. The game’s palette is cohesive in reviewed screens. Fix the specific warning-ink escapes in F02 and the test/design disagreement in F07; there is no evidence that all gradients need replacement. |
| Spacing and density | Most core panels use consistent padding and contained control groups. F03 and F08 are concrete exceptions. At 320 px, the Activity heading's “Last 24h” annotation wraps awkwardly; placing that annotation on its own secondary line is optional polish, not a blocked action. |
| Buttons and touch | Primary shared controls generally provide 44 px targets, names, disabled states and visible focus. Inline secondary actions deliberately use smaller targets in some dense surfaces. Do not classify every sub-44 px control as a WCAG AA failure: the [minimum-target criterion](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html) uses 24 px with exceptions. The CSV control is a real semantic defect. |
| Dialogs and popups | Shared Radix-based semantics, focus restoration, nested Escape behavior, safe-area/viewport handling and optional adaptive scrolling are good foundations. Production callers need to use the scroll contract correctly. Shared tests alone do not validate their content. |
| Toasts and transaction status | Generic `AppToaster` and durable transaction feedback serve different lifecycles; their coexistence is not redundant by itself. Selected tests for toast behavior, dialog-local presentation and transaction buttons passed. Preserve pending/unknown/confirmed distinctions and pause/dismiss behavior during refactors. |
| Navigation and responsive behavior | Primary destinations, responsive bottom/sidebar navigation, keyboard tab navigation and retained view state are established. Main-page screenshots at 320, 820 and 1440 px showed usable layouts. Small header balance areas are intentionally scrollable; partial balance visibility alone is not a clipping defect. |
| Motion and effects | Shared duration/easing tokens, reduced-motion handling, Performance Mode and visibility-aware work already exist. Selected focus/foundation tests exercise relevant modes. A physical low-end-device motion/rendering assessment remains outstanding. |
| Images and rendering | Layered land artwork and some native images have intentional sizing/fallback behavior. There is no basis for recommending a blanket conversion of every image to `next/image`. Production image/network budgets were not measured. |
| Performance | Retryable lazy tabs, idle prefetching with connection constraints, first-visit gates and React Activity already reduce unnecessary active work. F05 is a reproduced perceived-performance problem; F10 is a source-supported splitting opportunity. A large file alone does not establish unnecessary rerenders. |

## Validation and coverage

The running local development server was reused. Actual game pages were inspected using the local test-wallet surface for read-only viewing. Admin Airdrop used mocked auth/API responses. Mint Share used its fixture with a mocked share-creation response. No purchase, transfer, onchain transaction, administrative mutation, feedback submission or paid AI conversation was performed.

| Check | Result |
| --- | --- |
| `npm run typecheck` | Passed |
| `npm run lint` | Passed, including the Base RPC hardening check |
| `npm run frontend:smoke` | All four constituent checks passed |
| 10 selected browser suites × Chromium 320-light, 390-light, 1440-dark | 231 passed, 10 skipped, 5 failed |
| 7 selected browser suites × Chromium 820-light, WebKit 390-light | 121 passed, 10 skipped, 3 failed |
| Combined selected browser checks | **352 passed, 20 skipped, 8 failed; zero reported flaky tests** |
| Direct production-component probes | Confirmed short-dialog clipping, Airdrop mobile clipping, CSV semantics and Stake loading gap |
| Theme color probe | Evaluated four amber shades against all eight rendered card palettes |

The first browser run selected `primitives`, `foundation-medium`, `foundation-low`, `focus`, `dense-surfaces`, `economy-layout`, `economy-low-dialog-layout`, `app-toaster`, `wallet-profile-layout`, and `transaction-button-layout`. The second run selected the first seven. Both used two workers and JSON reporting. The failure breakdown is F07; successful tests should not be read as a pass for unexecuted suites or states. Some shared foundation/focus cases exercise all eight themes; this was not an eight-theme screenshot review of every feature.

Manual page screenshots covered Farm, Mint, Activity, Ranking and Swap at 320, 820 and 1440 px, plus login at 390 px. Existing fixtures supplied additional dense game, wallet, economy, focus and toast coverage. The short-height and enlarged-text probes specifically targeted Feedback and Mint Share. The admin finding is specific to Airdrop; the full authenticated admin workflow was not exercised.

Local SIWE/chat authentication produced localhost-domain errors, so real public-chat session behavior was not certified. Physical iOS/Android keyboards, embedded Farcaster/Base hosts, hardware wallets, every owned-building/game state, assistive-technology reading order and real transaction outcomes remain outside this runtime coverage. No fresh production build, production bundle analysis or Core Web Vitals profile was run; development timings are not production performance evidence.

Logs, probes and screenshots are retained locally in [the evidence directory](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/frontend-audit-2026-09-12). That directory is ignored by Git. This report is saved in the main docs directory so it can be reviewed and committed separately; the evidence remains local unless explicitly added later.

## Suggested implementation order

1. Fix F01–F04 and verify the exact production components at narrow/short sizes, enlarged text and across themes.
2. Fix F05–F06 using the existing loading/retry and draft-preservation patterns.
3. Resolve F07 after reviewing the intended current appearance; include the newly reproduced layouts in targeted regressions.
4. Normalize the named Card and confirmation call sites in F08–F09.
5. Measure and split the F10 import graph. Address F11 incrementally with feature work, preserving existing transaction and recovery contracts.
