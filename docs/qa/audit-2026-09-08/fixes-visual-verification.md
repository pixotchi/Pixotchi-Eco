# Independent dense-surface baseline review — 2026-09-08

Reviewed all nine original/new pairs visually with `view_image` (18 images), plus Pillow pixel comparisons and Git source/history checks. No production component, test, or baseline was edited during this review.

**Result:** no new content, color or component-layout regression was found. Barracks and Arcade differences are consistent with capture-origin/crop/raster alignment. Chat also contains a real pre-existing Profile-button change that the old snapshots had not captured; it must not be described as alignment-only.

## Image dimensions and observations

Dimensions below are screenshot pixels, not viewport dimensions.

| Surface/context | Original → updated | Review |
| --- | --- | --- |
| Barracks / Chromium 390 light | 324 × 492 → 324 × 491 | Identical compared pixels after removing the original's first row (one-pixel vertical origin shift). |
| Barracks / Chromium 1440 dark | 414 × 492 → 414 × 491 | Identical compared pixels after the same one-pixel shift. |
| Barracks / WebKit 390 light | 324 × 492 → 324 × 491 | Same titles, troop values, icons, outcome, settled amounts, date/time and table structure. Raster/position differences remain; not pixel-identical. |
| Arcade / Chromium 390 light | 324 × 309 → 324 × 308 | Same content, wrapping, spacing hierarchy and warning colors; one-pixel crop/origin and raster differences. |
| Arcade / Chromium 1440 dark | 414 × 309 → 414 × 308 | Same content and layout; small border/raster differences. |
| Arcade / WebKit 390 light | 324 × 309 → 324 × 308 | Same content and layout; one-pixel crop/origin and raster differences. |
| Chat / Chromium 390 light | 332 × 506 → 332 × 498 | Profile is visibly outlined/filled and compact. First bubble is shorter; following bubbles move up. Other content, wrapping and colors remain consistent. |
| Chat / Chromium 1440 dark | 550 × 423 → 550 × 414 | Same pre-existing Profile change plus origin/crop alignment. |
| Chat / WebKit 390 light | 332 × 506 → 332 × 498 | Same pre-existing Profile change; no other content/layout regression seen. |

## Why the Chat difference is legitimate

The audited/current HEAD is `2d2128049d75bd79c0b8b27d42d9edbbd08933f0`. Its [ChatMessageBubble source](C:/Users/Goat/Documents/Pixotchi-Eco/components/chat/chat-message-bubble.tsx) already specifies Profile `variant="outline"`, `size="compact"`, `h-6 min-h-6` and `py-0`.

Git commit `3a820e3ea42db2cc31d6df4a3f0bcf9eb2eea049`, **Restore compact visible public chat profile buttons**, introduced those exact changes on September 7 and is an ancestor of the audited HEAD. The last original Chat snapshot update was the earlier `7dd3a80`, **Use compact height for chat profile actions**. The old baseline therefore showed the previous ghost/transparent button and larger padding.

The P1 working-tree change to ChatMessageBubble only adds optional failed/cancelled delivery feedback. The dense-surface fixture supplies no delivery status, so that new feedback does not render in these screenshots. The visible Profile change is **not introduced by the P1 work**, and refreshing this stale reference does not require a production Profile markup change.

## Pixel evidence and limits

- Both Chromium Barracks pairs have **zero changed pixels** on their common image area after matching the one-row origin shift.
- WebKit Barracks has 4.485% exact pixel differences in the common crop, with mean absolute RGB-channel difference 2.923/255. Visual inspection found position/raster changes without altered values, missing content or changed visual hierarchy.
- After the best integer shift within ±2 pixels, Arcade exact pixel differences are 2.335–2.667%, with mean absolute RGB-channel difference 0.183–0.439/255. Primary background colors are unchanged in every pair.
- Chat changes are intentionally not reduced to a raster-difference statistic: the existing Profile styling and its height change account for a substantive part of the comparison.

Originals: [preserved baseline directory](C:/Users/Goat/Documents/Pixotchi-Eco/output/frontend-p1-original-baselines). Updated references: [snapshot directory](C:/Users/Goat/Documents/Pixotchi-Eco/tests/frontend/dense-surfaces.spec.ts-snapshots).

This is independent visual review of the provided reference updates. The coordinating task performs the final screenshot test run without `--update-snapshots`; this review does not substitute for that run or claim coverage beyond these nine contexts.
