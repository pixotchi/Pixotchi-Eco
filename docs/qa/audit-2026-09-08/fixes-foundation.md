# High-priority foundation remediation

## FND-01 — revalidated and fixed

The current Performance Mode stylesheet replaced the complete box shadow on every class containing `shadow-`, including `shadow-none`. Shared controls suppress the native outline and use a Tailwind ring, so this removed their keyboard focus indication. The prior live reproduction and current CSS/control source agree.

The fix removes only Tailwind's elevation and inset-shadow contributions. It preserves the independently composed ring and ring-offset contributions. Existing performance tokens still turn off the app's decorative shadows, gradients, blur and transitions; no preference is overridden.

Added a small development-only `/qa/focus` route using the production Button, ToggleGroup, AmountField and Dialog. Its regression navigates with the keyboard through primary/outline/header controls, selected/unselected navigation controls, both radio choices, an input and a dialog. It verifies actual focus-visible rendering, overlay focus restoration and removal of elevation in Performance Mode.

Independent review found a second overriding declaration on the third-party Profile Follow control. Its explicit `box-shadow: var(--shadow-control) !important` also discarded the ring. That declaration now composes the same separate Tailwind ring, offset, inset and elevation contributions. The fixture includes the exact profile/follow class collision on a production Button. The assertion compares the rendered shadow with the ring contribution temporarily disabled, so elevation alone cannot produce a false pass.

Validation: `npx playwright test tests/frontend/focus.spec.ts --project=390-light --project=1440-dark --project=webkit-390-light --workers=2 --reporter=list --output output/frontend-p1-focus-all` — **24 passed**, covering all eight themes in both normal and performance modes. These are automated browser checks, not physical-device or screen-reader certification.

The strengthened final suite also passed **24/24** in `output/frontend-p1-focus-final`, including Profile Follow and the stricter painted-ring assertion.

The separate ARC-06 integration/coverage ledger records the test-harness and full-suite work.
