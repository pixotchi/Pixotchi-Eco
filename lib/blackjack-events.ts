import { decodeEventLog, formatUnits, type Hex } from 'viem';
import { blackjackAbi, BlackjackResult, BlackjackAction } from '@/public/abi/blackjack-abi';
import type { TransactionReceiptLike } from './transaction-utils';

function readBlackjackResult(value: number): BlackjackResult {
    if (!Number.isInteger(value) || value < BlackjackResult.NONE || value > BlackjackResult.SURRENDERED) throw new Error('Invalid Blackjack result');
    return value;
}

export type BlackjackTransactionResult = {
        success: boolean;
        actionTaken?: BlackjackAction;
        cards?: number[];
        dealerCards?: number[];
        dealerValue?: number;
        handIndex?: number;
        dealerHits?: Array<{ card: number; value: number }>;
        splitCards?: number[];
        handValue?: number;
        splitValue?: number;
        dealerUpCard?: number;
        gameResult?: BlackjackResult;
        payout?: string;
        payoutWei?: bigint;
        busted?: boolean;
        lastActionCard?: number;
        lastActionHandIndex?: number;
        splitHand1Card?: number;
        splitHand2Card?: number;
        splitResults?: Array<{
            result: BlackjackResult;
            playerFinalValue: number;
            dealerFinalValue: number;
            payout?: string;
            payoutWei: bigint;
        }>;
};

const WIN_RESULTS = new Set<BlackjackResult>([
    BlackjackResult.PLAYER_WIN,
    BlackjackResult.PLAYER_BLACKJACK,
]);

const LOSS_RESULTS = new Set<BlackjackResult>([
    BlackjackResult.DEALER_WIN,
    BlackjackResult.DEALER_BLACKJACK,
    BlackjackResult.PLAYER_BUST,
]);

const summarizeSplitResult = (results: BlackjackResult[]): BlackjackResult => {
    if (results.length === 0) return BlackjackResult.NONE;

    const wins = results.filter(r => WIN_RESULTS.has(r)).length;
    const losses = results.filter(r => LOSS_RESULTS.has(r)).length;
    const pushes = results.filter(r => r === BlackjackResult.PUSH).length;

    if (wins === results.length) return BlackjackResult.PLAYER_WIN;
    if (losses === results.length) return BlackjackResult.DEALER_WIN;
    if (pushes === results.length) return BlackjackResult.PUSH;
    return BlackjackResult.NONE;
};

const normalizeSplitHandEvents = (
    events: Array<{
        result: BlackjackResult;
        playerFinalValue: number;
        dealerFinalValue: number;
        payoutWei: bigint;
    }>,
    totalPayoutWei?: bigint
) => {
    // A HandResult carrying NONE is not a real hand outcome — it is the placeholder
    // the contract emits for the split game itself. Letting one through put
    // BlackjackResult.NONE on a hand, which getResultText maps to '' and the UI then
    // renders as a neutral yellow "Result" — so a hand that plainly won (e.g. 19 vs a
    // busted dealer) showed no win. Prefer decided outcomes whenever there are enough
    // of them, and only fall back to the raw list if filtering would leave too few.
    const decidedEvents = events.filter((entry) => entry.result !== BlackjackResult.NONE);
    const pool = decidedEvents.length >= 2 ? decidedEvents : events;

    if (pool.length <= 2) return pool;

    // Best-effort: choose two entries whose payouts match total payout when available.
    if (typeof totalPayoutWei === 'bigint') {
        for (let i = 0; i < pool.length; i++) {
            for (let j = i + 1; j < pool.length; j++) {
                if (pool[i].payoutWei + pool[j].payoutWei === totalPayoutWei) {
                    return [pool[i], pool[j]];
                }
            }
        }
    }

    // Fallback to first+last to avoid rendering phantom extra hands.
    return [pool[0], pool[pool.length - 1]];
};


