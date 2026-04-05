import { buildCasinoPolicy } from "./casino-policy";

function isTruthyFlag(value: string | undefined | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function isFalsyFlag(value: string | undefined | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off";
}

export function isCasinoEnabled(): boolean {
  return (
    isTruthyFlag(process.env.CASINO_ENABLED) ||
    isTruthyFlag(process.env.NEXT_PUBLIC_CASINO_ENABLED)
  );
}

export function isCasinoMiniAppOnly(): boolean {
  // Deprecated: mini-app-only gating is no longer supported for casino features.
  return false;
}

export function isBlackjackEnabled(): boolean {
  if (process.env.BLACKJACK_ENABLED != null) {
    return !isFalsyFlag(process.env.BLACKJACK_ENABLED);
  }
  if (process.env.NEXT_PUBLIC_BLACKJACK_ENABLED != null) {
    return !isFalsyFlag(process.env.NEXT_PUBLIC_BLACKJACK_ENABLED);
  }
  return true;
}

export function getCasinoPolicy() {
  return buildCasinoPolicy({
    casinoEnabled: isCasinoEnabled(),
    blackjackEnabled: isBlackjackEnabled(),
  });
}
