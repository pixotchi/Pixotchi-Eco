export const CASINO_MINIAPP_ONLY_MESSAGE =
  "Casino games are available only inside Pixotchi Mini on Base app.";

export const CASINO_DISABLED_MESSAGE = "Casino is currently unavailable.";
export const BLACKJACK_DISABLED_MESSAGE = "Blackjack is currently unavailable.";

export function buildCasinoPolicy(input: {
  casinoEnabled: boolean;
  blackjackEnabled: boolean;
  miniAppOnly: boolean;
  isMiniApp?: boolean;
}) {
  const isMiniApp = Boolean(input.isMiniApp);
  const visible = input.casinoEnabled;
  const playable = visible && (!input.miniAppOnly || isMiniApp);

  let reason: "disabled" | "miniapp_only" | null = null;
  let message: string | null = null;

  if (!visible) {
    reason = "disabled";
    message = CASINO_DISABLED_MESSAGE;
  } else if (!playable) {
    reason = "miniapp_only";
    message = CASINO_MINIAPP_ONLY_MESSAGE;
  }

  return {
    casinoEnabled: input.casinoEnabled,
    blackjackEnabled: input.blackjackEnabled,
    miniAppOnly: input.miniAppOnly,
    isMiniApp,
    visible,
    playable,
    reason,
    message,
  };
}
