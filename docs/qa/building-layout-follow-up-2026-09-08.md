# Buildings layout follow-up — September 8, 2026

Addresses the desktop screenshot feedback received after the initial audit closure checkpoint. This follow-up does not replace that checkpoint or expand its acceptance claims.

| Area | Before | After |
| --- | --- | --- |
| Desktop columns | Building selector capped at 360px; details could occupy 520px. | Selector receives a larger share. At a 1920px viewport, measured selector/detail widths are approximately 470px/408px. Details retain a 360px minimum in the desktop split. |
| Building tiles | 72px minimum and duplicate grid overrides allowed names to split mid-word. | Shared 96px minimum; the grid reduces its column count when space is limited. Warehouse and Marketplace remain whole words. |
| Detail heading | Icon, title, and information button competed for width. | Header responds to its own available space, moving the title below the icon and information button when needed. |
| Enlarged text | Cost rows and some building navigation/retry controls overflowed. | Rows and affected button labels wrap without reducing text size or touch targets. |

Validation:

- Live Local Test Wallet checks at 320, 390, 820, 1024, 1280, 1440, and 1920 CSS pixels; additional 200% root-text checks at 390, 820, and 1440. No split words in visible building labels or horizontal overflow in the measured selector/detail regions after layout settled.
- Warehouse, Marketplace, Farmer House, Casino, and Barracks detail panels checked at normal and 200% text on desktop. Information dialog opens, closes with Escape, and restores focus to its trigger.
- Existing gameplay component smoke passed Chromium 320, WebKit 820, and Chromium 1440, including land selection/reveal and focus behavior. That harness mocks building details; the live checks above cover the actual panels.
- TypeScript check and scoped ESLint passed. Independent review found no actionable regression.

Local evidence: `output/building-spacing-visual-verified.log`, `output/building-spacing-final-controls.log`, `output/building-spacing-gameplay.log`, and `output/building-spacing-desktop-final.png` (ignored QA artifacts).

These are targeted layout checks, not renewed acceptance of every gameplay state or physical device. Live development output included an authentication 401 and image aspect-ratio warnings; no claim of a clean browser console is made. No transactions were submitted for this follow-up.
