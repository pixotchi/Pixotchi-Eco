# Medium map fixes — 8 September 2026

Scope: G09, G10, G14 and G27. All four original findings were revalidated against the current source before implementation. No transactions, wallet connection, production configuration, snapshot baselines or package scripts were changed by this work.

## G09 — Honest map data and recovery

**Revalidation:** `useLandMap` still invented `Math.max(500, maxOwnedId)` on supply failure, and returned zero during the initial read. The modal and canvas treated those numbers as verified minted boundaries. Missing owner reads appeared as ordinary “Unknown” identities.

**Fix:** the hook returns `number | null` and independent supply/neighbor read states, retains the last verified supply on refresh failure, and exposes one map-data retry. Rendering extent remains procedural and independent of supply. Owned IDs, verified neighbor IDs and successful owner reads establish minted plots even when supply is unavailable. Other plots are explicitly unknown until a current supply read establishes their status. The modal labels unavailable data and a retained count, and owner lookup has its own scoped loading/error/retry UI. An owner from the previous selection cannot appear on a newly selected plot while its lookup starts.

**Integration:** `lands-view.tsx` is owned by the gameplay parent and now passes `supplyStatus`, `neighborStatus`, `isRefreshing` and `onRetryMapData={retryMapData}` with the existing map props. `useLandMap(lands, options)` keeps its calling signature.

**Verification:** actual React Query hook and actual modal/canvas exercise initial pending reads, both RPC failures, retry success, later refresh failure with the verified 1,500 count retained, a verified zero, independently known owned land #1112, and unknown-plot announcements. Owner failure → retry → resolved identity is checked in the actual detail panel.

## G10 — Broken map artwork remains recoverable

**Revalidation:** image `onerror` still resolved a truthy broken `HTMLImageElement`, which later reached `drawImage` outside the loader's catch.

**Fix:** image failures resolve to null; drawing checks `complete` and `naturalWidth`. A drawing exception is caught at the individual sprite draw and uses the existing colored tile fallback, so other tiles and interactions survive. A visible artwork status and retry reload the sprites. Removed the unused procedural avatar allocation.

**Verification:** one real WebP request is aborted while the other production sprites load. The canvas remains selectable, reports the artwork problem and recovers after retry. A separate injected `drawImage` exception also stays local, reports recovery and clears on retry. There are no uncaught page errors.

## G14 — Focal pinch and uninterrupted one-finger pan

**Revalidation:** only the first pointer was captured; adding the second stopped pan, releasing either left pan stopped, and pinch changed zoom around the viewport center.

**Fix:** both active pointers are captured, coordinates are relative to the canvas, and each event updates a current pending view. The center and bounded zoom are published together once per animation frame. Pinch preserves the world point under the previous midpoint at the new midpoint, including translation and the 0.2–5 zoom limits. Releasing either finger seeds pan from the remaining finger's current position. Cancellation/lost capture clears the relevant pointer and suppresses unintended clicks. No inertia or decorative gesture animation was added.

**Verification:** Chromium receives trusted multi-touch input through CDP at phone, tablet and desktop viewport sizes. Checks cover moving-midpoint focal zoom, releasing the second finger and continuing pan, releasing the first finger and continuing pan, cancellation, no post-cancel mouse pan, and no synthetic selection after the gestures. Independent numeric assertions check focal invariance at both zoom limits and a zero-distance start.

## G27 — Readable neighboring owner details

**Revalidation:** a reserved right-side control rail, fixed 64px thumbnail, owner column and inline Profile button still competed for the width of a 320px panel.

**Fix:** land details occupy a full-width, scrollable footer separate from the map viewport. The redundant thumbnail is removed. Title/coordinates, full-width owner identity and the Profile action occupy distinct rows. Close targets remain 44px, including at increased text size. The map controls use a compact horizontal group within the map viewport, and their bounds remain visible at 200% text size. The map header and details no longer overlay each other.

**Verification:** actual app CSS and Radix dialog are rendered at Chromium 320×568, 820×1180, 1440×900 and WebKit 390×844. `beleka.base.eth` has a full-width identity row; the Profile target is at least 44px high. At 200% root text size there is no horizontal detail/identity overflow, the controls remain within the map viewport, and the footer can scroll to the working Profile action. The independently audited profile itself is a boundary stub in this harness.

## Checks and evidence

- `node smoke/land-map-medium-smoke.mjs` — all four browser/viewport runs pass. The harness uses production `useLandMap`, `LandMapModal`, `LandMapCanvas`, map helpers, Radix and compiled application CSS; only contract reads, primary-name resolution and the separate profile are replaced.
- `npx eslint hooks/useLandMap.ts lib/land-map-state.ts components/map/land-map-canvas.tsx components/map/land-map-modal.tsx smoke/land-map-medium-smoke.mjs` — pass.
- Eight normal-text/200%-text screenshots: `output/medium-maps/`. No snapshot baseline was created or refreshed.
- All modified/new source files were strictly decoded as UTF-8 after an intermediate ANSI insertion was repaired. No development-server process was stopped.

Limits: these are deterministic real-component browser regressions, not live-RPC or physical-device verification. WebKit covers rendering, keyboard selection and read/artwork recovery; trusted multi-touch was tested in Chromium only. No momentum behavior, payment flow, map-to-live-profile internals, deployed production environment or full frontend suite is claimed by this focused check.
