# Final Wallet Profile enlarged-text follow-up

## Revalidated failure

The actual-app evidence at `output/header-action-layout-final/header-action-layout-heade-f2916-and-clickable-with-200-text-320-light/performance-mode-200pct.png` showed a nearly zero-height body at 320×844 with 200% root text size. Nonshrinking header/description and pinned footer consumed the modal. The rem-sized close button grew to 88px and overlapped the title; footer labels overflowed their buttons. A successful focus/Space toggle and `toBeInViewport()` did not establish visual usability.

Canonical-CSS component reproduction also exposed an overflowing Get Basename action that caused a hidden account panel to scroll horizontally, Switch track/thumb dimensions scaling independently of its fixed translation, and a wallet balance value column capped at 48% that wrapped PIXOTCHI almost one letter per line.

## Fix and active contract

- `DialogContent adaptiveScroll` is opt-in, currently enabled by Wallet Profile. Header/body/footer remain the same mounted nodes. Normally only `DialogBody` scrolls and the footer remains pinned. When measured chrome leaves less than `min(240px, 40% of the surface height)` for an overflowing body, one outer content scrollport takes over; header/footer scroll with the body, and the body ceases to be a scrollport. The close button stays outside the scroller. Measurement observes the surface and slots, reacts to content changes, and cleans up its observers and animation frame on unmount. Focused content stays in view when the mode changes.
- Adaptive detail dialogs initially focus their close control without scrolling the heading away. An explicit feature autofocus handler takes precedence. Normal nonadaptive dialog autofocus is unchanged.
- Shared close chrome stays 44×44 CSS pixels with a 20px glyph and a fixed 64px header reservation. Text still enlarges and wraps. Shared Switch geometry stays a 44×56 hit area, 48×28 track and 20px thumb; its checked translation stays aligned at 200% text.
- Wallet account rows wrap labels and values, narrow padding leaves room for content, and long supporting text/actions can wrap. Footer actions retain their full labels. No authentication, disconnect, export lifecycle or transaction behavior changed.
- Only the wallet-profile variant of BalanceCard changes: rows can wrap, amounts may use the full row width, icons/padding retain normal pixel metrics, and refresh uses fixed 44px chrome. Monetary formatting and reads remain unchanged.

## Verification

`tests/frontend/wallet-profile-layout.spec.ts` mounts the production WalletProfile, BalanceCard, Dialog, ScrollArea, Switch and amount disclosures with the canonical `app/globals.css`, local Coinbase Sans fonts and public artwork. Only wallet/network/auth boundaries and unrelated closed transaction/airdrop subtrees are controlled. No real wallet credentials, storage inspection, transaction submission, traces or video are involved.

Three cases across 320 light, 390 dark, 820 light, 1440 dark Chromium and 390 light WebKit pass (15 cases): normal/200% text, full text-size round trip, and a 320×420 short viewport. Checks cover five-point pointer hit testing plus Playwright actionability for Performance and footer actions, one scrolling owner, pinned normal footer, full button labels, bounded amount layout, close/title separation, Switch geometry, focus restoration on Escape, and control identity/state retention during reflow. Targeted ESLint and TypeScript checks pass.

An added explicit original-DOM-node identity assertion was subsequently rerun on Chromium 320 and WebKit 390 (2/2), confirming that reflow retains the control itself, beyond the external preference store retaining its checked state. The final independent type-boundary/UTF-8 ratchet also passed.

Final screenshots are in `output/wallet-profile-layout-final/`; the 320px enlarged case directory is `wallet-profile-layout-Wall-b5150-visually-usable-at-200-text-320-light`, containing `header-200pct.png`, `performance-200pct.png`, `balances-200pct.png` and `actions-200pct.png`. Independent read-only Dialog measurement/focus/cleanup review found no blocker. Root owns final real Next acceptance and the integrated suite after source freeze.

The final independent screenshot review found two remaining word-fragmentation details. Wallet row labels now retain their natural case without expanded tracking; the supporting Smart-wallet callout stacks its icon and gives text the full column at widths up to 380px. Nine further normal/enlarged/reflow cases passed at 320/820/1440, and scoped lint passed. Root visually verified the corrected full words in `output/wallet-profile-layout-polish/wallet-profile-layout-Wall-b5150-visually-usable-at-200-text-320-light/performance-200pct.png`. These were two presentation-class changes, with no auth, controller or shared-primitive change.

This is measured browser evidence for these sizes and text settings, not physical-device certification or a claim that every possible nested dialog opts into adaptive scrolling. The opt-in avoids silently changing the scroll/focus contract of unrelated game dialogs.

## Owned files for this follow-up

`components/ui/dialog.tsx`, `components/ui/switch.tsx`, `components/wallet-profile.tsx`, `components/balance-card.tsx`, `tests/frontend/wallet-profile-layout.spec.ts`, `tests/frontend/fixtures/wallet-profile-layout.tsx`, `tests/frontend/fixtures/wallet-profile-layout-mocks.tsx`, and this report. Earlier unrelated uncommitted fixes are preserved.
