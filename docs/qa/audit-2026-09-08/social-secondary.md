# Social, ranking, activity, onboarding and secondary frontend audit

Audit date: 2026-09-08. Scope: current source in this checkout. No application code changed, wallet export performed, public message sent, or transaction submitted by this auditor. The root audit owns browser/device screenshots. Findings below explicitly distinguish source-confirmed defects, an executed dependency probe, and remaining device/auth validation.

## What these parts do

- Public chat and Neural Seed share a secure chat session across Base, Privy, Farcaster and Solana/twin authentication. Chat polls the latest 50 public messages, mirrors cached histories in a root context, lazy-loads the AI SDK, renders one selectable pane on smaller screens and two simultaneous panes at the desktop breakpoint. Messages can open a player profile, whose primary plant is fetched from its owner.
- Ranking offers plants, players, lands, staked SEED and Rocks. Plant rows additionally launch attack, kill, revive and profile dialogs. A common responsive ranking layout uses 12 mobile rows and 20 desktop rows, split into two columns; the land board uses 20 in both layouts. Player points use a snapshot with block/time attribution. Other boards have different fetching/error conventions.
- Activity combines 23 event variants, bundles matching care-item events, classifies them into categories and personal directions, and paginates locally. At the tablet breakpoint it changes from one selected feed to simultaneous All/My feeds. It reads owned asset IDs for personal perspective.
- Farmer's Tasks presents daily mission sections, rewards, streak and total progress. It receives global dialog and progress events and flushes an outbox. First Care Guide is a locally persisted checklist. Tutorial is a ten-slide modal with versioned local storage and optional gamification slide.
- Wallet Profile presents identity, provider/network, balances, settings, Solana bridge details, airdrop, transfer, disconnect and embedded wallet export. Verify Claim signs SIWE, checks Base Verify, then requests a free plant and bonuses. Airdrop signs a server message and polls durable claim state. Mint Share generates a short link and opens a sharing composer; the share route reads its Redis record for both page and metadata.

## Highest-priority findings

### SS-01 — P1 — Kill can remain enabled after its own dialog reports an active cooldown

**Evidence:** `components/tabs/leaderboard-tab.tsx:380–388` treats a cooldown read failure as `{canKill:true, remainingSeconds:0}`. Opening the dialog starts another asynchronous cooldown read (`398–402`). A late response can show the explicit active-cooldown warning at `1634–1637`, but the `KillTransaction` rendered at `1725–1741` receives no `disabled` prop. `components/transactions/kill-transaction.tsx:46,87` defaults that prop to false and passes it to GameTransaction.

**Impact:** The app invites the player to confirm a transaction it already knows is unavailable. Even if wallet simulation/contract checks reject it, that creates a predictable wallet interruption and avoidable failure. Failed RPC reads also masquerade as eligibility. The countdown fetch is not scoped to the current wallet, so a delayed old-wallet result can change the new wallet's cooldown.

**Fix:** Give cooldown state explicit loading/ready/error states keyed by wallet; disable confirmation while unavailable or cooling down, refresh immediately before submitting, and render the countdown and retry inline. Use the same preflight discipline as attack. Add a targeted delayed-read test that changes an initially available cooldown to unavailable while the dialog is open.

### SS-02 — P1 — Revive displays an assumed price and can use an old balance

**Evidence:** `components/tabs/leaderboard-tab.tsx:198–199` starts with zero balance and a hardcoded 100-SEED price. `415–428` silently substitutes that price when its read fails, silently catches a failed balance request, and has no owner/request cancellation or loading state. `1764` presents the resulting value as the cost; `1774–1792` derives the active CTA and “Not enough SEED” from those values. `components/transactions/revive-transaction.tsx:40–60` receives no verified price or balance context.

**Impact:** A funded player first sees an insufficient-balance message while data loads. An outage can continue showing a previous wallet's balance or an outdated cost as current; the review cannot reliably explain what the player is confirming.

**Fix:** Use an owner-keyed quote/read snapshot with loading, stale and failed states; never use a default price to authorize a paid action. Require a successful current read, expose retry, and clear/rescope the revive target on ownership changes. Reuse the existing resource/transaction review primitives.

