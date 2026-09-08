# TX-08 — batch reconciliation fix

Status: revalidated in source and fixed. Focused regression checks pass. No new onchain transaction was submitted for this change.

## Revalidation

Both production cards still changed `txKey` after success while old eligible rows remained. Claim started a scan and also emitted a building refresh; quest sent a refresh through a 900 ms debounce. Neither submission gate required the scan to finish. The claim controller could therefore remount against its previous claim list; quest could prepare the same available farmers again. Claim's displayed reward totals also covered all remaining rows while its calldata covered only the first batch.

The existing transaction adapter already emits `confirmedSyncing` from canonical receipt evidence before reconciling owner resources. Using that boundary is better than retiring items from an eventual toast callback or introducing a timer.

## Resulting behavior

- Both cards freeze the submitted subset while wallet approval, confirmation and reconciliation are in progress. Quest difficulty and fee state are part of that snapshot.
- At `confirmedSyncing`, submitted building/farmer identities retire synchronously. They cannot appear in the next executable subset while the post-receipt read is pending or fails.
- Both cards join the canonical `buildings` owner-resource reconciliation and include `lands` and `balances` in their transaction effects. The former direct scan plus refresh-event duplication and keyed remounts are removed.
- A shared coordinator coalesces concurrent refresh requests. A receipt arriving during an earlier read invalidates that read and performs one follow-up scan at the required block. A failed read keeps submission disabled and presents Retry; retries retain the receipt lower bound and retired identities.
- Reads check an uncached block height against the receipt, then pin every building/quest multicall chunk to that same block. Partial farmer reads fail the whole actionable census instead of quietly omitting part of a fleet.
- The transaction component remains mounted during confirmation and delayed refresh. Quest fee-pending recovery and regular submissions share one controller. Normal controller success reset replaces the `txKey` reset.
- Claim reward estimates now match the executing subset and distinguish this batch's fee from the remaining total across batches. Quest's existing once-per-run fee is retained; a run does not end based on a pending or failed scan.
- Wallet/holdings changes gate the first new render; late reads from disposed owners cannot publish.
- Snapshot validity is tied to the coordinator instance, so replacing a reader for the same wallet also starts unavailable until its own scan completes. The canonical owner dispatcher explicitly interprets a `false` listener result as failure; a focused test exercises failed scan and successful retry through that real dispatcher.

## Files

- [Batch claim](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/batch-claim-card.tsx)
- [Batch quests](C:/Users/Goat/Documents/Pixotchi-Eco/components/transactions/batch-quest-start-card.tsx)
- [Shared scan hook](C:/Users/Goat/Documents/Pixotchi-Eco/hooks/useBatchReconciliation.ts)
- [Reconciliation coordinator](C:/Users/Goat/Documents/Pixotchi-Eco/lib/batch-reconciliation.ts)
- [Contract read helpers](C:/Users/Goat/Documents/Pixotchi-Eco/lib/contracts.ts): only optional `blockNumber` support in `getLandBuildingsBatch` and `getQuestSlotsBatch` belongs to this fix.
- [Focused regressions](C:/Users/Goat/Documents/Pixotchi-Eco/smoke/batch-reconciliation-smoke.ts), plus updated obsolete source expectations in [existing batch quest checks](C:/Users/Goat/Documents/Pixotchi-Eco/smoke/batch-quest-smoke.ts).

## Validation

Passed:

1. `npx tsx smoke/batch-reconciliation-smoke.ts` — concurrent refresh ownership, receipt arrival during an old scan, synchronous retirement, failed reconciliation and retry (including the canonical owner dispatcher), later production cycles, farmer census transition, wallet cleanup, coordinator-instance snapshot guarding, and pinned block arguments through both real multicall helpers.
2. `npx tsx smoke/batch-quest-smoke.ts` — existing quest state, calldata, durable fee and action-gate regression suite.
3. Targeted ESLint for the two components, hook, coordinator and focused smoke file.

An initial whole-tree TypeScript run found only concurrent work outside this fix (`ai-chat-engine`, `transaction-kit`, `ranking-action-readiness`); the coordinating agent owns final integrated validation. No type errors were reported in these changed files.

Limits: delayed RPC/receipt behavior is deterministically tested without sending a wallet transaction. The available audit wallet does not have a built Farmer House or the fleet needed for a multi-batch live run. Real smart-wallet approval/reload/recovery through both complete batch flows therefore remains an integration validation item; it is not represented here as a live pass.
