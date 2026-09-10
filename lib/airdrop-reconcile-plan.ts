import { createHash } from 'node:crypto';
import type { Hex } from 'viem';
import { buildAirdropCalls, matchesAirdropOperation, observeAirdrop, publicAirdropStatus, type AirdropAdapter, type AirdropSnapshot } from './airdrop-execution';

export const airdropRecordFingerprint = (raw: string) => createHash('sha256').update(raw).digest('hex');

/** Review one supplied public operation hash. Never search, prepare, sign, send, or mark eligible. */
export async function planLegacyAirdropLink(snapshot: AirdropSnapshot, recipient: Hex, hash: Hex, evidence: string, adapter: AirdropAdapter, now = Date.now()) {
  if (snapshot.record.status !== 'pending' || snapshot.record.claimed) throw new Error('Only pending records can be reconciled');
  if (snapshot.record.operationId && snapshot.record.operationId.toLowerCase() !== hash.toLowerCase()) throw new Error('A different operation is already recorded');
  if (snapshot.record.execution && snapshot.record.execution.preparedUserOpHash?.toLowerCase() !== hash.toLowerCase()) throw new Error('The prepared operation cannot be replaced');
  if (!/^0x[0-9a-f]{64}$/i.test(hash) || evidence.trim().length < 8 || evidence.length > 500) throw new Error('An operation hash and concise evidence reference are required');
  const agentAddress = await adapter.address();
  if (snapshot.record.execution && snapshot.record.execution.agentAddress.toLowerCase() !== agentAddress.toLowerCase()) throw new Error('Agent account does not match the saved attempt');
  const calls = buildAirdropCalls(snapshot.record, recipient);
  const operation = await adapter.observe(agentAddress, hash);
  if (!calls.length || !matchesAirdropOperation(operation, hash, calls)) throw new Error('Operation does not match this allocation');
  const linked = { ...snapshot.record, recoveryState: undefined, operationId: hash,
    execution: snapshot.record.execution ? { ...snapshot.record.execution, phase: 'pending' as const } : undefined,
    reconciliation: { reviewedAt: now, evidence: evidence.trim(), agentAddress } };
  let planned = { raw: JSON.stringify(linked), record: linked } as AirdropSnapshot;
  planned = await observeAirdrop(planned, {
    read: async () => planned,
    cas: async (_expected, record) => { planned = { raw: JSON.stringify(record), record }; return true; },
  }, adapter, now, recipient);
  return { expectedFingerprint: airdropRecordFingerprint(snapshot.raw), record: planned.record, publicStatus: publicAirdropStatus(planned.record, now) };
}
