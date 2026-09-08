import assert from 'node:assert/strict';
import { encodeAbiParameters, encodeEventTopics, type AbiEvent, type Hex } from 'viem';
import { blackjackAbi, BlackjackAction, BlackjackResult } from '../public/abi/blackjack-abi';
import { parseBlackjackTransactionResult } from '../lib/blackjack-events';

const address = `0x${'1'.repeat(40)}` as Hex;
const abi = blackjackAbi.find(item => item.type === 'event' && item.name === 'BlackjackResult')! as AbiEvent;
const values: Record<string, unknown> = {landId:BigInt(1),player:address,bettingToken:address,result:BlackjackResult.PLAYER_WIN,playerFinalValue:20,dealerFinalValue:18,payout:BigInt(2000000)};
const params = abi.inputs.filter(input=>!input.indexed);
const log = {address,topics:encodeEventTopics({abi:blackjackAbi,eventName:'BlackjackResult',args:{landId:BigInt(1),player:address}}) as [Hex,...Hex[]],data:encodeAbiParameters(params,params.map(input=>values[input.name!]) as never)};
const unknown = parseBlackjackTransactionResult([{logs:[log]}],'action',BlackjackAction.STAND,undefined,address).result;
assert.equal(unknown.gameResult,BlackjackResult.PLAYER_WIN,'Paid round outcome can settle without token metadata');
assert.equal(unknown.payout,undefined,'Unknown decimals are never guessed');
assert.equal(unknown.payoutWei,BigInt(2000000),'Raw confirmed amount is retained for later verified formatting');
const known = parseBlackjackTransactionResult([{logs:[log]}],'action',BlackjackAction.STAND,6,address).result;
assert.equal(known.payout,'2');
assert.equal(known.payoutWei,unknown.payoutWei);
console.log('PASS Blackjack paid-round recovery preserves raw payout with unknown metadata');
