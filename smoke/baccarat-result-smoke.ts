import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, type AbiEvent, type Hex } from 'viem';
import { baccaratAbi, BaccaratBetType, BaccaratOutcome } from '../public/abi/baccarat-abi';
import { baccaratRoundBelongsTo, hasCompleteBaccaratResult, parseBaccaratResultFromReceipts, type BaccaratReceiptLog, type BaccaratRoundIdentity } from '../lib/baccarat-result';

const contract = '0x3333333333333333333333333333333333333333';
const round: BaccaratRoundIdentity = {
  owner: '0x1111111111111111111111111111111111111111', landId: BigInt(1), token: '0x2222222222222222222222222222222222222222',
  decimals: 6, symbol: 'BETA', wager: BigInt(10000000), betType: BaccaratBetType.BANKER, revealBlock: BigInt(1),
};
const hash = `0x${'a'.repeat(64)}`;
function event(name: 'BaccaratRoundResult' | 'BaccaratRoundCards' | 'BaccaratBetExpired', overrides: Record<string, unknown> = {}): BaccaratReceiptLog {
  const values: Record<string, unknown> = { landId: round.landId, player: round.owner, bettingToken: round.token,
    betType: BaccaratBetType.BANKER, outcome: BaccaratOutcome.BANKER, won: true, playerTotal: 3, bankerTotal: 8, payout: BigInt(19500000),
    playerCard1: 1, playerCard2: 0, playerCard3: 255, playerCardCount: 2, bankerCard1: 3, bankerCard2: 3, bankerCard3: 255, bankerCardCount: 2,
    forfeitedAmount: round.wager, ...overrides };
  const abi = baccaratAbi.find(item => item.type === 'event' && item.name === name)! as AbiEvent;
  const inputs = abi.inputs.filter(input => !input.indexed);
  return { address: contract,
    topics: encodeEventTopics({ abi: baccaratAbi, eventName: name, args: { landId: values.landId as bigint, player: values.player as Hex } }) as Hex[],
    data: encodeAbiParameters(inputs, inputs.map(input => values[input.name!]) as never) };
}
const parse = (logs: BaccaratReceiptLog[], identity = round) => parseBaccaratResultFromReceipts([{ transactionHash: hash, logs }], identity, contract);
assert.equal(parse([]), undefined, 'An empty confirmed receipt is unknown, never a zero payout');
assert.equal(hasCompleteBaccaratResult({transactionHash:hash,receiptIncomplete:true}),false);
const partial = parse([event('BaccaratRoundResult')])!;
assert.equal(partial.receiptIncomplete,true);
assert.equal(hasCompleteBaccaratResult(partial),false);
const complete = parse([event('BaccaratRoundResult'),event('BaccaratRoundCards')])!;
assert.equal(hasCompleteBaccaratResult(complete),true);
assert.equal(complete.payout,'19.5','Result uses the committed token precision');
assert.equal(complete.transactionHash,hash);
const raw = parse([event('BaccaratRoundResult'),event('BaccaratRoundCards')],{...round,decimals:undefined,symbol:undefined})!;
assert.equal(hasCompleteBaccaratResult(raw),true,'Metadata cannot block paid round settlement');
assert.equal(raw.payoutWei,BigInt(19500000));
assert.equal(raw.payout,undefined,'Never invent decimals to format a settlement');
const zero = parse([event('BaccaratRoundResult',{won:false,payout:BigInt(0)}),event('BaccaratRoundCards')])!;
assert.equal(hasCompleteBaccaratResult(zero),true,'A decoded complete zero payout remains a valid outcome');
assert.equal(zero.payout,'0');
assert.equal(parse([event('BaccaratRoundResult'),event('BaccaratRoundCards')],{...round,landId:BigInt(2)}),undefined);
assert.equal(parse([event('BaccaratRoundResult'),event('BaccaratRoundCards')],{...round,owner:'0x5555555555555555555555555555555555555555'}),undefined);
assert.equal(parse([event('BaccaratRoundResult'),event('BaccaratRoundCards')],{...round,token:'0x5555555555555555555555555555555555555555'}),undefined);
assert.equal(parse([event('BaccaratRoundResult'),event('BaccaratRoundCards')].map(log=>({...log,address:round.token}))),undefined);
assert.equal(hasCompleteBaccaratResult(parse([event('BaccaratRoundResult'),event('BaccaratRoundCards',{playerCard1:255})])!),false);
const expired = parse([event('BaccaratBetExpired')])!;
assert.equal(hasCompleteBaccaratResult(expired),true);
assert.equal(expired.forfeitedAmount,'10');
assert.equal(baccaratRoundBelongsTo(round,round.owner.toUpperCase(),BigInt(1)),true);
assert.equal(baccaratRoundBelongsTo(round,round.owner,BigInt(2)),false);
console.log('PASS Baccarat receipt completeness, exact precision, expiry, and contract/owner/land/token isolation');
