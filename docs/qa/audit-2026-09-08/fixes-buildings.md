# High-priority building fixes — 2026-09-08

## BP-01 — Revalidated and fixed

The original missing gate existed: `FarmerHousePanel` offered `questCommit` while unknown/unavailable reward funding disabled `questFinalize`.

Contract semantics were revalidated against the local Solidity source in `v22/src/libs/LibQuest.sol`, `v22/src/facets/QuestFacet.sol` and `v22/src/libs/LibPayment.sol`. Commit sets `pseudoRndBlock = block.number + 1` without checking funding. Finalize resets without a reward after `pseudoRndBlock + 256`. For a SEED/LEAF outcome, the facet transfers from the reward payer, and payment explicitly requires sufficient balance and allowance. Waiting before commit has no corresponding expiry. This supports blocking the avoidable deadline, rather than silently submitting and hoping opening becomes available.

Implemented:

- Return uses the same conservative readiness gate as start and awaits a fresh funding read immediately before submission. If funding cannot be verified or is below the existing conservative funding threshold, it throws a preflight error before wallet execution.
- The preflight also rejects a wallet/land change while that read was pending. Shared transaction infrastructure now awaits and honors the feature preflight, including retry paths.
- Failed multicall entries are errors, not zero balances. A configured fallback payer cannot authorize a funding-dependent action when the authoritative payer storage read failed. A failed refresh cannot reuse previously cached successful funding as readiness.
- Checking, temporarily unavailable, and read-error states have player-facing explanations and retry. Waiting farmers explain that their opening deadline has not started.
- Peer review improved already committed recovery: **Open now is independent of the conservative pool gate**, and awaits a per-slot `questFinalize` simulation instead. Non-token rewards and smaller affordable token rewards can still be opened when the whole-pool threshold fails. A simulation error prevents submission with a retry explanation; a simulation returning false cannot silently reset a newly expired quest under an “Open” label. Wallet/land scope is checked again afterward. The countdown stays visible, and the explicit expired reset does not acquire a funding gate.

Relevant files: [FarmerHousePanel.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details/FarmerHousePanel.tsx), [useQuestRewardsAvailability.ts](C:/Users/Goat/Documents/Pixotchi-Eco/hooks/useQuestRewardsAvailability.ts), [quest-rewards-readiness.ts](C:/Users/Goat/Documents/Pixotchi-Eco/lib/quest-rewards-readiness.ts).

Limit: funding can change after a successful preflight, including while the player approves their wallet. This frontend change prevents starting a deadline with funding already known to be unavailable; it cannot reserve contract rewards or guarantee later liquidity. At the P1 checkpoint this retained the existing 300 SEED / 492,750 LEAF thresholds. The subsequent BP-11 medium revalidation supersedes these stale constants with the same one-maximum-payout policy derived from fresh configured reward ranges and the highest configured difficulty multiplier; see fixes-medium-buildings.md. No live quest commit/open was submitted in this fix pass, and deployed facet bytecode was not independently matched to the local Solidity.

## BP-04 — Revalidated and fixed when preview is enabled

The original race existed: prior `preview` remained visible while the next target/count request loaded, and `canAttack` accepted that previous preview's successful status. Actual attack calldata already used the new selection. The feature remains disabled by default; it was explicitly enabled in regression coverage.

Implemented:

- The production `useBarracksRaidPreview` hook keys every result by normalized wallet, attacking land, defending land, swordsmen and phalanx. A changed selection cannot display or authorize the previous result even before its new effect runs.
- Loading, failure, disabled feature state and invalid inputs cannot produce an actionable preview. Superseded responses are cancelled/ignored, and returned troop counts must match the requested counts.
- Pre-submit validation requires the current matching successful preview. The raid transaction controller remains mounted while the preview refreshes, rather than being replaced by a separate disabled component.
- The updating state replaces outdated battle/loot information. Failed previews expose an explicit retry.

Relevant files: [BarracksPanelV2.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details/BarracksPanelV2.tsx), [useBarracksRaidPreview.ts](C:/Users/Goat/Documents/Pixotchi-Eco/hooks/useBarracksRaidPreview.ts), [barracks-preview-readiness.ts](C:/Users/Goat/Documents/Pixotchi-Eco/lib/barracks-preview-readiness.ts).

Limit: a preview estimates mutable onchain state. Identity matching prevents showing a different selection's result; it does not promise the defender/loot will be unchanged when a raid mines. No live raid was submitted.

## ARC-02 shared metadata migration — building consumers

The audit also confirmed Barracks and Casino inferred token names/decimal precision before metadata was authoritative. As part of the shared high-priority metadata correction, both panels now use `useTokenMetadata` readiness, show unavailable monetary values instead of assumed precision, and block approval/build/training until the relevant metadata is verified. Metadata failures include retry. Casino statistics retain counts but withhold unverified token amounts; existing active-game resume access remains available. This is a scoped consumer migration; the shared hook and other consumers are documented by the arcade owner.

Relevant additional file: [CasinoPanel.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/components/building-details/CasinoPanel.tsx).

## Verification

- `npx tsx smoke/building-transaction-guards-smoke.ts` — passed. Covers exact funding boundaries, each balance/allowance shortage, read failure, unverified payer, all preview identity fields, loading and unsuccessful preview status.
- `npx tsx smoke/quest-ui-smoke.ts` — passed. Existing expiry boundaries, reset/reward receipt parsing and scoped result persistence remain intact.
- Targeted ESLint over both panels, Casino metadata consumer, both hooks, helpers, fixture and test files — passed.
- `npx playwright test tests/frontend/building-guards.spec.ts --project=390-light --project=820-dark --project=webkit-390-light --workers=2 --reporter=list --output=output/building-guards-tests-final` — **15 passed**. Five scenarios run on Chromium phone, Chromium tablet/dark and WebKit phone. The test-only ambiguous status locator found on the first run was corrected before this passing run.
- Browser scenarios mount the production funding/preview hooks with delayed injected reads on the production-disabled `/qa/building-guards` route. They verify fresh preflight rejection/recovery, cache-after-error rejection, already committed payable/failed/expired simulation, target/troop/wallet/land changes, late responses, block refresh, failure/retry and feature disable. They do not claim full panel/wallet/onchain end-to-end coverage; transaction-controller behavior has separate shared infrastructure tests.
- `npx tsc --noEmit --pretty false` — passed after the committed-quest recovery improvement. Earlier errors during concurrent implementation were in other agents' in-progress files and had cleared on this run.

Test files: [building-guards.spec.ts](C:/Users/Goat/Documents/Pixotchi-Eco/tests/frontend/building-guards.spec.ts), [building-transaction-guards-smoke.ts](C:/Users/Goat/Documents/Pixotchi-Eco/smoke/building-transaction-guards-smoke.ts), [fixtures.tsx](C:/Users/Goat/Documents/Pixotchi-Eco/app/qa/building-guards/fixtures.tsx).
