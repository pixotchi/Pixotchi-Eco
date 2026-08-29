/**
 * Blackjack split-hand turn advance.
 *
 * Reproduces the reported bug — "after you Double the first hand of a split there
 * is no Double option for Hand 2, it always shows Playing Hand 1, and it only
 * refreshes after reopening" — against the state machine, and asserts the fixed
 * behaviour. Also covers the NONE-result placeholder that made a winning Hand 2
 * render as a neutral "Result".
 *
 * Run: npx tsx smoke/blackjack-split-turn-smoke.ts
 */
import assert from "node:assert/strict";

import { BlackjackAction, BlackjackResult, getResultText } from "../public/abi/blackjack-abi";

// ---------------------------------------------------------------------------
// The UI derivations, transcribed from BlackjackDialog.tsx (lines ~1046-1081).
// ---------------------------------------------------------------------------
type State = {
  hasSplit: boolean;
  currentHandIndex: number;
  playerCards: number[];
  splitCards: number[];
  canHit: boolean;
  canStand: boolean;
  canDouble: boolean;
};

function derive(state: State) {
  const currentActionHandIndex = state.hasSplit ? state.currentHandIndex : 0;
  const currentActionCards =
    state.hasSplit && currentActionHandIndex === 1 ? state.splitCards : state.playerCards;
  const currentHandHasTwoCards = currentActionCards.length === 2;
  return {
    label: state.hasSplit ? `Playing Hand ${currentActionHandIndex + 1}` : "Your Turn",
    canDoubleUi: state.canDouble && currentHandHasTwoCards,
    canHitUi: state.canHit && currentActionCards.length > 0,
  };
}

// ---------------------------------------------------------------------------
// The optimistic post-action reducers, transcribed from the fixed dialog.
// ---------------------------------------------------------------------------
function applyHitOrDouble(
  prev: State,
  result: { actionTaken: BlackjackAction; handIndex?: number; newCard: number; busted?: boolean },
): State {
  const targetHandIndex = result.handIndex ?? prev.currentHandIndex;
  const newPlayerCards = [...prev.playerCards];
  const newSplitCards = [...prev.splitCards];
  if (targetHandIndex === 1 && prev.hasSplit) newSplitCards.push(result.newCard);
  else newPlayerCards.push(result.newCard);

  const handFinished =
    result.actionTaken === BlackjackAction.DOUBLE ||
    (result.actionTaken === BlackjackAction.HIT && result.busted === true);
  const movesToSecondHand = prev.hasSplit && targetHandIndex === 0 && handFinished;

  return {
    ...prev,
    playerCards: newPlayerCards,
    splitCards: newSplitCards,
    currentHandIndex: movesToSecondHand ? 1 : prev.currentHandIndex,
    canHit: movesToSecondHand ? true : prev.canHit,
    canStand: movesToSecondHand ? true : prev.canStand,
    canDouble: movesToSecondHand ? newSplitCards.length === 2 : false,
  };
}

function applyStand(prev: State, result: { handIndex?: number }): State {
  const actedHandIndex = result.handIndex ?? prev.currentHandIndex;
  if (!prev.hasSplit || actedHandIndex !== 0) return prev;
  return {
    ...prev,
    currentHandIndex: 1,
    canHit: true,
    canStand: true,
    canDouble: prev.splitCards.length === 2,
  };
}

/** The pre-fix reducer, for contrast. */
function applyHitOrDoubleLegacy(
  prev: State,
  result: { actionTaken: BlackjackAction; handIndex?: number; newCard: number },
): State {
  const targetHandIndex = result.handIndex ?? prev.currentHandIndex;
  const newPlayerCards = [...prev.playerCards];
  const newSplitCards = [...prev.splitCards];
  if (targetHandIndex === 1 && prev.hasSplit) newSplitCards.push(result.newCard);
  else newPlayerCards.push(result.newCard);
  return { ...prev, playerCards: newPlayerCards, splitCards: newSplitCards, canDouble: false };
}

// Just split: two hands of two cards, acting on hand 1.
const afterSplit: State = {
  hasSplit: true,
  currentHandIndex: 0,
  playerCards: [8, 21],
  splitCards: [34, 5],
  canHit: true,
  canStand: true,
  canDouble: true,
};

// --- 1. the reported bug, on the old reducer --------------------------------
const legacy = applyHitOrDoubleLegacy(afterSplit, {
  actionTaken: BlackjackAction.DOUBLE,
  handIndex: 0,
  newCard: 12,
});
const legacyUi = derive(legacy);
assert.equal(legacyUi.label, "Playing Hand 1", "pre-fix: label stays on hand 1");
assert.equal(legacyUi.canDoubleUi, false, "pre-fix: no Double offered for hand 2");
console.log(`reproduced: after doubling hand 1 the old reducer still shows "${legacyUi.label}" with canDouble=${legacyUi.canDoubleUi}`);

// --- 2. fixed: double on hand 1 hands the turn to hand 2 ---------------------
const doubled = applyHitOrDouble(afterSplit, {
  actionTaken: BlackjackAction.DOUBLE,
  handIndex: 0,
  newCard: 12,
});
const doubledUi = derive(doubled);
assert.equal(doubled.currentHandIndex, 1, "double on hand 1 must advance to hand 2");
assert.equal(doubledUi.label, "Playing Hand 2", "label must follow the active hand");
assert.equal(doubledUi.canDoubleUi, true, "hand 2 has two cards, so Double must be offered");
assert.equal(doubledUi.canHitUi, true, "hand 2 must still be playable");
assert.deepStrictEqual(doubled.playerCards, [8, 21, 12], "the double card lands on hand 1");
assert.deepStrictEqual(doubled.splitCards, [34, 5], "hand 2 cards untouched");

