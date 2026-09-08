# Frontend architecture, coverage, authentication, and operational surfaces

Audit date: 2026-09-08. Scope: read-only application audit; generated only files in this audit directory. This report distinguishes source-confirmed behavior, a runtime confirmation relayed by the root reviewer, and untested risks. It does not claim complete visual or transaction coverage.

## Architecture and what the application does

Pixotchi is a Base blockchain farming game with ERC-721 plants/lands, onchain plant care and competitive actions, land buildings/production/quests, token rewards and staking, swaps/marketplace/transfers, casino/arcade games, public chat/AI help, and social identity. Players enter through regular web wallets, Base accounts, Farcaster/Base Mini App hosts, or an optional Solana bridge whose Twin address holds Base assets. A localhost-only wallet path exists for development.

The frontend uses Next 16.3.4 App Router, React 19.2.8, Tailwind 4, TanStack Query 5, Wagmi/Viem, Privy, Radix Dialog/Dropdown, react-hot-toast, and next-themes. The root layout provides fonts, metadata, global CSS, and analytics. `(game)/layout.tsx` passes a server-rendered login hero into a client provider readiness gate. Most game UI is client-rendered after wallet/host initialization.

The main game is one route with six URL-backed tabs: Farm, Mint, Activity, Ranking, Swap, About. Farm and Mint share a provider holding Plants/Lands choices. On web, top-level tabs push browser history while subviews/filter/page state replace the current entry. Mini Apps use local state. Tabs load lazily, then stay in React Activity boundaries so local state survives while hidden effects stop. The shell separately tracks the shared content scroller's position per tab. Breakpoints are 54rem for tablet/two-column behavior and 80rem for desktop left navigation; compact landscape moves status into the header at widths >=54rem and height <=700px.

Provider flow: Theme -> Snow -> Ambient Audio -> Paymaster -> Privy -> QueryClient -> HostEnvironment -> wallet-specific Wagmi config -> Frame -> SmartWallet -> EthMode -> SolanaWallet -> Balance -> Staking -> Chat -> Tutorial. OwnerResourceQuerySync sits next to HostEnvironment. Tasks, tutorial, wallet profile, broadcasts, and visual effects have different deferred-loading mechanisms. CoreProviders gives status/admin theme/toasts without game wallet dependencies.

Data is split between onchain reads, server API/indexer data, and local persistent intent/preferences. Owner-resource lists use owner-keyed TanStack Query caches; post-receipt invalidation reconciles visible and inactive views. Balances retain last successful values while exposing per-token unknown/ready/error status. Typed events coordinate balance/resource refreshes and global dialogs, with legacy event aliases retained. Durable EVM, bridge, transfer, EFP and SpinLeaf pending records are preserved during cache clearing. Auth cleanup, provider switching, service sessions, and wallet connector state are partly coordinated through storage and browser events.

Routes identified:

| Route | Purpose and entry behavior |
| --- | --- |
| `/` | Wallet/login gate and six-tab game shell |
| `/admin` | Separate administrative dashboard, key gate, ten operation sections |
| `/status` | Health cards; normally redirected to the status domain; standalone status mode rewrites `/` here |
| `/share/m/[id]` | Server-rendered mint share landing/metadata with missing/unavailable distinction |
| `/join` | Base referral redirect |
| `/qa/frontend` | Development-only deterministic fixtures; returns 404 in production |
| Error/loading/not-found routes | Root error and global error, share error/loading, status loading, root not-found |

## Inventory and how coverage was measured

The reproducible TypeScript AST inventory is `inventory.cjs`. It enumerated 509 code/style files under app/components/hooks/lib, 123,381 newline-delimited lines, 183 component files, 26 hook files, 178 shared library files, 89 API route files, 14 route/UI entry files, 11 QA fixture files, and 8 other app-infrastructure files. Counts include server code and type files; line counts retain a final empty line when present. They are scale measures, not reviewed-line or code-coverage percentages.

