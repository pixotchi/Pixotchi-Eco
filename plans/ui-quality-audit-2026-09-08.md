**Pixotchi — codebase, responsive UI, and motion audit**

Follow-up: the user authorized implementation after this audit. All twelve findings and the scoped follow-ups are now addressed; see the [fixes and validation report](<C:/Users/Goat/Documents/Pixotchi-Eco/plans/ui-quality-fixes-2026-09-08.md>). The remainder of this document preserves the original audit findings and evidence.

Audit date: 8 September 2026. Application version 1.8.35; source commit 5ab4214. Application source was left unchanged. The pre-existing .gitignore modification was preserved.

Pixotchi has a coherent visual identity and a substantial foundation for reliable interactions. The most valuable next step is a focused polish pass: correct shared press transitions, repair notification behavior, and refine tablet and short-window layouts. I would withhold motion/design polish sign-off until the confirmed P2 findings below are addressed. No P1 gameplay failure was confirmed in the exercised flows.

**What the application does and how it works**

Pixotchi is a Base-mainnet farming game, delivered as a responsive web application and a Farcaster/Base Mini App. Players own NFT plants and lands, spend SEED and other supported tokens, collect resources, develop buildings, stake, trade, complete tasks, and use social/game features.

| Layer | Responsibilities | Main evidence |
| --- | --- | --- |
| Application shell | Six main tabs: Farm, Mint, Activity, Ranking, Swap, About. Responsive bottom navigation becomes a desktop rail. | [Game page](<C:/Users/Goat/Documents/Pixotchi-Eco/app/(game)/page.tsx:252>) |
| Farm | Plants: care, items, rewards, revive, attacks and arcade. Lands: Village/Town buildings, production, Warehouse, quests, marketplace, casino and barracks. | [Dashboard](<C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/dashboard-tab.tsx:35>), [Lands](<C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/lands-view.tsx:1306>) |
| Wallet and session | Privy, Base Account, host Mini App and local-test authentication; smart-account/paymaster support; optional Solana-to-Base Twin path. | [Providers](<C:/Users/Goat/Documents/Pixotchi-Eco/app/providers.tsx:157>) |
| Data | Viem contract reads, same-origin Base RPC proxy, server provider failover and batching, indexer queries, React Query owner-resource caches and reconciliation. | [Base RPC](<C:/Users/Goat/Documents/Pixotchi-Eco/lib/base-rpc.ts:26>), [Owner queries](<C:/Users/Goat/Documents/Pixotchi-Eco/hooks/useOwnerResourceList.ts:102>) |
| Transactions | Shared lifecycle distinguishes wallet confirmation, submission, syncing, success, revert and unresolved status. Pending records and monitoring survive relevant remount/recovery flows. | [Transaction kit](<C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/transaction-kit.tsx:104>) |
| Server features | API routes support activity, swaps, chat, AI, missions, notifications, claims, admin and health checks. Redis backs stateful services. Neural Seed uses read-only tools; wallet actions stay in the application. | [AI service](<C:/Users/Goat/Documents/Pixotchi-Eco/lib/ai-service.ts:2445>) |
| Runtime/UI stack | Next.js 16.3.4, React 19.2.8, TypeScript, Tailwind 4, Radix, CVA, clsx, next-themes, react-hot-toast; mostly CSS/WAAPI motion and specialized canvas/game effects. | [Package manifest](<C:/Users/Goat/Documents/Pixotchi-Eco/package.json>) |

Visited tabs preserve state with React Activity. Expensive tabs and dialogs load lazily, with retryable loading and selective idle prefetching. Navigation supports browser history and restores per-tab scroll. Owner-resource polling is visibility-aware and transaction completion triggers reconciliation. These are useful foundations for an application players repeatedly revisit.

**Coverage and evidence**

