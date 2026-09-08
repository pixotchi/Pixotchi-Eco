# Medium architecture remediation — 2026-09-08

Owner: transaction-core / architecture agent. Scope: ARC-01, ARC-03, ARC-04, ARC-05, ARC-07, ARC-08, ARC-09, ARC-10, ARC-11. Revalidated against the shared P1-fixed worktree, preserved by the root's `output/p2-baseline` hashes and patch. No commits, deployments, real wallet submissions, administrative sends or deletes.

## ARC-01 — Tab continuity

**Before / revalidation:** the game page still removed every inactive tab's managed query keys. The shared Farm provider and mounted query hooks then observed absent keys as defaults. Farm → Swap → Farm lost Lands; Ranking/Activity filters shared the same failure. Per-tab scroll was captured only after changing active content.

**Solution:** extracted `useGameNavigation` as the shell's navigation and scroll owner. Each view retains its own query keys; top-level tabs still push history and view/filter changes replace it. Scroll events retain each outgoing tab's position before the content changes, and a layout effect restores the incoming position. `navigateToGameTab` is a checked, typed event for both web and Mini App navigation; gameplay owns its optional dashboard-view extension and matching FarmViewProvider listener. The shell width/classes remain root-owned.

**Validation:** real hook + FarmViewProvider browser coverage checks Lands/filter/scroll continuity, Back/Forward, refresh/deep links, Mini App local persistence, and direct Land mint navigation. The shell imports this controller; root integration supplies full real-app journeys.

**Limits:** scroll is an in-memory session preference, not persisted across full reloads. Refresh retains URL view/filter state. Physical host-webview behavior remains part of deployment/device QA.

## ARC-03 — Disconnect preserves player preferences

**Before / revalidation:** WalletProfile still called broad `clearAppCaches` after a 100 ms timeout, keeping only tutorial/cache-version keys. Broad `pixotchi` matching removed theme, audio, performance, currency mode and owner guidance. Separate auth-prefix lists were duplicated in the auth controller and profile.

**Solution:** one `clearAuthCaches` policy clears only SDK identity storage and leaves response caches, app preferences, guidance and durable transaction proof intact. Disconnect awaits cleanup rather than allowing its old delayed callback to race the next connection. Existing owner-resource clearing and sessionStorageManager auth metadata clearing remain in their owners. Surface switching and Mini App close share the same narrow policy.

**Validation:** browser storage tests seed auth state, preference/guidance keys and EVM/transfer proof, disconnect, reload, and verify only identity storage was removed. P1 durable transaction protection in the broad reset helper remains unchanged.

**Limits:** broad `clearAppCaches` still exists for explicit cache-reset/migration call sites; disconnect no longer uses it as a factory reset.

## ARC-04 — Truthful Solana capability failure

**Before / revalidation:** failed bootstrap returned `hasUsableConnectors: false`, then Providers mounted an Ethereum-only configuration while the persisted auth surface remained `privysolana`.

**Solution:** `useSolanaBootstrap` owns loading/ready/unavailable state, attempt cancellation and a 20-second deadline. `SolanaBootstrapGate` prevents mounting wallet sign-in until the requested capability is ready. Failure offers Retry Solana and an explicit Ethereum choice; the latter reloads with the selected surface in the URL. A failed or disabled Solana request never silently offers Ethereum wallets. Connector/RPC configuration now derives from installed SDK types.

**Validation:** actual hook/gate tests inject a rejected loader, verify no ready wallet surface, retry to usable Solana state, and check that an alternate wallet is entered only by explicit selection.

**Limits:** tests control SDK import outcomes; they do not sign into external wallets or spend funds. Actual vendor UI/network availability depends on the installed SDK and deployment.

## ARC-05 — Durable authentication feedback

**Before / revalidation:** the game page ignored `errorState` and secure-session state. Mini App reconnection used fire-and-forget connect plus a fixed 1.2-second busy timeout. The main web action named the provider rather than the sign-in method.

**Solution:** extracted `LoginAuthActions`, typed auth reducer/state and `useMiniAppReconnect`. The UI presents current progress, durable inline errors, pending controls, retry and web alternatives. Mini App busy state tracks the awaited connector promise with an immediate duplicate-entry lock and releases on settlement. The web action says “Continue with wallet or email,” with Privy attribution below. External error fields are narrowed before display.

**Validation:** real reconnect hook holds pending state beyond 1.2 seconds, rejects with inline feedback, retries, resolves and clears feedback. Web failure retains a retry plus Base alternative. The root-owned real-app tests should use the updated player-facing labels.

**Limits:** wallet-owned approval prompts cannot be time-boxed as successful/failed; the app waits for their promise, as it should. Host-specific sign-in needs physical Mini App verification.

## ARC-07 — Runtime boundaries and type escape reduction