Artifacts:

- `source-inventory.csv`: every source file, category, lines, client directive, state/effect counts, UntypedValue references, raw controls, DialogContent sites, contexts, imports, and tests explicitly naming the source. An absent explicit test reference does not mean absence of indirect coverage.
- `dialog-sites.csv`: all 33 production DialogContent call sites, plus four fixture sites, with current line numbers and opening-element properties.
- `route-inventory.csv`: route/UI/API entry files.
- `inventory-summary.json`: aggregate measurements.

There are 16 files creating contexts and 220 files with explicit client directives. `UntypedValue` appears 776 times across 130 files. Five Playwright specs define 44 tests; the 14 configured projects produce 616 project/test combinations, including repeated/conditionally skipped cases. Every suite navigates only to `/qa/frontend`.

`npm run frontend:smoke` passed all four suites on this checkout: frontend quality, recovery, boundaries, and dialog inventory. The browser run is owned by the root reviewer; its result belongs in the final consolidated audit. No test transactions or administrative messages were submitted by this reviewer.

The existing dialog CSV is an honest call-site register and explicitly records remaining integration checks. Its associated smoke verifies that every production DialogContent has an entry and names an existing test file. It does not prove that a given real dialog, its content branches, or its transactions are actually exercised by that test file. It also does not inventory third-party wallet sheets, dropdowns, full-screen overlays, browser/native prompts, or every nested state of a dialog.

## Findings

### ARC-01 — Tab navigation resets the player's selected view and filters (P2, source + runtime confirmed)

Evidence: `app/(game)/page.tsx:797` deletes query keys not on the active tab's allowlist and emits WEB_QUERY_STATE_EVENT at 829. `lib/farm-view-context.tsx:52` reads dashboardView with a default of plants; `hooks/useWebQueryState.ts:82` rereads missing values as defaults. FarmViewProvider stays mounted outside Activity at `app/(game)/page.tsx:1183`.

The root reviewer reproduced Farm -> Lands -> Swap -> Farm returning to Plants in the regular web Local Test Wallet session, which currently has no plants and land #1112. The app separately restores the outgoing scroll position, so state and position can refer to different views. Activity/Ranking URL-backed filters/pages are exposed to the same cleanup behavior when their effects resume. Mini App local state has a different persistence behavior.

Proposed fix: retain each tab's state in one navigation store keyed by tab, serialize only the active view if clean URLs are desired, and restore that state before scroll. Alternatively preserve inactive query keys. Add a real-shell test for view/filter/page + scroll continuity, browser Back/Forward, refresh/deep link, and Mini App parity.

### ARC-02 — Metadata failures can silently change token labels and denomination (P1, source confirmed with domain reviewers)

Evidence: `hooks/useTokenMetadata.ts:28` drops individual contract statuses/error and defaults decimals to 18 at 29; its return has no error/ready contract. `hooks/useTokenSymbol.ts:23` substitutes SEED on a failed symbol read. Barracks calls both separately at `components/building-details/BarracksPanelV2.tsx:157`, formats costs at 563, and enables actions based on allowances/balances at 609 and 750 without requiring metadata readiness. Roulette consumes decimals at `components/transactions/CasinoDialog.tsx:126`, parses amounts at 493, and has no metadata-ready gate in the CTA block starting at 1004. These consumer checks were independently confirmed by the building/casino reviewers.

For a configured token with decimals other than 18, a metadata outage or delayed read can show misleading limits/costs and parse a different denomination than the player entered. The contract may reject many such values; that does not make the displayed review reliable. A failed symbol is also represented as the entirely different SEED token.

Proposed fix: one chain+address keyed token metadata resource returning loading/ready/error, validated symbol and decimals, explicit retry, and separately labelled last-known values. Use a trusted registry for known tokens if appropriate. Block amount parsing/review/submission until required metadata is verified; never invent a token identity. Cover non-18 tokens, partial symbol/decimals failures, address changes while a read is pending, and active-game recovery. Coordinate with the casino/building findings rather than counting this twice.

