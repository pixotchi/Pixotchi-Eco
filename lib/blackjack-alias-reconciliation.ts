import type { Address } from 'viem';
import {
  BLACKJACK_INVENTORY_KEY, blackjackDecisionDigest, blackjackQuarantineKey,
  isBlackjackLock, parseBlackjackAliasKey, verifyBlackjackLock,
  type BlackjackInventory, type BlackjackLock,
} from './blackjack-locks';
import type { BlackjackLockStore } from './blackjack-lock-store';
import { incrementBlackjackLockCounter } from './blackjack-lock-metrics';

export interface BlackjackScanCheckpoint {
  v: 1;
  rolloutId: string;
  signer: Address;
  startedAt: number;
  cursor: string;
  keys: string[];
  complete: boolean;
  inventoryRaw?: string;
}

export interface BlackjackAliasReport {
  status: 'unknown' | 'reviewed' | 'stable';
  scannedKeys: number;
  copied: number;
  quarantined: number;
  groups: Array<{ landId: string; nonce: string; aliases: number; decision: 'copy' | 'quarantine' | 'unknown'; applied: boolean }>;
  unknownRecords: number;
}

export function newBlackjackScan(rolloutId: string, signer: Address, now = Date.now()): BlackjackScanCheckpoint {
  if (!/^[a-zA-Z0-9._-]{1,80}$/.test(rolloutId)) throw new Error('A bounded rollout ID is required');
  return { v: 1, rolloutId, signer, startedAt: now, cursor: '0', keys: [], complete: false };
}

export function validateBlackjackScan(value: unknown): value is BlackjackScanCheckpoint {
  if (!value || typeof value !== 'object') return false;
  const scan = value as BlackjackScanCheckpoint;
  return scan.v === 1 && /^[a-zA-Z0-9._-]{1,80}$/.test(scan.rolloutId)
    && /^0x[\da-f]{40}$/i.test(scan.signer) && Number.isFinite(scan.startedAt)
    && typeof scan.cursor === 'string' && /^\d+$/.test(scan.cursor)
    && Array.isArray(scan.keys) && scan.keys.every(key => typeof key === 'string')
    && typeof scan.complete === 'boolean' && (!scan.complete || scan.cursor === '0')
    && (scan.inventoryRaw === undefined || typeof scan.inventoryRaw === 'string');
}

/** Applying starts a durable issuance barrier before the first SCAN page. */
export async function beginBlackjackReconciliation(store: BlackjackLockStore, checkpoint: BlackjackScanCheckpoint): Promise<void> {
  if (checkpoint.inventoryRaw) {
    if (await store.read(BLACKJACK_INVENTORY_KEY) !== checkpoint.inventoryRaw) throw new Error('Inventory ownership changed');
    return;
  }
  if (checkpoint.keys.length || checkpoint.complete || checkpoint.cursor !== '0') {
    throw new Error('Apply requires a fresh scan after establishing the issuance barrier');
  }
  const previous = await store.read(BLACKJACK_INVENTORY_KEY);
  const inventory: BlackjackInventory = {
    v: 1, phase: 'scanning', signer: checkpoint.signer,
    rolloutId: checkpoint.rolloutId, startedAt: checkpoint.startedAt,
  };
  const raw = JSON.stringify(inventory);
  if (!await store.compareAndSet(BLACKJACK_INVENTORY_KEY, previous, raw)) throw new Error('Inventory ownership changed');
  checkpoint.inventoryRaw = raw;
}

/** The caller persists this checkpoint after every page. Errors leave complete=false. */
export async function scanBlackjackAliasPage(store: BlackjackLockStore, checkpoint: BlackjackScanCheckpoint): Promise<void> {
  if (checkpoint.complete) return;
  const result = await store.scan(checkpoint.cursor, 250);
  if (!/^\d+$/.test(result.cursor) || !Array.isArray(result.keys) || !result.keys.every(key => typeof key === 'string')) {
    throw new Error('Unknown alias inventory: invalid SCAN response');
  }
  checkpoint.keys = [...new Set([...checkpoint.keys, ...result.keys])];
  checkpoint.cursor = result.cursor;
  checkpoint.complete = result.cursor === '0';
}

