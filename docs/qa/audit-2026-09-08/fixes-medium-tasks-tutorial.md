# Tasks and tutorial fixes — 8 September 2026

Scope: SS-14, SS-15, SS-16, SS-18 and the Tasks layout portion of SS-23. Revalidated against `social-secondary.md` and the current source before editing. Apple/Emil interaction guidance and the React best-practices skill informed the work. No wallet connection, public message, transaction, deployment, package/config change, shared primitive edit or full build/suite was performed by this worker.

## SS-14 — Progress has an honest read state

**Before / revalidation:** missing mission data still rendered 15 unchecked tasks, best streak zero, daily/total Rocks zero and zero completions. The error required closing and reopening. Streak could publish before the mission response failed, mixing partially refreshed data. Disconnected identities also saw zeros.

**After:** Tasks publishes one validated summary for the initiating owner only after both responses succeed. Numbers and task completion remain unknown during a first load/failure; failures have an inline Retry. A failed refresh retains the last verified summary with an explicit stale notice. A wallet change immediately stops rendering the previous owner's snapshot, and abort/generation checks reject late responses. Disabled and disconnected states explain the limitation without fabricating progress.

**Why:** an unavailable service must not look like erased progress or an incomplete task. The checklist, numbers and reward state now come from the same verified snapshot.

**Evidence:** the real-component browser harness checks delayed initial reads, both failed responses, successful retry, stale refresh retention and owner A → B with late A responses. Unknown checklists contain 15 explicit “Progress not yet available” states. No stale `999` fixture values reach B. Shared parsing rejects incomplete summary/checklist shapes.

## SS-15 — Tasks lead to their destinations

**Before / revalidation:** cards contained static instructions, no navigation, inaccessible icon-only completion states and an “available” reward even after a section was earned. The UI repeated server reward literals.

**After:** each unfinished/unknown task has a named destination action and relevant prerequisite/context. Completed tasks explicitly say “Completed”; incomplete and unknown are distinct. A completed section says “Rocks earned”; otherwise the card explains the all-tasks requirement. Shared typed presentation metadata covers all 15 existing mission IDs. `GM_SECTION_REWARDS` is consumed by the UI and server award function, preserving the original 30/20/25/25 rewards. Reopening Tasks retains the last opened task label.

**Why:** navigation removes memorization from a complex game, while truthful reward copy avoids implying another claim is available.

**Integration:** top-level actions use `navigateToGameTab`; its coordinated optional `dashboardView` field is validated by FarmViewProvider and works in local miniapp state as well as URL-backed web state. Staking uses the existing open event. Public chat uses the new `mission-navigation` open event, consumed by the social owner's ChatButton implementation. Navigation alone never submits a paid action. Lands actions include the building/prerequisite to choose after arrival; no unsupported building deep links were invented.

**Evidence:** the harness runs actual shell navigation and FarmViewProvider consumers in miniapp mode and verifies Lands, Swap, staking and public-chat destination dispatch. Metadata asserts exact coverage/order of `GM_TASK_IDS`, no additional tasks and a total reward of 100. Four completed plant tasks announce completion and the section announces 25 Rocks earned.

## SS-16 — First Care completes Tasks only at the destination

**Before / revalidation:** First Care marked the step complete before dispatching a blind open event, regardless of gamification availability.

**After:** First Care respects both visibility and enabled policy. It offers Ranking through the shared navigation action when Tasks is unavailable. The Tasks destination records completion only while open, enabled and showing verified progress for that owner. Loading, failed, disabled and hidden states never complete the step.

**Why:** a suggested action should count only when the player can actually reach usable content.

**Evidence:** First Care remains incomplete during pending and failed Tasks reads, then completes after a verified response is rendered. Disabled policy removes its Tasks trigger, and the disabled dialog contains no progress/checklist. Disconnected Tasks renders the connection explanation.

## SS-18 — A short first run and a resumable full guide

**Before / revalidation:** first run opened ten generic mechanics slides, progress was anonymous dots, Skip marked completion and saved indexes accepted invalid values. The body used a static fade class and did not deliberately reset scroll. Monthly reward copy had no current shared policy guarantee.

**After:** first run has three steps: find/acquire a plant, give care, choose a next step. Copy explicitly handles an existing plant, wallet-supported mint options and free eligibility before paid choices. The final action opens Farm. About retains the full guide and resumes a paused full-guide position; Restart is explicit. Skip/Escape save a skipped position without marking complete; Done/final Farm action mark completion. Corrupt, negative, nonfinite, fractional and out-of-range indexes normalize safely. Visible live progress announces “Step N of M” and its title. Disabled Tasks is excluded from the full guide. Unverified monthly reward promises were replaced with current-event guidance.

The tutorial body now uses the shared `ScrollArea` with its own retained ref; changing slides scrolls that body to the top. Header/body/footer share the dialog height cap, so controls remain available with enlarged text.

**Why:** a newcomer can reach useful play quickly; returning players can use the detailed reference without losing their place or being reported as finished when they skipped.

**Evidence:** actual provider/modal tests cover 3-step first run, Skip preserving incomplete state, no repeated automatic opening after Skip, 10-step full-guide start/resume, 9 steps when Tasks is disabled, live progress text, body scroll reset at 200% text, negative/fractional/corrupt/out-of-range storage, explicit Done and quick-start Farm completion/navigation.

## SS-23 — Tasks layout at narrow widths and enlarged text

**Before / revalidation:** the 448px-capped dialog switched to two mission columns based on the outside viewport. At 200% text, the header's reserved close-button column could leave only a few characters of description width and consume the whole dialog.

**After:** mission cards remain one column at this dialog size. Summary metrics fit their actual available width. The local Tasks header uses a fixed 44px close target; its description scrolls with the content, so it cannot crowd out all task content. This changes the Tasks instance only, not the shared dialog primitives.

**Evidence:** normal and 200%-text screenshots at Chromium 320×568, 820×1180, 1440×900 and WebKit 390×844. The dialog has no horizontal overflow; a long-prerequisite task action remains scroll-reachable with a target at least 44px tall. The 320px screenshots were visually reviewed during correction.

## Validation and limits

- `node smoke/tasks-tutorial-medium-smoke.mjs`: all four browser/viewport runs pass.
- Targeted ESLint on all owned Tasks/tutorial/metadata/navigation source and the smoke harness: pass.
- Sixteen screenshots in `output/medium-tasks-tutorial/`: Tasks, enlarged Tasks, enlarged task actions and enlarged tutorial for each context. No committed snapshot baseline was refreshed.
- The harness renders production Tasks, First Care, SlideshowProvider/Modal, ScrollArea, Radix, mission metadata, shell/Farm navigation hooks and compiled application CSS. Wallet/policy/API responses and standalone staking/chat destination rendering are bounded test edges.

Limits: the controlled API responses are not live progress reads. These checks do not claim real chat authentication, wallet transactions, server Redis integration, every browser, physical touch hardware or all application themes. About/ChatButton integration is owned and verified in the social worker's changes; this worker verifies the shared event/API contract and actual navigation consumers.