### ARC-03 — Disconnect erases presentation/accessibility preferences (P2, source confirmed)

Evidence: `components/wallet-profile.tsx:578` calls clearAppCaches without onlyPrefixes, preserving only `pixotchi:tutorial` and `pixotchi:cache_version`. `lib/cache-utils.ts:15` includes broad `pixotchi` prefixes and removes every matching non-preserved key at 69–73. Preferences use those prefixes: `pixotchi-theme`, `pixotchi:performance-mode` (`components/ui/performance-mode.tsx:5`), `pixotchi:ethMode` (`lib/eth-mode-context.tsx:5`), and `pixotchi:ambient-audio` (`lib/ambient-audio-context.tsx:32`). First-care progress is also wallet-keyed under this namespace.

After disconnect, mounted providers can temporarily retain the old values in memory while storage has been deleted; the next reload restores defaults. Players must repeatedly reconfigure appearance/performance, and guidance can reappear. Surface switching already uses a narrower auth-prefix list, so cleanup behavior is inconsistent. Durable transaction evidence is correctly protected and should remain protected.

Proposed fix: separate auth/session cleanup, owner-cache invalidation, personal preferences, and durable transaction storage into explicit APIs. Keep appearance, accessibility/performance, audio and completed guidance across ordinary disconnects. Add a disconnect/reconnect/reload preference-preservation test.

### ARC-04 — Failed Solana bootstrap can offer an incompatible EVM login (P2, source confirmed; failure not injected live)

Evidence: `app/providers.tsx:154` catches Solana connector/bootstrap failure and returns hasUsableConnectors false; `app/providers.tsx:601` warns and falls through to ethereum-only configuration at 612. The authSurface stays privysolana. `hooks/useAppAuthController.ts:1172` requires authenticated + hasSolanaWallet for that surface. `components/solana/SolanaWalletProvider.tsx:60` likewise selects the identity bridge from the stored surface.

The provider can therefore offer an EVM login under a surface that cannot consider an EVM-only identity connected. The explanation exists only in console output. This is also a maintainability example: selected mode, offered capabilities, and successful-auth condition are maintained separately.

Proposed fix: represent Solana capability bootstrap as loading/ready/unavailable in the auth controller; show Retry Solana and a clearly labelled switch to another wallet path. Do not silently change the offered network while retaining the old auth condition. Add a controlled bootstrap failure test.

### ARC-05 — Auth errors do not have persistent, actionable screen state (P2, source confirmed)

Evidence: `hooks/useAppAuthController.ts:159` owns errorState and sets it on reset/failure (for example 261 and 1658), but `app/(game)/page.tsx` never reads errorState or secureSessionState. LoginAuthActions at 306 renders Connecting... plus Retry Connection for Mini Apps without distinguishing idle/error/connecting. Base/Privy errors are primarily toasts. The Mini App retry handler at `hooks/useAppAuthController.ts:1709` calls fire-and-forget connect and resets its busy flag after 1.2 seconds independent of actual completion.

A player who misses a toast returns to apparently identical login controls or an indefinite Connecting label. The controller's richer state cannot help the player because it is not rendered. Retry can stop looking busy while wallet work is still pending.

Proposed fix: a single auth presentation state with durable inline error, current step, pending controls, Retry and alternative sign-in. Derive pending duration from the connector promise/status. Keep low-level diagnostics in telemetry; explain the concrete next step in product copy. Consider replacing the implementation-centric primary label Continue with Privy with Wallet or email, keeping provider attribution secondary.

### ARC-06 — Tests cover shared pieces far more thoroughly than real player journeys (P1 quality gate, coverage gap)

