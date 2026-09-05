import { decodeEventLog, parseAbiItem, type Hex } from 'viem';
import type { TransactionReceiptLike } from './transaction-utils';

const attackEvent = parseAbiItem('event Attack(uint256 attacker, uint256 winner, uint256 loser, uint256 scoresWon)');
export function getAttackOutcome(logs: NonNullable<TransactionReceiptLike['logs']>, contractAddress: string) {
  for (const log of logs) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase() || !log.topics[0]) continue;
    try {
      const topics: [Hex, ...Hex[]] = [log.topics[0], ...log.topics.slice(1)];
      const { args } = decodeEventLog({ abi: [attackEvent], data: log.data, topics });
      const didWin = args.attacker === args.winner;
      const points = Number(args.scoresWon) / 1e12;
      return { didWin, message: `${didWin ? 'WON' : 'LOST'} ${points.toLocaleString(undefined, { maximumFractionDigits: 2 })} PTS` };
    } catch { /* Another event in the same receipt. */ }
  }
  return null;
}