### SS-03 — P1 — Free Verify Claim is not isolated to the initiating wallet

**Evidence:** `components/verify-claim.tsx:71–117` performs status requests on address changes without cancellation, generation tracking or an owner check before publishing the response. Verification and claim handlers at `119–275` similarly publish state/callbacks after asynchronous signing/network work without checking the initiating identity. Existing step, errors, bonuses and recovery state are not reset when the wallet changes. Compare the explicit `ownerKeyRef`/layout reset and response guards in `components/airdrop-claim-card.tsx:31–52,68–87,167,191–222`.

**Impact:** A slow status response for wallet A can hide the free-claim card for eligible wallet B or show A's recovery status under B. A claim finishing after a switch can show the wrong wallet's celebration and refresh/share side effects. This is source-confirmed missing request ownership; an actual cross-wallet signing flow was not executed.

**Fix:** Extract the proven owner-safe lifecycle from Airdrop into a reusable claim controller. Capture operation owner, invalidate/abort reads on change, guard every post-await UI publication, and keep any already-submitted operation attached to its original owner. Add slow-A/fast-B status and switch-during-signature coverage.

### SS-04 — P1 — Neural Seed reports an unsuccessful send as accepted and discards the draft

**Evidence:** `components/chat/chat-context.tsx:1396–1405` awaits `aiHandle.sendMessage(...)` and unconditionally returns true. `components/chat/chat-composer.tsx:33–37` clears the draft on true. The installed dependency catches request failures, sets error state and does not rethrow at `node_modules/ai/src/ui/chat.ts:824–854`. The separate `handleAiError` at `chat-context.tsx:749–753` only stores/toasts the error; consequently the 401 recovery catch at `1406–1408` also does not run for normal SDK transport errors.

**Executed probe:** Instantiated the installed `@ai-sdk/react` `Chat` class with an in-memory transport whose `sendMessages` throws `Simulated network failure`, then awaited `sendMessage({text:'preserve this draft'})`. Result: `{"promise":"resolved","status":"error","error":"Simulated network failure","messages":1}`. The probe had no network side effects.

**Impact:** A failed question leaves a user bubble in the conversation, clears the editable draft, and offers only a toast, with no explicit failed/retry affordance. Expired AI sessions can repeatedly fail without entering the intended recovery flow.

**Fix:** Make the engine's imperative send contract report an explicit accepted/failed/cancelled result using SDK callbacks/status, scoped to a request ID. Preserve the draft and mark the failed bubble retryable; route auth failures through shared session recovery. Do not infer success from Promise resolution.

### SS-05 — P1 — Switching wallets soon after loading Activity can leave “Mine” loading indefinitely

**Evidence:** `components/tabs/activity-tab.tsx:342–348` skips the visibility fetch when the last visible fetch started less than 30 seconds ago. `367–370` clears My rows and sets loading true on every wallet change. The visibility effect depends on the new address through `fetchActivities`, but the freshness guard is global rather than keyed by address; there is no scheduled retry when its 30 seconds elapse.

**Impact:** Switching from A to B (or connecting a wallet after viewing public activity) within that window can show a permanent personal-feed spinner until another visibility/dependency event triggers a fetch. An old pending request is also not invalidated merely by the clear effect, so it may still publish after a guard-skipped switch.

**Fix:** Key freshness and in-flight generation by effective owner and invalidate old requests synchronously on owner change; bypass freshness for a new owner. Prefer independently keyed All/My queries over hand-maintained shared request refs. Test wallet connect/switch at 1s and 29s after loading public activity.

## Reliability and interaction findings

### SS-06 — P2 — Chat history failure is rendered as a successful empty conversation

**Evidence:** `components/chat/chat-context.tsx:859–861` stores a history-fetch error. `components/chat/chat-messages.tsx:20–31` never consumes `error`; the empty-state branch at `114–179` shows “Be the first to start the conversation!” or “Ask Neural Seed!” whenever authentication succeeded and the failed fetch produced no messages. Existing cached messages likewise have no stale/error notice.