| Area | What was actually checked |
| --- | --- |
| Live local application | Signed in using the actual Local Test Wallet; visited all six tabs at 320, 390, 820, 864, 1024 and 1440 CSS-pixel widths. Light views covered 320/390/820/1024/1440; dark views covered 390/864/1440. |
| Boundary conditions | Inspected 1440×480 short desktop, the 864px tablet breakpoint, and 1024px tablet layout. No horizontal document overflow occurred in the six-tab viewport sweeps. |
| Dialogs and interactions | Actual onboarding, wallet profile at phone/tablet/desktop, staking, tasks, public chat, land building selection, World Map keyboard selection, normal-motion press behavior, Escape dismissal. Public chat was read without sending messages. |
| Real transaction | Collected Solar Panels production for Land #1112. The app showed submission, RPC receipt returned success, stored production reset, Warehouse resources increased, and Farmer's Tasks reflected production completion. |
| Existing automated checks | 66 passed, 0 failed, 0 skipped in 38.6 seconds: foundation-low, focus and dense-surfaces, each in Chromium 390-light, Chromium 1440-dark and WebKit 390-light. Includes screenshot baselines, eight-theme focus, performance mode, short dialogs, selection interruption, reduced motion, long data and recovery states. |
| Isolated component checks | Used the actual AppToaster and Dialog in a browser harness to reproduce inaccessible in-dialog notifications and four-second loading-toast expiry. |
| Other surfaces | Status navigation redirected to the deployed status site, which was inspected at phone and desktop sizes. Admin, casino/arcade and unavailable owned-plant flows also received source review; selected dense surfaces received fixture verification. |

