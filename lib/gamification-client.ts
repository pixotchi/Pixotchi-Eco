import { CLIENT_ENV } from '@/lib/env-config';
import { buildGamificationPolicy } from '@/lib/gamification-policy';

export function getClientGamificationPolicy() {
  return buildGamificationPolicy({
    disabled: CLIENT_ENV.GAMIFICATION_DISABLED,
    disabledMessage: CLIENT_ENV.GAMIFICATION_DISABLED_MESSAGE,
  });
}
