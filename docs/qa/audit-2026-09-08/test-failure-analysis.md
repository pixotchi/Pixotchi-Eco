# Frontend test failure analysis — 2026-09-08

## Outcome

The complete coordinated Playwright run finished with **591 passed, 14 failed, 11 skipped (616 total)** in 19.2 minutes. That remains the official result of that run; selective reruns must not be added to its pass count.

All 14 failed contexts were inspected and rerun serially without app changes or snapshot acceptance. **10 of the 11 originally failing behavior contexts passed on the serial rerun.** The remaining WebKit roulette test reached 20 correct selections (0 through 19) before exhausting its 30-second whole-test budget. A diagnostic 90-second rerun was stopped by the separate five-second fixture-readiness assertion before it exercised roulette.

Two Chromium visual failures repeat exactly and are a one-pixel screenshot alignment difference, not a changed Barracks composition. The WebKit visual failure is unresolved: the original image has a small position/rasterization difference, and serial attempts subsequently failed at fixture/Markdown readiness before making the comparison.

**Release confidence:** the evidence does not support “14 frontend behaviors are broken.” It also does not support declaring the release suite green. The immediate issue is an unstable regression harness with a verified hydration mismatch, a costly all-in-one fixture, fragile screenshot alignment, and insufficiently bounded readiness. Full WebKit roulette coverage and three dense visual contexts still need a deterministic green run after harness correction. The separate production-app audit contains real product issues, including the independently reproduced Performance Mode keyboard-focus failure; those should not be dismissed because many suite failures are harness problems.

## Exact context accounting

| Project / failed test | Original failure | Serial rerun |
| --- | --- | --- |
| `webkit-1024-dark` — care quantities are compact, edited in the popup and retained per item | Fixture ready attribute absent at 5s | Passed, 8.1s |
| `webkit-1024-dark` — selecting the same care item reopens its review | Fixture readiness at 5s | Passed, 6.8s |
| `webkit-1024-dark` — roulette number centers always select that straight number | Fixture readiness at 5s | Whole test timed out at 30s while starting number 20; 0–19 passed |
| `webkit-1024-dark` — failed reads have a retry and distinct empty state | Fixture readiness at 5s | Passed, 4.5s |
| `webkit-1024-dark` — nested dialog dismisses one layer and restores focus | Fixture readiness at 5s | Passed, 4.8s |
| `webkit-1024-dark` — named dialog layouts keep long content and actions reachable at enlarged text size | Fixture readiness at 5s | Passed, 6.7s |
| `webkit-1024-dark` — tiny and very large token amounts expose exact values without overflow | Fixture readiness at 5s | Passed, 3.5s |
| `webkit-1024-dark` — production readouts retain tiny points and total lifetime without looking actionable | Fixture readiness at 5s | Passed, 3.3s |
| `webkit-390-light` — selecting the same care item reopens its review | The first dialog visibility assertion failed (`primitives.spec.ts:112`), before the close/reopen sequence | Passed, 3.9s |
| `webkit-390-light` — first care persists by wallet and urgent plants retain guidance | Fixture readiness at 5s | Passed, 5.0s |
| `webkit-390-light` — roulette removal targets stay distinct and preserve long amounts | Fixture readiness at 5s | Passed, 2.7s |
| `390-light` — reviewed dense surface appearance | Barracks: 6,851 different pixels, reported ratio 0.05 | Repeated with same count |
| `1440-dark` — reviewed dense surface appearance | Barracks: 3,776 different pixels, reported ratio 0.02 | Repeated with same count |
| `webkit-390-light` — reviewed dense surface appearance | Barracks: 5,423 different pixels, reported ratio 0.04 | First serial attempt could not find lazy Markdown heading at 5s; isolated attempt failed fixture readiness at 5s |

This means **10 of the original 14 failures occurred in `beforeEach`**, before their named feature assertion. One reached an initial care-dialog assertion. Three reached a screenshot comparison. The first care-dialog assertion is not itself evidence that reopening the same item is broken.

## Verified cause: locale/timezone-dependent fixture hydration

Every one of the 14 original retained traces contains the same recoverable React hydration error in `BarracksReportCard`. The server emits:

```
05/09/2026, 12:00:00
```

The browser expects:

```
9/5/2026, 10:00:00 AM
```

The source is `components/building-details/barracks-report.tsx:98`:

```
new Date(Number(report.timestamp) * 1000).toLocaleString()
```

The test config fixes the browser's timezone to UTC (`playwright.config.ts:10`), but the development server uses the host's Europe/Madrid timezone and host locale. The fixture timestamp is fixed (`app/qa/frontend/dense-surface-fixtures.tsx:15`); its **formatting environment is not**. React explicitly reports that it regenerates the affected tree on the client.