**Impact:** Players cannot distinguish an empty community or new conversation from a network/API failure, and have no local retry. The root provider exposes an error field that the primary consumer ignores.

**Fix:** Model per-mode loading/empty/error/stale states, retain cached content with a small reconnect banner, and render a Retry history button. Avoid a shared scalar error because the desktop panes can fail independently.

### SS-07 — P2 — AI runtime and fetch responses are not consistently scoped to the owner

**Evidence:** `components/chat/chat-context.tsx:607–635` clears visible/cache messages on auth/identity change but never stops or clears the lazily mounted AI engine. `728–747` accepts every engine message callback into the current cache, using current identity/conversation refs. `763–883` history fetches do not use an AbortController or identity generation before publishing. The engine remains mounted once opened (`1656–1662`).

**Impact:** An in-flight old-identity stream or history request can repopulate cleared state during a wallet switch. This is a source-confirmed race opportunity, not a reproduced private-history exposure. Existing detailed bootstrap ownership checks do not cover all message-data paths.

**Fix:** Key the AI engine and both histories by authenticated principal, stop streams on principal change, and reject stale request generations. Keep late replies in the original principal's cache only. Add a switch-during-stream test before calling this path fully covered.

### SS-08 — P2 — Public-chat unread state does not reflect messages read while the dialog is open

**Evidence:** `components/chat/chat-button.tsx:42–50` calls `markAsRead` only on opening. `components/chat/chat-context.tsx:663–688` computes new messages after that timestamp even while the dialog is open; no subsequent call updates last-read time as visible messages arrive. `chat-messages.tsx:65–101` tracks whether the user is at the bottom independently but never updates the provider's read marker.

**Impact:** Messages visibly read in an open chat can remain “unread” and reappear in the header indicator after closing. Opening an AI-only phone pane also marks public history read before it was viewed.

**Fix:** Mark public messages read when the public pane is visible and its viewport reaches them, using the newest visible message timestamp. Keep unread state separate from conversation-open state and preserve new-arrival affordances while scrolled up.

### SS-09 — P2 — Desktop Activity pagination scrolls the wrong feed

**Evidence:** `components/tabs/activity-tab.tsx:513–521` resolves a single `document.querySelector('[data-activity-feed-scroll]')`; both desktop feeds render that attribute at `597`/`666`. Both paginations call the same handler (`525–541`, `802–827`).

**Impact:** Changing the My Activity page while scrolled down scrolls the All Activity column to the top. The right column stays at its old offset and can initially show the bottom of the newly loaded page.

**Fix:** Keep one scroll ref per feed and pass the corresponding reset function into its pagination. Test the second column explicitly rather than only the first matching DOM node.

### SS-10 — P2 — Activity errors remove useful rows and offer no retry

**Evidence:** A refresh keeps old activities (`281–292`) but sets `errorByView` on rejection (`300–310`). `components/tabs/activity-tab.tsx:618–625` replaces all content with an alert whenever any error is set, irrespective of existing rows. The message says “try again later,” but there is no retry button and no periodic refresh while the tab remains visible (`342–348`).

**Impact:** A transient refresh failure makes a previously usable feed disappear; waiting on the screen does not recover it. This differs from the ranked resource states with explicit retry.

**Fix:** Preserve previous rows, show “Could not refresh” with last-success time and Retry, and reserve full-page errors for an initial failure. Use the shared `ResourceState` pattern for that initial failure.

### SS-11 — P2 — Activity state changes when the same device crosses the tablet breakpoint

**Evidence:** Phone category/direction/page live in URL query state at `components/tabs/activity-tab.tsx:178–209`; desktop has unrelated component state at `165–168,210–219`. The desktop rendering at `785–830` ignores those URL filters and pages. In contrast Ranking shares query state between its layouts.

**Impact:** Rotating a tablet or resizing the browser can apparently reset the selected filter and page. Opening a shared filtered URL on desktop does not reproduce the sender's view.

**Fix:** Use a common per-feed state model independent of layout. URL-encode both feed scopes where simultaneous feeds exist; select one visible scope on narrow layouts without replacing the underlying state. Treat rotation as a layout operation.

