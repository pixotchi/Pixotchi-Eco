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
  return (
    isTruthyFlag(process.env.CASINO_MINIAPP_ONLY) ||
    isTruthyFlag(process.env.NEXT_PUBLIC_CASINO_MINIAPP_ONLY)
  );
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

export function getCasinoPolicy(input?: { isMiniApp?: boolean }) {
  return buildCasinoPolicy({
    casinoEnabled: isCasinoEnabled(),
    blackjackEnabled: isBlackjackEnabled(),
    miniAppOnly: isCasinoMiniAppOnly(),
    isMiniApp: input?.isMiniApp,
  });
}
