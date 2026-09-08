import { decodeEventLog, type Hex } from 'viem';
import { casinoAbi } from '@/public/abi/casino-abi';

export type RouletteReceiptResult = {
  winningNumber?: number;
  won?: boolean;
  payoutWei?: bigint;
  expired?: boolean;
  forfeitedAmountWei?: bigint;
  bettingToken: string;
  transactionHash?: string;
};

/** Keep receipt money in base units so metadata outages cannot change a result. */
export function parseRouletteReceipt(receipts: readonly unknown[], subject: { landId: bigint; player?: string; contract: string }): RouletteReceiptResult | undefined {
  for (const candidate of receipts) {
    if (!candidate || typeof candidate !== 'object') continue;
    const receipt = candidate as { logs?: unknown; transactionHash?: string };
    if (!Array.isArray(receipt.logs)) continue;
    for (const candidateLog of receipt.logs) {
      try {
        const log = candidateLog as { address?: string; data: Hex; topics: [Hex, ...Hex[]] };
        if (log.address?.toLowerCase() !== subject.contract.toLowerCase()) continue;
        const decoded = decodeEventLog({ abi: casinoAbi, data: log.data, topics: log.topics });
        if (decoded.eventName !== 'RouletteSpinResult' && decoded.eventName !== 'RouletteBetExpired') continue;
        const args = decoded.args;
        if (args.landId !== subject.landId || !subject.player || args.player.toLowerCase() !== subject.player.toLowerCase()) continue;
        return decoded.eventName === 'RouletteSpinResult'
          ? { winningNumber: decoded.args.winningNumber, won: decoded.args.won, payoutWei: decoded.args.payout, bettingToken: args.bettingToken, transactionHash: receipt.transactionHash }
          : { expired: true, forfeitedAmountWei: decoded.args.forfeitedAmount, bettingToken: args.bettingToken, transactionHash: receipt.transactionHash };
      } catch { /* Another event or malformed log is not this round's result. */ }
    }
  }
  return undefined;
}
