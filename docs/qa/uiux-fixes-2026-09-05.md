# UI/UX fixes — 5 September 2026

Application fixes for the six findings in the UI/UX audit. Smart contracts were used as references and were not modified or redeployed.

| Finding | Change | Runtime revalidation |
| --- | --- | --- |
| Hidden plant screens retained pre-transaction data | A persistent subscriber invalidates the shared query cache and refreshes inactive owner lists at the receipt block. Overlapping refreshes are guarded; active screens retain their existing reconciliation. | Two successful warehouse assignments: desktop with Performance Mode off immediately showed 10,869.77 PTS; mobile at 390 × 844 with Performance Mode on immediately showed 10,870.77 PTS. Neither required a reload or polling delay. |
| Marketplace converted balance failures into zero | Item details use the shared balance provider, explicit read status, and a retry action. Failed background reads retain the last known amount without presenting it as current spendable data. | Injected a balance RPC HTTP 503. The item panel showed “SEED balance unavailable,” then recovered through Retry without closing the panel. Balance formatting also matches the header. |
| Fixed ETH reserve blocked affordable swaps | Base L1 data, L2 execution, and operator fees are estimated with a buffer. ETH Max uses an estimated reserve. Each direct transaction is checked again against a fresh balance; approval and swap are estimated separately when allowance is missing. Smart-wallet batches delegate fee estimation to the wallet/bundler. | The formerly blocked 0.00001 ETH → SEED swap confirmed. The fee budget was approximately 0.00000288 ETH. Max produced an enabled 0.00003822 ETH quote from the original wallet balance. Injected fee-estimation failures showed a retry action; retry restored an enabled quote. |
| AI interpreted expiry timestamps as durations | Lifetime subtracts the current snapshot timestamp and clamps expired plants to zero. The result retains the absolute expiry and snapshot time. | The real `get_plants` tool returned 124.4175 hours for plant 22419: expiry 1789016721 minus snapshot 1788568818 = 447903 seconds. |
| Construction duration was missing before purchase | Upgrade and info panels show approximate construction duration and identify speed up as optional after construction starts. | Land 760 Farmer House showed ~1d before its 550,000 LEAF purchase; land 712 showed ~2d 2h for the next level. Both durations were verified against the contract's block intervals. Mobile panels and info dialog fit without horizontal overflow. |
| Warehouse assignments were absent from history | Both feeds query the existing `plantPointsAssignedEvents` and `plantLifetimeAssignedEvents` indexer collections, preserving the feed's cache, limits, 24-hour window and owner filters. The renderer shows resource amounts, land and plant IDs, and a block link. | My Activity and the Lands filter showed both new PTS assignments, earlier PTS assignments, and a lifetime assignment. Mobile history had no horizontal overflow. |

Confirmed demo-wallet transactions:

- [0.00001 ETH → SEED swap](https://basescan.org/tx/0xb06a7b481c1f661b8278d861e5cac69d4eccac67078cf3c94944f8151d2458cd), block 50889698. Receipt status: success.
- [Desktop warehouse assignment, 1 PTS](https://basescan.org/tx/0x4bb68c21f5c58b9e8bb407874121dde51215cfe117610873af3c64131956e197), block 50889735. Receipt status: success.
- [Mobile warehouse assignment, 1 PTS](https://basescan.org/tx/0x9dd14deca2e8c999a7119df1e66d1c461d14cec926ba178bb075b6b5049ae1f6). The receipt-triggered reconciliation updated both warehouse and plant state, and the event appeared in history.
- [Exact 1 SEED approval](https://basescan.org/tx/0x2cfc0edf3b132d03cb3d7f855af13932a20c2b604d213ad4229a3f56729c00a5), followed by the [1 SEED → ETH swap](https://basescan.org/tx/0x64333fcbd2b92d229e5c0a70a8e427d99c63d2d2465e06fe75990956483ab178). Both transactions completed; the SEED balance decreased from 7.189625 to 6.189625.

Validation used `npm run dev` on localhost:3000 with the terminal attached, real Chromium interactions, RPC fault injection, onchain reads, and confirmed transactions. Local browser scripts, screenshots, and response captures are retained in the ignored `output/playwright/audit-2026-09-05` directory.

Automated checks passed: typecheck, lint (including Base RPC hardening), production build, UI/UX regression checks, activity filters, balance consumers, balance/mint read states, owner resource races, transaction package compatibility, and production-fixes smoke. `npm run uiux:smoke` is included in the existing aggregate smoke command.

Runtime log-read diagnostics also exposed a provider-plan restriction reported as JSON-RPC error -32600. The RPC classifier now permits fallback for these provider-specific limits, while retaining deterministic handling of invalid input and contract reverts. This was covered by live log reads and regression checks.

The live transactions used the demo EOA. Smart-wallet/paymaster batches and Solana transactions were not submitted as part of this fix validation. Network fee budgets remain estimates; each direct transaction is rechecked before submission. History uses the existing indexer and remains subject to its ingestion delay. The indexer does not expose transaction hashes on these event types, so the in-app explorer link targets the recorded block.
