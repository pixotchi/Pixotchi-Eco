# High-priority transaction core fixes

Date: 2026-09-08. Findings owned: **TX-01, TX-02, TX-03, TX-07**. All four were revalidated against the working source before changes. No real transaction was submitted during this implementation. Installed Next.js client-component guidance and the repository AGENTS.md were read before editing.

## TX-01 — Staking draft render crash — fixed

**Revalidation:** The real dialog still called `buildStakeCall(amount)` and `buildUnstakeCall(amount)` while rendering, independently of the validated bigint that disabled the button. The builders parsed the raw string with `viem.parseUnits`. A disabled control did not protect rendering from intermediate or malformed text.

**Solution:** Stake/withdraw builders now accept only a bigint. Both render paths pass the already validated positive amount, or an empty call list while the draft is invalid. Draft text stays editable and validation remains in the existing AmountField.

**Regression:** The actual StakingDialog and contract builders run in Chromium and WebKit with staking read responses mocked and only the downstream transaction boundary replaced. The test types `.`, empty text, `1,5`, `-`, `abc`, `1e2`, and a 19-decimal amount in both modes. None constructs an amount call or enables submission. An exact 18-decimal valid amount is preserved without rounding. Max and switching modes produce the correct wallet/staked amounts.

## TX-02 — Unsupported atomicity leaves execution busy — fixed

**Revalidation:** Busy state was entered before awaiting capability discovery, while the explicit unsupported-atomicity exception occurred above the catch/finally boundary. Thus that exception escaped without busy cleanup.

**Solution:** All preparation after entering busy state, including status emission and optional capability discovery, is inside the existing error/cleanup boundary. Explicit unsupported capability produces actionable feedback and releases busy state. Missing capability information or a discovery transport error still allows the wallet to enforce `forceAtomic`; no dependent bundle is downgraded to sequential transactions. Unmount or wallet identity change during discovery aborts before opening the wallet.

**Regression:** The production Transaction controller, durable storage and pending coordinator run with wallet/RPC I/O mocked. Tests cover unsupported capability plus successful retry entry, missing capability metadata, discovery failure, supported capability, unmount while discovery is pending, and a successful atomic batch with canonical receipt proof. The real controller completes cleanup in both Chromium and WebKit.

## TX-03 — Retry bypasses current feature readiness — fixed

**Revalidation:** Feature `disabled` only reached TransactionButton. Toast retry directly called the controller; the controller cached an earlier button callback and continued after a thrown pre-handler.

**Solution:** `Transaction.canSubmit` is now required. The controller validates current readiness and nonempty calls for every new submission entry, including retries and custom render callbacks. Its current `onBeforeSubmit` accepts `void | boolean | Promise<void | boolean>`; `false` or a thrown/rejected error stops execution with feedback and guaranteed preparation cleanup. The controller announces preparation so feature status handlers can lock editing. Readiness is captured before a feature deliberately marks itself pending; that flag does not veto its own accepted click. After asynchronous validation, changed wallet identity or calldata requires review instead of sending stale calls. A toast retry after changed calldata also requires the main review/action. Existing proof recovery remains independent from form readiness and cannot become a resend.

`GameTransaction` maps its existing `disabled` and `onButtonClick` to the mandatory contract. SmartWalletTransaction exposes the same callback type. Direct EFP and NFT transfer consumers were adapted; the blackjack owner adapted its direct consumer. Transfer preparation is now inside the mandatory callback, so toast retry cannot bypass durable-plan preparation or the acknowledgment checkbox.

**Regression:** Tests exercise failure followed by unchecked readiness, disabled toast retry and direct retry calls, false and thrown preflight vetoes, the latest callback on retry, edited calldata requiring review, async draft changes, duplicate entry while validation waits, and a synchronous pending flag. These run through the actual controller, not a duplicated validation helper.

