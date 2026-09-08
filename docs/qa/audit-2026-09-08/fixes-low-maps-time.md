# Low map, artwork and time fixes — 8 September 2026

Scope: G20, G21, G25 and G26, revalidated against the medium implementation and the original gameplay audit. The existing owner guards, map gestures, pending purchase behavior and verified-data states remain in place.

## G20 — Readable care details and map targets

**Before / revalidation:** the medium map footer had already corrected Profile to a 44px target and promoted owner metadata to 12–16px. The map legend still used 10px text, the wilderness dismiss action still used the compact target, and care effects/prices remained 10px inside four columns at only 340px of available width.

**After:** map legends use 12px text; terrain dismissal is explicitly 44×44px with a narrower decorative thumbnail and a wrapping title. Care effects and prices use 12px text, comfortable line height, tabular numerals and wrapping. Cards choose columns from their actual available width with an 8rem readable minimum; at increased text size they naturally reduce columns. Lifetime is spelled out instead of TOD.

**Why:** price and effect information informs a purchase and needs the same readable hierarchy as other body-small content. Intrinsic columns protect that hierarchy on a phone, inside a narrow panel and at increased text size.

**Evidence:** real catalog buttons retain their effects, price, accessible names and click behavior at Chromium 320/820/1440 and WebKit 390 widths. Both normal and 200% text have no document or card horizontal overflow, no important text below 12px at normal size, and no undersized action. Terrain details and map actions also retain 44px targets at 200%. Existing garden-item expectations are aligned with lifetime wording and available-width layout.

## G21 — Consistent map meaning across themes

**Before / revalidation:** the canvas still used fixed blue for ownership and amber for selection while the legend used the theme primary color and omitted selection. Color was the only visual distinction.

**After:** `lib/land-map-markers.ts` owns domain-specific marker colors for both the canvas and DOM legend. Owned land has a white diamond with a blue border/tint. Selected land has a dashed amber outline with a white backing for terrain contrast. The legend shows both marks. Existing accessible canvas descriptions continue to identify ownership and selection.

**Why:** a theme change must not change the meaning of a map mark. The diamond and dashed outline provide distinct shapes as well as matching colors; the white backing preserves selection over busy sprites.

**Evidence:** browser checks compare the legend's computed RGB colors with actual central-plot canvas pixels in all eight existing themes (light, dark, green, yellow, red, pink, blue, violet). They also verify the white diamond and dashed legend shape. The retained map harness checks unknown/owned classifications, keyboard selection, sprite recovery and trusted Chromium pinch-to-pan behavior after the renderer change.

## G25 — Recoverable land artwork

**Before / revalidation:** `LandImage` still rendered a set of CSS backgrounds without loading or error state. A failed base or building layer silently left a blank or incomplete scene.

**After:** a scene boundary keyed by land and actual asset sources tracks native image loading. It preserves the original transparent layer order and completed-building rules. A missing base presents a readable loading/failure state and a 44px retry action. Failed optional layers are hidden without suppressing the base or healthy layers; a discreet message explains the incomplete artwork and provides retry. Changing land or village/town invalidates the previous scene's load callbacks.

**Why:** image failure must not look like missing player property, and optional artwork should not make the entire land scene unusable.

**Evidence:** the harness aborts an optional layer, verifies the base and another completed layer remain visible, confirms first-level construction is omitted and an existing upgrading building stays visible, then restores the failed layer through retry. It separately aborts the base, checks fallback and retry at 200%, changes village to town, clears selection and delivers a late old-scene failure while the new scene stays visible. No native broken-image glyph or uncaught page error reaches the scene.

## G26 — Predictable countdowns and timely protection expiry

**Before / revalidation:** compact/exact durations already shared `formatDurationSeconds` after the medium work. Countdown still had separate 96-hour day switching, second ticks even when seconds were hidden and no numerical styling of its own. Selected protection was memoized only on the plant object, so a zero timer could retain the shield until owner polling replaced that object.

**After:** the same duration module also exports `formatCountdownDuration`; countdown switches to days at 24 hours while compact/exact modes retain their public API. Minute-only labels round a positive partial minute up and schedule only the next displayed minute boundary or expiry. Second timers retain second cadence. Both stop at zero and catch up when a hidden tab returns. The two timer components use tabular numerals, named non-announcing timer semantics and safe wrapping at large text sizes.

A new `usePlantProtection` hook schedules the selected plant's actual V1/V2 protection deadlines, removes expired local protection immediately and invalidates only that owner's plants query once per observed expiry. It catches up on visibility changes, ignores old owner/plant callbacks and avoids repeated refresh loops if a server still returns an expired active flag. The gameplay owner approved and received the exact `plants-view` import/hook replacement.

**Why:** the displayed precision should determine timer work, zero must mean expired, and protection eligibility must follow the deadline rather than an unrelated polling interval.

**Evidence:** controlled clocks in the actual React components check minute-only commit counts, second updates, final positive minute, exact zero, no work after expiry, 24-hour/day formatting, tabular numerals, 200% wrapping and visibility catch-up. V1 and V2 expiry each cause one owner-scoped invalidation; repeated stale flags do not refetch; switching owners prevents the previous owner's deadline from invalidating; late visibility catch-up removes the new owner's expired protection.

## Verification and limits

- **Pass, 4/4 runs:** `node smoke/maps-time-low-smoke.mjs` (Chromium 320×568, 820×1180, 1440×900 and WebKit 390×844).
- **Pass, 4/4 runs:** `node smoke/land-map-medium-smoke.mjs --no-captures`. The new option preserves the existing harness's default artifact behavior while allowing this round to run without writing captures or updating snapshots.
- **Pass:** targeted ESLint covers the changed components, hooks, helpers and test files.
- Actual React components, React Query, Radix, application CSS and local artwork run in an isolated fixture server. Contract reads, name resolution and the separate Profile dialog are boundary stubs. The protection check uses real query-cache invalidation with deterministic local data.
- This is browser-engine and text-scaling verification, not physical-device or live-chain evidence. No wallet transaction, full suite/build, package/config/global primitive change, dev-server lifecycle change, snapshot update, commit or push was part of this work. The existing garden-items suite is aligned but its application-server matrix is left to the root verification owner.
