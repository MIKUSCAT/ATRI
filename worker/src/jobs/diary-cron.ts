import { Env } from '../types';
import {
  buildConversationTranscript,
  fetchConversationLogs,
  listPendingDiaryUsers,
  saveDiaryEntry,
  getLastConversationDate,
  calculateDaysBetween,
  getFirstConversationTimestamp,
  getUserModelPreference,
  getUserProfile,
  saveUserProfile,
  getAtriSelfReview,
  saveAtriSelfReview
} from '../services/data-service';
import { DEFAULT_TIMEZONE, formatDateInZone } from '../utils/date';
import { generateDiaryFromConversation } from '../services/diary-generator';
import { upsertDiaryMemory } from '../services/memory-service';
import { generateUserProfile } from '../services/profile-generator';
import { generateAtriSelfReview } from '../services/self-review-generator';

export async function runDiaryCron(env: Env, targetDate?: string) {
  const date = targetDate || formatDateInZone(Date.now(), DEFAULT_TIMEZONE);
  const pendingUsers = await listPendingDiaryUsers(env, date);
  if (!pendingUsers.length) {
    console.log('[ATRI] No diary tasks for', date);
    return;
  }

  for (const user of pendingUsers) {
    try {
      const logs = await fetchConversationLogs(env, user.userId, date);
      if (!logs.length) continue;
      const transcript = buildConversationTranscript(logs, user.userName || '你');

      const lastDate = await getLastConversationDate(env, user.userId, date);
      const daysSince = lastDate ? calculateDaysBetween(lastDate, date) : null;
      const firstConversationAt = await getFirstConversationTimestamp(env, user.userId);
      const firstDate = firstConversationAt
        ? formatDateInZone(firstConversationAt, user.timeZone || DEFAULT_TIMEZONE)
        : null;
      const daysTogether = firstDate ? Math.max(1, calculateDaysBetween(firstDate, date) + 1) : 1;

      let preferredModel: string | null = null;
      try {
        preferredModel = await getUserModelPreference(env, user.userId);
      } catch (err) {
        console.warn('[ATRI] load user model preference failed', { userId: user.userId, err });
      }

      const diary = await generateDiaryFromConversation(env, {
        conversation: transcript,
        userName: user.userName || '这个人',
        daysSinceLastChat: daysSince,
        modelKey: preferredModel
      });
      const summaryText = diary.highlights.length
        ? diary.highlights.join('；')
        : diary.content;
      const savedEntry = await saveDiaryEntry(env, {
        userId: user.userId,
        date,
        content: diary.content,
        summary: summaryText,
        mood: diary.mood,
        status: 'ready'
      });

      await upsertDiaryMemory(env, {
        entryId: savedEntry.id,
        userId: user.userId,
        date,
        mood: diary.mood,
        content: diary.content,
        timestamp: diary.timestamp
      });

      // 生成并保存用户长期档案（事实/喜好/雷区/说话风格/关系进展）
      try {
        const previousProfile = await getUserProfile(env, user.userId);
        const profile = await generateUserProfile(env, {
          transcript,
          diaryContent: diary.content,
          date,
          userName: user.userName || '这个人',
          previousProfile: previousProfile?.content || '',
          modelKey: preferredModel
        });
        await saveUserProfile(env, { userId: user.userId, content: profile.raw });
      } catch (err) {
        console.warn('[ATRI] User profile update skipped', { userId: user.userId, date, err });
      }

      // 生成并保存 ATRI 自我审查表（只给 ATRI 自己看，用于下一次对话的“隐藏提醒”）
      try {
        const previousSelfReview = await getAtriSelfReview(env, user.userId);
        const selfReview = await generateAtriSelfReview(env, {
          transcript,
          diaryContent: diary.content,
          date,
          daysTogether,
          userName: user.userName || '这个人',
          previousSelfReview: previousSelfReview?.content || '',
          modelKey: preferredModel
        });
        await saveAtriSelfReview(env, { userId: user.userId, content: selfReview.raw });
      } catch (err) {
        console.warn('[ATRI] Self review update skipped', { userId: user.userId, date, err });
      }

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
