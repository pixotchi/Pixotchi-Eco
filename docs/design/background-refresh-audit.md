# Background refresh audit — 11 September 2026

Reviewed scheduled queries, manual polling, refresh flags and their visible consumers. This follows the swap fee cache-key fix; it is not a full protocol or application security audit.

## Confirmed presentation issues fixed

| Area | Previous behavior | Updated behavior |
| --- | --- | --- |
| ETH plant and land minting | A 30-second quote refresh replaced the price with Loading and renamed the action | Retain the current quote and action label; show loading only without a quote for this selection |
| ETH care items, fences and plant renaming | Existing purchase labels changed to Updating ETH quote on every refresh | Retain the action label while checking the same quote |
| Solana bridge actions | Scheduled quote checks replaced a ready action's label | Keep the action label when a valid quote for the current identity exists |
| Swap balances | The shared header balance poll changed Swap to Checking Balances and appended last known to valid displayed balances | Retain labels and amounts while refreshing; errors still show last-known status and Retry |
| Barracks raid targets | Refreshing replaced the target count; an empty result alternated with Loading targets | Keep the count/selection, use the shared delayed refresh indicator, and distinguish an initial read from a known empty result |

## Guardrails retained

- All existing submission-disabled conditions and pre-signing revalidation remain in place. Keeping a label visible does not make a pending or failed read actionable.
- Quote changes still clear data belonging to another quantity, selection or wallet. Quote failures still expose an error/retry state.
- Barracks target snapshots are scoped to the selected land; request-generation checks are unchanged.
- Tasks eligibility checks, pending-transaction recovery, casino solvency checks and quote-expiry guards remain enforced.

## Other paths inspected

Chat history polling, public ranking queries, shared token balances, Barracks state snapshots, casino polling and owner-resource lists already retain content through normal background reads. Explicit errors and first-load states remain visible.

Validation: TypeScript and targeted ESLint; swap bundle, SEED purchase quote, swap fee refresh and Solana bridge smoke checks. Live browser verification observes actual balance refreshes and checks that Swap retains its label while submission remains disabled during the read.
