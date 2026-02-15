import type { FastifyInstance } from 'fastify';
import { Env } from '../runtime/types';
import { requireAppToken } from '../utils/auth';
import { sendJson } from '../utils/reply';
import {
  buildConversationTranscript,
  calculateDaysBetween,
  fetchConversationLogs,
  getDiaryEntry,
  getLastConversationDate,
  getUserProfile,
  listDiaryEntries,
  saveDiaryEntry,
  saveUserProfile
} from '../services/data-service';
import { generateDiaryFromConversation } from '../services/diary-generator';
import { upsertDiaryHighlightsMemory } from '../services/memory-service';
import { generateUserProfile } from '../services/profile-generator';

export function registerDiaryRoutes(app: FastifyInstance, env: Env) {
  app.get('/diary', async (request, reply) => {
    const auth = requireAppToken(request, env);
    if (auth) return sendJson(reply, auth.body, auth.status);

    const userId = String((request.query as any)?.userId || '').trim();
    const date = String((request.query as any)?.date || '').trim();
    if (!userId || !date) {
      return sendJson(reply, { error: 'missing_params' }, 400);
    }

    const entry = await getDiaryEntry(env, userId, date);
    if (!entry) {
      return sendJson(reply, { status: 'missing' });
    }
    return sendJson(reply, { status: entry.status, entry });
  });

  app.get('/diary/list', async (request, reply) => {
    const auth = requireAppToken(request, env);
    if (auth) return sendJson(reply, auth.body, auth.status);

    const userId = String((request.query as any)?.userId || '').trim();
    const limit = Number((request.query as any)?.limit || '7');
    if (!userId) {
      return sendJson(reply, { error: 'missing_params' }, 400);
    }
    const entries = await listDiaryEntries(env, userId, Math.min(Math.max(limit, 1), 30));
    return sendJson(reply, { entries });
  });

  app.post('/diary/regenerate', async (request, reply) => {
    const auth = requireAppToken(request, env);
    if (auth) return sendJson(reply, auth.body, auth.status);

    const body = request.body as any;
    const userId = String(body?.userId || '').trim();
    const date = String(body?.date || '').trim();
    if (!userId || !date) {
      return sendJson(reply, { error: 'missing_params' }, 400);
    }

    try {
      const logs = await fetchConversationLogs(env, userId, date);
      if (!logs.length) {
        return sendJson(reply, { error: 'no_conversation_logs' }, 404);
      }

      const detectedUserName =
        logs.find(l => l.role === 'user' && l.userName)?.userName
        || logs.find(l => l.userName)?.userName
        || '';
      const transcript = buildConversationTranscript(logs, detectedUserName || '你');

      const lastDate = await getLastConversationDate(env, userId, date);
      const daysSince = lastDate ? calculateDaysBetween(lastDate, date) : null;

      const diary = await generateDiaryFromConversation(env, {
        conversation: transcript,
        userId,
        userName: detectedUserName || '这个人',
        date,
        daysSinceLastChat: daysSince,
        modelKey: null
      });

      const summaryText = diary.highlights.length
        ? diary.highlights.join('；')
        : diary.content;

      await saveDiaryEntry(env, {
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

      try {
        const previousProfile = await getUserProfile(env, userId);
        const profile = await generateUserProfile(env, {
          userId,
          transcript,
          diaryContent: '',
          date,
          userName: detectedUserName || '这个人',
          previousProfile: previousProfile?.content || '',
          modelKey: null
        });
        await saveUserProfile(env, { userId, content: profile.raw });
      } catch (err) {
        request.log.warn({ err, userId, date }, '[ATRI] User profile update skipped (regenerate)');
      }

      const entry = await getDiaryEntry(env, userId, date);
      if (!entry) {
        return sendJson(reply, { error: 'save_failed' }, 500);
      }
      return sendJson(reply, { status: entry.status, entry });
    } catch (error: any) {
      request.log.error({ error, userId, date }, '[ATRI] Diary regenerate failed');
      return sendJson(reply, { status: 'error', error: String(error?.message || error) }, 500);
    }
  });
}
