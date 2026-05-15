import { Env } from '../types';
import { listPendingDiaryUsers, saveDiaryEntry } from '../services/data-service';
import { DEFAULT_TIMEZONE, formatDateInZone } from '../utils/date';
import { runFullNightlyForDate } from '../services/nightly-orchestrator';

export async function runDiaryCron(env: Env, targetDate?: string) {
  const date = targetDate || formatDateInZone(Date.now(), DEFAULT_TIMEZONE);
  const pendingUsers = await listPendingDiaryUsers(env, date);
  if (!pendingUsers.length) {
    console.log('[ATRI] No diary tasks for', date);
    return;
  }

  for (const user of pendingUsers) {
    try {
      await runFullNightlyForDate(env, {
        userId: user.userId,
        userName: user.userName || '这个人',
        date,
        modelKey: null,
        forceRegenerate: false
      });
      console.log('[ATRI] Diary auto generated for', user.userId, date);
    } catch (error) {
      console.error('[ATRI] Diary cron failed for user', user.userId, error);
      await saveDiaryEntry(env, {
        userId: user.userId,
        date,
        content: '自动日记生成失败，请稍后重试。',
        summary: '自动生成失败',
        mood: '异常',
        status: 'error'
      });
    }
  }
}
