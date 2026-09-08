# Final real-app acceptance after Mint and Activity corrections

Ran the six unchanged application journeys after the Activity owner confirmed production-source freeze, using the existing healthy root-owned Next server with `NEXT_PUBLIC_URL=http://localhost:3000`.

Command: `npx playwright test --config output/playwright-app-post-corrections.config.ts > output/low-post-correction-app.log 2>&1`

Result: **6 passed, exit 0, 1.6 minutes**. No application source, test, configuration or server-lifecycle changes were made during this verification.

| Viewport/project | Signed-out recovery journey | Full application journey |
| --- | --- | --- |
| Phone 390×844 | Pass, 11.5s | Pass, 19.8s |
| Tablet 820×1180 | Pass, 10.0s | Pass, 16.5s |
| Desktop 1440×900 | Pass, 11.4s | Pass, 21.4s |

All six journeys checked the actual public server session before and after explicit reconnect: `authenticated: true`, provider `base`, method `base-siwe`, and the same public wallet owner. Each recovery journey completed signed-out navigation and reload with an existing SDK session, explicit recovery-flag removal, owner continuity, and final disconnect. Each full journey completed all 14 recorded steps: all six tabs, theme, keyboard balances, invalid staking drafts, unchanged self-transfer review after Escape/reopen followed by cancellation, and two clean disconnects around reconnect.

There were **zero uncaught page errors across all six journeys**. The three full journeys each recorded an empty transaction submission-method list. The three auth-only journeys make no financial actions and do not separately instrument submission methods or HTTP error counts.

Each full journey recorded exactly four `GET /api/chat/auth/session` responses with status 401 (12 total), and only the corresponding deduplicated resource-load 401 console message. They recorded no failed authentication POST or other API failures. The signed-session assertions passed before and after reconnect. The sanitized response records do not include timestamps, so they do not establish the exact point of each unauthenticated GET within the login/logout transitions.

Evidence: `output/low-post-correction-app.log`, `output/low-post-correction-app.json`, and per-project `public-auth-recovery-results.json` / `public-journey-results.json` under `output/low-post-correction-app-tests/`. These tests disable traces/video and retain only public assertions and screenshots. No private wallet storage, credentials or key material was inspected or exported; no paid transaction was submitted. Root owns the subsequent build and final integrated-suite ledger.
