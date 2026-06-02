export const ROULETTE_BET_TYPE = {
  STRAIGHT: 0,
  SPLIT: 1,
  STREET: 2,
  CORNER: 3,
  SIX_LINE: 4,
  DOZEN: 5,
  COLUMN: 6,
  RED: 7,
  BLACK: 8,
  ODD: 9,
  EVEN: 10,
  LOW: 11,
  HIGH: 12,
};

const RED_NUMBERS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const NUMBER_BET_TYPES = new Set([
  ROULETTE_BET_TYPE.STRAIGHT,
  ROULETTE_BET_TYPE.SPLIT,
  ROULETTE_BET_TYPE.STREET,
  ROULETTE_BET_TYPE.CORNER,
  ROULETTE_BET_TYPE.SIX_LINE,
]);

export function rouletteBetWins(betType, numbers, winningNumber) {
  if (winningNumber === 0) {
    return betType === ROULETTE_BET_TYPE.STRAIGHT && numbers.length > 0 && numbers[0] === 0;
  }

  if (NUMBER_BET_TYPES.has(betType)) {
    return numbers.includes(winningNumber);
  }

  if (betType === ROULETTE_BET_TYPE.DOZEN) {
    const dozen = numbers[0];
    if (dozen === 1) return winningNumber >= 1 && winningNumber <= 12;
    if (dozen === 2) return winningNumber >= 13 && winningNumber <= 24;
    if (dozen === 3) return winningNumber >= 25 && winningNumber <= 36;
    return false;
  }

  if (betType === ROULETTE_BET_TYPE.COLUMN) {
    const column = numbers[0];
    return winningNumber % 3 === column % 3;
  }

  if (betType === ROULETTE_BET_TYPE.RED) return RED_NUMBERS.has(winningNumber);
  if (betType === ROULETTE_BET_TYPE.BLACK) return !RED_NUMBERS.has(winningNumber);
  if (betType === ROULETTE_BET_TYPE.ODD) return winningNumber % 2 === 1;
  if (betType === ROULETTE_BET_TYPE.EVEN) return winningNumber % 2 === 0;
  if (betType === ROULETTE_BET_TYPE.LOW) return winningNumber >= 1 && winningNumber <= 18;
  if (betType === ROULETTE_BET_TYPE.HIGH) return winningNumber >= 19 && winningNumber <= 36;
  return false;
}

export function rouletteHasUnsupportedZeroCombo(betType, numbers) {
  return betType !== ROULETTE_BET_TYPE.STRAIGHT && numbers.includes(0);
}

export function rouletteCanReveal(activeBet, liveBlock) {
  if (!activeBet?.isActive) return false;
  if (activeBet.canReveal || activeBet.isExpired) return true;
  if (typeof liveBlock !== 'bigint') return false;
  const revealBlock = activeBet.revealBlock ?? BigInt(0);
  return revealBlock > BigInt(0) && liveBlock > revealBlock;
}

export function rouletteRevealBlocksRemaining(activeBet, liveBlock) {
  if (!activeBet?.isActive || rouletteCanReveal(activeBet, liveBlock) || typeof liveBlock !== 'bigint') {
    return 0;
  }

  const revealBlock = activeBet.revealBlock ?? BigInt(0);
  if (revealBlock <= BigInt(0)) return 0;
  const revealableAt = revealBlock + BigInt(1);
  if (liveBlock >= revealableAt) return 0;
  return Number(revealableAt - liveBlock);
}
