/** Run via scripts/run-react-server-smoke.mjs. Credentials must be explicitly supplied in the environment. */
import { isAddress, type Hex } from 'viem';
import { getAirdropAdapter } from '../lib/airdrop-cdp';
import { createAirdropStore } from '../lib/airdrop-store';
import { airdropRecordFingerprint, planLegacyAirdropLink } from '../lib/airdrop-reconcile-plan';
import { publicAirdropStatus } from '../lib/airdrop-execution';

async function main() {
  const args = process.argv.slice(2);
  const value = (flag: string) => { const index = args.indexOf(flag); return index < 0 ? undefined : args[index + 1]; };
  const address = value('--address');
  const hash = value('--operation-id');
  const apply = args.includes('--apply');
  if (!address || !isAddress(address)) throw new Error('Use --address <wallet>; optional --operation-id <hash> --evidence <reference>. Default is dry-run.');
  const store = createAirdropStore(address);
  const snapshot = await store.read();
  if (!snapshot) throw new Error('No allocation record exists');
  const expectedFingerprint = airdropRecordFingerprint(snapshot.raw);
  if (!hash) {
    if (apply) throw new Error('Apply requires an explicitly reviewed operation ID');
    console.log(JSON.stringify({ mode: 'dry-run', expectedFingerprint, status: publicAirdropStatus(snapshot.record) }, null, 2));
    return;
  }
  const plan = await planLegacyAirdropLink(snapshot, address, hash as Hex, value('--evidence') ?? '', getAirdropAdapter());
  if (apply) {
    if (value('--expected-sha256') !== expectedFingerprint) throw new Error('Apply requires the exact fingerprint from the reviewed dry-run');
    if (!plan.record.confirmedProof || !['claimed', 'failed'].includes(plan.record.status ?? '')) throw new Error('Apply requires canonical matching settlement proof; this operation still needs review');
    if (!await store.cas(snapshot.raw, plan.record)) throw new Error('Record changed; rerun dry-run and review');
  }
  // Explicit projection: no execution record, signature, credentials, or upstream error body.
  console.log(JSON.stringify({ mode: apply ? 'applied' : 'dry-run', expectedFingerprint,
    applyAllowed: Boolean(plan.record.confirmedProof && ['claimed', 'failed'].includes(plan.record.status ?? '')), status: plan.publicStatus }, null, 2));
}
main().catch(() => { console.error('Airdrop reconciliation stopped. Verify arguments, record fingerprint, operation evidence, and service connectivity. No payout was submitted.'); process.exitCode = 1; });
