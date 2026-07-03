import { formatUnits } from "viem";
import { parseCasinoAmountInput } from "./casino-amount-input";

type CasinoGame = "roulette" | "blackjack" | "baccarat";

type BetPreferenceParams = {
  game: CasinoGame;
  token: string | null | undefined;
  minBet: bigint;
  maxBet: bigint;
  decimals: number;
  fallback: string;
};

const BET_PREFERENCE_PREFIX = "pixotchi:casino:bet";

const getBetPreferenceKey = (game: CasinoGame, token: string) =>
  `${BET_PREFERENCE_PREFIX}:${game}:${token.toLowerCase()}`;

export const loadBetPreference = ({
  game,
  token,
  minBet,
  maxBet,
  decimals,
  fallback,
}: BetPreferenceParams): string => {
  if (typeof window === "undefined" || !token) return fallback;

  try {
    const stored = localStorage.getItem(getBetPreferenceKey(game, token))?.trim();
    if (!stored) return fallback;

    const storedWei = parseCasinoAmountInput(stored, decimals);
    if (storedWei <= BigInt(0)) return fallback;
    if (storedWei < minBet) return fallback;
    if (storedWei > maxBet) return formatUnits(maxBet, decimals);

    return stored;
  } catch {
    return fallback;
  }
};

export const storeBetPreference = (
  game: CasinoGame,
  token: string | null | undefined,
  amount: string,
  decimals: number
): void => {
  if (typeof window === "undefined" || !token) return;

  try {
    const normalizedAmount = amount.trim();
    if (!normalizedAmount) return;

    const amountWei = parseCasinoAmountInput(normalizedAmount, decimals);
    if (amountWei <= BigInt(0)) return;

    localStorage.setItem(getBetPreferenceKey(game, token), normalizedAmount);
  } catch {
    // Ignore invalid/incomplete user input until it becomes parseable.
  }
};
