import assert from 'node:assert/strict';

import {
  ROULETTE_BET_TYPE,
  rouletteBetWins,
  rouletteCanReveal,
  rouletteRevealBlocksRemaining,
} from '../lib/casino-hardening-rules.mjs';
import { blackjackRandomnessLockMismatch } from '../lib/blackjack-randomness-lock.mjs';

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

console.log('Casino hardening smoke passed');
