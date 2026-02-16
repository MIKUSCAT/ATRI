import type { Router } from 'itty-router';
import { Env } from '../types';
import { jsonResponse } from '../utils/json-response';
import { sanitizeText } from '../utils/sanitize';
import {
  saveConversationLog,
  fetchConversationLogsAfter,
  fetchTombstonesAfter,
  calculateDaysBetween,
  getLastConversationDate,
  deleteConversationLogsByIds,
  isConversationLogDeleted,
  markDiaryPending
} from '../services/data-service';
import { DEFAULT_TIMEZONE, formatDateInZone } from '../utils/date';
import { requireAppToken } from '../utils/auth';
import { deleteDiaryVectors } from '../services/memory-service';

const VALID_ROLES = new Set(['user', 'atri']);

export function registerConversationRoutes(router: Router) {
  router.post('/conversation/log', async (request: Request, env: Env) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return auth;

      const body = await request.json();
      const userId = String(body.userId || '').trim();
      const role = String(body.role || '').trim();
      const logId = typeof body.logId === 'string' ? body.logId.trim() : undefined;
      const replyToRaw =
        typeof body.replyTo === 'string'
          ? body.replyTo
          : typeof body.reply_to === 'string'
            ? body.reply_to
            : undefined;
      const replyTo = typeof replyToRaw === 'string' ? replyToRaw.trim() : undefined;
      if (!userId || !VALID_ROLES.has(role)) {
        return jsonResponse({ error: 'invalid_params' }, 400);
      }

      const cleanedContent = sanitizeText(String(body.content || ''));
      if (!cleanedContent) {
        return jsonResponse({ error: 'empty_content' }, 400);
      }

      if (logId && await isConversationLogDeleted(env, userId, logId)) {
        return jsonResponse({ ok: true, ignored: true });
      }
      if (replyTo && await isConversationLogDeleted(env, userId, replyTo)) {
        return jsonResponse({ ok: true, ignored: true });
      }

      const result = await saveConversationLog(env, {
        id: logId,
        userId,
        role: role as 'user' | 'atri',
        content: cleanedContent,
        attachments: Array.isArray(body.attachments) ? body.attachments : undefined,
        replyTo,
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

  router.get('/conversation/pull', async (request: Request, env: Env) => {
    const auth = requireAppToken(request, env);
    if (auth) return auth;

    const { searchParams } = new URL(request.url);
    const userId = String(searchParams.get('userId') || '').trim();
    if (!userId) {
      return jsonResponse({ error: 'missing_user' }, 400);
    }

    const afterRaw = Number(searchParams.get('after') || '0');
    const limitRaw = Number(searchParams.get('limit') || '50');
    const roleParam = String(searchParams.get('role') || '').trim();
    const includeTombstones = String(searchParams.get('tombstones') || '').trim() === 'true';

    const roles = roleParam
      ? roleParam.split(',').map((item) => item.trim()).filter((r) => VALID_ROLES.has(r))
      : [];

    try {
      const logs = await fetchConversationLogsAfter(env, {
        userId,
        after: Number.isFinite(afterRaw) ? afterRaw : 0,
        limit: Number.isFinite(limitRaw) ? limitRaw : undefined,
        roles: roles as Array<'user' | 'atri'>
      });

      if (includeTombstones) {
        const tombstones = await fetchTombstonesAfter(env, {
          userId,
          after: Number.isFinite(afterRaw) ? afterRaw : 0,
          limit: 100
        });
        return jsonResponse({ logs, tombstones });
      }

      return jsonResponse({ logs });
    } catch (error: unknown) {
      console.error('[ATRI] conversation pull error');
      return jsonResponse({ error: 'pull_failed' }, 500);
    }
  });

  router.post('/conversation/invalidate-memory', async (request: Request, env: Env) => {
    try {
      const auth = requireAppToken(request, env);
      if (auth) return auth;

      const body = await request.json().catch(() => ({} as any));
      const userId = String(body?.userId || '').trim();
      const date = String(body?.date || '').trim();

      if (!userId || !date) {
        return jsonResponse({ error: 'invalid_params' }, 400);
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return jsonResponse({ error: 'invalid_date_format' }, 400);
      }

      const MAX_HIGHLIGHTS_PER_DAY = 10;
      const idsToDelete: string[] = [];
      for (let i = 0; i < MAX_HIGHLIGHTS_PER_DAY; i++) {
        idsToDelete.push(`hl:${userId}:${date}:${i}`);
      }

      const deleted = await deleteDiaryVectors(env, idsToDelete);
      await markDiaryPending(env, userId, date);

      return jsonResponse({ ok: true, deleted, date });
    } catch (error: unknown) {
      console.error('[ATRI] conversation invalidate-memory error', error);
      return jsonResponse({ error: 'invalidate_failed' }, 500);
    }
  });
}
