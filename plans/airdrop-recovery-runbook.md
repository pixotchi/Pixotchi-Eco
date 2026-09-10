# Airdrop prepared-operation recovery

No production migration or payout is part of the verification commands below.

The claim path saves the allocation, account, Base network, prepared operation hash,
signature and first broadcast marker through exact-record Redis Lua CAS before sending.
Recovery observes or resends that same hash. A lease or the CDP 24-hour idempotency
window cannot turn a possibly paid attempt back into an eligible allocation.

The adapter resolves the existing named `pixotchi-agent` and `pixotchi-agent-sa-sp`
accounts with read-only getters. They must already exist. Sponsorship uses the same
CDP active-token discovery as the old SDK helper; `AIRDROP_PAYMASTER_URL` optionally
supplies an explicit server-only sponsorship URL. No new dependency is required.

Completion/failure requires the receipt to be at or below Base's safe head, its
block hash to match the canonical block, and a matching EntryPoint UserOperationEvent.
Successful token transfers must be in that operation's log segment. Pending safe-head
confirmation continues observation without authorizing a replacement payout.

Admin CSV replacement and clearing only change allocations that have never entered
a claim attempt. Per-record Lua checks protect pending, claimed, failed, manually
reviewed and unrecognized records, even when omitted from a CSV. Each change compares
the exact saved bytes, so a concurrent reservation wins over a stale admin snapshot.
Legacy locks are preserved. Upload/clear responses report protected records and
concurrent changes skipped; refresh the admin view to review the resulting list.

## Legacy or manual-review records

Pending records without an operation hash, and legacy failed records without
canonical nonpayment proof, require review. Existing state is not bulk rewritten.
For one pending wallet, provide credentials explicitly in the process environment;
the tool does not load `.env` files or enumerate wallets.

```powershell
node scripts/run-react-server-smoke.mjs scripts/reconcile-airdrop.ts --address <wallet>
node scripts/run-react-server-smoke.mjs scripts/reconcile-airdrop.ts --address <wallet> --operation-id <reviewed-hash> --evidence <support-reference>
```

These commands only read state and evidence. Review the returned public status and
`expectedFingerprint`. A matching CDP operation without canonical settlement yields
`applyAllowed: false`. Only an independently reviewed matching settlement may be
applied using the same arguments plus `--apply --expected-sha256 <fingerprint>`.
Apply uses CAS and stops if the allocation changed. It never prepares/signs/sends,
changes a prepared operation hash, or sets an allocation to eligible. Operators must
not include private credentials, signatures or personal data in the evidence string.

## Observability

Seven fixed daily counters under the configured prefix expire after seven days:
`airdrop:metrics:YYYY-MM-DD:{new_attempt,broadcast_uncertain,legacy_ambiguous_observed,manual_review,claimed,failed,stale_cas}`.
They count events, not unique wallets or outstanding liabilities. There are no
address, transaction or signature labels. Storage/SDK failures return fixed messages;
public status uses an explicit projection that excludes execution/signatures.

## Isolated verification

```powershell
node scripts/run-react-server-smoke.mjs smoke/airdrop-execution-smoke.ts
npx tsx smoke/airdrop-claim-state-smoke.ts
npx tsx smoke/airdrop-claim-reconciliation-smoke.ts
npx tsx smoke/airdrop-pending-poll-smoke.ts
npm run airdrop:redis:smoke
```

The Redis smoke creates a random isolated test container, uses random test keys,
then deletes its keys and stops its container. It covers admin upload/clear races,
protected history, claim concurrency and recovery after 48 hours. An optional existing container must
have a `pixotchi-airdrop-` name. It has no CDP credentials or network submissions.
