import {
AbiEventSignatureNotFoundError,
decodeEventLog,
parseAbiItem,
type Hex,
} from 'viem';

export const SPIN_GAME_V2_COMMITTED_EVENT = parseAbiItem(
  'event SpinGameV2Committed(uint256 indexed nftId, address indexed player, bytes32 commitHash)',
);
export const SPIN_GAME_V2_PLAYED_EVENT = parseAbiItem(
  'event SpinGameV2Played(uint256 indexed nftId, address indexed player, uint256 indexed rewardIndex, int256 pointsDelta, uint256 timeAdded, uint256 leafAmount)',
);
const LEGACY_SPIN_GAME_V2_PLAYED_EVENT = parseAbiItem(
  'event SpinGameV2Played(uint256 indexed nftId, address indexed player, uint256 rewardIndex, int256 pointsDelta, uint256 timeAdded, uint256 leafAmount)',
);
export const SPIN_GAME_V2_FORFEITED_EVENT = parseAbiItem(
  'event SpinGameV2Forfeited(uint256 indexed nftId, address indexed player)',
);
const LEGACY_PLAYED_EVENT = parseAbiItem(
  'event Played(uint256 indexed id, uint256 points, uint256 timeExtension, string gameName)',
);
const LEGACY_PLAYED_V2_EVENT = parseAbiItem(
  'event PlayedV2(uint256 indexed id, int256 points, int256 timeExtension, string gameName)',
);

type DecodableLog = {
  data?: Hex;
  topics?: readonly Hex[];
};

type ScoredSpinRewardResult = SpinRewardResult & {
  score: number;
};

export type SpinRewardResult = {
  rewardIndex?: number;
  pointsDelta: number;
  timeAdded: number;
  leafAmount: bigint;
};

function scoreSpinReward(
  result: SpinRewardResult,
  source: 'spin_v2' | 'legacy',
): number {
  let score = source === 'spin_v2' ? 100 : 10;
  if (result.leafAmount !== BigInt(0)) score += 4;
  if (result.timeAdded !== 0) score += 2;
  if (result.pointsDelta !== 0) score += 1;
  if (result.rewardIndex !== undefined) score += 1;
  return score;
}

function decodeSpinRewardLog(log: DecodableLog): ScoredSpinRewardResult | null {
  if (!log.data || !log.topics?.length) {
    return null;
  }

  const decodeAttempts = [
    [SPIN_GAME_V2_PLAYED_EVENT],
    [LEGACY_SPIN_GAME_V2_PLAYED_EVENT],
    [LEGACY_PLAYED_EVENT],
    [LEGACY_PLAYED_V2_EVENT],
  ] as const;

  for (const abi of decodeAttempts) {
    try {
      const decoded = decodeEventLog({
        abi,
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });

      if (decoded.eventName === 'SpinGameV2Played') {
        const pointsDelta = Number(decoded.args.pointsDelta ?? 0);
        const timeAdded = Number(decoded.args.timeAdded ?? 0);
        const leafAmount = BigInt(decoded.args.leafAmount ?? 0);
        const rewardIndexRaw = decoded.args.rewardIndex;
        const reward: SpinRewardResult = {
          rewardIndex:
            rewardIndexRaw !== undefined ? Number(rewardIndexRaw) : undefined,
          pointsDelta,
          timeAdded,
          leafAmount,
        };

        return {
          ...reward,
          score: scoreSpinReward(reward, 'spin_v2'),
        };
      }

      if (
        decoded.eventName === 'Played' ||
        decoded.eventName === 'PlayedV2'
      ) {
        const reward: SpinRewardResult = {
          pointsDelta: Number(decoded.args.points ?? 0),
          timeAdded: Number(decoded.args.timeExtension ?? 0),
          leafAmount: BigInt(0),
        };

        return {
          ...reward,
          score: scoreSpinReward(reward, 'legacy'),
        };
      }
    } catch (error) {
      if (error instanceof AbiEventSignatureNotFoundError) {
        continue;
      }
      continue;
    }
  }

  return null;
}

export function extractBestSpinRewardFromLogs(
  logs: readonly DecodableLog[],
): SpinRewardResult | undefined {
  let best: ScoredSpinRewardResult | undefined;

  for (const log of logs) {
    const reward = decodeSpinRewardLog(log);
    if (!reward) continue;

    if (!best || reward.score > best.score) {
      best = reward;
    }
  }

  if (!best) {
    return undefined;
  }

  const { score, ...result } = best;
  void score;
  return result;
}
