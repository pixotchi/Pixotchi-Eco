import assert from 'node:assert/strict';

import {
  ROULETTE_BET_TYPE,
  rouletteBetWins,
  rouletteCanReveal,
  rouletteRevealBlocksRemaining,
} from '../lib/casino-hardening-rules.mjs';
import { blackjackRandomnessLockMismatch } from '../lib/blackjack-randomness-lock.mjs';
import {
  BACCARAT_BET_TYPE,
  BACCARAT_OUTCOME,
  baccaratBankerShouldDraw,
  baccaratCalculatePayoutWei,
  baccaratHandTotal,
} from '../lib/baccarat-rules.mjs';

const baseLock = {
  actionNum: 255,
  handIndex: 0,
  bettingToken: '0x0000000000000000000000000000000000000001',
  playerAddress: '0x0000000000000000000000000000000000000002',
  betAmountWei: '1000000000000000000',
};

assert.equal(
  rouletteBetWins(ROULETTE_BET_TYPE.STREET, [0, 1, 2], 0),
  false,
  'Zero-containing street/trio must not preview a win on 0.'
);

assert.equal(
  rouletteBetWins(ROULETTE_BET_TYPE.STRAIGHT, [0], 0),
  true,
  'Straight zero should win on 0.'
);

for (const betType of [
  ROULETTE_BET_TYPE.BLACK,
  ROULETTE_BET_TYPE.EVEN,
  ROULETTE_BET_TYPE.ODD,
  ROULETTE_BET_TYPE.LOW,
  ROULETTE_BET_TYPE.HIGH,
]) {
  assert.equal(
    rouletteBetWins(betType, [], 0),
    false,
    `Outside bet type ${betType} must lose on 0.`
  );
}

const pendingReveal = {
  isActive: true,
  canReveal: false,
  isExpired: false,
  revealBlock: 100n,
};

assert.equal(
  rouletteCanReveal(pendingReveal, 100n),
  false,
  'Reveal must remain disabled at liveBlock === revealBlock.'
);
assert.equal(
  rouletteCanReveal(pendingReveal, 101n),
  true,
  'Reveal must become enabled only after liveBlock > revealBlock.'
);
assert.equal(
  rouletteRevealBlocksRemaining(pendingReveal, 100n),
  1,
  'Block revealBlock still needs one more block.'
);

assert.equal(
  blackjackRandomnessLockMismatch(
    baseLock,
    255,
    0,
    baseLock.bettingToken,
    baseLock.playerAddress,
    '2000000000000000000'
  ),
  true,
  'Changing a deal amount for the same land/nonce must mismatch the lock.'
);

assert.equal(
  blackjackRandomnessLockMismatch(
    baseLock,
    255,
    0,
    baseLock.bettingToken.toUpperCase(),
    baseLock.playerAddress.toUpperCase(),
    baseLock.betAmountWei
  ),
  false,
  'Identical deal amount should reuse cached randomness, regardless of address casing.'
);

assert.equal(
  baccaratHandTotal([0, 8]),
  0,
  'Baccarat totals must be modulo 10.'
);

assert.equal(
  baccaratBankerShouldDraw(3, 8),
  false,
  'Banker total 3 must stand when player third-card value is 8.'
);

assert.equal(
  baccaratBankerShouldDraw(6, 7),
  true,
  'Banker total 6 must draw on player third-card value 6 or 7.'
);

assert.deepEqual(
  baccaratCalculatePayoutWei(BACCARAT_BET_TYPE.PLAYER, BACCARAT_OUTCOME.PLAYER, 100n),
  { won: true, payoutWei: 200n },
  'Player bet should return 2x on player win.'
);

assert.deepEqual(
  baccaratCalculatePayoutWei(BACCARAT_BET_TYPE.BANKER, BACCARAT_OUTCOME.BANKER, 100n),
  { won: true, payoutWei: 195n },
  'Banker bet should return stake plus 95% profit.'
);

assert.deepEqual(
  baccaratCalculatePayoutWei(BACCARAT_BET_TYPE.PLAYER, BACCARAT_OUTCOME.TIE, 100n),
  { won: false, payoutWei: 100n },
  'Player/Banker bets should push on tie.'
);

assert.deepEqual(
  baccaratCalculatePayoutWei(BACCARAT_BET_TYPE.TIE, BACCARAT_OUTCOME.TIE, 100n),
  { won: true, payoutWei: 900n },
  'Tie bet should return stake plus 8:1 profit.'
);

console.log('Casino hardening smoke passed');