**Independent recovery review:** A reviewer identified that retained/custom submission callbacks could run form validation against an unresolved durable reservation. The new regression reproduced the pre-fix `submissionAmbiguous` → terminal `buildError` transition, which could delete the reservation. A freshly rendered ambiguous toast already suppressed Try again, but the controller API still needed protection. It now checks both its active record and current wallet storage before entering preflight, before reporting a rejected preflight, and before executing after an async check. Existing proof/reservation and confirmed-state reconciliation are routed back to recovery without a new form error or send. Locked toast actions also cannot offer a new submission. Two additional regressions assert exact unchanged reservation data and no second wallet call after invalid readiness, changed calldata, false/throw validation modes and retained button/retry callbacks; they also cover another operation acquiring the wallet while an asynchronous validator waits and then rejects.

**Wallet-switch follow-up:** The reviewer also identified an unscoped delayed-reconciliation ref that could block wallet B after wallet A confirmed. A pre-fix browser regression reproduced that silent block. Execution, preflight and reconciliation now capture a wallet generation; wallet change resets local progress, and late success, failure and cleanup cannot overwrite the new wallet's state. GameTransaction receives a current-generation check and validates it after awaited resource reconciliation before feature callbacks. Late wallet responses still finalize proof for the original account without publishing into the new wallet. Four new scenarios cover a delayed refresh followed by switching wallets, late refresh success/failure after the new wallet's result, and a late send response whose original account proof remains durable.

## TX-07 — Reopened transfer review differs from prepared payload — fixed

**Revalidation:** Closing still cleared draft selection arrays while retaining the active plan. The old confirmation rendered those draft counts and mutable recipient fields; execution rebuilt calldata from the retained plan.

**Solution:** TransferPlanReview reads the immutable active plan exclusively. It shows the exact recipient, network, IDs in the current transaction, remaining assets, and already successful/failed assets during a multistep transfer. Ownership refreshes and closing no longer alter reviewed asset counts. A closed transfer/recovery controller cannot initiate a new send. Acknowledgment, verified ownership, ready phase and current open state are mandatory submission gates.

**Regression:** The actual TransferAssetsDialog is mounted with a persisted land-transfer plan and mocked ownership reads. The test checks exact land #1112 and recipient, closes via Escape, reopens, reloads the document/restores the plan, then cancels Back and verifies storage removal. Confirm & Send stays disabled without acknowledgment, and the mocked wallet records zero calls. A separate actual review-component test covers remaining/current/completed multistep assets.

## Validation and limits

- Dedicated behavior suite: **42 passed** (21 cases each in Chromium and WebKit) using `npx playwright test tests/frontend/transaction-core-p1.spec.ts --project=390-light --project=webkit-390-light --workers=2 --reporter=list --output=output/transaction-core-owner-verified`. Root integration reruns the final spec across all configured browser/viewport projects.
- Targeted ESLint passed for the changed core components, review model and regression fixtures.
- `npm run transaction-infra:smoke` passed, including package compatibility and production-fixes smoke. Its existing unconfigured Redis warning is unrelated to these changes.
- Full-project `npx tsc --noEmit --pretty false` passed after the independent recovery fix.
- `git diff --check` passed for the transaction-core edits.

The isolated browser harness runs production control flow but mocks wallet/provider/RPC I/O and supplies minimal dialog CSS; it is a behavior regression suite, not a physical-device visual review or proof of a live chain transaction. Transfer tests cover persisted-plan recovery and cancellation without signing. Wallet changes during pending requests and delayed reconciliation have runtime regressions; exhaustive hardware wallet/host-specific behavior remains outside these focused tests. Existing shared resource reconciliation acknowledges the first listener per domain; TX-08's local retired-item/readiness coordinator prevents repeat submissions despite that independent limitation.

## Files changed by this owner

- `components/staking/staking-dialog.tsx`; only staking builder signatures in `lib/contracts.ts` (other owners also edited this shared library).
- `components/transactions/transaction-kit.tsx`, `game-transaction.tsx`, `smart-wallet-transaction.tsx`.
- `components/efp-transaction-boundary.tsx` (mandatory readiness adaptation).
- `components/transactions/transfer-assets-dialog.tsx`, new `transfer-plan-review.tsx`, new `lib/transfer-assets-review.ts`.
- New `tests/frontend/transaction-core-p1.spec.ts` and its three fixtures under `tests/frontend/fixtures/transaction-core*` / `transaction-game-mock.tsx`.
- This report. No commits, package changes, production fixture route changes or .gitignore edits.