Evidence: all five specs use page.goto('/qa/frontend'); the fixture page explicitly excludes the wallet/provider tree, live reads and mutations. `playwright.config.ts:11` defines widths 320/390/820/864/1024/1440 and two WebKit contexts, but defaults every project to reduced motion. `tests/frontend/primitives.spec.ts:9` is a useful exception that explicitly tests notification icons in normal/system/performance modes. It is not app/game motion coverage. `tests/frontend/dense-surfaces.spec.ts:65` snapshots only Barracks/chat/arcade fragments in three Windows-only contexts and skips elsewhere.

The existing suite has meaningful controller races, amounts, keyboard, IME, dialog geometry, synthetic keyboard viewport, enlarged-text and overflow tests. Those are valuable. However the passing matrix does not detect ARC-01, third-party auth overlays, login/provider transitions, shell layout, resize during actual transactions, real dialogue content combinations, mobile wallet return-to-app, or normal game motion. Current device projects are viewport emulation, not physical iPhone/iPad/Android keyboard or Mini App hosts. Colored themes beyond light/dark are not matrix projects.

Proposed fix: retain fast deterministic fixtures and add a staging-capable real-app suite with a seeded wallet/data state and controlled transaction adapter. Required journeys: connect/disconnect/reconnect, Farm/lands/view continuity, mint and first care, building/quest/claim, swap, marketplace, transfer, staking, casino recovery, chat, owner/network changes, interruption+reload, and external-wallet handoff. Add per-surface state contracts: initial/loading/empty/error/stale, validation, unsupported wallet, insufficient funds, approval, review, signature rejection, pending, confirmed, failed, uncertain/recovery. Capture actual surfaces at narrow phone, tablet at either side of 864px, laptop/desktop, short landscape, 200% text, all theme tokens, normal/reduced/performance motion. Use physical device runs for keyboard and host integration. Report covered states and remaining states separately rather than a single misleading percentage.

### ARC-07 — A global any alias hides the most fragile boundaries (P2 maintainability, source confirmed)

Evidence: `lib/untyped-value.d.ts:6` defines UntypedValue as ReturnType<typeof JSON.parse>, which is any. The AST inventory finds 776 references in 130 files. The auth controller alone has 54; the admin screen 50. Dynamic tab import signatures, provider configs, API results, connector data and event payloads make frequent use of it.

The alias preserves the same lack of type checking as explicit any while making a simple any search/lint report look cleaner. This does not mean every occurrence is unsafe; many have local guards. It does mean compiler success is a weaker signal than the TypeScript footprint suggests, and the duplicated metadata/auth state contracts demonstrate practical drift.

Proposed fix: eliminate this alias at external boundaries first. Parse unknown service/connector/event input with discriminated DTOs and runtime validators, then pass typed domain values inward. Track and ratchet the count in touched files. Avoid a broad cosmetic any-to-unknown sweep without validators.

### ARC-08 — Large controllers and duplicated loading/cleanup policies make consistency expensive (P2 maintainability, source confirmed)

Evidence from inventory: app/admin/page.tsx ~4,030 lines with 76 useState calls; hooks/useAppAuthController.ts ~1,757 lines; app/(game)/page.tsx ~1,314 lines with 12 effects; app/providers.tsx ~834 lines with 16 useState calls. Wallet profile ~1,063 lines combines identity, capability explanations, presentation settings, export and disconnect. Provider tutorial/tasks loaders duplicate promise/loading/error/open handling; the wallet loader implements another version. Tab import failures instead return a permanently cached error component and Retry reloads the whole app (`app/(game)/page.tsx:87–133`). Auth-prefix cleanup lists are duplicated in the auth controller and wallet profile, while ordinary disconnect uses broad cleanup.

The problem is ownership boundaries and repeated policy, not line count by itself. Feature-specific failure behavior currently differs: some chunks have local Retry, tab failures require full reload, and some dynamic imports have no local fallback. Pending/draft state can be lost on a full reload even though durable transaction proof survives.

