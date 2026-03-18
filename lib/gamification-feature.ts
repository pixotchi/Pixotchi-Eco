import {
  buildGamificationPolicy,
  GAMIFICATION_DISABLED_FALLBACK_MESSAGE,
  isMiniAppGamificationContext,
} from './gamification-policy';

export { isMiniAppGamificationContext } from './gamification-policy';

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
  return (
    isTruthyFlag(process.env.GAMIFICATION_MINIAPP_ONLY) ||
    isTruthyFlag(process.env.NEXT_PUBLIC_GAMIFICATION_MINIAPP_ONLY)
  );
}

export function getGamificationDisabledMessage(): string {
  const message = process.env.NEXT_PUBLIC_GAMIFICATION_DISABLED_MESSAGE?.trim();
  if (message) return message;
  return GAMIFICATION_DISABLED_FALLBACK_MESSAGE;
}

export function getGamificationPolicy(input?: { isMiniApp?: boolean }) {
  return buildGamificationPolicy({
    disabled: isGamificationDisabled(),
    miniAppOnly: isGamificationMiniAppOnly(),
    isMiniApp: input?.isMiniApp,
    disabledMessage: getGamificationDisabledMessage(),
  });
}
