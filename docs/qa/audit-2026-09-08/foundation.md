# Frontend foundation audit — 2026-09-08

Scope: all 36 files directly under `components/ui`, global CSS, font/theme configuration, quantity controls, and the immediately related layout/feedback helpers. This is a current-source audit, supplemented by a live keyboard reproduction supplied by the coordinating audit. No application code was changed. Earlier QA documents were not used as proof of present behavior.

## What the foundation does

The app uses Tailwind v4's CSS-first configuration, CSS custom properties for eight class-selected themes, self-hosted Coinbase Sans and Pixelmix, and small React primitives. Radix owns dialog and dropdown accessibility behavior. The project adds a full-viewport dialog frame around a separately animated panel, visual-viewport sizing, safe-area protection, opener restoration, nested Escape routing, and a portal target for transaction feedback. `ToggleGroup` implements a radio group with roving focus, arrow navigation, and an interruptible Web Animations indicator. `Button`, `AmountField`, `ResourceValue`, and state/result components provide reusable visual conventions. `PerformanceMode` is a module-level external store; CSS removes effects, while expensive canvas/JS animations explicitly observe the setting.

This is an existing design system, not an absence of one. Good current foundations include a mostly 44px button floor, 16px shared fields on phones/coarse pointers, selectable browser zoom, semantic token amounts that avoid floating-point formatting, adequate default dialog close targets, bounded visual-viewport dialog heights, reduced-motion CSS at first paint, origin-aware Radix menu animation, keyboard radio navigation, and responsive input amount sizing. Preserve those improvements.

## Findings

### FND-01 — P1: Performance Mode removes keyboard focus from common controls

**Runtime verified.** `app/globals.css:700–704` applies `box-shadow: none !important` to every element whose class attribute contains `shadow-`. `components/ui/button.tsx:27` removes the native focus outline and supplies a Tailwind ring, which is a box shadow. Most button variants contain shadow classes (`button.tsx:32–54`), including `shadow-none`, so the blanket selector catches them too.

The coordinating audit enabled Performance Mode in Wallet Profile and tabbed to **Refresh balances**. The focused control computed `boxShadow: none` and `outline: rgb(16,84,158) none 2px`. Evidence: `output/playwright/audit-2026-09-08/performance-focus.png`.

**Player impact:** keyboard users lose their position across many primary, outline, navigation, and header controls precisely when choosing the lighter rendering mode. This is functional feedback, not optional decoration.

**Fix:** disable only the elevation token/shadow contribution. Preserve the ring components in Tailwind's composed box shadow, or give controls a separate visible outline in Performance Mode. Do not match arbitrary class substrings. Verify keyboard focus in all eight themes with both settings, including dialog close buttons and selected/unselected tabs.

### FND-02 — P2: The information color still doubles as fill and small text, with insufficient contrast

**Source and token calculation verified; not a rendered-pixel measurement.** `components/ui/badge.tsx:20` puts `--info` text over a 12% tint of the same token. `StatusChip` delegates to Badge (`premium.tsx:13–34`), and the live swap route chip uses `tone="info"` (`components/tabs/pixotchi-swap-panel.tsx:1956`). Other information text uses the same fill token in wallet notices, protection timers, and batch actions.

Calculated contrast for the info badge over the theme's solid `--card` background:

| Theme | Contrast |
| --- | ---: |
| Light | 3.41:1 |
| Dark | 3.81:1 |
| Green | 3.82:1 |
| Yellow | 4.25:1 |
| Red | 4.33:1 |
| Pink | 5.14:1 |
| Blue | 3.88:1 |
| Violet | 4.08:1 |

These are 12px badges, so 4.5:1 is the appropriate ordinary-text target. Gradient and raised surfaces require additional checks. The dark raised-surface correction at `app/globals.css:966–981` adjusts other ink tokens but leaves `--info` unchanged. The dark chain badge also computes only 4.11:1 over a card (`badge.tsx:21`).

**Fix:** introduce explicit information and primary/link ink tokens, following the existing `--success-strong`, `--warning-strong`, and `--destructive-strong` pattern. Test token **pairs and actual surface combinations**, including tinted badges, highlighted menu items, raised panels, and hover states; testing isolated swatches is insufficient.