`FrontendFixtures` initializes `ready` false and only sets it true in a mount effect (`app/qa/frontend/frontend-fixtures.tsx:46–47`), then places that flag on the giant fixture `<main>` (`:66`). Both test files require that flag within the default five-second expect budget (`tests/frontend/primitives.spec.ts:5`, `tests/frontend/dense-surfaces.spec.ts:5`). Failure snapshots show prerendered fixture content, initial zero read counts, and the lazy assistant response placeholder, consistent with incomplete hydration/client initialization rather than a missing test route.

**Confidence:** high that the hydration mismatch exists, forces recovery, and invalidates a clean-boot assumption. Medium that it is the complete explanation of every timeout: this audit did not profile CPU/network and did not change the source to establish a controlled before/after. Development-server load, the large fixture page, and WebKit engine overhead can also contribute. Serial execution alone does not make the readiness failures disappear consistently.

### Production scope is different

`/qa/frontend` directly renders `FrontendFixtures` and is unavailable in production (`app/qa/frontend/page.tsx:7–10`). This exposes the report to server rendering in the test harness. The main game's tab loader uses `ssr: false` (`app/(game)/page.tsx:116–126`), and the provider gate initially renders the login fallback. Therefore **this trace is proof of a fixture SSR defect, not proof that players' production Barracks views currently hydrate incorrectly**. The shared report's formatting remains a maintainability hazard if later reused in an SSR context, and the app should define an intentional player-facing date convention.

### Proposed correction

Make the initial report timestamp deterministic across server and browser: pass a preformatted fixture value, or use an explicit locale/timezone for that initial render; if the player should see their local time, update it after mount from an identical initial representation. Do not hide the whole error with `suppressHydrationWarning`. Set browser locale as well as timezone for visual fixtures, and ensure the server-rendered representation is controlled too.

Split the enormous aggregate fixture into focused routes or compositions so a care-quantity test does not depend on unrelated chat Markdown, Barracks dates, ranking columns, and game tables hydrating together. A ready marker should identify the component under test's settled state. Keep bounded, explicit expectations; raising a timeout may be useful for a demonstrated slow engine path, but is not a substitute for fixing deterministic hydration.

## Visual failures: alignment, not demonstrated redesign regressions

The original expected, actual, and diff Barracks images were viewed for all three visual contexts. Dimensions are unchanged: 324×492 at 390px and 414×492 at 1440px. Information, wrapping, colors, icons, and surface composition are the same by inspection.

For Chromium, an offline pixel comparison using Pillow established the following exact result: **actual pixel row `y` equals expected row `y + 1` for all compared pixels**. This was measured separately in vertical bands 0–45, 46–240, 240–420, and 420–492; every band had mean absolute RGB difference **0.0** after the one-pixel alignment. Without alignment, the same images produce the reported thousands of changed pixels. The serial rerun repeats the identical 6,851/3,776 counts.

That is strong evidence of a screenshot crop/scroll alignment issue for the Chromium baselines. It is not evidence that Barracks typography, spacing, or contrast was redesigned incorrectly. The root of the offset—fractional element position, screenshot crop rounding, or changed surrounding fixture geometry—was not isolated in this bounded pass. Do not simply accept new baselines because the pictures look close; stabilize the fixture origin first and then review the comparison.

The WebKit images also look like small positional/rasterization changes, but they are **not** pixel-identical under a single integer translation. The original 5,423-pixel mismatch remains an unapproved difference with medium-confidence environmental/alignment classification. Two serial follow-ups failed earlier, first waiting for the “Your next steps” heading and then the global ready attribute, so they do not provide a successful fresh visual comparison.

The Markdown heading is a separate asynchronous dependency: `components/chat/chat-message-bubble.tsx:6–10` dynamically loads its message renderer with `ssr: false` and “Loading response…” fallback. `dense-surfaces.spec.ts:67` waits for the heading but still uses the default five-second budget. The global mounted flag is not proof that this renderer is ready.

The visual test compares `barracks`, then `chat`, then `arcade` in a loop (`dense-surfaces.spec.ts:69–72`). Failing on Barracks prevents that context's later two comparisons. Thus the current result is **three Barracks comparison failures**, not nine known dense-surface regressions; Chat/Arcade visual coverage in those failed test invocations is incomplete.

Evidence:

- [390px Chromium expected](C:/Users/Goat/Documents/Pixotchi-Eco/output/frontend-tests/dense-surfaces-reviewed-dense-surface-appearance-390-light/barracks-expected.png), [actual](C:/Users/Goat/Documents/Pixotchi-Eco/output/frontend-tests/dense-surfaces-reviewed-dense-surface-appearance-390-light/barracks-actual.png), [diff](C:/Users/Goat/Documents/Pixotchi-Eco/output/frontend-tests/dense-surfaces-reviewed-dense-surface-appearance-390-light/barracks-diff.png).
- [1440px Chromium expected](C:/Users/Goat/Documents/Pixotchi-Eco/output/frontend-tests/dense-surfaces-reviewed-dense-surface-appearance-1440-dark/barracks-expected.png), [actual](C:/Users/Goat/Documents/Pixotchi-Eco/output/frontend-tests/dense-surfaces-reviewed-dense-surface-appearance-1440-dark/barracks-actual.png), [diff](C:/Users/Goat/Documents/Pixotchi-Eco/output/frontend-tests/dense-surfaces-reviewed-dense-surface-appearance-1440-dark/barracks-diff.png).
- [390px WebKit expected](C:/Users/Goat/Documents/Pixotchi-Eco/output/frontend-tests/dense-surfaces-reviewed-dense-surface-appearance-webkit-390-light/barracks-expected.png), [actual](C:/Users/Goat/Documents/Pixotchi-Eco/output/frontend-tests/dense-surfaces-reviewed-dense-surface-appearance-webkit-390-light/barracks-actual.png), [diff](C:/Users/Goat/Documents/Pixotchi-Eco/output/frontend-tests/dense-surfaces-reviewed-dense-surface-appearance-webkit-390-light/barracks-diff.png).

## Roulette: timeout does not establish incorrect betting targets

The serial WebKit 1024 test succeeded at each center for numbers 0 through 19, including the 44px geometry assertions and the exact selected bet output. The trace then shows the test runner closing its context at the 30-second deadline while the next `scrollIntoViewIfNeeded()` for number 20 starts. There is no failed expected-number assertion or observed incorrect target in that run.

The test performs multiple cross-process operations per number: locate/scroll, obtain bounding box, mouse click, then inspect output (`primitives.spec.ts:147–158`). The retained trace shows substantial cumulative overhead per operation in WebKit. A later diagnostic changed only the whole-test budget to 90 seconds; it failed at the independent fixture-ready expectation after five seconds. That diagnostic neither confirms nor disproves numbers 20–36 and the final Split 3–6 selection.

**Proposed correction:** first stabilize fixture boot; then size the full-loop test budget from measured engine runtime or split the 37 independent straight-number checks into bounded groups. Retain real pointer hit testing; replacing it with programmatic click dispatch would remove the behavior this test is meant to prove. No complete WebKit pass is claimed here.

## Rerun commands and preserved artifacts

All reruns used one worker, the existing server, the original test bodies, no retries, and a list-only reporter so the primary HTML report and `output/frontend-tests` artifacts remain untouched. Each invocation used a different output subdirectory to preserve preceding failures.

```
npx playwright test tests/frontend/primitives.spec.ts --workers=1 --project=webkit-1024-dark --grep 'care quantities are compact|failed reads have a retry|named dialog layouts keep long content|nested dialog dismisses one layer|production readouts retain tiny|roulette number centers|selecting the same care item|tiny and very large token amounts' --output output/frontend-audit-reruns/webkit1024 --reporter=list

npx playwright test tests/frontend/primitives.spec.ts --workers=1 --project=webkit-390-light --grep 'first care persists by wallet|roulette removal targets stay distinct|selecting the same care item' --output output/frontend-audit-reruns/webkit390 --reporter=list

npx playwright test tests/frontend/dense-surfaces.spec.ts --workers=1 --project=390-light --project=1440-dark --project=webkit-390-light --grep 'reviewed dense surface appearance' --output output/frontend-audit-reruns/visual --reporter=list

npx playwright test tests/frontend/primitives.spec.ts --workers=1 --project=webkit-1024-dark --grep 'roulette number centers always select' --timeout=90000 --output output/frontend-audit-reruns/roulette-diagnostic --reporter=list

npx playwright test tests/frontend/dense-surfaces.spec.ts --workers=1 --project=webkit-390-light --grep 'reviewed dense surface appearance' --output output/frontend-audit-reruns/webkit-visual-isolated --reporter=list
```

Logs are preserved as `output/frontend-audit-reruns-webkit1024.log`, `output/frontend-audit-reruns-webkit390.log`, `output/frontend-audit-reruns-visual.log`, `output/frontend-audit-reruns-roulette-diagnostic.log`, and `output/frontend-audit-reruns-webkit-visual-isolated.log`. Error contexts, screenshots, and retained traces are under the corresponding output subdirectories.

No app code, test bodies, configuration, baseline images, or production state was modified by this follow-up. Offline image analysis compared pixels only; it did not edit or normalize the saved evidence.
