# High-priority social/frontend fixes

Date: 2026-09-08. Scope: SS-01 through SS-05 from the social/secondary audit. All five findings were revalidated against the current checkout before changes. No finding was withdrawn. No real claim, game transaction, public message or AI question was sent during this work.

## SS-01 — Kill cooldown — fixed

**Revalidation:** The dialog showed cooldown text but did not disable its transaction. Revalidation also found a second fail-open below the component: `getKillCooldown` treated either failed multicall result as eligibility and returned eligibility from its catch handler.

**Change:** Both contract reads must succeed and yield a valid result. The dialog maintains loading/ready/error state with a wallet owner and request generation; opening a dialog clears previous readiness immediately. Unknown/error states disable submission and offer Check Again. Active cooldown displays its timer inline. The actual submission performs another read and rejects an active/unknown cooldown through the transaction controller's awaited preflight. Changing wallets invalidates reads and closes the old action dialogs. Living-plant data must also be ready.

**Files:** [leaderboard-tab.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/leaderboard-tab.tsx), [kill-transaction.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/kill-transaction.tsx), [contracts.ts](C:/Users/Goat/Documents/Pixotchi-Eco/lib/contracts.ts), [ranking-action-readiness.ts](C:/Users/Goat/Documents/Pixotchi-Eco/lib/ranking-action-readiness.ts).

**Validation:** Behavioral smoke invokes the actual cooldown reader with failing individual multicall results, malformed negative time and a valid active cooldown; none of the failures authorizes an action. Preflight tests reject both explicit `canKill: false` and nonzero remaining time. A separate agent reviewed the component/wrapper/core integration and found no remaining submission bypass. No paid/live kill was necessary.

## SS-02 — Revive quote and balance — fixed

**Revalidation:** The dialog initialized a 100-SEED price, substituted that price on failure, and retained unscoped balance values. The reported defect remained present.

**Change:** A single wallet-scoped read snapshot owns cost and balance. Both must resolve successfully; no assumed price or balance authorizes revival. Loading and failure have explicit copy and retry, and “not enough SEED” appears only after a verified read. Reopening invalidates old readiness. Immediately before submission, price and balance are read again. A changed price updates the review and rejects that attempt, requiring another deliberate confirmation; an insufficient or failed current balance also rejects. Wallet changes invalidate old reads and close the old review. Zero is preserved as a valid successfully read price rather than replaced with a fallback.

**Files:** [leaderboard-tab.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/leaderboard-tab.tsx), [revive-transaction.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/revive-transaction.tsx), [ranking-action-readiness.ts](C:/Users/Goat/Documents/Pixotchi-Eco/lib/ranking-action-readiness.ts).

**Validation:** Behavioral smoke covers price failure, balance failure, current owner forwarding, changed price, insufficient current balance, valid paid cost and valid zero cost. Owner-generation tests cover A → B → A and unmount invalidation. Separate integration review verified the preflight stays mounted and reaches the shared controller. No live paid revival was sent.

## SS-03 — Verify Claim wallet ownership — fixed

**Revalidation:** Eligibility requests and verify/claim continuations had no owner guard. A pending signature could continue to the claim endpoint after its wallet ceased to be current.

**Change:** The production wrapper mounts a separate claim controller keyed by wallet. Eligibility requests abort on cleanup and cannot publish after invalidation. Every asynchronous signature/verification/claim continuation checks its initiating operation. The submitted claim request contains its captured original owner. A claim already submitted remains the server's original-wallet operation, while its late response cannot show a celebration or call refresh/share callbacks under another wallet. Hidden feature policy now prevents mounting the read controller at all.

**Files:** [verify-claim.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/verify-claim.tsx), [useOwnerOperationScope.ts](C:/Users/Goat/Documents/Pixotchi-Eco/hooks/useOwnerOperationScope.ts), [owner-operation-scope.ts](C:/Users/Goat/Documents/Pixotchi-Eco/lib/owner-operation-scope.ts).

**Validation:** Browser tests use the actual claim controller with deferred mock signing/network responses. They verify slow A “already claimed” cannot hide eligible B; switching during signature produces zero claim submissions; a submitted A claim completing under B produces zero success callbacks and leaves B's claim available. All three scenarios passed in Chromium 390/light, Chromium 1440/dark and WebKit 390/light.

## SS-04 — Neural Seed send result and draft recovery — fixed

**Revalidation:** A probe of the installed AI SDK again confirmed that a rejected transport sets `status: error` while the `sendMessage` promise resolves. The provider consequently returned true and the composer discarded the draft. The installed HTTP transport also discards HTTP status when constructing its error, so text matching alone was an unreliable authentication signal.

**Change:** The lazy AI engine now reports explicit accepted/failed/cancelled results using per-attempt SDK error/finish callbacks. Missing completion is failure. The provider clears a draft only for accepted completion; failed sends reach shared session recovery on HTTP 401. The transport preserves 401 as a typed error even when response text lacks “401” or “unauthorized.” Failed/stopped user bubbles explain that the question remains editable and can be sent again. An unchanged retry replaces the failed bubble rather than duplicating it. Replacing history clears the retry target; a history revision also prevents a pending old send from reinstating an ID that history removed.