### FND-03 — P2: Success button text does not meet ordinary-text contrast in six themes

**Source and token calculation verified.** The colorful-theme defaults use `--success: 142 72% 36%` with `--success-foreground: 0 0% 98%` (`app/globals.css:282–284`), a 3.34:1 contrast pair. They are used for real action text in `components/edit-plant-name.tsx:368` and `components/item-details-panel.tsx:602,626`; the follow-button success surface uses them too (`app/globals.css:1491–1500`). The foreground is not restricted to large icons.

**Player impact:** small approval/success action labels become harder to read in Green, Yellow, Red, Pink, Blue, and Violet. Theme choice changes basic legibility.

**Fix:** darken the success fill or choose a dark foreground for those themes. Audit the complete gradient, whose lightened top stop can further reduce contrast. Keep icon and text contrast checks distinct; the toast success icon is not itself proof of a text failure.

### FND-04 — P2: Dropdown lists do not have a safe available-height default

**Source verified; viewport consequences require live confirmation.** `components/ui/dropdown-menu.tsx:32` uses `overflow-hidden` and no maximum height. `matchTriggerWidth` adds only width protection (`:33`). Several consumers add `max-h-60` or `max-h-72` manually; Solana mint strains (`components/tabs/mint-tab.tsx:686–708`) and casino tokens (`components/building-details/CasinoPanel.tsx:586–598`) add none. Even a fixed 240px consumer cap does not account for a shorter available viewport.

**Player impact:** data growth, landscape phones, larger text, and a visible software keyboard can place choices beyond the visible menu. Radix collision placement moves a popover; it does not automatically make an oversized list scrollable.

**Fix:** make the primitive vertically scrollable with `max-height` derived from `--radix-dropdown-menu-content-available-height`, an application menu cap, and a safe gutter. Preserve focus-ring clearance. Default the maximum width as well, not only when matching the trigger. Add searchable selection for large asset lists, while keeping theme swatches as a compact menu.

### FND-05 — P2: The purchase quantity control is an exception to the touch system and scales poorly to its range

**Source verified.** `components/quantity-selector.tsx:32` fixes both controls at 32×32px at every breakpoint; `:48` renders a noneditable output; `:20–29` changes the quantity by exactly one per press. The component supports up to 80 and is used in item purchases (`components/item-details-panel.tsx:415`). The shared button system otherwise targets 44px (`components/ui/button.tsx:65–73`).

**Player impact:** a repeated purchase control has smaller targets than the adjacent actions, and moving from 1 to 80 requires 79 individual increments. This is a comfort/efficiency issue; 32px alone is not a claim that the control violates WCAG's 24px minimum-target criterion.

**Fix:** retain a compact visual stepper if desired, but supply a 44px hit area on coarse pointers. Allow direct integer entry with clamping/blur validation, plus useful presets or a maximum action where the purchase flow supports it. Keep a live quantity announcement and explicit minimum/maximum disabled states.

### FND-06 — P2: A native share-link field bypasses the mobile field-size protection

**Source verified; iOS zoom outcome untested here.** `components/mint-share-modal.tsx:309–315` renders a native input at `text-xs` without the `data-form-control` attribute. The mobile/coarse-pointer 16px override only matches `[data-form-control]` (`app/globals.css:1920–1923`). All normal `Input` and `Textarea` instances opt in automatically.

**Player impact:** this one copy/share field can still trigger iOS focus zoom and a different text/spacing treatment from other fields. Its corner uses `rounded`, unlike the control radius token.

**Fix:** compose the share field from the shared Input, allowing its readonly monospace styling while retaining its sizing/focus contract. Test tap-to-select and copy on an actual iPhone Safari and embedded wallet browser. Do not infer Safari behavior from Chromium mobile emulation.

### FND-07 — P2: Exact token amounts are exposed only through hover-style inspection

**Source verified.** `components/ui/token-amount.tsx:10–15` displays a rounded/compact amount, puts the exact amount in `title`, and applies an `aria-label` to a span. There is no tap or keyboard disclosure. Desktop hover inspection is supplied, but touch players cannot reliably reveal the `title` tooltip. Screen-reader handling of naming a generic span also requires actual assistive-technology testing.

**Player impact:** on mobile, a player can see a compact balance or price but lacks an explicit way to inspect its complete precision. This matters most around fees, maximum amounts, and very small balances.

