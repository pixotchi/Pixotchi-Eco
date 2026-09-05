import { decodeEventLog, parseAbiItem, type Hex } from 'viem';
import type { TransactionReceiptLike } from './transaction-utils';

export type BoxResult = { pointsDelta: number; timeAdded: number };
const events = [parseAbiItem('event Played(uint256 indexed id, uint256 points, uint256 timeExtension, string gameName)'),
  parseAbiItem('event PlayedV2(uint256 indexed id, int256 points, int256 timeExtension, string gameName)')] as const;

export function getBoxResult(receipts: readonly TransactionReceiptLike[], plantId: number, contractAddress: string): BoxResult | null {
  for (const receipt of receipts) for (const log of receipt.logs ?? []) {
    if (log.address.toLowerCase() !== contractAddress.toLowerCase() || !log.topics[0]) continue;
    const topics: [Hex, ...Hex[]] = [log.topics[0], ...log.topics.slice(1)];
    for (const event of events) {
      try {
        const { args } = decodeEventLog({ abi: [event], data: log.data, topics });
        if (args.id === BigInt(plantId)) return { pointsDelta: Number(args.points), timeAdded: Number(args.timeExtension) };
      } catch { /* Another event in this receipt. */ }
    }
  }
  return null;
}