### SS-12 — P2 — The Activity feed mislabels Blackjack pushes/returns as wins

**Evidence:** `components/activity/event-renderers.tsx:591–606` defines `won = Number(event.payout) > 0` and ignores `event.result`. That field is present in `lib/types.ts:614–625` and queried in `lib/activity-service.ts:330–340`. `public/abi/blackjack-abi.ts:457–465,504–512` already distinguishes PLAYER_WIN, PLAYER_BLACKJACK, PUSH and SURRENDERED, and `lib/blackjack-events.ts:37–58` uses those distinctions.

**Impact:** Any push returning the stake, or surrender with a returned amount, is presented as a win in the player's history. Players cannot reconcile the main game result with Activity. This is a concrete duplicated outcome-logic drift.

**Fix:** Use one outcome formatter driven by the enum; distinguish gross payout, returned stake and net gain if the data permits. Reuse it in the game, transaction result and activity row. Add PUSH and SURRENDERED fixtures, not just won/lost.

### SS-13 — P2 — Activity's personal language and rendering robustness remain inconsistent

**Evidence:** Plant actions use `ActivityPerspective`, but most land renderers explicitly pass `isYou={false}` or ignore their accepted `userAddress` (`components/activity/event-renderers.tsx:424–543`). `activity-tab.tsx:388–420` passes the raw wagmi address for land/casino rows while the feed itself uses effective twin address (`151`). `EventWrapper`'s flexible text column at `event-renderers.tsx:231` lacks `min-w-0`/wrapping; dynamic names at `197–207,437` have no wrapping rule. `TimeAgo` at `50–58` calls `formatDistanceToNow` on unchecked data; casino formatters call `BigInt` on unchecked payout strings (`574,594,615`). `lib/activity-client.ts:23–25` validates only that activities is an array.

**Impact:** “Mine” is consistently personalized for plants but not many land events. Long unbroken names can force horizontal overflow on narrow feeds. A malformed event timestamp/number can throw during render and take the feed down rather than isolating one bad row. The Solana identity consequence needs a real Solana session to confirm.

**Fix:** Normalize event payloads at the boundary, build a shared typed presentation model with actor/target ownership and outcome, add `min-w-0` plus overflow wrapping to the row, and give unknown values safe fallbacks. Format times as semantic `<time dateTime>` with an absolute-time tooltip. Test every event variant with long names and malformed timestamp/payout, not only common plant events.

## Onboarding, tasks and content findings

### SS-14 — P2 — Tasks still shows confident incomplete/zero progress when it cannot know the answer

**Evidence:** `components/tasks/TasksInfoDialog.tsx:195` sets a summary error but renders all mission cards regardless. `221–259` converts missing `missionDay` into undefined `done`; `29–58` displays those as incomplete. Once loading finishes, summary figures use `streak?.current ?? 0`, `missionPts`, `completedTaskCount` (`285–304`). “Best 0” renders even during loading (`288`). The error asks the user to close and reopen instead of supplying Retry. The component also renders zeros with no address (`147–149`).

**Impact:** A service outage or unconnected/unsupported identity looks like lost progress. The page has made progress toward proper loading states, but the mission cards and error completion still contradict that effort.

**Fix:** Keep last-known progress with an explicit stale marker; otherwise display unknown/loading states rather than unchecked tasks. Put Retry alongside the error. Gate disconnected state with a useful explanation. Include delayed and failed summary fixtures for both the numbers and checklist.

### SS-15 — P2 — Farmer's Tasks tells the player what to do without helping them get there

**Evidence:** Mission tasks are static labels with no navigation/action (`components/tasks/TasksInfoDialog.tsx:49–62`). A completed section still says its full reward is “available” (`38`). Status icons are `aria-hidden`, and individual task text does not announce completed/incomplete state (`54–58`). General/social/land/plant sections and rewards are hardcoded client-side (`221–260`) rather than drawn from a common mission presentation definition.

**Impact:** Players must dismiss the dialog and remember where “Stake,” “Place a SEED/LEAF order,” or “Send a farmer” lives in a complex game. The section reward text implies more Rocks are claimable after earning them. Screen-reader users hear labels but cannot identify which specific tasks are complete.