**Fix:** provide an optional exact-amount disclosure/copy affordance or a visible exact detail row in contexts that need inspection. Keep the current BigInt formatting and nonzero subprecision notation. Do not add a button to every decorative amount; designate the balances and confirmation amounts that need the behavior.

### FND-08 — P2/P3: Scroll fading depends on unrelated DOM mutations and does not reliably register portaled bodies

**Source-conditional finding; not claimed as universally reproduced.** `components/ui/scroll-fade-controller.tsx:65–76` discovers elements with a whole-document query. It runs once at mount, then observes only the content pane when that pane exists (`:89–98`). Dialog bodies are portaled outside that pane (`components/ui/dialog.tsx:162,342`). Opening such a dialog after the content-pane observer is installed does not by itself trigger registration; a later page mutation or window resize does. If the controller initially falls back to observing `document.body`, that specific gap does not occur. The branch taken depends on startup rendering.

The controller also observes the scroll container's box size, not descendants' sizes, and the mutation observer ignores text/attribute changes. An image/font expansion or text update can change scrollHeight without resizing the scrollport or adding/removing a child.

**Player impact:** hints that more content exists can appear late, disappear inconsistently, or depend on resizing. This is mostly polish, but it matters when important content extends below the visible body.

**Fix:** use a ref-owned scroll-area component/hook that registers when its actual scrollport mounts, watches the relevant content size, and updates from that scrollport. Reuse it for DialogBody and main panels. Avoid a global scan after every subtree mutation.

### FND-09 — P3: Dialog's public API has misleading and inert options

**Source verified.** `stickyFooter` is accepted (`components/ui/dialog.tsx:106`), defaults false (`:122`), and only sets `data-sticky-footer` (`:174`). No production stylesheet or consumer reads that attribute. The sole production caller is `components/transactions/CasinoDialog.tsx:842`. Actual footer stickiness is independently decided by `DialogFooter`'s own `sticky` argument or `layout === "form"` (`dialog.tsx:321–328`). Similarly, `mobileMode="auto"` follows exactly the same branches as `"center"`; no automatic adaptation exists (`:183,249–251`).

**Maintainer impact:** the type-safe API appears to guarantee behaviors it does not implement, inviting silent regressions. This is not proof the current casino footer is visibly broken; it can be positioned by other layout styles.

**Fix:** remove/deprecate inert arguments or wire them into a single layout contract. Prefer explicit detail, form, and game compositions with one scroll owner and an intentional footer policy. Supply separate frame and surface props if custom consumers need to style both.

### FND-10 — P3: Small wrapper components advertise DOM props that are silently discarded

**Source verified.** `StatusChip`, `InlineBalanceNotice`, `DisabledReason`, and `RewardResultPanel` extend `React.HTMLAttributes` but destructure only their own small prop set, with no `...rest` forwarding (`components/ui/premium.tsx:21–35,38–60,63–81,84–107`). A caller can type-check `id`, `aria-describedby`, `aria-label`, or an event handler and receive no corresponding DOM behavior. Current production callsites mostly pass children/className, so this is a proven API defect rather than a claim of a currently broken event.

**Fix:** forward compatible DOM attributes, or narrow the prop type to the truly supported surface. Preserve deliberate live-region semantics, allowing an explicit documented override when justified. The same review should cover Button's `asChild` contract: it exposes `aria-disabled` but does not prevent keyboard activation (`button.tsx:111–125`); no existing dangerous disabled-link caller was found.

### FND-11 — P3: Theme metadata, font hierarchy, and component styles still have multiple ownership points

**Source verified.** Theme names occur in `lib/theme-utils.ts`, `components/server-theme-provider.tsx`, `app/core-providers.tsx`, `app/providers.tsx`, and the selector's own array. Theme background HSL values are deliberately copied into `lib/theme-utils.ts:22–31`; updates require palette/meta synchronization. `ThemeInitializer` waits 450ms before updating browser chrome (`components/theme-initializer.tsx:12,31–34`), while ordinary body transitions are 220ms (`globals.css:96–99,592–594`). A late browser-chrome color change is therefore expected after a theme selection, though its visual prominence depends on browser.

