import { Env } from '../types';
import { listProactiveCandidateUsers } from '../services/data-service';
import { evaluateProactiveForUser } from '../services/proactive-service';
import { getEffectiveRuntimeSettings } from '../services/runtime-settings';

export async function runProactiveCron(env: Env) {
  const settings = await getEffectiveRuntimeSettings(env);
  if (!settings.proactiveEnabled) {
    return;
  }

  const users = await listProactiveCandidateUsers(env, { lookbackHours: 24 * 30, limit: 500 });
  if (!users.length) {
    console.log('[ATRI] proactive cron no users');
    return;
  }

  for (const user of users) {
    try {
      const result = await evaluateProactiveForUser(env, {
        userId: user.userId,
        userName: user.userName,
        timeZone: user.timeZone || settings.proactiveTimeZone,
        now: Date.now(),
        settings
      });
      if (result.triggered) {
        console.log('[ATRI] proactive sent', { userId: user.userId, messageId: result.messageId });
      }
    } catch (error: any) {
      console.warn('[ATRI] proactive user failed', {
        userId: user.userId,
        error: String(error?.message || error)
      });
    }
  }
}
