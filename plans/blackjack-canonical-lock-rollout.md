# Blackjack canonical lock rollout

The signing route now accepts canonical uint256 land IDs only. Redis decisions have no TTL, and temporary action unavailability never releases a signed decision. The route only removes the previous canonical lock after a `safe` onchain nonce read. Already-issued signatures cannot be revoked by this app change.

Production signing requires a stable Redis inventory matching the configured signer and `BLACKJACK_CANONICAL_SIGNER_ROLLOUT_ID`. Keep the existing casino, Blackjack and legacy-contract acknowledgement settings. A missing or incomplete inventory returns a retryable service-unavailable response; a quarantined nonce remains under reconciliation. No automatic client retry should change the requested action.

1. Run a **dry run** against the intended Base/Redis environment, with an explicitly configured signer or `--signer` public address. Use a private checkpoint location. The tool uses cursor `SCAN` and never `KEYS`. It saves a checkpoint after each page; repeat the same command to resume. Exit code 2 means the inventory is incomplete or unknown, not empty.

   `npx tsx scripts/reconcile-blackjack-aliases.ts --rollout-id canonical-v1 --checkpoint output/blackjack-dry-run.json --signer 0x...`

2. Review the adjacent `.report.json`. A single verified decision can be copied to its canonical key. Conflicting decisions are quarantined; malformed keys, missing records, invalid signatures, unavailable Redis and CAS conflicts leave the inventory unknown. Reports omit signatures and seeds. No lock is deleted by this tool.

3. Deploy the canonical-lock release to **every** signing instance, including old deployments still receiving traffic. Configure the same unique `BLACKJACK_CANONICAL_SIGNER_ROLLOUT_ID` on all instances. Keep signing unavailable while this transition runs. Older instances do not honor the inventory barrier and must not remain reachable.

4. After reviewing the dry-run report and completing deployment, apply with a **new checkpoint**. Apply first persists the issuance barrier, then performs a fresh scan; a dry-run checkpoint cannot be promoted directly. `--all-signers-upgraded` is the operator's acknowledgement of the completed rollout, not an automated fleet check.

   `npx tsx scripts/reconcile-blackjack-aliases.ts --rollout-id canonical-v1 --checkpoint output/blackjack-apply.json --apply --all-signers-upgraded --signer 0x...`

5. Resume an incomplete apply with the same arguments and checkpoint. Only a complete scan with all valid single decisions copied and conflicts durably quarantined can declare the inventory stable. Quarantines are sticky and cannot be released with this command. An invalid record requires investigation; do not bulk-clear records to make the scan pass. Once a completed apply reports `stable`, use a new checkpoint for later inventories.

The application may issue new decisions after the stable marker is written, so the marker is evidence about the alias inventory at rollout, not a continuously frozen list of every canonical lock. If the configured onchain signer changes, use a new rollout and review old-signer records deliberately. Rollback must keep the canonical ID validation, quarantine checks and persistent locks; restoring the old route can issue aliases again.
