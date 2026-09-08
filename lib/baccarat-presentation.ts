import { BaccaratBetType } from '../public/abi/baccarat-abi';
import { baccaratCalculatePayoutWei } from './baccarat-rules.mjs';

export type BaccaratPayoutRules = { bankerCommissionBps: number; tiePayoutMultiplier: number };
export function validBaccaratPayoutRules(value: BaccaratPayoutRules): boolean {
  return Number.isInteger(value.bankerCommissionBps) && value.bankerCommissionBps >= 0 && value.bankerCommissionBps <= 10000
    && Number.isInteger(value.tiePayoutMultiplier) && value.tiePayoutMultiplier >= 1 && value.tiePayoutMultiplier <= 20;
}
export function baccaratPotentialReturn(betType: BaccaratBetType, wager: bigint, rules: BaccaratPayoutRules): bigint {
  if (!validBaccaratPayoutRules(rules)) throw new Error('Baccarat payout rules are unavailable');
  return baccaratCalculatePayoutWei(betType, betType, wager, rules.bankerCommissionBps, rules.tiePayoutMultiplier).payoutWei;
}
export function baccaratReturnLabel(betType: BaccaratBetType, rules: BaccaratPayoutRules): string {
  const factor = betType === BaccaratBetType.BANKER ? (20000 - rules.bankerCommissionBps) / 10000
    : betType === BaccaratBetType.TIE ? 1 + rules.tiePayoutMultiplier : 2;
  return `${factor}× total return`;
}
export function baccaratWorstCaseReturn(rules: BaccaratPayoutRules): bigint {
  return BigInt(Math.max(2, 1 + rules.tiePayoutMultiplier));
}
