# Feature CSS parity and final header follow-up

## CSS extraction review

Recovered the earlier compiled application CSS from the P3 Playwright trace and compared it with the freshly served stylesheet. All five extracted feature families are present: login, transaction feedback, status tokens, quest presentation, and admin.

Across 320×844, 820×900, 1440×900, and 640×320, normal motion, OS reduced motion, and performance mode, **5,580 computed-property comparisons produced no differences** for representative feature selectors and their children. The probes include positioning, dimensions, wrapping, colors, surfaces, animation/transition properties, and admin overflow. No import omission or new cascade/motion regression was found. This is a bounded comparison, not exhaustive testing of every selector combination or theme.

Fresh real-app Mint, Swap, and Wallet profile views were also opened at 320×568, 820×900, 1440×900, and 640×320. Captures are `output/css-review-*.png`. Enlarged-text Swap actions and wallet balance refresh remain reachable by scrolling/keyboard. No page errors were observed in the final focused enlarged-text check. The local Next development badge intercepted one pointer interaction; keyboard navigation completed that check without changing application styles or inspecting storage.

## Base mark coverage review

The three focused tests exercise shared artwork, one loading announcement, active color work, pause/resume for visibility/reduced-motion/performance, cleanup after unmount, touch/mouse echo handling, and the measured 200×60 About footprint with compiled app styles. Source review confirms that initial hidden/reduced/performance states also decline to start timers. Those initial-state combinations and the legacy `MediaQueryList.addListener` fallback are not separately covered by browser cases. Hidden-tab behavior is simulated through the document visibility property/event; it is not a physical background-tab throttling test. No additional defect was found.

## Header correction approved during review

At 320×568 with 200% text, the header's rem-based icon controls grew to 88px. The wallet button ended at x334 and the theme button at x438, beyond the 320px viewport. This was a separate responsive gap, not a feature-CSS extraction regression.

Added opt-in `Button size="headerIcon"`: fixed 44px targets and 20px direct glyphs. Chat, wallet, theme trigger/placeholder, and the mini-app Add icon share it. Header spacing is fixed at 8px. The mobile action group keeps its intrinsic size while the desktop balance strip can still shrink; brand text retains normal text scaling and truncation. Theme/unread indicators retain fixed decorative dimensions so they cannot obscure the glyphs when text grows. Generic icon, input, and text-bearing button sizes remain scalable.

**Six actual-app scenarios passed** at 320, 820, and 1440px with normal and 200% text: bounds, target/glyph dimensions, keyboard focus, and actual opening/closing of Chat, Wallet, and Theme. Scoped ESLint passed. Final header captures are in `output/header-action-layout-final/`. No transactions, messages, storage inspection, configuration, server lifecycle, or commits were involved.

## Theme menu follow-up approved during review

Opening the theme menu at 320px/200% text exposed an existing internal overflow: the menu had a 286px client width and 307px scroll width, with horizontal overflow hidden. Four rem-sized columns left the fourth column partly clipped. Evidence before the fix: `output/header-theme-200pct-review.png`. This was reported first, then root authorized the narrow correction.

Theme choice boxes now use fixed 44px dimensions in the existing `themeMenuButtonClass`. Their color swatches, accessible theme names, radio selection, and scaled text controls remain intact. The same six actual-app checks now also validate all eight choice bounds, pointer reachability, and arrow-key traversal at normal and 200% text. The actual Wallet Profile Performance Mode switch can receive keyboard focus and be activated on and off at 320px/200%; it is not a control in the theme menu. Final menu and performance screenshots are included in `output/header-action-layout-final/`.

Visual inspection found a separate limitation in the 320×844/200% Wallet Profile screenshot: the enlarged fixed header/description and footer consume the body area, obscuring its content. Keyboard activation and viewport intersection alone do not establish visible pointer reachability. This was reported to root with the screenshot before any dialog edits; the header/menu correction does not change shared dialog geometry.
