# Tutorial refresh — 11 September 2026

The tutorial uses phone mockups and enlarged crops of the current application, following the original `public/tutorial/*.webp` compositions. All standalone icons and game art come from the repository. The rejected generated illustrations were removed from the project.

Final assets: `public/tutorial/current/` (11 WebP images, 1440 × 900). Composition sources and asset paths are recorded in `tutorial-art-current.json`.

To reproduce, run the local development app with its existing Local Test Wallet surface enabled, then run `npx tsx scripts/capture-tutorial.mts` and `node scripts/render-tutorial-art.mjs`. Captures use the production components; sample plant, land, selected token reads and chat history exist only in the capture browser. Transaction submission is blocked. Other live readouts are point-in-time examples and may change.

Validation completed:

- TypeScript and targeted ESLint passed.
- All three quick-start steps loaded at 320 px and retained identical image bounds.
- All ten full-guide steps fit their content at 1440 px: 16 px of padding below the text, with no reserved blank region. Longer steps scroll within the viewport cap. Back replaces the redundant Restart guide action.
- At 320 × 568, the footer remained reachable with no page overflow.
- The image viewer pans at full detail on mobile. Escape closes only the viewer, restores focus to its trigger, and preserves the tutorial step. Arrow keys inside the viewer do not advance the guide.
- Tasks, Stake, Chat, Wallet profile and Settings share one surface definition. All five were checked across all eight themes at 320 and 1440 px: matching fills and borders, 44 px touch targets, and no horizontal overflow.
- Stronger opaque fills and visible borders apply only to Light and Dark. All six colored themes preserve the original icon-button surface (65% card fill, transparent resting border and 25% primary hover border), now also used by Tasks and Stake. The final theme checks use the `theme-scope-` screenshot prefix.
- At 320 × 568 with 200% text, the guide scrolls to the end of the copy and keeps Back/Next reachable.
- The empty farm and login hero have four illustrated stages: Plant, Care, Grow and Earn ETH. The fourth uses the original `public/icons/ethlogo.svg` in a reward medallion; the description explains points and variable reward distributions.
- Tutorial screenshots were recaptured after the shared header-control update, then all eleven phone compositions were rebuilt.
- The compact header uses one mobile status row with original token icons and abbreviated balances. Tasks/Stake place their labels to the right of their icons at every width, matching main's arrangement with tighter phone padding. Their heights match main: 36 px, reduced to 32 px at widths up to 380 px. Header plus status height is 96 px at 320 px and 100 px at 390 px, down from 172 px. All three balances and both labeled actions fit at 320 px. The focused responsive header check passed. Tutorial phone screenshots were recaptured for this layout.

Screenshots from the final layout checks are in `output/playwright/` with the `polish-` prefix. Earlier tutorial zoom checks use `tutorial-real-`.