`app/fonts.ts` explicitly maps both 500 and 600 to the same static Medium font. This restores a distinction from Bold, but `font-medium` versus `font-semibold` remains naming-only, not a visual weight distinction. `CardTitle` uses 16px/line-height 1 (`components/ui/card.tsx:76`) while `DialogTitle` uses 18px/line-height 1 and tighter tracking (`dialog.tsx:355`), with headings overridden ad hoc in features. There is no exported role-based typography scale.

**Fix:** export one theme list and generate/derive meta colors from the authoritative palette. Synchronize browser chrome intentionally with theme application. Define a small typography-role contract (screen title, panel title, field label, body, secondary, numeric value) using the actual three available sans weights; prefer honest roles over pretending to have a fourth face. Preserve Pixelmix for the game identity where legible.

### FND-12 — P3: The remaining design-system escape hatches make future drift likely

**Source verified; design assessment.** `StandardContainer` (`components/ui/pixel-container.tsx:18–19`) uses `border-border/60` and a secondary gradient; Card (`components/ui/card.tsx:19–20`) uses `--edge-panel` and a flat card surface. Dialog surfaces use `border-border/65` (`dialog.tsx:86–89`) despite canonical edge tokens. The global stylesheet owns feature selectors, generic header positioning, follow-button substring matching, nested surface token overrides, login layout, transaction geometry, and game animation in one file (`app/globals.css:1330–1339,1436–1541,1799–1895`). Some are necessary integrations, but they share a broad global cascade.

`ToggleGroup` and page-local `SlidingNavTabs` separately implement measurement, resize observation, selection focus, Home/End/arrow navigation, and indicator state (`components/ui/toggle-group.tsx:95–242`; `app/(game)/page.tsx:462–546`). Their ARIA roles legitimately differ, so merging them into one “toggle” is not the right abstraction. Their shared measurement/motion machinery can still be extracted.

Both BASE logo files also duplicate the same color palette, four SVG paths, media-query listener lifecycle, and color timer behavior (`BaseAnimatedLogo.tsx`, `BaseExpandedLoadingLogo.tsx`). Their timer loops do not suspend on page visibility, unlike SnowEffect and the roulette wheel.

**Fix:** establish surface roles and implement reusable semantic variants; isolate feature CSS to feature styles; replace broad global substring selectors with integration-owned classes; extract reusable indicator geometry and a single decorative BaseMark. Keep tabs and radio semantics separate. Pause decorative JS work when the document is hidden.

## Additional polish/robustness observations

- `WalletAvatar` chooses its fallback only when the avatar URL is absent (`components/ui/wallet-avatar.tsx:67–82`); a present URL that fails to load has no `onError` fallback. Use the generated avatar after load failure. Actual broken remote URLs were not exercised.
- `ToggleGroup` falls back to option index zero for geometry/tab order when its `value` is not in `options`, while every option reports unchecked (`toggle-group.tsx:73,269,275`). Add a deliberate invalid/no-selection policy instead of painting an apparently selected first pill. No failing production value was identified in this scoped pass.
- The global reduced-motion policy stops spatial CSS motion, and relevant JS components listen to the preference. There are no dedicated `prefers-contrast`, forced-colors, or reduced-transparency treatments in the shared CSS; these need an actual OS/browser pass, especially for thin tinted borders, input states, and low-opacity selected surfaces.
- `AppToaster` and the separate transaction feedback system have different geometry/visual contracts. The toaster sits top-center with a four-second default, while transaction feedback defaults to a bottom-right position from 1024px (`app/globals.css:1879`) even though desktop navigation changes at 1280px. This merits explicit cross-system positioning and collision testing at 1024–1279px. Do not assume a collision occurred merely from the source.
- No screen-reader announcement failure is asserted for toast content: the installed `aria-hidden` package explicitly preserves existing `[aria-live]` regions. Creation of the first toast while a modal is already open still warrants a runtime check, because the toast host's ancestry may already have been hidden.
- The shared heading line-height of 1 is unusually tight for titles that wrap under larger text settings. Confirm two-line titles and translated/long player names before changing spacing globally.

## Independent screenshot review

The following observations come from directly viewing all ten coordinated captures: `Mint`, `Swap`, `Activity`, `Ranking`, and `Farm`, each at 320×568 and 820×1180. They are visual observations/design judgments about those captured states, not proof of every state of the features. Next.js development badges visible in the bottom corner are development tooling and are excluded from the product-design verdict.

