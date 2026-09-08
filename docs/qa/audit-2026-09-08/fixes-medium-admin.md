# Medium admin remediation — 2026-09-08

Scope: complete the admin portions of ARC-07 and ARC-08, preserving and revalidating ARC-11. Work starts from the shared high-priority fixes and first architecture remediation. No server authentication policy, deployment, package/configuration, global stylesheet, or snapshot baseline changes. Administrative requests in tests are intercepted; no real messages, claims resets, or deletes were performed.

## Original requirements and revalidation

ARC-07 called for validated external DTOs rather than hiding unchecked API data behind `UntypedValue`. The first architecture pass had validated AI conversation statistics, but the remaining admin broadcast/notification/airdrop/claims/dashboard responses still entered state directly. Nested collections reached `.map`, token amounts and requirements reached number formatters, dates reached date-fns, and external identifiers reached administrative request URLs without consistent validation.

ARC-08 called for feature ownership, scoped hooks and shared loading/retry behavior. After the initial access/confirmation extraction, `app/admin/page.tsx` still contained 3,913 lines and the state, reads, writes and markup for all ten sections. ARC-11's labelled gate, form controls, explicit navigation selection, confirmation policy, DialogBody/footer and ScrollArea owners already existed and needed to survive the extraction.

## ARC-07 — Validated admin boundaries

`lib/admin-api-data.ts` validates the values actually consumed by broadcast, chat, AI message detail, feedback, RPC, leaderboards, share previews, airdrop management and Base Verify claims. Schemas check collection shapes, safe counts, dates within JavaScript's supported range, token decimal strings, nested balance requirements, action addresses and display strings. The existing AI conversation parser additionally rejects dates outside the supported range. State and render loops use inferred DTO types.

`lib/admin-notification-data.ts` validates notification statistics, provider-specific audience snapshots, campaign history, eligibility, grouped Redis keys, campaign previews and operation outcomes. Arbitrary logs, tool inputs and Redis values remain `unknown` and are displayed only through JSON formatting. Optional user-supplied Farcaster profile hints are sanitized independently: an API-accepted negative FID is discarded while its valid feedback record remains available for moderation.

Invalid read responses produce scoped inline errors with retry. Invalid refreshes clear data-driven action targets. Eligibility refreshes and filter changes invalidate prior recipients; missing plant throttle information cannot make a recipient sendable. Base campaigns require a valid preview for the current draft, and draft edits/tab changes invalidate that preview. Late responses cannot restore obsolete recipient sets or previews.

Independent response-parity review found and corrected two additional details before handoff: claims reset returns `deleted: { walletClaims, verifiedClaims }`, which is accepted without confusing the separate numeric gamification deletion count; AI conversation identifiers and broadcast IDs are query-encoded, so an ID containing `&all=true` stays a single ID parameter.

The prior architecture report measured 45 remaining `UntypedValue` occurrences in the admin page after its first pass. There are now **zero** `UntypedValue` or explicit `any` type escapes across the page, all ten new feature sections, the shared admin helper, new read hook and DTO modules. The escapes were removed rather than relocated.

## ARC-08 — Scoped section ownership

The page is now a 168-line shell with four state values: authentication, in-memory key, active section and shared confirmation. Ten focused components own Broadcast, Chat, AI Chat, Gamification, RPC, Notifications, OG Images, Feedback, Airdrop and Claims. Their explicit props provide only the key, active state and confirmation callback where needed. Sections stay mounted across navigation so unsent drafts persist; logout unmounts the authenticated sections and releases their state.

`useAdminRead` provides the common read lifecycle: initial/loading/error/data, a 15-second deadline, cancellation on hide/unmount, last-attempt checks, response validation and local retry. Snapshot scope follows the endpoint and key, including selected AI conversation details. A failed resource does not require reloading the entire dashboard. Notification handlers retain their separate operation lifecycles and request generations because read eligibility, preview, sync, review and send have different controls.

