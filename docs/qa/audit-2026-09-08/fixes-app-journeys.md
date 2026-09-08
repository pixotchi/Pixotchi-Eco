# ARC-06 — Real application journey verification

Verified on 2026-09-08 against the local Next development app at `http://localhost:3000`, using the actual Local Test Wallet login, production providers, shell, dialogs, RPC reads, and discovered wallet holdings. The suite has no component stubs, RPC mocks, injected wallet state, or authentication bypass. It hides only the Next development overlay so that development chrome does not intercept application clicks.

## Result

`npm run frontend:app` — **3 passed (59.2 seconds)** on the final settled implementation, after the transaction-owner recovery changes. An earlier independent run passed in 50.4 seconds. Targeted ESLint for the configuration and journey spec also passed.

| Project | Viewport | Motion during interaction | Result |
| --- | --- | --- | --- |
| app-phone-390 | 390 × 844 | Reduced | Passed |
| app-tablet-820 | 820 × 1180 | Reduced | Passed |
| app-desktop-1440 | 1440 × 900 | Normal (`no-preference`) | Passed |

All three projects use Chromium. Desktop has a dark browser preference, but the app retained its default Light theme; this run does not establish application dark-theme coverage. Animations are disabled only while capturing still screenshots, not during desktop journey interactions.

Each project completed the following real application checks:

- Connected with Local Test Wallet and dismissed the actual first-visit tutorial.
- Opened Farm, Mint, Activity, Ranking, Swap, and About; each tab rendered content without the application error boundary.
- Entered `.` in the real Stake and Unstake amount fields. Both retained the draft and mounted dialog, displayed the validation message, and disabled submission.
- Copied the connected wallet's public address through Wallet Profile, discovered its first selectable land, and prepared a transfer to that same address. The available holding was land **#1112**; the wallet had no plants.
- Closed Confirm Transfer with Escape, reopened it through Wallet Profile, and verified the exact same review text, recipient, and asset ID. Acknowledgement remained unchecked and Confirm & Send remained disabled. Back cleared the prepared selection, and the dialog was cancelled.
- Disconnected, reconnected through the login screen, verified the same public wallet address, and disconnected again. Every passing journey finishes disconnected.

There were **zero uncaught browser page errors** and **zero observed transaction-submission RPC methods** in all three projects. No approval, acknowledgement, transfer, stake, claim, swap, wager, or other spending action was submitted. Existing collection approvals allowed the read-only transfer preparation step.

## Evidence and implementation

- Configuration: `playwright.app.config.ts`. This is a separate opt-in suite extending the existing frontend configuration; its test directory and artifacts do not alter the fixture suite.
- Test: `tests/app-journeys/local-wallet.spec.ts`.
- HTML report: `output/playwright/app-journey-report/index.html`.
- Screenshots and results: `output/playwright/app-journeys/local-wallet-local-wallet--d00f4-view-recovery-and-reconnect-app-{phone-390,tablet-820,desktop-1440}/`.
- Each project contains 12 public UI screenshots and `public-journey-results.json`: **36 screenshots and three result documents** in total, plus Playwright's own metadata/attachment copies.

The screenshots cover all six tabs, both invalid amount drafts, the initial and reopened transfer review, disconnection, and the reconnected wallet. Independent visual inspection of the reopened transfer review at all three widths confirmed the recipient and land ID remained readable within the dialog; the phone invalid Unstake screenshot also shows the retained draft and inline validation without an app crash.

Tracing, video, and browser-storage export are disabled. The test never logs request payloads or key material. Its network listener retains only transaction method names, and saved console/page errors are bounded and sanitized. The wallet address and land ID in the result documents are public UI data.

## Observed service limitations

The run is **not console-error-free**. All three contexts recorded localhost chat autologin failing with `Unexpected SIWE domain`, alongside HTTP 400/401 console errors. EVM wallet connection and the tested app journeys succeeded, but secure chat authentication and authenticated chat actions could not be established on this origin. No authentication checks were weakened to make the journey pass.

An earlier desktop context additionally recorded a TradingView widget fetch failure and HTTP 403. The final repeat did not record that error; all three final contexts still recorded the chat authentication errors above. The Swap tab remained usable for the bounded checks, but chart rendering was not an assertion in this journey.

This verification covers one local EOA wallet and its currently available land. It does not cover physical devices, Safari/WebKit, Solana, smart wallets, Farcaster authentication, a different account, owned-plant gameplay, successful paid transactions, or every dialog and error branch. Together with the component and transaction regressions, it adds real provider/shell evidence for ARC-06; it is not a claim of 100% application journey coverage.

The development server started for this verification remains running for the parent agent's final integrated checks (exec session `18645`). No production feature files were changed by this verification task.
