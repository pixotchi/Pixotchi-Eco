# TX-09: trustworthy staking and marketplace reads

Status: revalidated and fixed for staking and marketplace. The batch-quest branch is already covered by the P1 reconciliation fix and was rechecked. Swap is owned by the coordinating economy agent. This work also supplies the common readiness policy for TX-14 and the requested staking pending labels / marketplace duplicate-error cleanup for TX-11.

## Revalidation

- Staking retained balances and approval after refresh failure, but its Stake, Unstake, Claim and Approve gates did not require a successful current snapshot. Initial failure could display default zero and offer approval. The amount field's existing error handling did not cover the other metrics or transaction gates.
- The upstream `getStakeComposite` helper swallowed complete RPC failure and missing approval entries into successful-looking `null` / `false` results. The staking API therefore could return HTTP 200 for an unavailable economic read; repairing the component alone would have missed this path.
- Marketplace attached a snapshot to an address but did not revoke that snapshot's spending authority on refresh failure. Error text could coexist with enabled Create, Take and Approve actions.
- Batch quests now reject partial scans, require receipt-aware `scanReady`, render a resource error with Retry, and preserve the previous confirmed fee state during read failure. No further batch implementation change was necessary.

## Resulting behavior

The small pure [economic-read-state policy](C:/Users/Goat/Documents/Pixotchi-Eco/lib/economic-read-state.ts) returns `loading`, `error` or `ready` from `{ hasSnapshot, identityMatches, loading, error }`. Error takes precedence; retained or mismatched values cannot confer spending authority. Staking and marketplace use the same policy while keeping their appropriate API / RPC transports. The coordinating economy agent also consumes it for swap.

[Staking](C:/Users/Goat/Documents/Pixotchi-Eco/components/staking/staking-dialog.tsx) commits only a complete wallet-bound balance/stake/approval snapshot. Initial unavailability reads “Unavailable”; a failed refresh retains explicitly labeled “last known” metrics. Approve, Stake, Unstake, Claim and Max stay disabled until a fresh read succeeds. Retry sits beside the error, invalid numeric drafts retain the P1 safe builder behavior, and valid zero remains a real empty balance. Pending labels describe Approving SEED, Staking, Unstaking and Claiming rewards.

The scoped [staking composite helper](C:/Users/Goat/Documents/Pixotchi-Eco/lib/contracts.ts:1185) now rejects failed or malformed required stake/allowance entries. Its existing API caller returns HTTP 500 through the existing catch, so no API route edit was necessary. Optional reward-rate metadata remains optional and is never substituted for required economic data. Other callers were checked: AI read aggregation already catches these failures or uses its outer tool error boundary.

[Marketplace](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/marketplace-dialog.tsx) invalidates balance freshness immediately on refresh and on dialog cleanup. A complete set of nonnegative bigint balances and allowances restores it. Late wallet responses cannot publish into a different owner. A known approval controller remains mounted during refresh and is disabled until readiness returns. Failure is labeled “Balances unavailable,” rather than “Low balance”; last-known amounts remain visibly qualified and Retry restores actions.

Escrow cancellation remains available when current owned-order and land-ownership reads succeed: Cancel returns an existing order's escrow and does not spend the unread SEED/LEAF balances. Complete order pagination and owned Cancel access are preserved. Duplicate marketplace approval error toasts were removed because the shared transaction controller owns error feedback.

## Validation

Passed 22 focused browser checks across Chromium 390px and WebKit 390px: the ten [economic read regressions](C:/Users/Goat/Documents/Pixotchi-Eco/tests/frontend/economic-reads.spec.ts) plus the existing TX-01 real staking input regression in both engines. Checks cover initial/refresh failure, visible last-known values, Retry, valid zero, malformed success, required multicall failure, optional metadata failure, retained approval control, wallet switches, trade gates, and escrow cancellation access.

The harness renders the production dialogs and production staking builders/composite parser. It replaces wallet/RPC I/O and the final transaction submission boundary; no wallet transaction is sent. It is behavioral verification, not a screenshot/layout or deployed-chain pass.

Command used:

```text
npx playwright test tests/frontend/economic-reads.spec.ts tests/frontend/transaction-core-p1.spec.ts --config=output/economic-read.playwright.config.ts --project=390-light --project=webkit-390-light --grep "economic readiness|staking|stake composite|marketplace" --workers=1 --reporter=list --output=output/economic-read-tests-final
```

The ignored temporary configuration only disables Playwright's dev-server startup because this isolated harness has no dependency on Next. The first run through the regular configuration stopped before tests when an existing Next development lock prevented another server from starting. No server process or repository configuration was changed.

Scoped ESLint and diff whitespace checks passed for the edited components, shared policy, and new test files. Both `npx tsx smoke/batch-reconciliation-smoke.ts` and `npx tsx smoke/batch-quest-smoke.ts` passed again. The coordinating agent owns full integrated typecheck and suite results. No commits or onchain transactions were made.
