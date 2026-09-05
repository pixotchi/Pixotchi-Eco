import { readInt256, readSafeUint, readTupleField, readUint } from './contract-value';
import { decodeEventLog, type Hex } from 'viem';
import { SPIN_GAME_V2_COMMITTED_EVENT } from './spin-game-events';

export function parseSpinCommit(log: { data: Hex; topics: readonly Hex[]; blockNumber: bigint | null }, owner: string, plantId: number) {
  if (!log.topics[0]) throw new Error('Missing SpinLeaf commit event');
  const topics: [Hex, ...Hex[]] = [log.topics[0], ...log.topics.slice(1)];
  const { args } = decodeEventLog({ abi: [SPIN_GAME_V2_COMMITTED_EVENT], data: log.data, topics });
  if (args.player.toLowerCase() !== owner.toLowerCase() || args.nftId !== BigInt(plantId)) throw new Error('SpinLeaf commit belongs to another player or plant');
  const commitBlock = readSafeUint(log.blockNumber);
  if (!commitBlock) throw new Error('SpinLeaf commit is not sealed');
  return { player: args.player, commitment: args.commitHash, commitBlock };
}

export type SpinRewardPreview = { index: number; pointsDelta: number; timeExtension: number; leafAmount: bigint };
export type SpinMetadata = { cooldown: number; starCost: number; rewards: SpinRewardPreview[] };

export function parseSpinReward(value: unknown, index: number): SpinRewardPreview {
  // PTS is a scaled display estimate; LEAF remains exact for token formatting.
  return { index, pointsDelta: Number(readInt256(readTupleField(value, 'pointsDelta', 0))),
    timeExtension: readSafeUint(readTupleField(value, 'timeExtension', 1)),
    leafAmount: readUint(readTupleField(value, 'leafAmount', 2)) };
}

export function parseSpinMetadata(globalCooldown: unknown, starCost: unknown, perNftCooldown: unknown, rewards: unknown): SpinMetadata {
  readSafeUint(globalCooldown);
  if (!Array.isArray(rewards) || rewards.length !== 6) throw new Error('Incomplete SpinLeaf rewards');
  return { cooldown: readSafeUint(perNftCooldown), starCost: readSafeUint(starCost), rewards: rewards.map(parseSpinReward) };
}