**Fix:** Add accessible completion text and one clear action per incomplete task with any prerequisite (“Requires a land,” “Open public chat,” etc.). Close/navigate intentionally and retain task context. Present earned/remaining reward accurately. Share mission IDs, labels, rewards and destination metadata across server and UI.

### SS-16 — P2 — First Care can claim Tasks was explored when no task dialog can appear

**Evidence:** `components/first-care-guide.tsx:19` writes the completed Tasks step before calling `openTasksDialog`, without consulting gamification availability. `components/tasks/TasksInfoDialog.tsx:212–218` explicitly refuses to render when the policy is invisible. Tutorial already filters the same unavailable feature (`components/tutorial/SlideshowProvider.tsx:33–38`).

**Impact:** With gamification hidden, a newcomer taps a suggested next step, nothing opens, and the guide permanently says “Tasks explored.” If this completes the guide it can disappear (`first-care-guide.tsx:13`).

**Fix:** Respect feature policy when selecting next steps and record completion only after the destination actually opens. Offer a useful alternative when tasks are unavailable. Use a shared capability-aware navigation action instead of a blind global event.

### SS-17 — P2 — Feedback validation and in-flight editing can lose the user's work

**Evidence:** `components/tabs/about-tab.tsx:62–65` checks only the minimum length; the Textarea at `209–220` has no `maxLength` or visible counter, while `app/api/feedback/submit/route.ts:74–79` rejects more than 1000 characters. The button is disabled without `address` (`224`) but the dialog has no explanation/connect affordance. Textarea and close remain available while the request runs (`192,209–220`), and success unconditionally clears the current draft and closes (`100–103`).

**Impact:** A detailed report can be rejected only after submission. Typing additional feedback while the first request is pending, or reopening the dialog, lets the earlier response erase the newer draft. Disconnected users can write a report and encounter a disabled button with no reason.

**Fix:** Display and enforce the 10–1000-character range before send, show a connect explanation/action, and bind completion to the submitted draft/request generation. Either retain newer edits or freeze the submitted draft clearly. Add inline error and retry while preserving text. Real Solana support remains unverified because this flow uses raw wagmi address.

### SS-18 — P2/P3 — Tutorial changes need clearer progress and a lighter first-run path

**Evidence:** `components/tutorial/SlideshowModal.tsx:128–135` uses anonymous decorative dots for all steps with no current/total text; Next updates content while focus remains on Next, without a live progress announcement (`117–143`). `SlideshowProvider.tsx:44–66` auto-starts/resumes ten slides based on browser-local versioned state, and `close` always marks completed (`87–90`). `components/tutorial/slides.tsx:22,37–40,82,145` starts with swapping/minting and claims monthly Rocks rewards; it does not branch for an existing farm, free claim, or wallet capabilities. `app/(game)/page.tsx:846` invokes first-visit start after wallet connection.

**Impact:** Users are asked to absorb a large body of mechanics before their first useful action. Screen-reader users lack a concise “Step 3 of 10” confirmation. Returning players/new devices see the same generic sequence. The reward promise should be checked against current product policy rather than copied indefinitely.

**Fix:** Expose named progress and announce the newly selected step. Turn first run into a brief “get a plant → care once → see next step” flow, keeping the full guide discoverable in About. Make skip vs complete semantics explicit, validate stored indexes, and drive feature-specific guidance/reward copy from shared configuration. Visual/screen-reader validation remains required.

### SS-19 — P2 — Claim recovery screens are operational dead ends

**Evidence:** Verify manual review tells the player to contact support with an ID, but has neither contact/copy action nor status refresh (`components/verify-claim.tsx:319–348`; Check Status appears only when `!needsReview`). Airdrop failure says payout was not confirmed with no operation ID, support action or refresh (`components/airdrop-claim-card.tsx:388–397`), although state includes attempt/operation/transaction IDs (`24–27`). Claimed Airdrop likewise stores `txHash` but does not link to it (`375–387`). Verify's processing copy exposes “reservation”/“another claim attempt owns…” implementation concepts (`333`).

