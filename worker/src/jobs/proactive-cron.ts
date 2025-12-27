import { Env } from '../types';
import { formatDateInZone, DEFAULT_TIMEZONE } from '../utils/date';
import { createDailySchedules } from '../services/proactive-scheduler';

export async function runProactiveCron(env: Env, targetDate?: string) {
  const date = targetDate || formatDateInZone(Date.now(), DEFAULT_TIMEZONE);
  
  try {
    // 获取所有有对话记录的用户
    const result = await env.ATRI_DB.prepare(
      `SELECT DISTINCT user_id as userId, MAX(time_zone) as timeZone
       FROM conversation_logs
       WHERE date >= date('now', '-7 days')
       GROUP BY user_id`
    ).all<{ userId: string; timeZone?: string }>();
    
    const users = result.results || [];
    
    for (const user of users) {
      try {
        const timeZone = user.timeZone || DEFAULT_TIMEZONE;
        await createDailySchedules(env, user.userId, date, timeZone);
        console.log('[ATRI] Proactive schedule created', { userId: user.userId, date });
      } catch (error) {
        console.error('[ATRI] Proactive schedule failed for user', user.userId, error);
      }
    }
    
    console.log('[ATRI] Proactive cron completed', { date, userCount: users.length });
  } catch (error) {
    console.error('[ATRI] Proactive cron failed', error);
  }
}