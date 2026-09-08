# FND-12 — Shared Base artwork and animation lifecycle

Revalidated: `BaseAnimatedLogo` and `BaseExpandedLoadingLogo` duplicated all four SVG paths, the eight-color palette, initial colors, and timer/media-query logic. Both continued their decorative color interval while the document was hidden.

Added `components/ui/base-mark.tsx` for the unchanged decorative artwork and palette, and `hooks/useBaseMarkColors.ts` for the shared lifecycle. Both callers now stop their initial timeout and interval when hidden, when reduced motion is requested, in performance mode, or on cleanup. Returning to a visible, permitted state resumes the same calm 100ms initial change and 1500ms interval. An already-queued callback also checks visibility/preferences. Pointer exit keeps the final palette instead of causing an extra decorative change.

The About mark retains its fixed 200×60 footprint, mounted expanded/collapsed layers, and 700ms guard against synthetic mouse events following touch. The loading mark remains decorative inside one live status announcement; its existing size variants and loading text remain intact.

Validation: three focused production-component browser scenarios passed with compiled app styles. They verify shared paths and one loading announcement, pause/resume across visibility/reduced-motion/performance changes, no remaining color work after unmount, the touch echo guard, and unchanged measured footprint. Media-query tests wait for the browser's asynchronous rendering event before advancing the next color tick. Scoped ESLint and whitespace checks passed. No new `any`/`UntypedValue` types; no shared configuration changes. Root owns integrated typecheck and the complete shared regression matrix.
