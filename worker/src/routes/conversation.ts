import type { Router } from 'itty-router';
import { Env } from '../types';
import { jsonResponse } from '../utils/json-response';
import { sanitizeText } from '../utils/sanitize';
import {
  saveConversationLog,
  calculateDaysBetween,
  getLastConversationDate,
  deleteConversationLogsByIds
} from '../services/data-service';
import { DEFAULT_TIMEZONE, formatDateInZone } from '../utils/date';
import { requireAppToken } from '../utils/auth';

const VALID_ROLES = new Set(['user', 'atri']);

export function registerConversationRoutes(router: Router) {
  router.post('/conversation/log', async (request: Request, env: Env) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return auth;

      const body = await request.json();
      const userId = String(body.userId || '').trim();
      const role = String(body.role || '').trim();
      if (!userId || !VALID_ROLES.has(role)) {
        return jsonResponse({ error: 'invalid_params' }, 400);
      }

      const cleanedContent = sanitizeText(String(body.content || ''));
      if (!cleanedContent) {
        return jsonResponse({ error: 'empty_content' }, 400);
      }

      const result = await saveConversationLog(env, {
        id: typeof body.logId === 'string' ? body.logId : undefined,
        userId,
        role: role as 'user' | 'atri',
        content: cleanedContent,
        attachments: Array.isArray(body.attachments) ? body.attachments : undefined,
        mood: typeof body.mood === 'string' ? body.mood : undefined,
        timestamp: typeof body.timestamp === 'number' ? body.timestamp : undefined,
        userName: typeof body.userName === 'string' ? body.userName : undefined,
        timeZone: typeof body.timeZone === 'string' ? body.timeZone : undefined,
        date: typeof body.date === 'string' ? body.date : undefined
      });

      return jsonResponse({ ok: true, id: result.id, date: result.date });
    } catch (error: unknown) {
      console.error('[ATRI] conversation log error');
      return jsonResponse({ error: 'log_failed' }, 500);
    }
  });

  router.post('/conversation/delete', async (request: Request, env: Env) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return auth;

      const body = await request.json();
      const userId = String(body.userId || '').trim();
      const ids = Array.isArray(body.ids)
        ? body.ids.map((item: any) => String(item || '').trim()).filter(Boolean)
        : [];
      if (!userId || !ids.length) {
        return jsonResponse({ error: 'invalid_params' }, 400);
      }
      const changes = await deleteConversationLogsByIds(env, userId, ids);
      return jsonResponse({ ok: true, deleted: changes });
    } catch (error: unknown) {
      console.error('[ATRI] conversation delete error');
      return jsonResponse({ error: 'delete_failed' }, 500);
    }
  });

  router.get('/conversation/last', async (request: Request, env: Env) => {
    const auth = requireAppToken(request, env);
    if (auth) return auth;

    const { searchParams } = new URL(request.url);
    const userId = (searchParams.get('userId') || '').trim();
    const timeZone = (searchParams.get('timeZone') || DEFAULT_TIMEZONE).trim();
    const anchorDate =
      (searchParams.get('date') || formatDateInZone(Date.now(), timeZone)).trim();

    if (!userId) {
      return jsonResponse({ error: 'missing_user' }, 400);
    }

    try {
      const lastDate = await getLastConversationDate(env, userId, anchorDate);
      if (!lastDate) {
        return jsonResponse({ status: 'missing' });
      }
      const daysSince = calculateDaysBetween(lastDate, anchorDate);
      return jsonResponse({ status: 'ok', date: lastDate, daysSince });
    } catch (error: unknown) {
      console.error('[ATRI] conversation last error');
      return jsonResponse({ error: 'lookup_failed' }, 500);
    }
  });
}
