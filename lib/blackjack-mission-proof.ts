import { decodeEventLog, type Hex } from 'viem';
import { blackjackAbi, BlackjackResult } from '@/public/abi/blackjack-abi';
import { extractTransactionHash, type TransactionReceiptLike } from './transaction-utils';

export type BlackjackMissionSubject = { player: string; landId: bigint };

/** A Deal can settle naturally. Credit the matching settlement receipt, never an approval or a Hit. */
export function getBlackjackSettlementProofs(
  receipts: readonly TransactionReceiptLike[],
  subject: BlackjackMissionSubject,
  contractAddress: string,
): Hex[] {
  const hashes = new Set<Hex>();
  for (const receipt of receipts) {
    const hash = extractTransactionHash(receipt);
    if (!hash || receipt.status === 'reverted' || receipt.status === 0 || receipt.status === BigInt(0) || receipt.status === '0x0') continue;
    for (const log of receipt.logs ?? []) {
      if (log.address.toLowerCase() !== contractAddress.toLowerCase() || !log.topics[0]) continue;
      try {
        const event = decodeEventLog({ abi: blackjackAbi, topics: [log.topics[0], ...log.topics.slice(1)], data: log.data, strict: true });
        if (event.eventName !== 'BlackjackResult' && event.eventName !== 'BlackjackGameComplete') continue;
        if (event.args.player.toLowerCase() !== subject.player.toLowerCase() || event.args.landId !== subject.landId) continue;
        if (event.args.result > BlackjackResult.SURRENDERED || (event.eventName === 'BlackjackResult' && event.args.result === BlackjackResult.NONE)) continue;
        hashes.add(hash.toLowerCase() as Hex);
        break;
      } catch {
        // Other events and incomplete logs cannot prove a settled round.
      }
    }
  }
  return [...hashes];
}
