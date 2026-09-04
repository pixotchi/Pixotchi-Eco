import { buildCasinoPolicy } from "./casino-policy";

function isTruthyFlag(value: string | undefined | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
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
    return isTruthyFlag(process.env.BLACKJACK_ENABLED);
  }
  if (process.env.NEXT_PUBLIC_BLACKJACK_ENABLED != null) {
    return isTruthyFlag(process.env.NEXT_PUBLIC_BLACKJACK_ENABLED);
  }
  return false;
}

/**
 * The deployed Blackjack contract verifies a legacy signature that does not
 * bind every economic input. This explicit, server-only acknowledgement keeps
 * the signer disabled by default until the contract verifier can be upgraded.
 */
export function isLegacyBlackjackContractAcknowledged(): boolean {
  return isTruthyFlag(process.env.BLACKJACK_UNSAFE_LEGACY_SIGNATURES_ACKNOWLEDGED);
}

export function getCasinoPolicy() {
  return buildCasinoPolicy({
    casinoEnabled: isCasinoEnabled(),
    blackjackEnabled: isBlackjackEnabled(),
  });
}