Proposed fix: extract the app shell/navigation controller, an auth adapter per wallet surface with a shared state contract, typed deferred-dialog loader, and explicit cleanup service. Split admin sections into route/subsection components with scoped hooks. Use one resource-loading/retry contract and one source of truth for theme names. Retain the owner-resource query cache and receipt reconciliation improvements already present.

### ARC-09 — Privy's modal theme is disconnected from the app theme (P2 visual consistency, source confirmed)

Evidence: `app/providers.tsx:625` sets appearance.theme to light unconditionally. The app has eight themes and persists a dark theme. `components/auth/surface-switch-buttons.tsx:27` already maps the Base vendor button to light/dark, so third-party surfaces have different theme policies.

Proposed fix: apply the currently selected theme's supported light/dark appearance to Privy through a small themed auth provider adapter. Include text, fields, error and wallet list states in dark-mode interaction review. The login's independently cycling local palette is another reason to define a clear rule for which palette the auth sheet follows.

### ARC-10 — Status page has no freshness/overall summary and refresh can remain blocked (P2 reliability, source confirmed)

Evidence: `lib/status-snapshot.ts:12` provides generatedAt and overall. `components/status/StatusPageClient.tsx:123` displays Live ecosystem health and only maps services at 158; it renders neither overall status nor generatedAt. A failed refresh keeps the existing snapshot and shows an error, but a player cannot determine how old those green statuses are. `refresh` at 25 uses one in-flight boolean and fetch without an application timeout/AbortController; a hung request prevents subsequent refresh attempts until it settles. The response is cast to StatusSnapshot at 36 instead of using the existing parser. The page has no h1; card headings start at h3.

Proposed fix: show Overall status and Last checked [time], explicitly mark stale data after a freshness threshold, and preserve last-known data with a clear stale state. Bound/abort requests and permit retry. Parse the response using the existing safe snapshot parser. Use an h1 for the page and h2 for services. Keep internal infrastructure details redacted as the public DTO already does.

### ARC-11 — Admin UI still bypasses shared accessible form and selection contracts (P2 secondary surface, source confirmed)

Evidence: `app/admin/page.tsx:1685` and 1696 render visual labels without htmlFor and fields without matching ids; the login at 1500 uses placeholder-only naming; confirmation text at 3992 is a paragraph adjacent to an unlabelled input. The broadcast type grid at 1720 indicates selection only through CSS classes, not aria-pressed/radio semantics. The notification dialog at 3899 uses custom max-h-[80vh] and nested max-h-[300px] scrolling; confirmation uses another custom layout. The 10 admin sections share the 4,030-line stateful screen. Existing dialog coverage deliberately stops at shared chrome/admin gate rather than authenticated state coverage.

Proposed fix: use the same field-id/error-description helpers and ToggleGroup/radio pattern as player UI; migrate forms and confirmations onto the form/dialog-body/footer contract. Add deterministic authenticated admin fixtures for read-only navigation, long recipient lists, empty/error states and form validation. Administrative sends/deletes are separate action checks, not necessary to verify layout.

## Additional risks and polish opportunities to validate

- AppUpdateBanner has no fetch deadline and its Refresh directly reloads the page without knowing about in-progress drafts/transactions (`components/app-update-banner.tsx:44`, 105). Durable receipts are protected, but unsubmitted drafts need a continuity policy. Consider a defer/dismiss action and refresh only after pending work is safely represented. This is a workflow risk, not an observed lost transaction.
- `app/global-error.tsx:51` centers a fixed h-full layout rather than using the scroll-safe min-height/margins pattern in app/error.tsx. Verify real global-error screens at short landscape/200% text before asserting clipping.
- A returned mint share and not-found route do not mount CoreProviders; they use CSS default appearance rather than applying stored game theme. Decide whether these standalone public pages intentionally use a single theme.
- CountdownTimer and FenceTimer duplicate badge layout and use one useCountdown interval per instance. useCountdown ticks every second even when seconds are hidden and does not explicitly pause on document visibility; useDeadlineClock does. Consolidate display/time semantics where useful and measure an asset-rich farm before calling this a performance defect.
- The broad client provider tree is mitigated by lazy tabs/wallet configs, server login markup, memoized providers and hidden-tab effects. Still measure production cold load, interactive readiness, memory after visiting all six tabs, long tasks during game animation, and wallet-resume latency on a low-end phone. Source size alone is not a bundle/performance verdict.
- Multiple retained legacy aliases/helpers deserve retirement criteria: event aliases, auth surface coinbase->base normalization, older wagmi result shapes, several independent Farcaster SDK promise loaders, and separate token-symbol/metadata hooks. Remove only with compatibility evidence.