/** All input records are reread and signature-checked. Reports contain no signatures or seeds. */
export async function reconcileBlackjackAliases(
  store: BlackjackLockStore,
  checkpoint: BlackjackScanCheckpoint,
  options: { apply?: boolean; allSignersUpgraded?: boolean; now?: number } = {},
): Promise<BlackjackAliasReport> {
  const report: BlackjackAliasReport = { status: 'unknown', scannedKeys: checkpoint.keys.length, copied: 0, quarantined: 0, groups: [], unknownRecords: 0 };
  if (!checkpoint.complete) return report;
  if (options.apply && (!options.allSignersUpgraded || !checkpoint.inventoryRaw)) throw new Error('Applying requires the signer rollout acknowledgement and issuance barrier');
  const groups = new Map<string, { landId: bigint; nonce: bigint; keys: string[] }>();
  for (const key of checkpoint.keys) {
    const parsed = parseBlackjackAliasKey(key);
    if (!parsed) { report.unknownRecords++; continue; }
    const group = groups.get(parsed.canonicalKey) ?? { landId: parsed.landId, nonce: parsed.nonce, keys: [] };
    group.keys.push(key);
    groups.set(parsed.canonicalKey, group);
  }
  for (const [canonicalKey, group] of groups) {
    const entry: BlackjackAliasReport['groups'][number] = {
      landId: group.landId.toString(), nonce: group.nonce.toString(), aliases: group.keys.length,
      decision: 'unknown', applied: false,
    };
    report.groups.push(entry);
    try {
      const guards: Array<[string, string | null]> = [];
      const decisions = new Map<string, { lock: BlackjackLock; raw: string }>();
      // Include the canonical key even when SCAN did not return it. A race is unknown.
      const keys = [...new Set([...group.keys, canonicalKey])];
      let invalid = false;
      for (const key of keys) {
        const raw = await store.read(key);
        guards.push([key, raw]);
        if (raw === null) { if (group.keys.includes(key)) invalid = true; continue; }
        let value: unknown;
        try { value = JSON.parse(raw); } catch { invalid = true; continue; }
        if (!isBlackjackLock(value) || !await verifyBlackjackLock(group.landId, group.nonce, value, checkpoint.signer)) {
          invalid = true; continue;
        }
        decisions.set(blackjackDecisionDigest(value), { lock: value, raw });
      }
      const quarantineKey = blackjackQuarantineKey(group.landId, group.nonce);
      const quarantineRaw = await store.read(quarantineKey);
      // A prior quarantine remains sticky; the tool never silently releases it.
      entry.decision = invalid || decisions.size === 0 ? 'unknown' : decisions.size > 1 || quarantineRaw !== null ? 'quarantine' : 'copy';
      if (entry.decision === 'unknown') report.unknownRecords++;
      if (!options.apply) continue;
      guards.push([BLACKJACK_INVENTORY_KEY, checkpoint.inventoryRaw!]);
      if (entry.decision !== 'copy') {
        const value = JSON.stringify({ v: 1, reason: entry.decision === 'unknown' ? 'invalid_record' : 'conflicting_decisions', rolloutId: checkpoint.rolloutId, recordedAt: options.now ?? Date.now() });
        entry.applied = await store.guardedWrite(quarantineKey, quarantineRaw, value, guards);
        if (entry.applied) {
          report.quarantined++;
          if (quarantineRaw === null) incrementBlackjackLockCounter('quarantined_nonces');
        }
      } else {
        const expected = guards.find(([key]) => key === canonicalKey)![1];
        guards.push([quarantineKey, null]);
        // SET without a TTL also preserves a canonical decision for the full nonce lifetime.
        entry.applied = await store.guardedWrite(canonicalKey, expected, decisions.values().next().value!.raw, guards);
        if (entry.applied) report.copied++;
      }
      if (!entry.applied) { entry.decision = 'unknown'; report.unknownRecords++; }
    } catch {
      entry.decision = 'unknown';
      report.unknownRecords++;
    }
  }
  if (report.unknownRecords) return report;
  report.status = 'reviewed';
  if (options.apply) {
    const stable: BlackjackInventory = {
      v: 1, phase: 'stable', signer: checkpoint.signer, rolloutId: checkpoint.rolloutId,
      startedAt: checkpoint.startedAt, completedAt: options.now ?? Date.now(),
    };
    if (await store.compareAndSet(BLACKJACK_INVENTORY_KEY, checkpoint.inventoryRaw!, JSON.stringify(stable))) report.status = 'stable';
    else report.status = 'unknown';
  }
  return report;
}