Successful Base transaction: [Solar Panels Collect receipt](https://basescan.org/tx/0x17c83dd9f2ad22212ac00d9e1b1b600c0781cb4cffa36120c5a2cb3d2f3f2376). One transaction was submitted; it consumed normal network gas. The wallet had one land and no plants, so this audit does not claim live coverage of every plant purchase, arcade outcome, casino wager or wallet adapter.

Browser viewport testing is not physical iOS/Android testing. The WebKit checks used desktop automation. No native Farcaster/Base host, hardware keyboard opening, external-wallet app switch, production frame-rate benchmark or complete screen-reader session was performed. Accessibility-tree reproduction is identified separately from physical assistive-technology testing.

**Prioritized findings**

P2 means a concrete usability, accessibility or interaction-quality issue worth addressing in the next polish pass. P3 means narrower polish or resilience work. Rows are ordered roughly by impact relative to effort. Recommended changes have not been applied.

| ID / Priority / Area | Before | After | Why / evidence |
| --- | --- | --- | --- |
| F01 · P2 · Notification accessibility | Ordinary toasts created after a modal opens can sit under an aria-hidden ancestor. [AppToaster](<C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/app-toaster.tsx:8>) is outside the active Radix dialog scope. A real call site is [roulette bet selection](<C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/CasinoDialog.tsx:552>). | Give ordinary notifications a persistent accessible live-region host, or integrate their renderer with the active dialog feedback host. Preserve announcements across nested dialogs. | **Browser harness confirmed:** toast text existed in the DOM, but the accessibility tree exposed no status notification. The custom [transaction toast](<C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/global-transaction-toast.tsx:22>) already handles dialog hosting; ordinary toasts need equivalent treatment. |
| F02 · P2 · Shared motion | [Button](<C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/button.tsx:27>) transitions transform, while active utilities change separate translate and scale properties. Press and release therefore snap. Map panels repeat this at [line 361](<C:/Users/Goat/Documents/Pixotchi-Eco/components/map/land-map-modal.tsx:361>) and [line 412](<C:/Users/Goat/Documents/Pixotchi-Eco/components/map/land-map-modal.tsx:412>). | Include translate and scale in the explicit transition list, or consistently animate the full transform property. Retain the existing motion tokens and instant keyboard handling. | **Live browser confirmed:** pressed wallet button immediately computed translate 0px 1px and scale 0.985, with no translate/scale transition in getAnimations(). This is a Tailwind 4 property mismatch, not a missing animation library. |
| F03 · P2 · Tablet Mint composition | At 864–1024px, the outer Plant/Land split and inner artwork/control split both activate. The controls narrow to roughly 226–262px, pushing the strain picker into one column and stretching a mostly empty artwork stage. [Inner layout](<C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/mint-tab.tsx:746>), [outer layout](<C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/mint-tab.tsx:1188>). | Defer one split until its actual container has enough width. A compact horizontal artwork summary can remain until desktop. Preserve mounted transaction controllers across breakpoint changes. | **Visually confirmed at 864 and 1024:** important mint controls fall far below the initial viewport while artwork consumes a tall empty column. The picker needs 264px for two 128px tracks plus its gap. |
| F04 · P2 · Short desktop navigation | The desktop rail uses six 68px controls plus gaps/padding, without its own scrolling. [Rail](<C:/Users/Goat/Documents/Pixotchi-Eco/app/(game)/page.tsx:838>), [button height](<C:/Users/Goat/Documents/Pixotchi-Eco/app/(game)/page.tsx:343>). | Make the rail vertically scrollable, or compact it for short desktop heights while preserving usable hit areas and focus visibility. | **Live confirmed at 1440×480:** About spans y≈453–521, clipping its label and much of its target. Current short-height rules stop below desktop width. Do not describe it as wholly unclickable: a portion remains visible. |
| F05 · P2 · Phone/tablet targets | Tasks and Stake are 32px tall below 864px. The [shared status override](<C:/Users/Goat/Documents/Pixotchi-Eco/components/status-bar.tsx:198>) also affects Retry when displayed. | Keep at least a 44px interactive box, even if the visible background remains compact. | **Live measured:** 70×32 and 71×32 at 390px; 61×32 and 62×32 at 320px. This is an ergonomics recommendation against the app's own core-control sizing, not a claim that every target below 44px fails WCAG. |
| F06 · P2 · Pending feedback | The [global 4000ms toast duration](<C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/app-toaster.tsx:12>) overrides infinite loading defaults. [Stale-quote refresh](<C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/pixotchi-swap-panel.tsx:1562>) supplies no duration override. | Set loading duration to Infinity centrally; update or dismiss the same ID when the operation settles. | **Browser harness confirmed:** an unresolved loading toast changed to dismissed after four seconds. The existing QA fixture explicitly supplies Infinity and therefore misses the production default. |
| F07 · P2 · Mobile notification lifetime | Ordinary notifications do not pause while the document is hidden. Some game results use ordinary toasts and suppress generic transaction success. [Casino result](<C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/casino-transaction.tsx:166>), [AppToaster](<C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/app-toaster.tsx:6>). | Pause the remaining visible lifetime during backgrounding and retain consequential outcomes inline. Align ordinary notifications with the shared transaction policy. | **Source confirmed; physical wallet-switch scenario not exercised.** The installed library pauses on mouse hover, not visibility. The custom transaction lifecycle already handles visibility changes. |
| F08 · P2 · Mobile building orientation | Selecting a building forcibly focuses and instantly scrolls to details below the grid. [Selection effect](<C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/lands-view.tsx:950>). There is no explicit return-to-buildings control. | Preserve the catalogue position with a mobile review sheet, or provide a clear return control that restores the selected tile. Reuse the existing [care-sheet pattern](<C:/Users/Goat/Documents/Pixotchi-Eco/components/plant-care-layout.tsx:20>). | **Live confirmed at 390px:** the clicked Soil Factory tile moved from y≈637 to y≈−87 after selection. Comparing buildings requires scrolling back. Treat this as a product-navigation refinement, not a reason to add a long scrolling animation. |
| F09 · P3 · Map continuity | Details enter normal flow beside a flexing map, resizing the scene as the panel mounts. [Map layout](<C:/Users/Goat/Documents/Pixotchi-Eco/components/map/land-map-modal.tsx:259>), [panel](<C:/Users/Goat/Documents/Pixotchi-Eco/components/map/land-map-modal.tsx:357>). | Reserve a details region or place an accessible overlay within a stable map viewport. Correct the property mismatch from F02 at the same time. | **Live confirmed:** opening forest details reduced the measured map region height from approximately 606px to 545px. Its spatial frame changes separately from the detail fade. |
| F10 · P3 · Admin rendering | Notification and airdrop progress bars animate width with transition-all. [Notifications](<C:/Users/Goat/Documents/Pixotchi-Eco/components/admin/admin-notifications-section.tsx:971>), [airdrop](<C:/Users/Goat/Documents/Pixotchi-Eco/components/admin/admin-airdrop-section.tsx:197>). | Reuse the existing transform-based [ProgressBar](<C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/progress-bar.tsx:28>); explicitly list properties on nearby selection controls. | **Source confirmed.** Width animation does layout work. No dropped frames were measured; admin exposure is limited, so this is a cleanup item. |
| F11 · P3 · Attention management | The Stake icon alternates indefinitely every 2.8 seconds; unread chat pings for the whole unread period. [Stake icon](<C:/Users/Goat/Documents/Pixotchi-Eco/app/styles/status-tokens.css:61>), [chat badge](<C:/Users/Goat/Documents/Pixotchi-Eco/components/chat/chat-button.tsx:84>). | Keep a static token pair. Briefly signal a newly received message, then retain a static unread badge. | Persistent chrome sits beside balances and transaction decisions. A new event warrants attention; unchanged state does not need an endless animation. Reduced motion is already handled. |
| F12 · P3 · Exceptional-state language | Some EFP errors expose “durable transaction proof” or a “completion marker.” [Proof message](<C:/Users/Goat/Documents/Pixotchi-Eco/components/efp-transaction-boundary.tsx:389>), [marker message](<C:/Users/Goat/Documents/Pixotchi-Eco/components/efp-transaction-boundary.tsx:421>). | Explain the confirmed outcome, uncertainty and available next action. For example, the confirmed-but-local-update-failed case can say: “Your profile update is confirmed. We couldn't finish updating this screen.” Keep proof-missing copy appropriately uncertain. | **Source confirmed.** Players need a next step rather than storage/transaction-infrastructure terminology. Preserve the underlying recovery safeguards. |

The Tailwind diagnosis matches its current [transition-property reference](https://tailwindcss.com/docs/transition-property): transition-transform includes transform, translate, scale and rotate. A custom list containing only transform does not animate changes to the independent properties.

Rapid responsive changes also produced TradingView iframe-teardown warnings and a support-endpoint 403. The chart remained usable. [Embed cleanup](<C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/TradingViewWidget.tsx:105>) can detach its host before a pending vendor script finishes. Record this as a separate P3 integration-resilience follow-up, not a demonstrated broken chart. The initial session-check 401 did not prevent signed login.

**Visual examples**

Tablet Mint at 1024px: stretched artwork and a narrow control column.

![Tablet Mint layout](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/design-audit/1024-light-mint.png)

Short desktop at 1440×480: About is cut off at the bottom of the rail.

![Short desktop rail](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/design-audit/1440x480-navigation.png)

Phone Swap: an example of a clear, well-contained composition worth preserving.

![Phone Swap layout](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/design-audit/390-light-swap.png)

Other useful captures: [390px Mint](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/design-audit/390-light-mint.png>), [864px dark Mint](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/design-audit/864-dark-mint.png>), [dark wallet](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/design-audit/390-dark-wallet.png>), [building selection](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/design-audit/390-building-selection.png>), [map details](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/design-audit/390-map-details.png>), [production after collection](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/design-audit/390-collect-result.png>).

**What already works well**

The pixel artwork establishes a recognizable game identity; typography, tinted surfaces and control styling are consistent across the inspected light and dark views. Phone Swap presents its primary task clearly. Activity and Ranking adapt to available width without document overflow. Wallet, tasks and chat use contained scrolling instead of extending beyond the viewport.

The motion foundation already uses restrained 140/220/280ms tokens and a shared cubic-bezier(0.16,1,0.3,1). Selection indicators retarget their current visual position instead of restarting, and keyboard selection suppresses spatial movement. Radix dialogs/dropdowns provide focus management and appropriate origins. Reduced motion applies before hydration; performance mode and hidden-document guards stop many effects. Roulette, snow and specialized game motion have meaningful cleanup and suppression paths. The real production-collection flow successfully reconciled the resource view and mission completion.

My design judgment is to preserve the playful artwork and strengthen content hierarchy, especially the tablet Mint composition. More animated backgrounds, stronger glass effects or extra celebratory layers would add distraction before solving the current interaction seams.

**New motion worth considering**

Only two additional candidates survived the frequency/purpose/speed/function gate. Both should follow F02 so the shared behavior is correct first.

| Location | Today | Purpose / frequency | Suggested motion |
| --- | --- | --- | --- |
| [BuildingTile](<C:/Users/Goat/Documents/Pixotchi-Eco/components/building-grid.tsx:31>) | Raw tile changes selection after release, with no active press state. | Feedback; tens of uses per day, so barely perceptible. | Pointer press scale 0.985, release scale 1; 140ms cubic-bezier(0.16,1,0.3,1). No input delay or bounce. Reduced motion: omit transform and use 120ms opacity feedback, pressed opacity 0.9. |
| [Mint strain choice](<C:/Users/Goat/Documents/Pixotchi-Eco/components/mint/mint-presentation.tsx:27>) | Selection/hover colors but no immediate active feedback. | Feedback; occasional. | The same shared press recipe, preserving disabled and pending states. Keep keyboard activation immediate and gate any hover motion to fine pointers. |

Vocabulary: **Press / Tap feedback — A subtle scale-down when an element is clicked, so it feels physical.**

Rejected additions: extra main-navigation animation fails the frequency gate; rolling balances/timers move data people are reading; animated activity-row height shifts adjacent records; map inertia is not justified for precise plot selection; additional mint confetti has no demonstrated need beyond the existing success moment. Preserve tabular numbers and the existing rare-success animation budget.

**Requested skills and library decisions**

| Skill | Application to this audit |
| --- | --- |
| emil-design-eng | Component consistency, press response, hierarchy, concrete Before/After review. |
| animate | Timing, property selection, input response, motion purpose and reduced-motion behavior. Applied as audit criteria; no animation implementation requested. |
| animate-expo | Native implementation is not applicable: no React Native/Expo target or dependencies were found. Mobile touch/latency principles informed the web review. |
| review-animations | Existing CSS/WAAPI/game motion review, including the Tailwind property mismatch. |
| improve-animations | Read-only motion inventory, vetting and priority order. |
| find-animation-opportunities | Two restrained feedback opportunities; explicit rejected candidates. |
| animation-vocabulary | Precise naming of press feedback and spatial continuity issues. |
| apple-design | Direct response, continuity, touch sizing, stable scene orientation and interruption. |
| pick-ui-library | Existing dependency fit; avoid churn where the stack already solves the task. |
| ask-sonner | Notification lifetime, hosting, pending/success/error transitions and a single consistent notification policy. The application currently uses react-hot-toast. |

Keep Radix, CVA, clsx and next-themes. CSS and the existing WAAPI controller cover the identified motion fixes; there is no reason to add Motion or GSAP for these changes. Sonner is the curated choice if notification consolidation is undertaken, but the immediate defects can be fixed in the existing system. Preserve the transaction lifecycle regardless of renderer choice. Its [toast API](https://sonner.emilkowal.ski/toast) supports loading/promise/update flows; its [Toaster API](https://sonner.emilkowal.ski/toaster) covers themes, positioning and intentionally targeted multiple hosts. The existing library also supports [type-specific toast options](https://react-hot-toast.com/docs/toaster), so F06 does not require migration.

**Verification and next sequence**

The 66 existing tests passed with tracing disabled and no baseline updates. [Run result](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-responsive-regressions/.last-run.json>). These fixture checks supplement the real wallet walkthrough; they do not establish every production flow.

The repository's viewport matrix defaults primarily to reduced motion, and its existing phone/tablet live-wallet journeys also disable motion. Some focused tests explicitly cover regular animation. Add a small normal-motion phone/tablet journey for the repaired controls, modal notifications and transaction transitions, plus a short-desktop rail case and default loading-toast lifetime case. The existing live-wallet test stops before submission; the single successful production collection in this audit expands evidence for that flow only.

Suggested implementation order: F01/F06 notification correctness and F02 shared transitions; F03/F04/F05 responsive usability; F07/F08 mobile continuity; then the P3 cleanup and two optional press-feedback additions. Keep each change narrow and rerun its relevant existing checks. A final physical-phone pass should cover browser keyboard opening, safe areas, host wallets, background/return notification behavior and gesture responsiveness.

**Motion review verdict: Block polish sign-off pending F02 and the straightforward layout-property cleanup in F10.** Preserve the existing motion system and complete the targeted corrections before expanding animation scope.
