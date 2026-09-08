# ARC-06 — coverage remediation and remaining acceptance

Status: **partially addressed; open as a release acceptance item**. This is one of the original 30 high-priority groups. It must not be counted as a fully resolved code defect or rolled into medium-priority work.

## Revalidated gap

The original five specs all opened a provider-free fixture route. The audit's final matrix had 591 passes, 14 failures and 11 platform-specific skips. Its real app sampling did not substitute for reproducible provider/wallet journeys, complex game-state execution, physical devices or wallet-host handoff.

## Implemented infrastructure

- Added `frontend:app`, a separate real-provider local-wallet suite. It discovers the connected public wallet and land through the actual UI, exercises navigation, safe staking drafts and durable transfer review, and disconnects/reconnects. It records no trace, video or storage; evidence is public screenshots and sanitized summaries. Three viewport journeys passed, with normal desktop motion. See the linked journey report for scope and service failures.
- Added actual-component/controller regressions for the fixed high-priority defects, with controlled wallet/RPC/transport boundaries. These include failure/retry, changed wallet/asset/draft, stalled chains, incomplete results, ambiguous submissions, delayed reconciliation and history replacement.
- Added the nine-check `frontend:p1` runner to CI. Declared its existing esbuild runtime explicitly and included every required script. Expanded CI's browser job budget for the larger matrix.
- Added all-eight-theme normal/performance keyboard-focus checks in Chromium phone/desktop and WebKit phone, including Profile Follow's overriding class and a direct test that the painted ring contributes to the shadow.
- Split shared fixtures by suite so a small behavior test does not hydrate unrelated heavy controllers. Bootstrap rejects page errors, grants a bounded 20-second navigation plus 20-second hydration budget before loading, and retains the normal action budget afterward.
- Fixed server/client timestamp drift with explicit fixture-only en-US/UTC formatting. Production reports still use the player's local date formatting.
- Fixed paused-clock fixture boot: browser timers now run during Next/React loading; tests then pause and restart the scenario's relative countdown. All original countdown behavior assertions remain.
- Split the roulette number-center loop into three bounded tests while retaining all 37 numbers and combination hit-area checks.
- Stabilized screenshot capture origins and independently reviewed all nine updated references, including the pre-existing compact Chat Profile styling absent from the stale references. Final screenshots are checked without update mode.
- Extended production isolation to discover every current QA page. The optimized release must return 404 for all five, while the app root returns 200 with its production CSP.

Final integrated counts are recorded in the [coordinating fix ledger](C:/Users/Goat/Documents/Pixotchi-Eco/docs/qa/frontend-high-priority-fixes-2026-09-08.md). Interrupted exploratory runs and snapshot-update generation are not counted as release passes.

## Coverage that remains open

| Acceptance area | Evidence now available | Still required |
| --- | --- | --- |
| Provider/shell and wallet | Real EOA connect, six tabs, disconnect/reconnect at 390/820/1440. | Account/network changes across actual active operations; Privy, smart wallet/paymaster, Farcaster/Base hosts and Solana. |
| Mint and plant care | Production quote/catalog, actual ordinary-care approval and rename component regressions. | Real-provider mint/first-care, live/urgent/dead/fenced plants, rejection and confirmation with sufficient seeded holdings. |
| Buildings and batches | Real funding/preview hooks, actual receipt-aware scan coordinator, contract/readiness smoke. | Complete Return/Open/claim and multiple batches with a built Farmer House/fleet; actual raids when enabled. |
| Swap and marketplace | Actual tab renders; quote/controller races and complete paginated list/cancel callback regressions. | Actual approval/review/rejection/confirmation, 49+ owned-order cancellation and recovery through the provider tree. |
| Transfer and staking | Real invalid Stake/Unstake drafts; actual exact self-transfer review, close/reopen and cancellation. Actual controller reload recovery regression. | Successful transfer/stake/unstake and external wallet return/interrupt, using deliberately seeded assets. |
| Casino/Arcade | Actual Box/Spin/Roulette/Blackjack/Baccarat components, metadata outages, raw receipts, deadlines, incomplete result and paid recovery. | Real-provider wager/reveal and each game outcome with controlled liquidity/rounds; wallet handoff near deadlines. |
| Chat and claims | Actual AI SDK/engine failure/retry and Verify Claim owner races with controlled transport. | Successful authenticated integration; localhost SIWE domain currently rejects chat authentication. |
| Devices and accessibility | Chromium six widths/light-dark; WebKit two widths; all-theme focus; synthetic keyboard/200% text fixtures; normal desktop shell motion. | Physical iPhone, Android and iPad keyboard/safe-area/rotation/split-view/host runs; assistive technology; actual low-end motion performance. |

The available local test wallet owns no plants and one land (#1112), with no advanced fleet. A seeded integration environment and actual wallet/host/device sessions are needed to close these remaining checks. Automatically passing missing fixtures or marking physical devices passed from viewport emulation would conceal the original issue.