## Recommended implementation sequence

1. Correct token metadata readiness, tab/view continuity, and preference preservation; add integration regressions for those exact behaviors.
2. Make authentication and capability failures explicit and recoverable; apply third-party theme parity.
3. Establish a seeded real-app journey harness and state-by-device coverage register; use the current fixture suite as the fast base.
4. Extract ownership boundaries incrementally while touching those features: navigation, per-surface auth, deferred dialogs, cleanup policy, typed metadata resource. Keep shared runtime validations close to network/chain boundaries.
5. Finish operational-page freshness and accessible form contracts; record physical-device and Mini App results before claiming cross-device completion.

## Exact source files reviewed in this architecture pass

Full or near-full reads of the relevant implementation (some were read in successive chunks):

- AGENTS.md; package.json; next.config.mjs; playwright.config.ts
- app/layout.tsx; app/(game)/layout.tsx; app/(game)/page.tsx; app/providers.tsx; app/core-providers.tsx
- app/error.tsx; app/global-error.tsx; app/not-found.tsx; app/status/page.tsx; app/status/layout.tsx; app/admin/layout.tsx; app/join/route.ts; app/qa/frontend/page.tsx; app/share/m/[id]/page.tsx; app/share/m/[id]/error.tsx
- components/login-hero.tsx; components/auth/surface-switch-buttons.tsx; components/wallet-profile.tsx; components/owner-resource-query-sync.tsx; components/app-update-banner.tsx; components/server-theme-provider.tsx; components/theme-initializer.tsx; components/countdown-timer.tsx; components/fence-timer.tsx
- components/status/StatusPageClient.tsx; components/status/StatusCard.tsx; components/status/StatusBadge.tsx; components/solana/SolanaGate.tsx; components/solana/SolanaWalletProvider.tsx
- hooks/useWebQueryState.ts; hooks/useMediaQuery.ts; hooks/useKeyboardAware.ts; hooks/useOwnerResourceList.ts; hooks/useDocumentVisible.ts; hooks/useAutoConnect.ts; hooks/useFarcaster.ts; hooks/useCountdown.ts; hooks/useDeadlineClock.ts; hooks/useDebounce.ts; hooks/useTokenMetadata.ts; hooks/useTokenSymbol.ts; hooks/useAuthSurface.ts
- lib/auth-surface.ts; lib/balance-context.tsx; lib/app-events.ts; lib/transaction-refresh.ts; lib/tab-visibility-context.tsx; lib/farm-view-context.tsx; lib/owner-resource-query-cache.ts; lib/query-keys.ts; lib/cache-utils.ts; lib/untyped-value.d.ts; lib/eth-mode-context.tsx; lib/paymaster-context.tsx; lib/duration-display.ts; lib/status-snapshot.ts
- app/api/status/checks/route.ts; components/tutorial/config.ts
- tests/frontend/primitives.spec.ts; tests/frontend/controllers.spec.ts; tests/frontend/dense-surfaces.spec.ts; tests/frontend/plant-attack.spec.ts; tests/frontend/garden-items.spec.ts; tests/frontend/dense-surfaces.spec.ts-snapshots/README.md
- smoke/frontend-dialog-inventory-smoke.ts; scripts/check-frontend-release.mjs; docs/qa/frontend-dialog-coverage-2026-09-05.csv