**Before / revalidation:** the global `UntypedValue` alias still bypassed compiler guarantees. Particularly unsafe areas were SDK configuration, partial Mini App context, API status casting and admin JSON consumed by numeric formatters.

**Solution:** installed SDK types replace provider/connector casts; `auth-presentation-data` narrows error codes/messages, host display fields and wallet names from unknown values. Status parses through its existing validated DTO and validates public RPC metrics before formatting. Admin AI responses use `parseAdminAiSnapshot` and preserve an inline error on invalid data. A deliberately malformed AI stats response reproduced the existing `toLocaleString`/`toFixed` render crash during this work, so that concrete boundary now fails safely. Broadcast request payload and current broadcast state have explicit types.

**Validation:** runtime malformed-field cases cover nested wallet errors, invalid/nonfinite error codes, bad host FIDs/client fields, malformed status timestamps and invalid RPC counts. The real authenticated admin navigation test feeds malformed AI stats and verifies a stable dashboard with error feedback. Typecheck and targeted ESLint are part of the final checks.

**Measured boundary improvement:** the same seven initial architecture files now fall from 131 `UntypedValue` occurrences to **zero**: game page 7→0, providers 6→0, auth controller 54→0, admin page 51→0, wallet profile 7→0, Solana availability 3→0, status DTO 3→0. The newly extracted auth and admin owners also contain no escape aliases or explicit any. This is not a file-movement accounting trick: Base wallet providers, addresses, SIWE signatures, RPC payloads, public session DTOs and refresh request events now cross runtime validators. Signatures accept whole nonempty hexadecimal bytes, including variable-length EIP-1271 signatures; they do not impose an EOA-only length. Admin endpoint coverage and extraction are documented in [the admin completion report](fixes-medium-admin.md).

**Repository guard:** root added the AST-based `frontend:types` ceiling and CI source-quality check. It allows no new-file escape hatches and no per-file increases. The final check observed 624 existing escapes across 120 files; this is remaining repository debt, not an assertion that all code is now fully typed.

**Closure and limits:** the originally identified architecture boundary defects and the requested touched-file ratchet are resolved. Existing Base and legacy Coinbase negotiation paths remain supported through typed adapters and validators. Broader repository debt remains under the ratchet; this pass does not claim to type-check third-party SDK internals or eliminate every unrelated legacy escape.

## ARC-08 — Controller ownership and retry reuse

**Before / revalidation:** the game page owned URL pruning, scroll, auth presentation and a catch-to-error-component dynamic loader whose Retry reloaded the full app. Provider/profile lazy loaders separately cached and reset rejected module promises. Auth and profile duplicated cleanup policy; admin gate and confirmation added more state to the monolithic screen.

**Solution:** navigation, auth presentation, reconnect, bootstrap, typed auth reducer, status resource, admin access, admin confirmation and boundary parsers now have focused owners. The existing `THEMES` registry now derives `THEME_NAMES` for the provider and selector, with typed presentation metadata, removing independent supported-theme lists. A generic typed `createRetryableResource` shares successful/in-flight imports and releases rejection; tutorial/tasks/profile/tab paths use it. `createRetryableTab` retries the chunk locally, preserving surrounding mounted drafts. Admin selection/form fixes remain local; its access and confirmation flow are extracted. Admin capped lists/code blocks use the root's explicit ScrollArea owner (20 scroll containers), and its notification dialog uses one shared DialogBody.

**Validation:** a real retryable tab rejects its first load, retries successfully, and preserves an edited sibling draft. Navigation/auth/admin tests exercise the extracted owners. No P1 submission/recovery implementation was edited by this agent during the medium round.

**Completed ownership split:** `useAppAuthController` is now a 227-line shared state/surface orchestrator. `useBaseAuthAdapter` owns signed Base/test session restoration, autologin and recovery; `useBaseWalletAuthentication` owns SIWE negotiation and its legacy/same-provider fallbacks; `usePrivyAuthAdapter` owns EVM/Solana SDK callbacks, address binding and cancellation; the Mini App reconnect adapter awaits its connector promise. They share `AuthControllerState` and typed reducer actions. The admin owner completed ten cohesive section components with scoped read state, cancellation and endpoint DTOs; its shell is 168 lines with four local states. See [the admin completion report](fixes-medium-admin.md).

**Closure and limits:** the requested per-surface auth and admin ownership extractions are complete, alongside navigation, retry resources and explicit cleanup service. Protocol complexity still exists in the feature owner that needs it. Provider-level/deployment bundle measurement remains necessary before making performance claims.

## ARC-09 — Vendor theme parity

**Before / revalidation:** Privy appearance was always light while the game supports dark and six light chromatic themes.