### FND-V1 — P2: Tablet portrait retains a phone-width content column

**Runtime screenshot verified.** Across all five 820px captures, the connected shell is approximately 448px wide, leaving roughly 186px unused on each side. Source explains it: `app/globals.css:1080–1092` keeps the shell at 28rem until 54rem/864px. The narrowness is especially costly in Mint, where confirmation is pushed to the bottom, and Ranking/Activity, where names and event sentences must wrap while the surrounding canvas is empty.

**Proposal:** introduce a real tablet portrait composition at 768px or use a fluid content width before the two-column gate. A 600–700px single column can preserve reading comfort while freeing names and actions; switch to two columns only when each column remains useful. Do not just enlarge every element. The empty Farm state can remain comfortably narrow within the wider shell.

Evidence: [Mint at 820px](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/Mint-820.png), [Ranking at 820px](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/Ranking-820.png), [Activity at 820px](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/Activity-820.png).

### FND-V2 — P2: Empty Farm gives an instruction without a path to perform it

**Runtime screenshot verified.** Both empty-Farm captures show “No Plants Yet!” and “Choose a strain and review its cost to begin.” There is no action beside that explanation. The player must infer that a different navigation tab contains strains. The 820px view devotes almost its whole content area to that passive state. `EmptyState` supports an action slot (`components/ui/empty-state.tsx:29,42`), so the foundation already has most of what is needed.

**Proposal:** make the first step explicit with **Choose your first plant**, opening Mint with the current context. A secondary short explanation can state the cost/resource requirement. Keep the illustration compact and brand-specific. Centering an empty state is fine; leaving the next step unactionable is the gap.

Evidence: [Farm at 320px](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/Farm-320.png), [Farm at 820px](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/Farm-820.png).

### FND-V3 — P2 design judgment: The verification promotion overwhelms Mint's primary task

**Runtime screenshot verified.** The 320px Mint screen devotes about 194px to a saturated blue/purple claim banner, with a lime decorative ribbon/star and dark gradient button, before the first Mint panel. No strain or mint price is visible in that first viewport. The banner also crosses into the heading's visual space with a bright horizontal stripe. At 820px, it remains the most visually forceful object while the actual plant selection is composed from soft, low-contrast blue panels.

**Proposal:** integrate the free-claim path into the same surface language, with a small eligibility cue and a clear but restrained action. For eligible first-time players it may remain prominent; after dismissal or in repeat-player flows it should not repeatedly consume the first fold. Reduce noninformational decoration behind text. Preserve Base's blue brand cue without an unrelated promotional composition taking over the game.

Evidence: [Mint at 320px](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/Mint-320.png), [Mint at 820px](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/Mint-820.png).

### FND-V4 — P2 design judgment: Small-screen swap allocates too much height to empty amount stages

**Runtime screenshot verified.** On the 320px screen, the Sell stage alone is about 195px tall, dominated by “0.0” and empty space. Only the top of Buy is visible above navigation; the pair of amounts and submit action cannot be reviewed together in the first viewport. On 820px, the same form remains a tall narrow card with a large unused canvas beneath it. This is not a claim that scrolling or the Swap action is broken.

**Proposal:** create a compact-phone variant with a shorter amount row, less vertical empty space, and consistent 12–16px internal gaps so both sides and the main action are visible together whenever viewport height permits. Keep the actual editable text ≥16px and let long values horizontally edit rather than shrinking indefinitely. The large 40px value can remain on spacious layouts. Avoid making the inactive Buy field look just as editable as Sell without a clear distinction.

Evidence: [Swap at 320px](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/Swap-320.png), [Swap at 820px](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/Swap-820.png).

### FND-V5 — P3 design judgment: Content hierarchy is flattened by repeated blue surfaces and control treatments

**Runtime screenshot verified.** In the light-theme captures, the header, status bar, segmented controls, selected pills, main panels, nested cards, amount cards, and footer controls all use variations of pale blue with rounded borders and raised shadows. Every wrapper reads as an object. Mint has a panel around the selected plant, a panel around strain choices, individual bordered choices, metric tiles, and another confirmation panel. Ranking and Activity simultaneously present outer cards, filter capsules, line dividers, rounded pagination footers, and a separate rounded navigation bar.

