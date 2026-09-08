import { decodeEventLog, formatUnits, type Hex } from 'viem';
import { baccaratAbi, type BaccaratBetType, type BaccaratOutcome } from '../public/abi/baccarat-abi';

export type BaccaratRevealResult = {
  betType?: BaccaratBetType;
  outcome?: BaccaratOutcome;
  won?: boolean;
  playerCards?: number[];
  bankerCards?: number[];
  playerTotal?: number;
  bankerTotal?: number;
  payout?: string;
  payoutWei?: bigint;
  expired?: boolean;
  forfeitedAmount?: string;
  forfeitedWei?: bigint;
  transactionHash?: string;
  receiptIncomplete?: boolean;
};

/** Frozen before submission: selected token and connected wallet can change later. */
export type BaccaratRoundIdentity = {
  owner: string;
  landId: bigint;
  token: string;
  decimals: number | undefined;
  symbol: string | undefined;
  wager: bigint;
  betType: BaccaratBetType;
  revealBlock: bigint;
};
export type BaccaratSettlement = { round: BaccaratRoundIdentity; result: BaccaratRevealResult };
export type BaccaratReceiptLog = { address?: string; data?: string; topics?: readonly string[] };
export type BaccaratReceipt = { transactionHash?: string; logs?: readonly BaccaratReceiptLog[] };

export const baccaratOwnerScope = (owner: string | undefined, landId: bigint) => `${owner?.toLowerCase() ?? ''}:${landId}`;
export const baccaratRoundBelongsTo = (round: BaccaratRoundIdentity, owner: string | undefined, landId: bigint) => (
  baccaratOwnerScope(round.owner, round.landId) === baccaratOwnerScope(owner, landId)
);

export function hasCompleteBaccaratResult(result: BaccaratRevealResult): boolean {
  if (result.receiptIncomplete) return false;
  if (result.expired) return typeof result.forfeitedWei === 'bigint' || typeof result.forfeitedAmount === 'string';
  return result.outcome !== undefined && result.betType !== undefined && typeof result.won === 'boolean'
    && (typeof result.payoutWei === 'bigint' || typeof result.payout === 'string') && result.playerTotal !== undefined && result.bankerTotal !== undefined
    && !!result.playerCards?.length && !!result.bankerCards?.length;
}

/** Accept only this land, owner, token and emitting contract; missing logs stay unknown. */
export function parseBaccaratResultFromReceipts(
  receipts: readonly BaccaratReceipt[],
  round: BaccaratRoundIdentity,
  contractAddress: string,
): BaccaratRevealResult | undefined {
  for (const receipt of receipts) {
    let result: BaccaratRevealResult | undefined;
    let cards: Pick<BaccaratRevealResult, 'playerCards' | 'bankerCards'> = {};
    for (const log of receipt.logs ?? []) {
      if (log.address?.toLowerCase() !== contractAddress.toLowerCase() || !log.data || !log.topics) continue;
      try {
        const decoded = decodeEventLog({ abi: baccaratAbi, data: log.data as Hex, topics: log.topics as [Hex, ...Hex[]] });
        if (decoded.eventName !== 'BaccaratRoundResult' && decoded.eventName !== 'BaccaratRoundCards' && decoded.eventName !== 'BaccaratBetExpired') continue;
        const args = decoded.args;
        if (args.landId !== round.landId || args.player.toLowerCase() !== round.owner.toLowerCase()) continue;
        if ('bettingToken' in args && args.bettingToken.toLowerCase() !== round.token.toLowerCase()) continue;
        if (decoded.eventName === 'BaccaratBetExpired') {
          return { expired: true, forfeitedAmount: round.decimals === undefined ? undefined : formatUnits(decoded.args.forfeitedAmount, round.decimals), forfeitedWei: decoded.args.forfeitedAmount, transactionHash: receipt.transactionHash };
        }
        if (decoded.eventName === 'BaccaratRoundResult') {
          const value = decoded.args;
          if (value.outcome > 2 || value.betType > 2 || value.playerTotal > 9 || value.bankerTotal > 9) continue;
          result = { betType: value.betType, outcome: value.outcome, won: value.won, playerTotal: value.playerTotal,
            bankerTotal: value.bankerTotal, payout: round.decimals === undefined ? undefined : formatUnits(value.payout, round.decimals), payoutWei: value.payout, transactionHash: receipt.transactionHash };
        }
        if (decoded.eventName === 'BaccaratRoundCards') {
          const value = decoded.args;
          const hand = (a: number, b: number, c: number, count: number) => {
            const values = count === 2 ? [a, b] : count === 3 ? [a, b, c] : [];
            return values.length && values.every(card => Number.isInteger(card) && card >= 0 && card < 52) ? values : undefined;
          };
          cards = { playerCards: hand(value.playerCard1, value.playerCard2, value.playerCard3, value.playerCardCount),
            bankerCards: hand(value.bankerCard1, value.bankerCard2, value.bankerCard3, value.bankerCardCount) };
        }
      } catch { /* A receipt can include unrelated or incomplete logs. */ }
    }
    if (result) {
      const combined = { ...result, ...cards };
      return { ...combined, receiptIncomplete: !hasCompleteBaccaratResult(combined) };
    }
  }
  return undefined;
}
