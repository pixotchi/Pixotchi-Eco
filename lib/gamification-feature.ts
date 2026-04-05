import {
  buildGamificationPolicy,
  GAMIFICATION_DISABLED_FALLBACK_MESSAGE,
} from './gamification-policy';

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

export function isGamificationMiniAppOnly(): boolean {
  // Deprecated: mini-app-only gating is no longer supported for gamification.
  return false;
}

export function getGamificationDisabledMessage(): string {
  const message = process.env.NEXT_PUBLIC_GAMIFICATION_DISABLED_MESSAGE?.trim();
  if (message) return message;
  return GAMIFICATION_DISABLED_FALLBACK_MESSAGE;
}

export function getGamificationPolicy() {
  return buildGamificationPolicy({
    disabled: isGamificationDisabled(),
    disabledMessage: getGamificationDisabledMessage(),
  });
}
