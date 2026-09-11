# Interface refinement — 12 September 2026

The game header, navigation motion, interaction feedback, numeric typography, loading states and game transaction presentation now share a more restrained interaction system.

## Delivered

- **Header and status bar:** restored the original layout following user review. Balances are visible at a glance, wallet profile is a direct header action, and Tasks/Stake remain on the status row. Background transaction feedback uses the existing toast surface.
- **Motion:** Motion springs use stiffness 380, damping 30 and mass 1. The selection indicator's trailing edge uses a slightly softer spring to stretch during longer moves. Interrupted transitions begin from their current visual bounds. Keyboard selection, reduced motion and Performance Mode settle immediately.
- **Touch navigation:** horizontal swipes switch between the five primary tabs. Axis locking preserves vertical scrolling; controls, game canvases and horizontal scrollers keep their interactions. Boundary gestures resist movement. The outer 24px remain available to browser/OS navigation.
- **Sensory feedback:** persistent, independent opt-in settings for touch feedback and interaction sounds. Light feedback accompanies tab/quantity changes; success haptics require verified confirmation. Quiet synthesized water, mechanical and card sounds avoid an additional media download. Wheel sounds are bounded rather than looping through a long network wait.
- **Typography:** functional asset names, lists and ranking rows use the app's sans face. Numeric displays use tabular figures and tighter spacing. Stored production points roll when their values change; header balances use their original presentation and countdowns remain steady.
- **Loading and detail states:** glass shimmer skeletons reserve space and follow card, list, swap or care layouts. Care reviews open from their source tile. Building details switch immediately without a slide, scale or fade animation; the existing mounted controller and selection are preserved.
- **Transactions:** removed the generic receipt sheet after user review. Game actions open the existing wallet submission flow directly; Blackjack retains its prepare/confirm flow without an additional app dialog. Existing toasts and configured inline feedback provide progress, errors, recovery and completion. Preflight, duplicate-submission locks, durable proof, reconciliation and specialized transfer reviews are preserved.

## Deliberate adaptations

The capsule was removed after user review because it hid balances and buried wallet access. Its plant/transaction stores and glass-sheet styles were removed as well. The remaining transaction and motion improvements are retained.

Paymaster configuration is not proof that a particular wallet route received sponsorship. The removed sheet offered no confirmed fee estimate and added a redundant confirmation before the wallet. Fee confirmation belongs to the wallet; the transaction engine's optional sponsorship request is unchanged.

Wallet signing and biometric verification remain in the wallet. Haptics are feature-detected, opt-in and best effort. Physical haptic quality on supported phones has not been measured in this desktop environment.

Buildings keep their existing in-place detail controller instead of replacing it with a second modal controller. Asset transfer and EFP retain their specialized multi-step reviews and recovery controls; they inherit the common dialog motion but were not replaced with a generic purchase receipt.

## Initial refinement verification

- Production build, TypeScript and repository ESLint/Base RPC checks passed.
- Existing transaction recovery and focus suites: **90 passed** across Chromium and WebKit.
- Updated header, capsule, indicator and ranking regressions: **10 passed** across Chromium and WebKit.
- Isolated browser checks using the real transaction controller with mocked wallet I/O covered review without submission, changed quote acknowledgement, one wallet request, background dismissal/reopening, verified completion, rejection retry review, and account changes.
- Native Chromium touch input covered swiping in both directions, boundary resistance and rejection of vertical gestures. This found and fixed the implicit pointer-capture transfer cancellation bug.
- Real app layout checks covered 320, 390, 820 and 1440px, and 200% text at 390px. Header actions stayed in bounds; wallet content remained scrollable without horizontal overflow; closing restored focus to the capsule.
- Local screenshots and reusable browser check scripts are in `output/playwright/polish-*` and `output/playwright/verify-*.js` (ignored artifacts).

No live wallet transaction was signed or broadcast. The existing localhost chat-session 401 responses remain an environment limitation for authenticated chat checks.

## Header restoration

The original header/status implementation and its regression expectations were restored. Background transaction toasts now reopen the shared receipt instead of relying on the removed capsule. The receipt ignores outside-interaction events from its toast opener so immediately reopening during the exit animation remains reliable. Capsule-specific screenshots above are historical.

- Restored header regression checks: **12 passed** across Chromium and WebKit, including narrow screens, visible balances, wallet access, focus, and 200% text.
- Typecheck and targeted lint passed.
- The isolated receipt check passed review, changed-quote acknowledgement, background dismissal, immediate toast reopening, and confirmation with exactly one mocked wallet request.

## Receipt clarity and alignment (superseded)

Removed the sheet's environment-derived sponsorship flag and corrected its centered header to use equal horizontal padding. The close control no longer shifts the icon, title or description left. Isolated browser checks passed at 320, 390, 820 and 1440px with normal and 200% text, with centered headers and no horizontal overflow. Regular and smart wallet fixtures both defer fee confirmation to the wallet without unverified sponsorship claims. Typecheck and targeted lint passed; no transaction was submitted during this pass.

## Removal of the extra transaction dialog

Removed the sheet, its review metadata, toast reopening action and unused styling. Restored the original direct transaction controls while retaining confirmation haptics and Blackjack card audio. Typecheck and targeted lint passed. Transaction controller regressions passed **74 tests** across Chromium and WebKit. An isolated check using the actual GameTransaction adapter confirmed that one Claim Rewards click makes exactly one mocked wallet request, opens no app dialog, locks the pending button, and shows the completion toast. No live transaction was signed or broadcast.