**Solution:** `ThemedPrivyProvider`, mounted below the existing theme provider, derives supported vendor light/dark appearance from forced/resolved/selected app theme. Dark uses dark; light/chromatic themes use light. The decorative login hero cycle does not change the player's sign-in theme.

**Validation:** real next-themes provider and the adapter are tested over all eight app themes. The first focused test exposed forcedTheme precedence; it was corrected before the final run.

**Limits:** the vendor supports light/dark appearance, not the app's full chromatic token palette.

## ARC-10 — Dated, recoverable status

**Before / revalidation:** status rendered “Live” without generatedAt/overall, cast JSON, and had an unbounded in-flight fetch. A hung request prevented retry; headings skipped h1/h2.

**Solution:** extracted `useStatusSnapshot`, a 12-second abort deadline, validated response parsing, last-known snapshot preservation and an explicit retry on failure. The page shows Overall status, a deterministic UTC Last checked time, and stale/last-known notices. Staleness is 20 minutes: the actual server health sweep is every 15 minutes, with five minutes for public-cache grace. Refresh requests a newer server snapshot; it does not claim to execute an anonymous health sweep. Page/service headings use h1/h2.

**Validation:** actual status component tests render old timestamps, reject malformed API data while keeping existing health information, retry to a valid degraded snapshot, and abort a hung fetch so retry becomes usable. Public infrastructure redaction remains unchanged.

**Limits:** the public route deliberately reads cached server checks. Displayed timestamps make that age explicit; no privileged health execution was added.

## ARC-11 — Admin forms and dialogs

**Before / revalidation:** gate/broadcast/confirmation inputs lacked accessible labels; several single-choice button grids conveyed state only through CSS. The notification review nested 80vh/300px scroll caps. Auth errors were toast-only.

**Solution:** a real labelled admin sign-in form has required input, visibility control, pending state, bounded request, inline error and error association. Broadcast/search/campaign/eligibility/preview/CSV controls receive field names and key descriptions; single-choice grids expose selected state via aria-pressed and labelled groups. Admin navigation marks the current section. Typed confirmation labels the exact required text and uses shared form/body/footer layout. Notification review uses one scrolling body, with the footer outside it. Short-width strain selection wraps into two columns. Admin list scrollers explicitly own scroll fades.

**Validation:** real AdminDashboard fixtures authenticate with mocked read-only endpoints, navigate all ten sections, fill broadcast fields and inspect selected state, show a 150-recipient notification review, type the required claims confirmation then cancel, and verify no administrative writes were sent. Auth rejection remains inline. Runtime tests use shared Radix controls but not the full Tailwind visual stylesheet.

**Limits:** administrative sends/deletes are not exercised. The admin completion report records the final endpoint parsers and section fixtures. Full production-dataset, vendor-sheet and physical-device checks remain separate from this deterministic frontend validation.

## Additional root-authorized integration

FND-07: BalanceCard now uses the shared inspectable TokenAmount for SOL/wSOL/ETH/SEED/LEAF/PIXOTCHI and staking/reward balances. Exact values are accessible by keyboard and copy through the root's shared disclosure. A focused real BalanceCard test verifies a value with 18 fractional digits and absence of nested buttons. WalletProfile small info text uses the root's stronger info ink token.

## Independent auth review and follow-through

Independent reviews reproduced and corrected additional instances of the ARC-03/04/05 reliability findings:

- A confirmed Mini App with persisted `privysolana` and failed web capability startup did not mount host readiness. `HostWalletBoundary` now always mounts real host detection/readiness outside the Solana gate; a confirmed Mini App uses its host wallet despite that failed web capability. The original single ready attempt and 2.5-second local deadline remain.
- Delayed logout cleanup could erase the replacement wallet's SDK storage. A synchronous shared auth cleanup lock now covers logout and cleanup; visible, direct and automatic reconnect paths observe it. Local storage clears before the remote DELETE; that request has a 10-second abort deadline and cannot run a later storage sweep.
- A Base signature or session POST could finish after logout or an owner/surface switch. Scoped `AuthAttempt` objects bind owner/surface/generation, validate every awaited step, abort obsolete HTTP work and prevent authoritative session events before result publication. Caller success, failure cleanup and finally paths retain operation ownership, so old errors cannot disconnect a replacement owner.
- Privy's authenticated-address hydration could undo cleanup while the SDK was still logged in. Both hydration and SDK callbacks now respect cleanup/logout intent and the attempt generation.
- Rejected Base autologin could leave the login screen permanently pending because its effect cleaned itself up during an expected state transition. Operation lifetime is now independent of effect dependency rerenders, and the current operation settles its pending state on rejection.

Behavioral regressions hold signatures and session responses, change owner, delay and abort logout cleanup, hydrate Privy while cleanup is held, and reject actual Base autologin. They verify no stale POST/event/identity publication, no replacement-owner disconnect and enabled retry after failure. No actual wallet signatures, token transfers or administrative writes are made by these tests.