**Files:** [ai-chat-engine.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/chat/ai-chat-engine.tsx), [ai-send-outcome.ts](C:/Users/Goat/Documents/Pixotchi-Eco/lib/ai-send-outcome.ts), [ai-message-utils.ts](C:/Users/Goat/Documents/Pixotchi-Eco/components/chat/ai-message-utils.ts), [chat-context.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/chat/chat-context.tsx), [chat-message.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/chat/chat-message.tsx), [chat-message-bubble.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/chat/chat-message-bubble.tsx).

**Validation:** The smoke test exercises the installed SDK's real failure and success lifecycle without a network. Browser tests use the actual engine and composer with intercepted 401/SSE responses, verifying saved editable text, a failure notice, successful retry, one user bubble and cleared draft only after success. Three variants cover unchanged history, history replaced after failure and history replaced while the failing request is pending. All passed in Chromium 390/light, Chromium 1440/dark and WebKit 390/light. A separate reviewer identified the history-replacement edge case during implementation, and the final revision covers both orderings. Full provider/session bootstrap and cross-principal stream ownership are broader SS-07 follow-up scope; no real AI request was issued.

## SS-05 — Activity wallet freshness and stale requests — fixed

**Revalidation:** The shared 30-second timestamp skipped the new wallet's fetch after clearing its rows; no timer guaranteed recovery. The prior request could also publish when that new fetch was skipped.

**Change:** The actual Activity read lifecycle is extracted into `useActivityFeeds`. Freshness is keyed by normalized owner and reset on ownership change. Rows, personal error and asset classification are reset before the new wallet paints. Every request captures an owner generation and a unique request identity, so a previous wallet's response/finally cannot change the current feed or its spinner. A new owner always gets an immediate visible-tab fetch; retained-tab visibility still respects same-owner freshness.

**Files:** [activity-tab.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/tabs/activity-tab.tsx), [useActivityFeeds.ts](C:/Users/Goat/Documents/Pixotchi-Eco/hooks/useActivityFeeds.ts), [useOwnerOperationScope.ts](C:/Users/Goat/Documents/Pixotchi-Eco/hooks/useOwnerOperationScope.ts).

**Validation:** Browser tests use the production hook with deferred data reads. They connect/switch at 1 second and 29 seconds after public activity initialization, confirm both personal requests start, resolve B first and then A, and verify B remains visible without a stuck spinner. Both scenarios passed in Chromium 390/light, Chromium 1440/dark and WebKit 390/light.

## Test record and integration notes

- [social-p1-reliability-smoke.ts](C:/Users/Goat/Documents/Pixotchi-Eco/smoke/social-p1-reliability-smoke.ts): passed using `npx tsx smoke/social-p1-reliability-smoke.ts`. Expected unavailable-cooldown errors are logged by the actual reader during negative tests.
- [social-reliability.spec.ts](C:/Users/Goat/Documents/Pixotchi-Eco/tests/frontend/social-reliability.spec.ts): eight current scenarios across three projects, **24 passing scenario/project combinations**, validated in scoped runs. The last AI run was nine passed after HTTP-status preservation was added. Earlier 15 Activity/Claim contexts were unchanged and passed. Raw artifacts are under `output/social-p1-tests-final`, `output/social-p1-during-history` and `output/social-p1-auth-final`.
- The first AI browser attempt found an ambiguous test locator (`output` itself has role `status`); the selector was scoped to its message article. This was a test issue, fixed before the passing runs.
- Scoped ESLint passed; the only initial warning was an `any` in the smoke transport type, replaced with SDK `UIMessage`, then checked clean. Relevant installed Next client-component docs and the React best-practices skill were reviewed. Parallel cost/balance reads and lazy AI loading remain intact.
- Shared typecheck passed during this work. A subsequent concurrent run reported only two Baccarat smoke typing errors, communicated to its owner; the root integration pass owns the final whole-tree result.
- The awaited `GameTransaction.onButtonClick` preflight and retry enforcement are supplied by the transaction-core fix. The social wrappers forward it and do not implement a competing transaction executor.
- At integration's request, three Activity casino payout renderers were adapted to the new nullable token metadata: missing decimals show “Amount unavailable” rather than formatting as an assumed denomination. Broader Activity outcome-label fixes remain medium-priority work.
- The isolated `/qa/social-reliability` route is unavailable in production. Claim fixtures supply an in-memory request transport and mock signer; AI browser requests are intercepted. No production API or blockchain mutation is required by these tests.

**Remaining validation limit:** This closes the five reported code defects and exercises their critical async contracts. It does not claim a real Base Verify payout, real kill/revive receipt, physical iOS keyboard run, or every wallet/host session mode. Those are integration/device coverage limits, not unresolved versions of these five findings.