**Impact:** After the stressful part of a claim, the player cannot tell what happened, verify receipt, or send support the details the system already knows. “Needs review” becomes a terminal screen with no next action.

**Fix:** Use one claim-recovery card with plain language, original wallet, last update, copyable reference, status check, and support destination prefilled with non-secret details. Show a confirmed transaction link when available. Preserve the non-retryable safety distinction without making the user understand backend reservations.

### SS-20 — P2/P3 — Several pieces of copy contradict the actual outcome/action

**Evidence and fixes:**

- Kill cooldown description says “Your attack action…before attacking again” (`components/tabs/leaderboard-tab.tsx:1817–1820`), while the body explains a separate hourly kill cooldown (`1825–1830`). Use “Collect a star”/kill consistently and show the correct independent timer. The inline kill warning “Close this dialog to see the timer” (`1636`) does not itself open the timer when closed.
- My Plants + no matching entries displays “No plants ranked yet” and directs minting (`leaderboard-tab.tsx:1109–1135`) rather than explaining the user's filter; Dead + My can assert “All plants are currently alive!” (`1125`) even though only the filtered subset was checked. Scope empty copy and add reset filter.
- `components/activity/event-renderers.tsx:377` always says “and won” even for “no reward this time” or negative points/lifetime formatted at `335–355`; choose neutral/won/lost outcome copy.
- `components/mint-share-modal.tsx:229` promises eligibility for more rewards without qualifying how, and its data-unavailable fallback says “Try minting again to share your plant” (`337`). A share-data error should never encourage repeating a paid mint; offer close/retry/recover the existing mint. Twitter accessible naming (`298`) conflicts with X branding elsewhere.
- `components/verify-claim.tsx:297–299` returns null for complete before its dedicated “Claimed!” success branch (`354–364`), so the success card is unreachable after the handler sets complete+success (`232–233`). Choose one intentional post-claim state and remove the dead branch.

## Visual, responsive and infrastructure findings

### SS-21 — P2 — Secret Garden's touch interaction does not install on first open

**Evidence:** `components/secret-garden-overlay.tsx:97` initially sets `shouldRender=false`. The open effect schedules it true (`213–230`). The separate pointer-listener effect at `261–322` immediately reads `gridRef.current`, returns if null, and only depends on `open` and stable callbacks. The grid does not mount until `shouldRender` passes the return guard (`416–418`). Thus the effect sees no grid in the open commit and does not rerun when the grid appears. The JSX `onPointerDown` at `462` only removes initial reveal colors, not the missing `updateHoverFromPoint` handling.

**Impact:** On a coarse-pointer device, touching the artwork can remove the initial colored image without enabling the intended drag-to-reveal interaction. Desktop hover uses CSS and can conceal this defect during desktop-only inspection.

**Fix:** Bind handlers declaratively on the rendered grid or use a callback ref/effect depending on mounted render state. Test the first unlock on a touch device, subsequent reopen, pointer-cancel and performance/reduced-motion modes.

### SS-22 — P2 — Secret Garden is not contained for short landscape viewports

**Evidence:** `components/secret-garden-overlay.tsx:424` is a fixed full-viewport takeover; its child is `h-full items-center` with vertical padding (`440`) and contains heading/body, a square grid up to 18rem (`446–493`), 6-unit gaps and a return button. There is no vertical overflow container or viewport-height-dependent art scaling.

**Impact:** The composition is taller than a 320–430px-high landscape phone viewport. Centering can place the heading and return button outside the reachable area while body scrolling is explicitly locked (`238–259`). This is a source/layout finding; a physical device was not exercised.

**Fix:** Fit artwork using both available width and height and use an independently scrollable content region with a persistent return control and safe areas. Prefer the shared dialog foundation so scroll/focus/viewport behavior does not drift. Verify at 844×390, 1024×600 and 200% text zoom.

### SS-23 — P2/P3 — Several dense secondary screens bypass the established touch/type scale