**Proposal:** define three clear visual jobs: page canvas, quiet content grouping, and interactive controls. Use spacing and typography for more internal groups; reserve a bordered/elevated surface for actual tasks or interaction. Strengthen the active-state distinction without making every inactive control raised. Keep pixel plant art and occasional Pixelmix names as identity—the improvement is calm hierarchy, not removal of the game's personality.

Evidence: [Mint at 820px](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/Mint-820.png), [Ranking at 820px](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/Ranking-820.png), [Swap at 320px](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/Swap-320.png).

### FND-V6 — P3: Mobile records are verbose while key units are implicit

**Runtime screenshot verified.** The 320px Activity view shows approximately two complete records because each sentence combines source land, action, reward, destination plant, transaction link, and timestamp in a narrow text block. In Ranking, points, stars, and ETH are represented predominantly by small icons and numbers. The global header likewise shows three token icons and quantities without text labels. These compact conventions are learnable for veterans but force new players to decode icon meaning.

**Proposal:** format activity as a concise result plus a secondary source/time line; let tapping the record expose detail and explorer access. In Ranking and the status strip, provide more discoverable visible unit labels on tablet/desktop where room exists. The status strip already includes meaningful screen-reader-only currency labels (`components/status-bar.tsx:232,239,245,252,258`); the screenshot concern is visual discoverability, not absence of an accessible currency name. Avoid shrinking the icons and labels further to gain density. Preserve full detail through disclosure, rather than discarding it.

Evidence: [Activity at 320px](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/Activity-320.png), [Ranking at 320px](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/Ranking-320.png).

## Automated accessibility addendum

The coordinated 390px About scan and its settled follow-up used axe 4.12.1 and returned the same two violations. The following are runtime automated findings with current-source confirmation; they are not a full assistive-technology or WCAG compliance assessment.

### FND-A1 — P2: The horizontally scrolling balance group cannot receive keyboard focus

The `scrollable-region-focusable` rule reports the named **Token balances** group. Source at `components/status-bar.tsx:227–261` confirms a nonfocusable `<div role="group" aria-label="Token balances">` containing only static images/text; the scroll behavior is `overflow-x: auto` in `app/globals.css:1266–1271`. The neighboring Tasks/Stake buttons are outside that inner scrollport. This is an app-shell issue, so the affected structure is shared with tabs other than About.

**Fix:** when this balance group overflows, make the scrollport keyboard focusable with a visible focus indicator and retain its existing accessible name, so native arrow-key scrolling can reveal clipped balances. An alternative is a layout that never requires horizontal balance scrolling. Confirm the solution manually in Chromium and WebKit, at larger text sizes and with the additional ETH/SOL balances. The automated result identifies the focusability gap; this subtask did not independently perform that keyboard-scroll interaction.

### FND-A2 — P3: About skips from the app's h1 to a community h3

The `heading-order` rule identifies **Join our Community**. `app/(game)/page.tsx:1048` renders the app h1; About's prose section has no intervening h2, while `components/tabs/about-tab.tsx:248` renders this heading as h3. Its visual text size does not require that semantic level.

**Fix:** give the About content an intentional heading outline, using h2 for this top-level section or adding a meaningful About h2 before nested h3 sections. Preserve the existing visual style if appropriate. Heading-order detection is a useful best-practice finding; it is not, by itself, a complete determination of a WCAG conformance failure.

Evidence: [About scan](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/axe-about-390.json), [settled About scan](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/axe-about-390-settled.json).

The About scan leaves color contrast incomplete, requiring manual review. The [Wallet scan](C:/Users/Goat/Documents/Pixotchi-Eco/output/playwright/audit-2026-09-08/axe-wallet-390.json) reports zero violations for the captured state but includes incomplete color-contrast and aria-hidden-focus checks. Neither zero reported violations nor a passing count is a guarantee that the app, dialog, or all its states are accessible. In particular, the independently reproduced Performance Mode focus defect remains valid.

## Proposed implementation sequence

