import { isMiniAppRequestContext } from "./miniapp-request-context";

export const GAMIFICATION_DISABLED_FALLBACK_MESSAGE =
  'Tasks and Rocks leaderboard are temporarily disabled while we reset progress for the next mission season.';

export const GAMIFICATION_MINIAPP_ONLY_MESSAGE =
  'Tasks, streaks, and Rocks are available only inside Pixotchi Mini App.';

export function isMiniAppGamificationContext(input?: {
  miniAppCookie?: string | null;
  miniAppHeader?: string | null;
  sessionMethod?: string | null;
}): boolean {
  return isMiniAppRequestContext(input);
}

export function buildGamificationPolicy(input: {
  disabled: boolean;
  miniAppOnly: boolean;
  isMiniApp?: boolean;
  disabledMessage?: string | null;
}) {
  const isMiniApp = Boolean(input.isMiniApp);
  const visible = !input.miniAppOnly || isMiniApp;
  const enabled = !input.disabled && visible;

  let reason: 'disabled' | 'miniapp_only' | null = null;
  let message: string | null = null;

  if (input.disabled) {
    reason = 'disabled';
    message = input.disabledMessage?.trim() || GAMIFICATION_DISABLED_FALLBACK_MESSAGE;
  } else if (!visible) {
    reason = 'miniapp_only';
    message = GAMIFICATION_MINIAPP_ONLY_MESSAGE;
  }

  return {
    disabled: input.disabled,
    miniAppOnly: input.miniAppOnly,
    isMiniApp,
    visible,
    enabled,
    reason,
    message,
  };
}
