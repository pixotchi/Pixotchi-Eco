**Pixotchi UI quality fixes — 8 September 2026**

All twelve findings from the [design audit](<C:/Users/Goat/Documents/Pixotchi-Eco/plans/ui-quality-audit-2026-09-08.md>) are implemented. The TradingView lifecycle follow-up and both proposed press-feedback additions are also implemented. Changes are local and uncommitted. The existing `.gitignore` modification was preserved; no dependencies were added.

| Finding | Implemented behavior | Source |
| --- | --- | --- |
| F01 — Modal notification accessibility | One ordinary-toast renderer follows the active dialog feedback host, including nested dialogs. Its lifetime controllers remain mounted when the portal moves. | [AppToaster](<C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/app-toaster.tsx:83>) |
| F02 — Press transitions | Explicit transition lists include Tailwind 4's independent `translate` and `scale` properties. Shared buttons, dialog close controls, wallet copy feedback and Baccarat choices retain immediate keyboard transitions. Map details use `translate` correctly too. | [Button](<C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/button.tsx:27>) |
| F03 — Tablet Mint | Artwork and controls split only when the Plant card itself reaches 38rem. Narrower cards use a compact artwork summary with full-width controls. Resizing preserves selection and mounted controllers. | [Mint layout](<C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/mint-tab.tsx:736>) |
| F04 — Short desktop rail | The desktop navigation scrolls vertically; rows retain their size and the selection indicator stays aligned. Pointer and keyboard navigation reach About at 480px viewport height. | [Desktop rail](<C:/Users/Goat/Documents/Pixotchi-Eco/app/(game)/page.tsx:838>) |
| F05 — Mobile action targets | Tasks, Stake and status Retry retain 44px interactive height below the tablet breakpoint. | [Status actions](<C:/Users/Goat/Documents/Pixotchi-Eco/components/status-bar.tsx:198>) |
| F06 — Pending notification duration | Loading notifications default to infinite duration until their operation updates or dismisses them. Completed results retain finite display windows. | [Toast defaults](<C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/app-toaster.tsx:10>) |
| F07 — Background notification timing | Each notification counts visible display time, pausing for document visibility, hover and focus. Results created or resolved during a pause receive their own full display window. Explicit dismissal still removes persistent custom notifications. | [Toast lifetime](<C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/app-toast-lifetime.tsx:8>) |
| F08 — Building orientation | Mobile/tablet Back to buildings restores the clicked tile's focus and previous scroll position while retaining the selected detail, drafts and transaction controller. | [Building return](<C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/lands-view.tsx:953>) |
| F09 — Map continuity | Bounded detail overlays preserve canvas geometry. Long content scrolls above the zoom controls; dismissing details returns focus to the canvas. Keyboard/reduced-motion navigation is immediate. | [World Map](<C:/Users/Goat/Documents/Pixotchi-Eco/components/map/land-map-modal.tsx:268>) |
| F10 — Admin motion | Notification and airdrop progress reuse the accessible transform-based ProgressBar. Broadcast selectors explicitly transition colors and borders. | [Notifications](<C:/Users/Goat/Documents/Pixotchi-Eco/components/admin/admin-notifications-section.tsx:971>), [airdrop](<C:/Users/Goat/Documents/Pixotchi-Eco/components/admin/admin-airdrop-section.tsx:197>) |
| F11 — Persistent attention | Stake displays a static token pair. Chat briefly highlights newly arrived unread messages, then retains a static unread badge; arrivals during a burst do not extend it indefinitely. | [Stake styling](<C:/Users/Goat/Documents/Pixotchi-Eco/app/styles/status-tokens.css:1>), [chat](<C:/Users/Goat/Documents/Pixotchi-Eco/components/chat/chat-button.tsx:26>) |
| F12 — EFP recovery copy | Errors explain the confirmed or uncertain outcome and the next action, without exposing internal proof/storage terminology. Verification and resend safeguards are unchanged. | [EFP boundary](<C:/Users/Goat/Documents/Pixotchi-Eco/components/efp-transaction-boundary.tsx:421>) |
| TradingView follow-up | An owned iframe document isolates vendor execution so pending scripts and listeners are disposed together on deactivation, unmount or configuration change. Readiness waits for the vendor-created iframe; timeout offers retry. Performance Mode creates no vendor frame or request. | [Chart lifecycle](<C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/TradingViewWidget.tsx:60>) |
| Additional press feedback | Building tiles and Mint strain choices use a restrained 0.985 pointer press scale with the existing 140ms easing. Keyboard remains immediate; reduced/performance modes omit spatial feedback. | [BuildingTile](<C:/Users/Goat/Documents/Pixotchi-Eco/components/building-grid.tsx:27>), [MintStrainPicker](<C:/Users/Goat/Documents/Pixotchi-Eco/components/mint/mint-presentation.tsx:8>) |

**Validation**

114 browser checks passed across the following runs, with traces disabled:

| Run | Passed | Coverage |
| --- | ---: | --- |
| Foundation, focus, dense surfaces | 69 | Chromium phone/light and desktop/dark, WebKit phone/light; eight-theme focus, selection interruption, shared press interpolation/release, reduced motion, dense data and existing screenshot baselines. |
| Ordinary notification regression | 24 | Nested dialogs, host changes without lifetime resets, default loading, hidden promise completion, overlapping pause sources, infinite custom dismissal, position overrides and reduced/performance motion. |
| TradingView lifecycle regression | 12 | Delayed script/frame loading, deactivation/unmount, theme/symbol changes, retry, timeout and Performance Mode. |
| Responsive fixes | 6 | Chromium and WebKit; 320–1440px widths, 480px-high desktop navigation, indicator alignment, touch targets and mounted Mint selection across breakpoints. |
| Real local-wallet land navigation | 3 | Phone 390, tablet 820 and desktop 1440; exact scroll/focus return, retained detail subtree, stable map bounds and reachable controls at 440px height with 200% text. No transaction was submitted. |

Production `npm run build`, full `npm run lint`, `npm run typecheck`, `uiux:smoke`, `app-ui:smoke`, `transaction-feedback:smoke`, and `efp:smoke` passed. The first three stages of `frontend:smoke` (quality, recovery and boundaries) passed. `git diff --check` passed.

The complete `frontend:smoke` command still fails at its inventory stage because HEAD `5ab4214` ("clean up") deleted `docs/qa/frontend-dialog-coverage-2026-09-05.csv`. Its historical inventory also references the deleted `docs/qa/plant-care-purchase-review-2026-09-07.md`. Both files exist in `fc570b2`; an in-memory comparison found 31 inventory rows matching all 31 current DialogContent sites. Those intentional historical-document deletions were left intact. This is a pre-existing QA/CI gate failure, separate from application runtime and these fixes.

Live visual review covered the repaired Mint layout at 320, 390, 820, 864, 1024 and 1440px, light/dark views, and the short desktop rail. A real wallet-copy notification inside Wallet Profile was visible, located within the dialog, and had no `aria-hidden` ancestor. The live TradingView chart rendered, changed interval, resized to mobile and reloaded in dark theme. TradingView's external support-endpoint 403 remains outside this code fix; the chart itself remained usable.

Representative updated views:

- [864px light Mint](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/design-fixes/864-light-mint.png>) and [864px dark Mint](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/design-fixes/864-dark-mint.png>)
- [1440px Mint](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/design-fixes/1440-light-mint.png>) and [480px-high desktop navigation](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/design-fixes/1440x480-navigation.png>)
- [Phone modal notification](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/design-fixes/390-dark-dialog-toast.png>)
- [Phone building return](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/land-navigation-check/land-navigation-land-navig-5b760-rve-the-canvas-and-controls-app-phone-390/building-return-navigation.png>) and [stable map details](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/land-navigation-check/land-navigation-land-navig-5b760-rve-the-canvas-and-controls-app-phone-390/map-anchored-details.png>)

Physical iOS/Android devices, native Mini App wallet switching and a complete screen-reader session remain outside this verification. No deployment or new mainnet transaction was performed in this fix pass. The local verification wallet was disconnected and the review browser was closed.

**Follow-up correction from the user's screenshots**

The original audit missed full token precision in the Casino/Barracks purchase summaries. These panels explicitly requested every token decimal; the casino contract currently returns a cost just below 500,000. This was a display-policy problem, not a reason to change the contract amount.

| Before | After | Why |
| --- | --- | --- |
| `499,999.999999999991611392 pixotchi` | `500,000 PIXOTCHI` | Grouped, concise cost and consistent known ticker casing. |
| `6.18962505334847115 SEED` | `6.18 SEED` | Matches the existing balance policy without overstating spendable funds. |
| `243.81037494665152885` plus repeated Required/Available text | `You need 243.82 SEED more.` | One actionable shortfall, rounded up so the shown amount covers what is missing. |

The shared [cost formatter](<C:/Users/Goat/Documents/Pixotchi-Eco/lib/token-display.ts>) uses bigint arithmetic. [TokenAmount](<C:/Users/Goat/Documents/Pixotchi-Eco/components/ui/token-amount.tsx>) retains exact values in title/accessibility text. Build/training costs, balances, approvals, affordability checks and submitted amounts keep their original precision. Small nonzero amounts remain explicitly below the display threshold instead of appearing as zero. Unknown token branding is preserved.

The same presentation correction covers Barracks training, care/fence catalogue and detail prices, their insufficient-funds notices, and quest reward ranges. Build/balance rows wrap cleanly when there is insufficient horizontal room.

Verified the actual Casino and Barracks panels at 320, 390, 864 and 1440px, plus dark phone views, with no panel overflow. Production build, typecheck, targeted ESLint, frontend quality smoke (including new large/tiny amount and exact affordability cases), quest UI smoke, and balance-consumer smoke passed. The focused production care-catalogue browser check passed in Chromium phone/desktop and WebKit phone (3 cases); the existing building guard suite passed in those same projects (18 cases). No transaction was submitted.

Corrected screenshots: [Casino desktop](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/value-presentation/1440-casino.png>), [Barracks desktop](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/value-presentation/1440-barracks.png>), [320px Casino](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/value-presentation/320-casino.png>), [dark phone Barracks](<C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/value-presentation/390-dark-barracks.png>).
