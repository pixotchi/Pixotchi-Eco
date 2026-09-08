# Reviewed frontend baselines

These nine images cover the real Barracks report, chat message bubble and Arcade readout components in three contexts:

- Chromium, 390px, light
- Chromium, 1440px, dark
- WebKit, 390px, light

They were visually re-reviewed on Windows on 8 September 2026, using the repository's pinned Playwright engines, en-US, UTC and reduced motion. Fixtures use fixed timestamps and values, including an explicitly preformatted server/client timestamp. Next's development indicator is hidden in the test page. No real wallet, RPC request or transaction is involved.

The September 8 update moves dense surfaces into a focused fixture suite and aligns capture origins to whole pixels. Barracks/Arcade differences from the September 5 references were crop/raster alignment. Chat references also caught up with the compact Profile button already present in audited HEAD before the high-priority fixes; its shorter bubble was a stale-baseline difference, not a new redesign. Every original/new pair was independently inspected. Details are in [the visual verification record](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/audit-2026-09-08/fixes-visual-verification.md).

The Windows job checks these images. The Ubuntu behavior job intentionally skips this platform-specific visual test; it still runs the layout and interaction tests. The first hosted Windows run still needs review for platform/font differences. The jobs have not run on GitHub as part of this local task.

The medium round subsequently updates only the three Chat references for SS-20's 44px Profile target and the information-ink adjustment. Root inspected all three resulting screenshots against the prior references: mobile bubbles grow by20px; desktop retains the inline author/action arrangement. Text wrapping, timestamps and message alignment remain intact. This is an intentional accessibility change, unlike the earlier stale-baseline correction. Barracks/Arcade references were not regenerated for this update.

Run the checks without updating images:

```sh
npx playwright test tests/frontend/dense-surfaces.spec.ts --project=390-light --project=1440-dark --project=webkit-390-light
```

When an intentional visual change requires an update, run the same command with `--update-snapshots`, inspect every changed image, then run the command again without that flag. Do not automatically approve image changes in CI.

These are a small reference set, not a baseline for every dialog, theme or transaction state.
