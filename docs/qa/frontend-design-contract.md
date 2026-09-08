# Frontend presentation contracts

The page canvas uses `background`. `Card`, `TabCard` and default `StandardContainer` share `surface-panel`: one flat task boundary, canonical `edge-panel`, and card ink. Elevation is explicit through `TabCard` or `Card surface="raised"`. Use `surface-group` for spacing-only groups and `surface-inset` for quiet supporting information. Reserve selected backgrounds and elevation for interactive states. Do not nest raised cards solely to group labels.

Lifted content uses `surface-lifted`, `surface-detail` or `surface-subpanel`. Their contextual ink tokens are intentional: dark-theme ink on these lighter surfaces needs a different contrast pair. Avoid overriding their palette with arbitrary opacity classes.

Interactive boundaries must retain explicit border geometry when surface classes change. `surface-panel` provides border colour, while the control owns its border width; a focus border-colour rule cannot reveal a zero-width border. Segmented controls retain an enclosing outline. Map failure notices reserve space outside the measured canvas viewport so they cannot cover its legend or controls.

Coinbase Sans has three static faces: Regular 400, Medium 500 and Bold 700. `font-semibold` is a compatibility alias for Medium, not a fourth face. Prefer roles: `type-page-title` (24px), `type-dialog-title` (18px), `type-section-title` (16px), `type-label` and `type-body` (14px), `type-secondary` (12px), and `type-numeric` for tabular digits. Sizes use rem and titles have wrapping line height. Pixelmix remains appropriate for game identity, not dense explanatory text.

Dialogs use explicit `center` or `sheet` presentation. `layout="form"` pins `DialogFooter`; form/detail content belongs in one `DialogBody`, and game layout scrolls its surface. `DialogFooter sticky` is the only explicit footer override. `className`/`surfaceStyle` target the visible surface; `frameClassName`/`style` target the viewport frame. The removed `stickyFooter` and `auto` options never implemented distinct behavior.

Long detail dialogs may opt into `adaptiveScroll`, as Wallet Profile does. When the header/footer crowd out an overflowing body, the same mounted content changes to one complete-content scroller; its close control remains outside that scroller. Normal sizing retains the body scroller and pinned footer. Verify focus, state and pointer reachability through enlargement and restoration before opting in another feature.

Icon-only header/close controls retain 44px targets when text grows. `Button size="headerIcon"` keeps its direct glyph at 20px; theme choices use 44px boxes. Switch track, thumb and travel share fixed geometry within a 44px-high target. Text-bearing controls still grow and wrap. A matched-width menu trigger must not scale while pressed: a changing transformed width can destabilize floating-menu measurement. Check enlarged text visually as well as geometrically; whole words and usable text columns matter even when no content clips.

Secondary inline actions preserve the density of their surrounding content. The chat Profile action intentionally uses a 24px-high button beside the sender name; do not apply the 44px header-control sizing rule to it. Keep its visible label, keyboard focus and activation behavior when adjusting size.

Status wrappers forward DOM attributes. Notices/results default to `role="status"` and `aria-live="polite"`; an explicit caller may override these for static descriptions or assertive alerts. Keep the corresponding field `aria-describedby` and message id together. Disabled `Button asChild` blocks activation in the child and wrapper and removes it from sequential focus, while retaining normal Tab exit if programmatically focused.

Tabs and radio groups retain separate ARIA contracts. `useSelectionIndicator` shares measured geometry, resize observation, interruption-safe movement and motion preferences; `getRovingIndex` shares arrow/Home/End geometry. An unknown selected value paints no selected pill. The first option remains a keyboard entry point.

Theme names come from `THEME_NAMES`; palette values live only in CSS. The root `ThemeInitializer` observes the applied theme class and derives browser chrome immediately from its computed background token. Feature styles live in `app/styles`, with shared tokens/primitives in `app/globals.css`; the identity-kit integration uses explicit app-owned classes and one required third-party portal selector. Avoid substring selectors or global element positioning.

Verification is recorded per behavior and environment in the dated audit reports. Browser emulation, controlled adapters and physical wallet hosts are different evidence sources; a passing fixture count is not a claim of universal device coverage.
