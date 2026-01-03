import type { Router } from 'itty-router';
import { Env } from '../types';
import { jsonResponse } from '../utils/json-response';
import {
  buildConversationTranscript,
  calculateDaysBetween,
  fetchConversationLogs,
  getAtriSelfReview,
  getDiaryEntry,
  getFirstConversationTimestamp,
  getLastConversationDate,
  getUserModelPreference,
  getUserProfile,
  listDiaryEntries,
  saveAtriSelfReview,
  saveDiaryEntry,
  saveUserProfile
} from '../services/data-service';
import { requireAppToken } from '../utils/auth';
import { generateDiaryFromConversation } from '../services/diary-generator';
import { upsertDiaryHighlightsMemory } from '../services/memory-service';
import { generateUserProfile } from '../services/profile-generator';
import { generateAtriSelfReview } from '../services/self-review-generator';
import { DEFAULT_TIMEZONE, formatDateInZone } from '../utils/date';

export function registerDiaryRoutes(router: any) {
  router.get('/diary', async (request: any, env: Env) => {
    const auth = requireAppToken(request, env);
    if (auth) return auth;

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || '';
    const date = searchParams.get('date') || '';
    if (!userId || !date) {
      return jsonResponse({ error: 'missing_params' }, 400);
    }

    const entry = await getDiaryEntry(env, userId, date);
    if (!entry) {
      return jsonResponse({ status: 'missing' });
    }
    return jsonResponse({ status: entry.status, entry });
  });

  router.get('/diary/list', async (request: any, env: Env) => {
    const auth = requireAppToken(request, env);
    if (auth) return auth;

    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || '';
    const limit = Number(searchParams.get('limit') || '7');
    if (!userId) {
      return jsonResponse({ error: 'missing_params' }, 400);
    }
    const entries = await listDiaryEntries(env, userId, Math.min(Math.max(limit, 1), 30));
    return jsonResponse({ entries });
  });

  router.post('/diary/regenerate', async (request: any, env: Env) => {
    const auth = requireAppToken(request, env);
    if (auth) return auth;

    let body: any;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'invalid_json' }, 400);
    }

    const userId = String(body?.userId || '').trim();
    const date = String(body?.date || '').trim();
    if (!userId || !date) {
      return jsonResponse({ error: 'missing_params' }, 400);
    }

    try {
      const logs = await fetchConversationLogs(env, userId, date);
      if (!logs.length) {
        return jsonResponse({ error: 'no_conversation_logs' }, 404);
      }

      const detectedUserName = logs.find(l => l.role === 'user' && l.userName)?.userName
        || logs.find(l => l.userName)?.userName
        || '';
      const transcript = buildConversationTranscript(logs, detectedUserName || '你');

      const lastDate = await getLastConversationDate(env, userId, date);
      const daysSince = lastDate ? calculateDaysBetween(lastDate, date) : null;

      let preferredModel: string | null = null;
      try {
        preferredModel = await getUserModelPreference(env, userId);
      } catch (err) {
        console.warn('[ATRI] load user model preference failed', { userId, err });
      }

      const diary = await generateDiaryFromConversation(env, {
        conversation: transcript,
        userName: detectedUserName || '这个人',
        date,
        daysSinceLastChat: daysSince,
        modelKey: preferredModel
      });

      const summaryText = diary.highlights.length
        ? diary.highlights.join('；')
        : diary.content;

      const savedEntry = await saveDiaryEntry(env, {
        userId,
        date,
        content: diary.content,
        summary: summaryText,
        mood: diary.mood,
        status: 'ready'
      });

      await upsertDiaryHighlightsMemory(env, {
        userId,
        date,
        mood: diary.mood,
        highlights: Array.isArray(diary.highlights) && diary.highlights.length
          ? diary.highlights
          : summaryText
            ? summaryText.split('；').map(s => s.trim()).filter(Boolean).slice(0, 10)
            : [diary.content],
        timestamp: diary.timestamp
      });

      // ✅ 强制刷新：用户长期档案（user_profiles）
      try {
        const previousProfile = await getUserProfile(env, userId);
        const profile = await generateUserProfile(env, {
          transcript,
          diaryContent: '',
          date,
          userName: detectedUserName || '这个人',
          previousProfile: previousProfile?.content || '',
          modelKey: preferredModel
        });
        await saveUserProfile(env, { userId, content: profile.raw });
      } catch (err) {
        console.warn('[ATRI] User profile update skipped (regenerate)', { userId, date, err });
      }

      // ✅ 强制刷新：ATRI 自我审查表（atri_self_reviews）
      try {
        const timeZone =
          logs.find(l => l.role === 'user' && l.timeZone)?.timeZone
          || logs.find(l => l.timeZone)?.timeZone
          || DEFAULT_TIMEZONE;

        const firstConversationAt = await getFirstConversationTimestamp(env, userId);
        const firstDate = firstConversationAt ? formatDateInZone(firstConversationAt, timeZone) : null;
        const daysTogether = firstDate ? Math.max(1, calculateDaysBetween(firstDate, date) + 1) : 1;

        const previousSelfReview = await getAtriSelfReview(env, userId);
        const selfReview = await generateAtriSelfReview(env, {
          transcript,
          diaryContent: '',
          date,
          daysTogether,
          userName: detectedUserName || '这个人',
          previousSelfReview: previousSelfReview?.content || '',
          modelKey: preferredModel
        });
        await saveAtriSelfReview(env, { userId, content: selfReview.raw });
      } catch (err) {
        console.warn('[ATRI] Self review update skipped (regenerate)', { userId, date, err });
      }

      const entry = await getDiaryEntry(env, userId, date);
      if (!entry) {
        return jsonResponse({ error: 'save_failed' }, 500);
      }

      return jsonResponse({ status: entry.status, entry });
    } catch (error: any) {
      console.error('[ATRI] Diary regenerate failed', { userId, date, error });
      return jsonResponse({ status: 'error', error: String(error?.message || error) }, 500);
    }
  });
}
