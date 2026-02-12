function isTruthyFlag(value: string | undefined | null): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

export function isGamificationDisabled(): boolean {
  return (
    isTruthyFlag(process.env.GAMIFICATION_DISABLED) ||
    isTruthyFlag(process.env.NEXT_PUBLIC_GAMIFICATION_DISABLED)
  );
}

export function getGamificationDisabledMessage(): string {
  const message = process.env.NEXT_PUBLIC_GAMIFICATION_DISABLED_MESSAGE?.trim();
  if (message) return message;
  return 'Tasks and Rocks leaderboard are temporarily disabled while we reset progress for the next mission season.';
}
