# Farm crash when a built Town building is selected

## Cause and reproduction

Investigated public wallet `0xaa31f93b514fc817210bf7b31ea8a118c7f00312`. Its current public reads succeeded: 37 plants and 115 lands. A read-only local browser fixture redirected owner-list calls to this wallet, preserving the normal contract decoding and component rendering; signing/submission RPC methods were blocked.

All 37 plant selections initially rendered. Switching land/building selection to a built Farmer House reproduced the reported Farm error boundary. The browser stack was:

```
TypeError: Cannot mix BigInt and other types, use explicit conversions
  at effectiveDailyPoints
  at getVillageProductionRates
  at BuildingInfoDialog
```

Commit `ac8649f` added an unconditional Village production calculation inside BuildingInfoDialog. Town ABI records do not contain Village production fields. At level zero the helper skipped the calculation; built Town buildings reached `undefined * BigInt(6)` and threw. BuildingDetailsPanel mounts the info dialog even while closed. Persisted building selection can restore this failing path on reload. The exact affected-player browser stack was not provided, so this is a confirmed matching local reproduction, not direct telemetry from their device.

## Fix

Only compute and display Village production rates for Village buildings. Preserve the verified Village multiplier and upgrade behavior. No RPC fallback, transaction, or onchain state changes.

## Verification

- Added regression rendering for the six supported Town info types at levels 0, 1, and 3 using ABI-decoded Town records with no production fields.
- Land production smoke passed, including existing onchain-rate/upgrade/units assertions and the new 18 render cases. Its standalone run emitted the existing missing-Redis configuration diagnostic; these checks do not require Redis.
- TypeScript and targeted ESLint passed.
- Local mobile Chromium: all six Town selections, opening Farmer House info, three land switches, saved-selection reload, and return to Plants passed without page errors after the fix.
- Screenshot: `output/playwright/frontend-review-2026-09-05/player-farm-recovered.png`.
- WebKit verification was unavailable in the CLI browser installation. No claim is made about the player's specific browser, which remains unknown.

The existing error boundary logs its stack in the browser; the analytics event does not include the message/stack. This explains why a frontend crash need not produce Vercel runtime error logs.
