export const GAMIFICATION_DISABLED_FALLBACK_MESSAGE =
  'Tasks and Rocks leaderboard are temporarily disabled while we reset progress for the next mission season.';

export function buildGamificationPolicy(input: {
  disabled: boolean;
  disabledMessage?: string | null;
}) {
  const visible = true;
  const enabled = !input.disabled;

  let reason: 'disabled' | null = null;
  let message: string | null = null;

  if (input.disabled) {
    reason = 'disabled';
    message = input.disabledMessage?.trim() || GAMIFICATION_DISABLED_FALLBACK_MESSAGE;
  }

  return {
    disabled: input.disabled,
    miniAppOnly: false,
    isMiniApp: false,
    visible,
    enabled,
    reason,
    message,
  };
}