**Evidence:** Chat Profile trigger explicitly overrides the shared Button to `h-6 min-h-6` (`components/chat/chat-message-bubble.tsx:47–48`). Wallet copy controls are bespoke 32×32 buttons (`components/wallet-profile.tsx:106–121`) rather than the app's 44px icon controls. Wallet labels/status metadata use 11px uppercase text throughout (`144,178,182,711`); Tasks packs two mission columns inside a max-448px dialog at any `sm` viewport (`TasksInfoDialog.tsx:322,341`), so a wide display can create narrower text columns without widening the dialog. Ranking summary uses wrapping 14px pixel names at desktop (`ranking-plant-summary.tsx:8`) but truncated 16px pixel names on mobile (`leaderboard-tab.tsx:777`).

**Impact:** Hit areas, readability and row height vary by surface without reflecting task importance. The desktop task cards can become tall word-wrapped columns in a narrow modal. Reading text on mobile is especially demanding when small pixel type, stacked borders and muted labels accumulate.

**Fix:** Establish a 44px minimum player-facing target even when the visible glyph is small, use one metadata/body/heading scale, and make a task dialog's columns respond to its own available width. Define a reusable ranking identity/metrics row whose layout changes without changing truncation policy. Validate all themes, 320/390px widths and text enlargement before deciding final values. These are source-confirmed styling inconsistencies; exact visual impact belongs with screenshots.

### SS-24 — P2/P3 — Broadcast takes control for 15 seconds without saying why or how long

**Evidence:** `components/broadcast-message-modal.tsx:54,108–114,168–174` blocks close button, Escape and backdrop for a non-dismissible message, while the only notice is “Please review this message before continuing.” There is no countdown. The action handler at `95–104` has no pending/error state and does not dismiss an internal-navigation message; non-dismissible unlock state is only reset in the no-message/dismissible branch (`78–85`), not on every new non-dismissible message.

**Impact:** A player can reasonably think the app is frozen, particularly when this appears over an existing flow. An outgoing link can leave them in the same blocking dialog on return. Consecutive message replacement can inherit prior unlock state.

**Fix:** Prefer a dismissible contextual announcement/banner; reserve blocking presentation for necessary action. If an intentional timed attention period remains, display a clear countdown and available exit, key the timer by message ID, and handle action failure visibly. Coordinate broadcasts with tutorial/transaction dialogs instead of independently opening another modal.

### SS-25 — P3 — Repeated metadata, data ownership and modal implementations make drift likely

**Concrete duplication/drift:**

- `components/mint-share-modal.tsx:27–33` and `app/share/m/[id]/page.tsx:13–19` duplicate strain→art mappings rather than using canonical strain metadata. Activity separately maps item/building icons (`event-renderers.tsx:18–20,115–150`).
- `components/tabs/leaderboard-tab.tsx` is 1,841 lines and combines five data sources, breakpoint/page state, five row layouts, four gameplay dialogs, outcome formatting and profile routing. Its identical compact/noncompact revive button branches at `892–927` are still duplicated. Mobile/desktop plant filter handlers/markup are duplicated at `1158–1193,1251–1283`.
- `components/chat/chat-context.tsx` is 1,675 lines with secure-auth bootstrap, retry coordination, polling, message cache, streaming, unread state, modes and UI imperative methods. A global scalar `sendingMode` is still reset by independently finishing sends (`1415–1419,1498–1503`) even though desktop input intentionally supports separate panes. One memoized object still includes message/status changes and invalidates all consumers (`1596–1651`). Memoization alone does not isolate a header badge from streaming state.
- `components/wallet-profile.tsx` is 1,063 lines with authentication teardown, provider classification, export workflow, debug gestures and custom visual primitives. The export dialog keeps its parent open (`368–374`) but uses default modal layer (`978–980`) instead of the shared nested-layer contract, while Chat Profile explicitly uses nested layering (`chat-profile-dialog.tsx:119–122`). Confirm visual stacking with an embedded-wallet session.
- Verify Claim and Airdrop gate rendering only after their effects have already run (`verify-claim.tsx:288`, `airdrop-claim-card.tsx:227`), unlike a parent-level capability gate. Hidden UI can still initiate eligibility reads.
- Activity, chat and ranking implement separate clocks, caches, manual async guards and incompatible stale/error states. `components/ai-elements/message.tsx:34–36` custom memo equality ignores all props except children/isAnimating despite exporting the full Streamdown prop type; a future class/plugin/config change can be silently ignored.