/** Decode only this casino's receipt events; presentation and wallet execution stay outside. */
export function parseBlackjackTransactionResult(receipts: readonly TransactionReceiptLike[], mode: 'deal' | 'action', action: BlackjackAction | undefined, tokenDecimals: number | undefined, contractAddress: string) {
  let resultData: BlackjackTransactionResult = {
      success: true,
      actionTaken: mode === "action" ? action : undefined,
  };
  const handResultEvents: Array<{
      result: BlackjackResult;
      playerFinalValue: number;
      dealerFinalValue: number;
      payoutWei: bigint;
  }> = [];
  const seenBlackjackResultLogs = new Set<string>();
  let gameCompleteData: {
      result: BlackjackResult;
      playerCards: number[];
      splitCards: number[];
      dealerCards: number[];
      playerFinalValue: number;
      splitFinalValue: number;
      dealerFinalValue: number;
      payoutWei: bigint;
  } | null = null;

  for (const receipt of receipts) {
      for (const log of (receipt?.logs || [])) {
      if (log.address.toLowerCase() !== contractAddress.toLowerCase() || !log.topics[0]) continue;
      const topics: [Hex, ...Hex[]] = [log.topics[0], ...log.topics.slice(1)];
          try {
              if (mode === "deal") {
                  try {
                      const decoded = decodeEventLog({ abi: blackjackAbi, data: log.data, topics, eventName: 'BlackjackDealt' });
                      if (decoded.args) {
                          const args = decoded.args ;
                          resultData = { ...resultData, cards: [args.playerCard1, args.playerCard2], handValue: args.playerHandValue, dealerUpCard: args.dealerUpCard };
                      }
                  } catch { }
              }

              if (mode === "action") {
                  try {
                      const decoded = decodeEventLog({ abi: blackjackAbi, data: log.data, topics, eventName: 'BlackjackHit' });
                      if (decoded.args) {
                          const args = decoded.args ;
                          resultData = {
                              ...resultData,
                              cards: [Number(args.newCard)],
                              handValue: Number(args.newHandValue),
                              busted: args.busted,
                              handIndex: Number(args.handIndex),
                              lastActionCard: Number(args.newCard),
                              lastActionHandIndex: Number(args.handIndex),
                          };
                      }
                  } catch { }

                  try {
                      const decoded = decodeEventLog({ abi: blackjackAbi, data: log.data, topics, eventName: 'BlackjackSplit' });
                      if (decoded.args) {
                          const args = decoded.args ;
                          resultData = {
                              ...resultData,
                              splitHand1Card: Number(args.hand1Card),
                              splitHand2Card: Number(args.hand2Card),
                          };
                      }
                  } catch { }
              }

              // Parse BlackjackGameComplete event for full card state (preferred over BlackjackResult)
              try {
                  const decoded = decodeEventLog({ abi: blackjackAbi, data: log.data, topics, eventName: 'BlackjackGameComplete' });
                  if (decoded.args) {
                      const args = decoded.args ;
                      gameCompleteData = {
                          result: readBlackjackResult(args.result),
                          playerCards: Array.isArray(args.playerCards) ? args.playerCards.map(Number) : [],
                          splitCards: Array.isArray(args.splitCards) ? args.splitCards.map(Number) : [],
                          dealerCards: Array.isArray(args.dealerCards) ? args.dealerCards.map(Number) : [],
                          playerFinalValue: Number(args.playerFinalValue),
                          splitFinalValue: Number(args.splitFinalValue),
                          dealerFinalValue: Number(args.dealerFinalValue),
                          payoutWei: BigInt(args.payout),
                      };
                  }
              } catch { }

              // Parse BlackjackResult (single result or per-hand split results)
              try {
                  const decoded = decodeEventLog({ abi: blackjackAbi, data: log.data, topics, eventName: 'BlackjackResult' });
                  if (decoded.args) {
                      const fallbackLogId = `${log?.data ?? ''}-${Array.isArray(log?.topics) ? log.topics.join('|') : ''}`;
                      const resultLogKey = `${receipt?.transactionHash ?? 'nohash'}-${String(log?.logIndex ?? log?.transactionLogIndex ?? fallbackLogId)}-BlackjackResult`;
                      if (seenBlackjackResultLogs.has(resultLogKey)) {
                          continue;
                      }
                      seenBlackjackResultLogs.add(resultLogKey);

                      const args = decoded.args ;
                      handResultEvents.push({
                          result: readBlackjackResult(args.result),
                          playerFinalValue: Number(args.playerFinalValue),
                          dealerFinalValue: Number(args.dealerFinalValue),
                          payoutWei: BigInt(args.payout),
                      });
                  }
              } catch { }

              // Parse BlackjackDealerHit events for animation data
              try {
                  const decoded = decodeEventLog({ abi: blackjackAbi, data: log.data, topics, eventName: 'BlackjackDealerHit' });
                  if (decoded.args) {
                      const args = decoded.args ;
                      if (!resultData.dealerHits) resultData.dealerHits = [];
                      resultData.dealerHits.push({
                          card: Number(args.newCard),
                          value: Number(args.dealerValue)
                      });
                  }
              } catch { }
          } catch { }
      }
  }

  // Finalize result parsing once we have all logs
  if (gameCompleteData) {
      resultData = {
          ...resultData,
          cards: gameCompleteData.playerCards.length > 0 ? gameCompleteData.playerCards : resultData.cards,
          splitCards: gameCompleteData.splitCards.length > 0 ? gameCompleteData.splitCards : resultData.splitCards,
          dealerCards: gameCompleteData.dealerCards,
          handValue: gameCompleteData.playerFinalValue,
          splitValue: gameCompleteData.splitFinalValue,
          dealerValue: gameCompleteData.dealerFinalValue,
          payout: tokenDecimals === undefined ? undefined : formatUnits(gameCompleteData.payoutWei, tokenDecimals),
          payoutWei: gameCompleteData.payoutWei,
      };
  }

  if (handResultEvents.length > 0) {
      const hasSplitCardsFromComplete = !!gameCompleteData && gameCompleteData.splitCards.length > 0;
      const isSplitResolution =
          hasSplitCardsFromComplete ||
          gameCompleteData?.result === BlackjackResult.NONE ||
          (!gameCompleteData && handResultEvents.length > 1);
      if (isSplitResolution) {
          const normalizedSplitEvents = normalizeSplitHandEvents(
              handResultEvents,
              gameCompleteData?.payoutWei
          );
          const splitResults = normalizedSplitEvents.map((entry) => ({
              result: entry.result,
              playerFinalValue: entry.playerFinalValue,
              dealerFinalValue: entry.dealerFinalValue,
              payout: tokenDecimals === undefined ? undefined : formatUnits(entry.payoutWei, tokenDecimals),
              payoutWei: entry.payoutWei,
          }));
          const totalPayoutWei = gameCompleteData
              ? gameCompleteData.payoutWei
              : handResultEvents.reduce((sum, entry) => sum + entry.payoutWei, BigInt(0));

          resultData = {
              ...resultData,
              splitResults,
              gameResult: summarizeSplitResult(normalizedSplitEvents.map(entry => entry.result)),
              payout: tokenDecimals === undefined ? undefined : formatUnits(totalPayoutWei, tokenDecimals),
              payoutWei: totalPayoutWei,
              dealerValue: gameCompleteData?.dealerFinalValue ?? normalizedSplitEvents[0].dealerFinalValue,
          };
      } else {
          const final = handResultEvents[handResultEvents.length - 1];
          resultData = {
              ...resultData,
              gameResult: gameCompleteData && gameCompleteData.result !== BlackjackResult.NONE ? gameCompleteData.result : final.result,
              handValue: gameCompleteData?.playerFinalValue ?? final.playerFinalValue,
              payout: tokenDecimals === undefined ? undefined : formatUnits(gameCompleteData?.payoutWei ?? final.payoutWei, tokenDecimals),
              payoutWei: gameCompleteData?.payoutWei ?? final.payoutWei,
              dealerValue: gameCompleteData?.dealerFinalValue ?? final.dealerFinalValue,
          };
      }
  } else if (gameCompleteData?.result !== undefined) {
      resultData = {
          ...resultData,
          gameResult: gameCompleteData.result,
      };
  }


  return { result: resultData, gameComplete: Boolean(gameCompleteData) };
}