// --- 3. fixed: a bust on hand 1 also advances -------------------------------
const busted = applyHitOrDouble(afterSplit, {
  actionTaken: BlackjackAction.HIT,
  handIndex: 0,
  newCard: 12,
  busted: true,
});
assert.equal(busted.currentHandIndex, 1, "busting hand 1 must advance to hand 2");
assert.equal(derive(busted).label, "Playing Hand 2");

// --- 4. a non-busting hit must NOT advance ----------------------------------
const hitOn = applyHitOrDouble(afterSplit, {
  actionTaken: BlackjackAction.HIT,
  handIndex: 0,
  newCard: 3,
  busted: false,
});
assert.equal(hitOn.currentHandIndex, 0, "a surviving hit keeps the turn on hand 1");
assert.equal(derive(hitOn).label, "Playing Hand 1");
assert.equal(derive(hitOn).canDoubleUi, false, "three cards cannot double");

// --- 5. stand on hand 1 advances --------------------------------------------
const stood = applyStand(afterSplit, { handIndex: 0 });
assert.equal(stood.currentHandIndex, 1, "standing hand 1 must advance to hand 2");
assert.equal(derive(stood).canDoubleUi, true, "hand 2 can still double after stand");

// --- 6. acting on hand 2 must never advance past it -------------------------
const onHand2: State = { ...afterSplit, currentHandIndex: 1 };
assert.equal(
  applyHitOrDouble(onHand2, { actionTaken: BlackjackAction.DOUBLE, handIndex: 1, newCard: 9 }).currentHandIndex,
  1,
  "doubling hand 2 must not invent a hand 3",
);
assert.equal(applyStand(onHand2, { handIndex: 1 }).currentHandIndex, 1, "standing hand 2 must not advance");

// --- 7. an unsplit game is unaffected ---------------------------------------
const noSplit: State = { ...afterSplit, hasSplit: false, splitCards: [] };
const noSplitDoubled = applyHitOrDouble(noSplit, {
  actionTaken: BlackjackAction.DOUBLE,
  handIndex: 0,
  newCard: 12,
});
assert.equal(noSplitDoubled.currentHandIndex, 0, "no split: index stays 0");
assert.equal(derive(noSplitDoubled).label, "Your Turn");

console.log("split turn advance: OK (double / bust / stand advance; hit, hand 2 and unsplit games unaffected)");

// --- 8. the NONE placeholder that made a winning Hand 2 look neutral --------
type HandEvent = { result: BlackjackResult; playerFinalValue: number; dealerFinalValue: number; payoutWei: bigint };

function normalizeSplitHandEvents(events: HandEvent[], totalPayoutWei?: bigint): HandEvent[] {
  const decidedEvents = events.filter((entry) => entry.result !== BlackjackResult.NONE);
  const pool = decidedEvents.length >= 2 ? decidedEvents : events;
  if (pool.length <= 2) return pool;
  if (typeof totalPayoutWei === "bigint") {
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        if (pool[i].payoutWei + pool[j].payoutWei === totalPayoutWei) return [pool[i], pool[j]];
      }
    }
  }
  return [pool[0], pool[pool.length - 1]];
}

const ev = (result: BlackjackResult, payoutWei: bigint): HandEvent => ({
  result,
  playerFinalValue: 19,
  dealerFinalValue: 24,
  payoutWei,
});

// Both hands 19 against a busted dealer, plus the game-level NONE placeholder —
// the exact shape behind the reported screenshot.
const withPlaceholder = [
  ev(BlackjackResult.PLAYER_WIN, BigInt(400)),
  ev(BlackjackResult.NONE, BigInt(0)),
  ev(BlackjackResult.PLAYER_WIN, BigInt(400)),
];
const picked = normalizeSplitHandEvents(withPlaceholder, BigInt(800));
assert.equal(picked.length, 2, "exactly two hands");
for (const [i, entry] of picked.entries()) {
  assert.notEqual(entry.result, BlackjackResult.NONE, `hand ${i + 1} must not resolve to NONE`);
  assert.equal(getResultText(entry.result), "WIN!", `hand ${i + 1} must read as a win`);
}

// A genuine two-hand result is passed through untouched.
const plain = [ev(BlackjackResult.PLAYER_WIN, BigInt(400)), ev(BlackjackResult.DEALER_WIN, BigInt(0))];
assert.deepStrictEqual(normalizeSplitHandEvents(plain, BigInt(400)), plain, "decided pairs pass through");

// If filtering would leave too few, fall back rather than dropping a hand.
const mostlyNone = [ev(BlackjackResult.PLAYER_WIN, BigInt(400)), ev(BlackjackResult.NONE, BigInt(0))];
assert.equal(normalizeSplitHandEvents(mostlyNone, BigInt(400)).length, 2, "must not drop below two hands");

console.log('split result labels: OK (NONE placeholder no longer lands on a hand as a neutral "Result")');
