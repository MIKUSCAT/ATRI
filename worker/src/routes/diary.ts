import type { Router } from 'itty-router';
import { Env } from '../types';
import { jsonResponse } from '../utils/json-response';
import {
  buildConversationTranscript,
  fetchConversationLogs,
  getDiaryEntry,
  listDiaryEntries,
  saveDiaryEntry
} from '../services/data-service';
import { generateDiaryFromConversation } from '../services/diary-generator';
import { upsertDiaryMemory } from '../services/memory-service';

export function registerDiaryRoutes(router: Router) {
  router.get('/diary', async (request, env: Env) => {
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

  router.get('/diary/list', async (request, env: Env) => {
    const { searchParams } = new URL(request.url);
    const userId = searchParams.get('userId') || '';
    const limit = Number(searchParams.get('limit') || '7');
    if (!userId) {
      return jsonResponse({ error: 'missing_params' }, 400);
    }
    const entries = await listDiaryEntries(env, userId, Math.min(Math.max(limit, 1), 30));
    return jsonResponse({ entries });
  });

  router.post('/diary/generate', async (request, env: Env) => {
    try {
      const body = await request.json();
      const userId: string | undefined = body.userId;
      const providedConversation: string | undefined = body.conversation;
      const date: string | undefined = body.date;
      const userName: string | undefined = body.userName;
      const timestamp: number | undefined = body.timestamp;

      let conversation = providedConversation;
      if (!conversation && userId && date) {
        const logs = await fetchConversationLogs(env, userId, date);
        conversation = buildConversationTranscript(logs, userName || '你');
      }

      if (!conversation) {
        return jsonResponse({ error: 'missing_conversation' }, 400);
      }

      console.log('[ATRI] Generating diary for user:', userId || 'manual');
      const diary = await generateDiaryFromConversation(env, {
        conversation,
        userName,
        timestamp
      });

      let saved = false;
      if (userId && date && body.persist !== false) {
        const summaryText = diary.highlights.length
          ? diary.highlights.join('；')
          : diary.content.slice(0, 80);
        const savedEntry = await saveDiaryEntry(env, {
          userId,
          date,
          content: diary.content,
          summary: summaryText,
          mood: diary.mood,
          status: 'ready'
        });
        await upsertDiaryMemory(env, {
          entryId: savedEntry.id,
          userId,
          date,
          mood: diary.mood,
          content: diary.content,
          timestamp: diary.timestamp
        });
        saved = true;
      }

      return jsonResponse({
        content: diary.content,
        mood: diary.mood,
        highlights: diary.highlights,
        saved
      });
    } catch (error: any) {
      console.error('[ATRI] Failed to generate diary:', error);
      return jsonResponse({ error: 'diary_failed', details: String(error?.message || error) }, 500);
    }
  });

  router.post('/diary/index', async (request, env: Env) => {
    try {
      const { userId, date, content, mood } = await request.json();
      if (!userId || !date || !content) {
        return jsonResponse({ error: 'missing_params' }, 400);
      }
      const summaryText = mood ? `${mood}：${content.slice(0, 40)}` : content.slice(0, 80);
      const savedEntry = await saveDiaryEntry(env, {
        userId,
        date,
        content,
        summary: summaryText,
        mood,
        status: 'ready'
      });
      await upsertDiaryMemory(env, {
        entryId: savedEntry.id,
        userId,
        date,
        mood,
        content,
        timestamp: Date.now()
      });
      return jsonResponse({ entry: savedEntry });
    } catch (error: any) {
      console.error('[ATRI] Diary index error:', error);
      return jsonResponse({ error: 'index_failed', details: String(error?.message || error) }, 500);
    }
  });
}
