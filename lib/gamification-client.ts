import { CLIENT_ENV } from '@/lib/env-config';
import { buildGamificationPolicy } from '@/lib/gamification-policy';

export function getClientGamificationPolicy(input?: { isMiniApp?: boolean }) {
  return buildGamificationPolicy({
    disabled: CLIENT_ENV.GAMIFICATION_DISABLED,
    miniAppOnly: CLIENT_ENV.GAMIFICATION_MINIAPP_ONLY,
    isMiniApp: input?.isMiniApp,
    disabledMessage: CLIENT_ENV.GAMIFICATION_DISABLED_MESSAGE,
  });
}