## Final validation

**102 passed**: 19 architecture cases plus 15 auth adapter cases across Chromium 390/light, Chromium 1440/dark and WebKit 390/light, output `output/architecture-medium-complete`. The corrected exact Privy storage-key/seed case was rerun independently and passed. `npx tsc --noEmit --pretty false`, targeted ESLint and `npm run frontend:types` passed. Auth, Mini App auth, cache, local-test logout, Solana bridge and Mini App ready smoke checks passed. Obsolete smoke file-location assertions were moved to the extracted owners while preserving their runtime behavior checks.

The focused fixtures use real application components/hooks and controlled SDK/HTTP responses. Architecture fixtures are behavioral checks without the complete Tailwind visual stylesheet; they do not establish physical-phone, Mini App host or vendor-owned wallet sheet coverage. Theme registry completion added one further case: the theme registry and all-eight-theme vendor adapter checks passed six checks across the same three projects (`output/architecture-theme-registry`). The final combined specs now contain 35 cases. Independent economy review reran and cleared the five reproduced auth race cases and their guard ordering. Root owns the final integrated matrix/build. No full app suite/build, commits, deployments or real transactions were performed by this agent in the medium round.

## Exact medium-owned files

Existing: `app/(game)/page.tsx`, `app/providers.tsx`, `app/admin/page.tsx`, `components/wallet-profile.tsx`, `components/balance-card.tsx`, `components/status/StatusPageClient.tsx`, `components/status/StatusCard.tsx`, `hooks/useAppAuthController.ts`, `lib/cache-utils.ts`, `lib/solana-auth-availability.ts`, `lib/status-snapshot.ts`.

New: `components/retryable-tab.tsx`, `components/auth/login-auth-actions.tsx`, `components/auth/solana-bootstrap-gate.tsx`, `components/auth/themed-privy-provider.tsx`, `components/admin/admin-access-gate.tsx`, `components/admin/admin-confirmation-dialog.tsx`, `hooks/useGameNavigation.ts`, `hooks/useStatusSnapshot.ts`, `hooks/useMiniAppReconnect.ts`, `hooks/useSolanaBootstrap.ts`, `lib/game-navigation.ts` (optional dashboard-view hunk co-owned by gameplay), `lib/retryable-resource.ts`, `lib/auth-controller-state.ts`, `lib/auth-presentation-data.ts`, `lib/admin-view-data.ts`, `tests/frontend/architecture-medium.spec.ts`, `tests/frontend/fixtures/architecture-medium.tsx`, `tests/frontend/fixtures/architecture-medium-mocks.tsx`, and this report.


Additional owned files from completion/review: `components/auth/host-wallet-boundary.tsx`, `hooks/useBaseAuthAdapter.ts`, `hooks/useBaseWalletAuthentication.ts`, `hooks/usePrivyAuthAdapter.ts`, `hooks/useAutoConnect.ts`, `lib/auth-cleanup.ts`, `lib/disconnect-wallet-identity.ts`, `lib/auth/auth-attempt.ts`, `lib/auth/base-wallet-boundary.ts`, `lib/auth/wallet-adapter-contract.ts`, `lib/auth/public-session-boundary.ts`, `lib/chat-auth-client.ts`, `lib/base-chat-session-refresh.ts`, `tests/frontend/auth-adapters-medium.spec.ts`, `tests/frontend/fixtures/auth-adapters-medium.tsx`, `tests/frontend/fixtures/auth-adapters-privy-mock.ts`, `smoke/auth-session-mission-hardening-smoke.ts`, `smoke/local-test-logout-smoke.ts`, and `smoke/miniapp-ready-smoke.ts`. Admin page/subtree final ownership transferred to the admin completion agent, whose report lists its additional files.

Theme registry final files: `lib/theme-utils.ts`, `components/server-theme-provider.tsx`, `components/theme-selector.tsx` (only registry/presentation derivation; prior root UI edits preserved).


Final smoke integration: `smoke/production-fixes-smoke.ts` passes, including asynchronous durable transaction checks. Only obsolete structural assertions were adapted to the extracted HostWalletBoundary, the disabled purchase-label fallback, and mandatory SwapQuoteReview. Root's earlier assertion fixes remain intact. This file is additionally co-owned with root for those specific test hunks.

Root real-app evidence: phone and tablet journeys passed. One initial desktop journey stayed connected after its second disconnect and logged an unexpected SIWE-domain error; its complete desktop rerun passed all steps. Read-only review of public evidence and the current source did not establish a reproducible source cause. Do not describe that initial failure as proven HMR behavior or claim this deterministic suite removes all intermittent host/integration risk; preserve both runs in the final integration record.
