export const CASINO_DISABLED_MESSAGE = "Casino is currently unavailable.";
export const BLACKJACK_DISABLED_MESSAGE = "Blackjack is currently unavailable.";

export function buildCasinoPolicy(input: {
  casinoEnabled: boolean;
  blackjackEnabled: boolean;
}) {
  const visible = input.casinoEnabled;
  const playable = visible;

  let reason: "disabled" | null = null;
  let message: string | null = null;

  if (!visible) {
    reason = "disabled";
    message = CASINO_DISABLED_MESSAGE;
  }

  return {
    casinoEnabled: input.casinoEnabled,
    blackjackEnabled: input.blackjackEnabled,
    miniAppOnly: false,
    isMiniApp: false,
    visible,
    playable,
    reason,
    message,
  };
}
