# Reviewed frontend baselines

These nine images cover the real Barracks report, chat message bubble and Arcade readout components in three contexts:

- Chromium, 390px, light
- Chromium, 1440px, dark
- WebKit, 390px, light

They were visually reviewed on Windows on 5 September 2026, using the repository's pinned Playwright engines, UTC and reduced motion. Fixtures use fixed timestamps and values. Next's development indicator is hidden in the test page. No real wallet, RPC request or transaction is involved.

The Windows job checks these images. The Ubuntu behavior job intentionally skips this platform-specific visual test; it still runs the layout and interaction tests. The first hosted Windows run still needs review for platform/font differences. The jobs have not run on GitHub as part of this local task.

Run the checks without updating images:

```sh
npx playwright test tests/frontend/dense-surfaces.spec.ts --project=390-light --project=1440-dark --project=webkit-390-light
```

When an intentional visual change requires an update, run the same command with `--update-snapshots`, inspect every changed image, then run the command again without that flag. Do not automatically approve image changes in CI.

These are a small reference set, not a baseline for every dialog, theme or transaction state.