Targeted/excerpt review rather than full semantic review: app/admin/page.tsx (state ownership, auth, navigation, broadcast form, notification and generic confirmation dialogs); hooks/useAppAuthController.ts (surface switch, session reset, provider login, connection derivation, restoration/autologin, error and Mini App retry); lib/status-checks.ts (snapshot freshness/cache functions); lib/ambient-audio-context.tsx (preference/bootstrap); components/ui/performance-mode.tsx (storage/store); lib/first-care-progress.ts and lib/casino-bet-preferences.ts (storage-key references). Casino/Barracks consumer evidence was cross-checked by the respective domain reviewers.

All 509 files were structurally enumerated with AST metrics; that is not a claim of line-by-line semantic review of all 509 files. Gameplay, transactions, social, foundation and casino reports document their own reviewed coverage. No application route API beyond the ones named above was audited comprehensively for backend correctness/security.

Relevant installed Next docs read before analysis: node_modules/next/dist/docs/01-app/01-getting-started/05-server-and-client-components.md; 10-error-handling.md; node_modules/next/dist/docs/01-app/02-guides/lazy-loading.md. They confirm the current client/server and dynamic-loading/error-boundary conventions used to assess this checkout.

## Runtime appendix — isolated ancillary-screen pass

An isolated agent-browser session named `audit0908ancillary` checked these entry states at 390x844 and 1440x900 without authentication or mutations. Screenshots and snapshots are in `output/playwright/audit-2026-09-08/ancillary/`. The browser was closed afterward. Next's development portal was hidden on local routes with an injected style. The root page was a fresh logged-out session with no stored theme and no test-wallet activation.

| Entry | Runtime result | Evidence |
| --- | --- | --- |
| `/admin` | Key gate rendered at both sizes with visible controls. At 390px the outer card touches both screen edges, unlike other standalone pages. The key field has zero associated labels and no aria-label; the accessibility snapshot names it from its placeholder. The page heading is h3, with no h1. | admin-390.png, admin-1440.png, admin-390.txt |
| `/nonexistent-audit-route` | Branded missing-page screen with visible Return to the farm action. Phone copy wraps cleanly; desktop content is centered and readable. No horizontal overflow observed. | not-found-390.png, not-found-1440.png, not-found-1440.txt |
| `/share/m/nonexistent` | Missing share resolves to the same branded missing-page treatment. Return to the farm is visible. No blank page or horizontal overflow observed. This does not verify unavailable-data errors or successful shares. | share-missing-390.png, share-missing-1440.png, share-missing-390.txt |
| `/status` | Redirects to the public status domain. Eight service cards use two desktop columns and one phone column. At capture, seven were Operational and Notifications (Base App) was Unknown. There is no last-checked timestamp, overall summary, h1, or visible manual Refresh control. Service names start at h3. The external deployment must not be treated as identical to the current checkout. | status-live-390.png, status-live-1440.png, status-live-390-full.png, status-live-390.txt, status-live-1440.txt |
| `/` logged out | Fresh login renders title, welcome copy, Web App notice, Continue with Privy, Sign in with Base, and localhost-only Local Test Wallet. This environment offers no Solana button. All controls fit at 390x844; desktop uses a compact centered card. Normal-motion captures caught different palettes during the intentional login theme cycle. The notice repeats implementation language and competes with the sign-in decision. No auth sheet was opened. | login-390.png, login-1440.png, login-390.txt, login-1440.txt |

Additional proposal: give the admin entry the shared phone gutter and explicit h1/field label while retaining its clear single-action hierarchy. Shorten login's platform explanation to the player-relevant sign-in choice. Physical keyboard behavior, provider sheets, operational failures, and successful share content remain unverified by this bounded pass.