**Fix:** Extract by stable responsibility, not by line count alone: principal-scoped chat transport/history hooks; one eligibility/read-state contract; shared ranking rows/filters; a claim controller/recovery surface; centralized resource/outcome metadata; and a modal stack that every overlay participates in. Keep feature-specific behavior explicit. Add tests at these contracts so removing duplication also removes the demonstrated drift.

## Scoped coverage inventory

Source reviewed directly: all 13 files in `components/chat` (including index and AI converters/runtime); the sole `components/ai-elements/message.tsx`; `components/tabs/activity-tab.tsx`, `leaderboard-tab.tsx`, `about-tab.tsx`; all three `components/activity` files and all four `components/tutorial` implementation/config files plus their index; `components/tasks/TasksInfoDialog.tsx`; `components/first-care-guide.tsx`; `components/wallet-profile.tsx`; `components/verify-claim.tsx`; `components/airdrop-claim-card.tsx`; `components/broadcast-message-modal.tsx`; `components/secret-garden-listener.tsx`/`secret-garden-overlay.tsx`; `components/mint-share-modal.tsx`; `components/ranking-columns.tsx`, `ranking-plant-summary.tsx`, `player-ranking-row.tsx`; and share page/loading/error under `app/share/m/[id]`.

Supporting contracts inspected as needed: activity client/service/filter types; Blackjack ABI/result formatter; installed AI SDK send lifecycle (with executed probe); shared dialog layer/viewport behavior; gamification policy/service mission IDs; feedback API validation; kill/revive transaction wrappers; app/provider opening integration; land-ranking query.

The plant-profile dialog's internal EFP/stats/name/layout issues are owned by the plants/lands audit and should be cross-referenced rather than duplicated here. Its reported issues include clickable-looking follower counts without action, failed stats silently disappearing and social-data failures presented as empty.

## Coverage still required before claiming complete frontend validation

This source review is broad coverage of the assigned files, not “100% UI/UX coverage.” Real screenshots and interactions must still exercise:

- Chat empty/history/API failure, per-pane drafts and simultaneous sends, 401 recovery, long/cjk/markdown/math/table/code content, IME, mobile keyboard, scrolled-up new arrivals, profile nesting, wallet change during a response, history older than 50 messages.
- Each of the five ranking boards with long identities, zero/one/many rows, filter intersections, first/last page, rotation across 54rem, degraded reads, all attack/kill/revive eligibility and transaction outcomes, and another wallet taking an action concurrently.
- All 23 activity variants, both directions, empty filtered and failed refresh states, both desktop scrollers, malformed/long payloads and shared URL parity.
- Farmer's Tasks with missing auth, disabled policy, server-disabled policy, loading/error/stale data, partial progress, fully earned section, pending outbox, daily reset while open and screen-reader completion announcements.
- First Care with hidden tasks and returning owners; all tutorial slides including short landscape, skip/replay, blocked/corrupt storage and assistive technology.
- Privy embedded-wallet export selection and cancellation; Base/Farcaster session controls; Solana/twin ownership/name/network/tasks/feedback parity. No live Solana session was available to this scoped audit.
- Verify and Airdrop unclaimed, retryable, pending, complete, review/failed, unavailable, signature rejection, wallet change and partial submission. Read backend recovery semantics before testing real claims.
- Share generation failure, close/reopen mid-generation, missing data, clipboard-denied/manual copy, existing/expired/unavailable short link, Mini App composer return and popup failure.
- Broadcast replacement/non-dismissible cases, overlapping modal coordination, Secret Garden first touch/reopen/landscape/reduced motion, keyboard-only and screen-reader focus.

Recommended regression order: resolve P1 ownership/eligibility/send-contract defects first; then make recovery states honest and actionable; then normalize navigation, content and responsive state; finally polish typography, density, surfaces and motion against a shared device/theme matrix. A pleasant surface depends on those first layers being trustworthy.
