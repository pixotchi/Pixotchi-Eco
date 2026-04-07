import { CLIENT_ENV } from "@/lib/env-config";
import { buildCasinoPolicy } from "@/lib/casino-policy";

export function getClientCasinoPolicy() {
  return buildCasinoPolicy({
    casinoEnabled: CLIENT_ENV.CASINO_ENABLED,
    blackjackEnabled: CLIENT_ENV.BLACKJACK_ENABLED,
  });
}
