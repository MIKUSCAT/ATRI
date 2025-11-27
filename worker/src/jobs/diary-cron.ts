import { Env } from '../types';
import {
  buildConversationTranscript,
  fetchConversationLogs,
  listPendingDiaryUsers,
  saveDiaryEntry,
  getLastConversationDate,
  calculateDaysBetween,
  saveDailyLearning,
  saveUserMemories
} from '../services/data-service';
import { DEFAULT_TIMEZONE, formatDateInZone } from '../utils/date';
import { generateDiaryFromConversation } from '../services/diary-generator';
import { upsertDiaryMemory, upsertStructuredMemories } from '../services/memory-service';
import { generateDailyLearning } from '../services/daily-learning';
import { extractMemoriesFromText, toUserMemoryInputs } from '../services/memory-extractor';

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

      const diary = await generateDiaryFromConversation(env, {
        conversation: transcript,
        userName: user.userName || '这个人',
        daysSinceLastChat: daysSince
      });
      const summaryText = diary.highlights.length
        ? diary.highlights.join('；')
        : (diary.content.split('\n')[0].slice(0, 150) || diary.content.slice(0, 150));
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

      try {
        const extractionText = `【今日对话】\n${transcript}\n\n【今日日记】\n${diary.content}`;
        const extracted = await extractMemoriesFromText(env, { text: extractionText });
        if (extracted.memories.length > 0) {
          const memoryInputs = toUserMemoryInputs(user.userId, extracted.memories, date);
          await saveUserMemories(env, memoryInputs);
          await upsertStructuredMemories(env, user.userId, extracted.memories, date);
          console.log('[ATRI] Extracted memories for', user.userId, ':', extracted.memories.length);
        }
      } catch (err) {
        console.warn('[ATRI] Memory extraction skipped', { userId: user.userId, date, err });
      }

      try {
        const learning = await generateDailyLearning(env, {
          transcript,
          diaryContent: diary.content,
          date,
          userName: user.userName || '这个人'
        });
        await saveDailyLearning(env, {
          userId: user.userId,
          date,
          summary: learning.summary,
          payload: JSON.stringify(learning.payload || {})
        });
      } catch (err) {
        console.warn('[ATRI] Daily learning generation skipped', { userId: user.userId, date, err });
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