The original access gate, confirmation behavior, notification review structure and explicit scroll owners remain. The low broadcast-priority label now uses the shared muted-foreground token after the real-style review exposed its dark-theme contrast issue.

## Validation and evidence

- `tests/frontend/admin-medium.spec.ts`: 14 focused cases covering malformed nested DTOs, broadcast/CSV/OG/campaign draft continuity, claims action readiness, chat/feedback/RPC/leaderboard retry, timeouts, notification stats/keys/eligibility, AI tool records, Base preview invalidation, exact claims-reset response parity, query-encoded AI deletion and optional negative-FID metadata. All passed across Chromium 390/light, Chromium 1440/dark and WebKit 390/light in bounded runs after the relevant edits.
- The three existing actual-admin cases in `architecture-medium.spec.ts` passed in the same three projects: gate/form semantics, all-ten-section navigation and cancel-only typed confirmation, plus a 150-recipient notification review. Its valid eligibility fixture now supplies explicit plant throttles and `throttledUsers`, matching the real endpoint.
- `tests/frontend/admin-notification-data.spec.ts`: 27 pure validator cases passed. They cover Base/Neynar shapes, malformed provider identities, counts/dates/collections, conservative throttle handling, preview consistency, success outcomes and HTTP/error extraction.
- Real application CSS is compiled from `app/globals.css` through PostCSS/Tailwind for the bounded admin layout case. It verifies navigation controls and form fields fit, controls meet the 44px minimum, the form submit control is reachable, and the long notification dialog has exactly one scrolling descendant with a visible footer. Phone/light and desktop/dark screenshots were visually inspected; WebKit phone geometry also passed. Other isolated behavior cases retain their minimal dialog stylesheet and are not claimed as full visual coverage.
- Final scoped ESLint: passed with no warnings. Final TypeScript check using `output/tsconfig.admin-medium.json`: passed. A whole-repository check during concurrent auth work reported only `useBaseAuthAdapter.ts` errors; root owns the final repository check.

Evidence directories: `output/admin-medium-final` (30 initial passing cases; six eligibility/review failures diagnosed), `output/admin-notification-final` (nine passing corrected/new notification cases), `output/admin-review-final` (nine passing layout and reviewer regressions), and `output/admin-feedback-final` (six passing parser/optional-profile cases). The failures were caused by an unnecessary trailing `?` in the extracted eligible URL and an incomplete older valid-response fixture; both were corrected. Final screenshots are in `output/admin-review-final/*/admin-navigation-layout.png`, `admin-broadcast-layout.png` and `admin-notification-layout.png`. No snapshots were replaced.

## Remaining debt and limits

The backend still contains legacy untyped storage/service code outside this frontend scope. Live delivery, real destructive operations, physical devices and production dataset migration were not exercised. Airdrop server-reported balances are validated for shape and denomination strings; this work does not change the server's balance-fetch policy or independently attest those balances onchain. Feature extraction makes ownership explicit; it does not claim a measured bundle or runtime performance improvement.

## Owned files

Existing: `app/admin/page.tsx`, `lib/admin-view-data.ts`, and the valid eligibility-response line in `tests/frontend/architecture-medium.spec.ts` (coordinated with its owner).

New: `components/admin/admin-{broadcast,chat,ai-chat,gamification,rpc,notifications,og-images,feedback,airdrop,claims}-section.tsx`, `components/admin/admin-section-shared.tsx`, `hooks/useAdminRead.ts`, `lib/admin-api-data.ts`, `lib/admin-notification-data.ts`, `tests/frontend/admin-medium.spec.ts`, `tests/frontend/admin-notification-data.spec.ts`, `tests/frontend/fixtures/admin-medium.tsx`, and this report. Existing admin access/confirmation components were preserved. Extraction/formatting scripts and the focused TypeScript configuration are reproducible local working artifacts under ignored `output/`.
