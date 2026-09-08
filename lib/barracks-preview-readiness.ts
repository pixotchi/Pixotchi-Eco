import type { BarracksRaidPreviewV2 } from './types';

export type RaidPreviewState =
  | { identity: string; status: 'loading' }
  | { identity: string; status: 'error'; message: string }
  | { identity: string; status: 'ready'; preview: BarracksRaidPreviewV2 };

export function getRaidPreviewIdentity(
  owner: string | undefined,
  attackerLandId: bigint,
  defenderLandId: bigint | null,
  swordsmen: bigint | null,
  phalanx: bigint | null,
): string | null {
  if (!owner || defenderLandId === null || swordsmen === null || phalanx === null
    || swordsmen < BigInt(0) || phalanx < BigInt(0) || swordsmen + phalanx <= BigInt(0)) return null;
  return `${owner.toLowerCase()}:${attackerLandId}:${defenderLandId}:${swordsmen}:${phalanx}`;
}

/** Identity is checked during render, before the effect for changed inputs runs. */
export function getCurrentRaidPreview(state: RaidPreviewState | null, identity: string | null): BarracksRaidPreviewV2 | null {
  return identity !== null && state?.identity === identity && state.status === 'ready' ? state.preview : null;
}

export function requireCurrentRaidPreview(state: RaidPreviewState | null, identity: string | null): void {
  const preview = getCurrentRaidPreview(state, identity);
  if (!preview || preview.statusCode !== 0) {
    throw new Error('Wait for the current raid preview, then review it before submitting.');
  }
}