1. Restore invariant functional feedback: Performance Mode focus, information/success contrast, viewport-bounded menus, share-field parity, and accessible exact-amount inspection.
2. Complete interaction contracts: quantity editing, ref-owned scroll areas, explicit dialog/footer behavior, error/focus/description wiring, and wrapper prop forwarding.
3. Establish visual rules: a small typography-role scale, consistent 8/12/16/24 spacing roles, explicit control/panel/dialog surfaces, and audited contextual ink pairs. Reserve stronger gradients/elevation for active controls and task hierarchy, with calm content surfaces. This is a proposed design direction; the detailed visual verdict belongs to the screenshot audit.
4. Extract only proven duplication: indicator mechanics, decorative BaseMark, shared theme configuration, and feature style ownership. Avoid a wholesale replacement of working Radix or amount-parsing behavior.

Verification should cover 320/360/390px phones, compact landscape, 768/820px tablets below the 864px gate, 864/1024px two-column layouts, 1280/1440px desktop; 200% text/zoom; keyboard navigation; all themes; reduced motion; Performance Mode; real iOS software keyboards and safe areas; long names, large counts, zero/tiny/huge token amounts; loading/error/empty states; and nested dialogs with menus and pending transaction notices. Test boundaries on both sides of the actual breakpoint, rather than only a generic phone/desktop preset.

## Coverage and evidence limits

All **36/36 current shared UI files** were source reviewed:

| Area | Files |
| --- | --- |
| Controls | `button.tsx`, `input.tsx`, `textarea.tsx`, `switch.tsx`, `toggle-group.tsx`, `amount-field.tsx`, `asset-multi-select.tsx`, `asset-carousel-button.tsx`, `pagination-footer.tsx` |
| Surfaces / semantics | `card.tsx`, `pixel-container.tsx`, `badge.tsx`, `alert.tsx`, `premium.tsx`, `empty-state.tsx`, `resource-state.tsx`, `approval-state.tsx`, `progress-bar.tsx` |
| Dialog / feedback | `dialog.tsx`, `dialog-feedback-host.ts`, `app-toaster.tsx`, `error-boundary.tsx` |
| Content / loading | `resource-value.tsx`, `token-amount.tsx`, `wallet-avatar.tsx`, `loading.tsx`, `skeleton.tsx`, `refresh-icon.tsx`, `BaseAnimatedLogo.tsx`, `BaseExpandedLoadingLogo.tsx` |
| Motion / games | `performance-mode.tsx`, `scroll-fade-controller.tsx`, `snow-effect.tsx`, `PlayingCard.tsx`, `EuropeanRouletteWheel.tsx` |

Additionally reviewed: complete `app/globals.css`, `app/fonts.ts`, `app/ock-compat.css`, `tailwind.config.ts`, `postcss.config.mjs`, `app/layout.tsx`, `app/(game)/layout.tsx`, `app/core-providers.tsx`, `components/server-theme-provider.tsx`, `components/theme-initializer.tsx`, `components/theme-selector.tsx`, `components/quantity-selector.tsx`, `components/swap-amount-layout.tsx`, `components/transactions/game-dialog-heading.tsx`, `lib/theme-utils.ts`, `lib/dialog-focus.ts`, and `lib/token-display.ts`. Relevant source slices were inspected in page-level `SlidingNavTabs`, provider mounting, item details, Solana mint, casino panel, name editing, swap, sharing, wallet, and transfer/marketplace flows to establish concrete consumers. Those feature files were not independently audited in full by this subtask.

Search counts are useful context, not quality scores: current app/components TSX contains 336 shared Button uses across 79 files versus 52 native buttons across 24 files; 20 Input uses and 17 AmountField uses. Native inputs largely consist of legitimate checkboxes/radios/file controls, so they are not automatically duplication defects.

Token calculations stripped comments, applied matching root/theme declarations in source order, converted HSL to sRGB, composited alpha backgrounds in sRGB, and used linearized relative luminance. They intentionally exclude gradients and ancestors other than the stated solid card surface. Source findings are differentiated above from runtime verification and conditional inferences.

**Not covered by this subtask:** complete feature state machines, real-wallet transaction outcomes, full network-error scenarios, actual Safari/Firefox/VoiceOver/NVDA rendering, forced-colors OS behavior, physical device gestures, or every combination of the application's dynamic data. 36/36 source files is a precise scoped coverage statement; it is not a claim of 100% runtime UI/state coverage.
